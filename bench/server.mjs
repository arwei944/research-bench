/**
 * bench 统一服务平台。
 *
 * 一个进程，多应用。每个应用在 bench/apps/<id>/ 下自描述：
 *   app.json     元数据
 *   server.mjs   导出 routes 表（"METHOD /path": handler）
 *   public/      静态文件
 *
 * 平台职责：
 *   /                    外壳页（顶部应用切换 + iframe 内容区 + 主题）
 *   /app/<id>/           该应用的前端（从它的 public/ 取）
 *   /api/<id>/<route>    该应用的后端（从它的 server.mjs 取）
 *   /api/_platform/*     平台自身：应用增删改查、主题、健康
 *
 * 热发现：每次请求 /api/_platform/apps 都重新扫描 apps/，
 * 所以新增/删除目录立刻可见，无需重启。
 */

import http from "node:http";
import path from "node:path";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";


// ---------------------------------------------------------------------------
// 代理：直接在启动时由 bench.mjs 注入 NODE_USE_ENV_PROXY=1。
//
// 这里刻意**不再**用 spawnSync 重启自身——那会产生双 PID，
// 启动器记录的 PID 不是真正监听的那个，导致：
//   - stop 杀不掉服务（端口残留）
//   - 残留进程占住 7800，新实例被迫换端口
//   - 用户看到「地址栏端口」和「实际端口」不一致，最终拒绝连接
// ---------------------------------------------------------------------------

import * as registry from "./lib/registry.mjs";
import * as scaffold from "./lib/scaffold.mjs";
import * as mode from "./lib/mode.mjs";
import * as designs from "./lib/designs.mjs";
import * as layers from "./lib/layers.mjs";
import * as knowledgeBase from "./lib/knowledge-base.mjs";
import * as icons from "./lib/icons.mjs";
import { readdirSync } from "node:fs";


const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// .pi/skills 扫描
// ---------------------------------------------------------------------------
const SKILLS_ROOT = path.resolve(HERE, "..", ".pi", "skills");

function listSkills() {
  if (!existsSync(SKILLS_ROOT)) return [];
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(SKILLS_ROOT); } catch { return []; }
  for (const name of dirs) {
    const dir = path.join(SKILLS_ROOT, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const f = path.join(dir, "SKILL.md");
    if (!existsSync(f)) continue;
    let txt = "";
    try { txt = readFileSync(f, "utf8"); } catch { continue; }

    // 解析 frontmatter 的 name / description
    const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let meta = {};
    if (fm) {
      for (const line of fm[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim();
      }
    }
    out.push({
      id: name,
      name: meta.name || name,
      description: meta.description || "",
      size: Buffer.byteLength(txt),
      modified: st.mtime.toISOString(),
      files: countFiles(dir),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function countFiles(dir) {
  let n = 0;
  try {
    for (const x of readdirSync(dir)) {
      const p = path.join(dir, x);
      try { if (statSync(p).isDirectory()) n += countFiles(p); else n++; } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return n;
}

function readSkill(name) {
  const clean = String(name ?? "").replace(/[^a-z0-9-]/gi, "");
  if (!clean) return { ok: false, error: "缺少 name" };
  const f = path.join(SKILLS_ROOT, clean, "SKILL.md");
  if (!existsSync(f)) return { ok: false, error: "技能不存在" };
  try {
    return { ok: true, id: clean, content: readFileSync(f, "utf8") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

import { bench as kb } from "./kernel/index.mjs";
import * as capabilities from "./lib/capabilities/index.mjs";
import * as observe from "./kernel/observe.mjs";

const PORT = Number(process.env.BENCH_PORT ?? (process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 7800));
const HOST = process.env.BENCH_HOST ?? "127.0.0.1";

// ---------------------------------------------------------------------------
// 应用路由缓存（按 mtime 失效 → 改 server.mjs 也热更新）
// ---------------------------------------------------------------------------
const routeCache = new Map(); // id -> { mtime, routes }

async function loadRoutes(id) {
  const info = registry.get(id);
  if (!info) return null;
  const sf = path.join(info.dir, "server.mjs");
  if (!existsSync(sf)) return {};
  let mtime;
  try { mtime = statSync(sf).mtimeMs; } catch { return {}; }

  const cached = routeCache.get(id);
  if (cached && cached.mtime === mtime) {
    return { routes: cached.routes, dynamic: cached.dynamic ?? [] };
  }

  try {
    const mod = await import(pathToFileURL(sf).href + `?t=${mtime}`);
    const routes = mod.routes ?? {};
    const dynamic = Array.isArray(mod.dynamicRoutes) ? mod.dynamicRoutes : [];
    routeCache.set(id, { mtime, routes, dynamic });
    return { routes, dynamic };
  } catch (e) {
    console.error(`[app:${id}] 加载 server.mjs 失败:`, e.message);
    return { routes: { __error: String(e.message) }, dynamic: [] };
  }
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
function json(res, code, data) {
  const b = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(b),
    "Cache-Control": "no-store",
  });
  res.end(b);
}
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req, limit = 8 << 20) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const cs = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) { reject(new Error("body too large")); req.destroy(); return; }
      cs.push(c);
    });
    req.on("end", () => {
      const s = Buffer.concat(cs).toString("utf8");
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

function safeJoin(base, rel) {
  const p = path.resolve(base, rel || ".");
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) return null;
  return p;
}

// ---------------------------------------------------------------------------
// 主题（persist 到 bench/data/theme.json）
// ---------------------------------------------------------------------------
const THEME_FILE = path.join(HERE, "data", "theme.json");
function readTheme() {
  try {
    const t = JSON.parse(readFileSync(THEME_FILE, "utf8"));
    return { mode: t.mode === "light" ? "light" : "dark" };
  } catch {
    return { mode: "dark" };
  }
}
function writeTheme(t) {
  try {
    mkdirSync(path.dirname(THEME_FILE), { recursive: true });
    writeFileSync(THEME_FILE, JSON.stringify(t, null, 2), "utf8");
  } catch {
    /* 写不了也不阻塞当前请求 */
  }
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const traceId = observe.newTraceId();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);
  const m = req.method ?? "GET";

  // 把 traceId 回传给客户端，便于串联日志
  res.setHeader("X-Bench-Trace", traceId);

  // 在响应结束时记录（无论成功失败）
  const recordOnce = () => {
    if (res.__benchRecorded) return;
    res.__benchRecorded = true;
    const appId = p.startsWith("/api/") && !p.startsWith("/api/_platform")
      ? p.split("/")[2] || null
      : null;
    try {
      observe.record({
        traceId,
        method: m,
        path: p,
        status: res.statusCode || 200,
        ms: Date.now() - t0,
        appId,
      });
    } catch { /* 观测失败不能影响主流程 */ }
  };
  res.on("finish", recordOnce);
  res.on("close", recordOnce);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (m === "OPTIONS") { res.writeHead(204); return res.end(); }

  try {
    // ---------- 外壳页 ----------
    if (p === "/" || p === "/index.html") {
      const f = path.join(HERE, "public", "shell.html");
      if (!existsSync(f)) return send(res, 500, "public/shell.html 缺失", "text/plain");
      return send(res, 200, readFileSync(f, "utf8"), MIME[".html"]);
    }
    // 体检与知识层已并入首页（Tab 切换），旧地址保留为重定向，避免书签失效
    if (p === "/status") {
      res.writeHead(302, { Location: "/#health" });
      return res.end();
    }
    if (p === "/kernel") {
      res.writeHead(302, { Location: "/#kernel" });
      return res.end();
    }
    if (p === "/designs") {
      const f = path.join(HERE, "public", "designs.html");
      if (!existsSync(f)) return send(res, 500, "public/designs.html 缺失", "text/plain");
      return send(res, 200, readFileSync(f, "utf8"), MIME[".html"]);
    }
    // 图标 sprite：一次加载，全站 <use> 引用
    if (p === "/static/icons.svg") {
      return send(res, 200, icons.iconSprite(), "image/svg+xml; charset=utf-8");
    }
    if (p.startsWith("/static/")) {
      const f = safeJoin(path.join(HERE, "public"), p.slice("/static/".length));
      if (!f || !existsSync(f)) return json(res, 404, { error: "not found" });
      return send(res, 200, readFileSync(f), MIME[path.extname(f)] ?? "application/octet-stream");
    }

    // ---------- 平台 API ----------
    if (p === "/api/_platform/ping") return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });

    // ---------- 内核视图（跨应用的知识层） ----------
    // 直接用门面的 dashboard()，平台不再关心内核内部结构
    if (p === "/api/_platform/kernel" && m === "GET") {
      const d = kb.dashboard();
      return json(res, 200, {
        claims: d.claims.map((c) => ({
          id: c.id,
          text: c.text,
          status: c.digest.status,
          confidence: c.confidence,
          tags: c.tags ?? [],
          note: c.note ?? "",
          createdAt: c.createdAt,
          evidenceCount: c.digest.evidenceCount,
          byTier: c.digest.byTier,
          warning: c.digest.warning,
          evidences: c.evidences,
        })),
        stats: d.stats,
        loop: d.loop,
        events: d.events.slice(0, 20),
      });
    }

    // ---------- 技能（.pi/skills/） ----------
    // Pi Agent 侧的技能定义，工作台之前完全不认识它们。
    // 现在可列、可读，让「工作台里的应用」和「Agent 侧的技能」能对上号。
    if (p === "/api/_platform/skills" && m === "GET") {
      return json(res, 200, { skills: listSkills(), root: SKILLS_ROOT });
    }

    if (p === "/api/_platform/skills/read" && m === "GET") {
      const r = readSkill(url.searchParams.get("name") || "");
      return r.ok ? json(res, 200, r) : json(res, 400, { error: r.error });
    }

    // ---------- 知识库（knowledge-base/） ----------
    // AGENTS.md 规定的沉淀位置，现在工作台可列/可读/可写
    if (p === "/api/_platform/kb" && m === "GET") {
      const domain = url.searchParams.get("domain") || undefined;
      return json(res, 200, {
        stats: knowledgeBase.stats(),
        domains: knowledgeBase.domainList,
        files: knowledgeBase.listFiles({ domain }),
      });
    }

    if (p === "/api/_platform/kb/read" && m === "GET") {
      const r = knowledgeBase.readFile(url.searchParams.get("path") || "");
      return r.ok ? json(res, 200, r) : json(res, 400, { error: r.error });
    }

    if (p === "/api/_platform/kb/write" && m === "POST") {
      const b = await readBody(req);
      const r = knowledgeBase.writeFile(String(b.path ?? ""), String(b.content ?? ""));
      return r.ok ? json(res, 200, r) : json(res, 400, { error: r.error });
    }

    if (p === "/api/_platform/kb/deposit" && m === "POST") {
      const b = await readBody(req);
      const r = knowledgeBase.deposit({
        domain: String(b.domain ?? "inbox"),
        title: String(b.title ?? ""),
        body: String(b.body ?? ""),
        meta: b.meta ?? {},
      });
      return r.ok ? json(res, 200, r) : json(res, 400, { error: r.error });
    }

    if (p === "/api/_platform/apps" && m === "GET") {
      const apps = registry.discover();
      const impact = layers.impactChain(apps);
      const summary = layers.edgeSummary(apps);
      return json(res, 200, {
        apps,
        templates: scaffold.templateList,
        layers: layers.LAYERS,
        grouped: layers.group(apps),
        // 影响链：appId -> 它会连带影响的应用
        impact: Object.fromEntries(impact),
        edges: summary.edges,
        edgeStats: { total: summary.edges.length, crossLayer: summary.crossLayer, violations: summary.violations },
      });
    }
    // 运行时健康探测：真正加载每个应用的 server.mjs，报告谁能用
    if (p === "/api/_platform/apps/health" && m === "GET") {
      const apps = registry.discover();
      const rows = await Promise.all(
        apps.map(async (a) => {
          if (!a.hasServer) return { id: a.id, ok: true, note: "无后端（纯静态）" };
          const loaded = await loadRoutes(a.id);
          if (!loaded) return { id: a.id, ok: false, note: "加载失败" };
          if (loaded.routes?.__error) return { id: a.id, ok: false, note: loaded.routes.__error };
          return { id: a.id, ok: true, note: null, routes: Object.keys(loaded.routes ?? {}).length };
        }),
      );
      const bad = rows.filter((r) => !r.ok);
      return json(res, 200, { total: rows.length, ok: rows.length - bad.length, bad: bad.length, apps: rows, at: new Date().toISOString() });
    }

    if (p === "/api/_platform/layers" && m === "GET") {
      const apps = registry.discover();
      const impact = layers.impactChain(apps);
      const summary = layers.edgeSummary(apps);
      return json(res, 200, {
        layers: layers.LAYERS,
        grouped: layers.group(apps),
        impact: Object.fromEntries(impact),
        edges: summary.edges,
        edgeStats: { total: summary.edges.length, crossLayer: summary.crossLayer, violations: summary.violations },
      });
    }

    if (p === "/api/_platform/apps" && m === "POST") {
      const b = await readBody(req);
      try {
        const r = scaffold.create(String(b.id ?? ""), { name: b.name, icon: b.icon, template: b.template });
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // 改层（转正 / 降级）
    {
      const mm = p.match(/^\/api\/_platform\/apps\/([^/]+)\/layer$/);
      if (mm && (m === "POST" || m === "PUT")) {
        const id = decodeURIComponent(mm[1]);
        const b = await readBody(req);
        try {
          const r = scaffold.setLayer(id, String(b.layer ?? ""));
          return json(res, 200, { ok: true, ...r });
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
    }

    if (p.startsWith("/api/_platform/apps/") && m === "DELETE") {
      const id = p.slice("/api/_platform/apps/".length);
      try {
        const r = scaffold.remove(id, { force: url.searchParams.get("force") === "1" });
        return json(res, 200, { ok: true, ...r });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    if (p === "/api/_platform/theme" && m === "GET") return json(res, 200, readTheme());
    if (p === "/api/_platform/theme" && m === "POST") {
      const b = await readBody(req);
      const t = { mode: b.mode === "light" ? "light" : "dark" };
      writeTheme(t);
      return json(res, 200, t);
    }

    // ---------- 模式（专家 / 小白） ----------
    if (p === "/api/_platform/mode" && m === "GET") {
      return json(res, 200, { ...mode.read(), appId: url.searchParams.get("app") || null });
    }
    if (p === "/api/_platform/mode" && m === "POST") {
      const b = await readBody(req);
      const next = mode.write({ mode: b.mode, perApp: b.perApp });
      return json(res, 200, next);
    }
    if (p === "/api/_platform/mode/preview" && m === "GET") {
      // 实时预览：返回同一份内容在两种模式下的渲染结果，供并排对比
      const sample = url.searchParams.get("sample") || "default";
      return json(res, 200, mode.preview(sample));
    }

    // ---------- 设计（10 款供选择） ----------
    if (p === "/api/_platform/designs" && m === "GET") {
      return json(res, 200, { designs: designs.list(), current: designs.readCurrent() });
    }
    if (p === "/api/_platform/design" && m === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, designs.writeCurrent(String(b.id ?? "")));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    // ---------- 一屏体检：把各维度聚合成一个可判读的状态 ----------
    if (p === "/api/_platform/status" && m === "GET") {
      const apps = registry.discover();
      const obs = observe.health();
      const kstats = kb.stats();

      // 逐应用探测后端
      const appHealth = await Promise.all(apps.map(async (a) => {
        const base = { id: a.id, name: a.name, layer: a.layer, layerName: a.layerMeta?.name ?? a.layer };
        if (!a.hasServer) return { ...base, ok: true, note: "纯静态" };
        const loaded = await loadRoutes(a.id);
        if (!loaded) return { ...base, ok: false, note: "加载失败" };
        if (loaded.routes?.__error) return { ...base, ok: false, note: loaded.routes.__error };
        return { ...base, ok: true, note: `${Object.keys(loaded.routes ?? {}).length} 路由` };
      }));
      const brokenApps = appHealth.filter((x) => !x.ok);

      // 闭环检查：直接用门面的 dashboard（不再碰内核内部）
      const kd = kb.dashboard();
      const c = kstats.counts;
      const loop = {
        artifacts: c.artifact ?? 0,
        claims: c.claim ?? 0,
        runs: c.run ?? 0,
        evidences: c.evidence ?? 0,
        closed: kd.loop.closed,
        orphanClaims: kd.loop.orphanClaims,
        ungatedRuns: kd.loop.ungatedRuns,
      };

      const issues = [];
      // 能力降级也算问题（必须可见）
      const deg = capabilities.degrade.overview();
      for (const c of deg.capabilities) {
        if (c.status === "ok") continue;
        issues.push({
          level: c.status === "unavailable" ? "err" : "warn",
          msg: `能力「${c.name}」${c.status === "unavailable" ? "不可用" : "降级"}：${c.reason ?? "未知原因"}` +
               (deg.impact[c.name] ? ` → 影响：${deg.impact[c.name].join("、")}` : ""),
        });
      }

      if (brokenApps.length) issues.push({ level: "err", msg: `${brokenApps.length} 个应用后端异常：${brokenApps.map((x) => x.id).join(", ")}` });
      if (obs.status === "unhealthy") issues.push({ level: "err", msg: "观测指标判断为 unhealthy" });
      if (obs.issues?.length) obs.issues.forEach((m) => issues.push({ level: "warn", msg: m }));
      if (kstats.health.claimsWithUngatedEvidence > 0) issues.push({ level: "err", msg: `${kstats.health.claimsWithUngatedEvidence} 条结论的证据未经闸门` });
      if (loop.orphanClaims > 0) issues.push({ level: "warn", msg: `${loop.orphanClaims} 条结论没有证据（draft 状态）` });
      if (loop.ungatedRuns > 0) issues.push({ level: "warn", msg: `${loop.ungatedRuns} 次实验未经闸门` });
      if (!loop.closed && loop.claims > 0) issues.push({ level: "warn", msg: "闭环未成立：没有任何结论被 A 级证据支撑" });

      const status = issues.some((i) => i.level === "err")
        ? "unhealthy"
        : issues.length
          ? "degraded"
          : "healthy";

      return json(res, 200, {
        status,
        issues,
        process: {
          pid: process.pid,
          node: process.version,
          platform: process.platform,
          uptimeSec: Math.round(process.uptime()),
          memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
        apps: { total: apps.length, broken: brokenApps.length, detail: appHealth },
        layers: layers.group(apps).map((g) => ({ id: g.id, name: g.name, count: g.apps.length })),
        kernel: kstats,
        capabilities: {
          evaluator: capabilities.evaluator.apps(),
          llm: capabilities.llm.snapshot(),
          searchChannels: capabilities.search.CHANNELS.length,
          degrade: capabilities.degrade.overview(),
        },
        loop,
        observability: obs,
        at: new Date().toISOString(),
      });
    }

    if (p === "/api/_platform/capabilities" && m === "GET") {
      return json(res, 200, {
        overview: capabilities.degrade.overview(),
        evaluator: capabilities.evaluator.apps(),
        llm: capabilities.llm.snapshot(),
        search: { channels: capabilities.search.CHANNELS.length },
        at: new Date().toISOString(),
      });
    }

    if (p === "/api/_platform/metrics" && m === "GET") {
      return json(res, 200, observe.snapshot());
    }

    if (p === "/api/_platform/metrics/health" && m === "GET") {
      return json(res, 200, observe.health());
    }

    if (p === "/api/_platform/trace" && m === "GET") {
      const limit = Number(url.searchParams.get("limit")) || 60;
      return json(res, 200, { entries: observe.traceLog(limit) });
    }

    if (p === "/api/_platform/health") {
      const apps = registry.discover();
      const obs = observe.health();
      return json(res, 200, {
        ok: obs.status !== "unhealthy",
        uptime: Math.round(process.uptime()),
        status: obs.status,
        issues: obs.issues,
        metrics: { totalRequests: obs.totalRequests, uptimeSec: obs.uptimeSec },
        apps: apps.map((a) => ({ id: a.id, name: a.name, ok: !a.error, error: a.error })),
        at: new Date().toISOString(),
      });
    }

    // ---------- 应用前端：/app/<id>/... ----------
    if (p.startsWith("/app/")) {
      const rest = p.slice("/app/".length);
      const slash = rest.indexOf("/");
      const id = slash < 0 ? rest : rest.slice(0, slash);
      let rel = slash < 0 ? "" : rest.slice(slash + 1);
      const info = registry.get(id);
      if (!info) return send(res, 404, `应用 ${id} 不存在`, "text/plain; charset=utf-8");
      const pub = path.join(info.dir, "public");
      if (!existsSync(pub)) return send(res, 404, `应用 ${id} 没有 public/`, "text/plain; charset=utf-8");
      if (!rel || rel.endsWith("/")) rel = (rel + (info.meta?.entry ?? "index.html"));
      const f = safeJoin(pub, rel);
      if (!f || !existsSync(f) || statSync(f).isDirectory()) {
        return send(res, 404, `未找到 ${rel}`, "text/plain; charset=utf-8");
      }
      return send(res, 200, readFileSync(f), MIME[path.extname(f)] ?? "application/octet-stream");
    }

    // ---------- 应用后端：/api/<id>/<route> ----------
    if (p.startsWith("/api/")) {
      const rest = p.slice("/api/".length);
      const slash = rest.indexOf("/");
      const id = slash < 0 ? rest : rest.slice(0, slash);
      const sub = slash < 0 ? "/" : rest.slice(slash);
      if (!registry.get(id)) return json(res, 404, { error: `应用 ${id} 不存在` });

      const loaded = await loadRoutes(id);
      if (!loaded) return json(res, 404, { error: "应用无后端" });
      const routes = loaded.routes ?? {};
      const dynamic = loaded.dynamic ?? [];
      if (routes.__error) return json(res, 500, { error: `server.mjs 加载失败: ${routes.__error}` });

      let body = {};
      if (m === "POST" || m === "PUT" || m === "PATCH") body = await readBody(req);
      const ctx = { req, res, url, id, method: m, path: sub };

      // ---- 路由匹配：精确优先，其次动态正则 ----
      const key = `${m} ${sub}`;
      let handler = routes[key];
      let out;
      let matched = false;

      if (handler) {
        matched = true;
        out = await handler(ctx, body);
      } else {
        for (const d of dynamic) {
          if (d.method !== m) continue;
          const mm = sub.match(d.pattern);
          if (!mm) continue;
          matched = true;
          out = await d.handler(ctx, body, mm);
          break;
        }
      }

      if (!matched) {
        return json(res, 404, {
          error: `路由不存在: ${key}`,
          available: Object.keys(routes).filter((k) => !k.startsWith("__")),
        });
      }
      if (out === undefined) return; // handler 自己写了响应

      // ---- 特殊返回约定 ----
      if (out && typeof out === "object") {
        if (out.__raw !== undefined) {
          return send(res, out.__status ?? 200, String(out.__raw), out.__type ?? "text/plain; charset=utf-8");
        }
        if (out.__status && out.error) {
          return json(res, out.__status, { error: out.error });
        }
      }
      return json(res, 200, out);
    }

    return json(res, 404, { error: `未知路径 ${p}` });
  } catch (e) {
    console.error("[bench]", m, p, "→", e.message);
    return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// 崩溃必须留痕，否则「服务莫名消失」无法排查
process.on("uncaughtException", (e) => {
  console.error(`[bench] uncaughtException ${new Date().toISOString()}:`, e?.stack || e);
});
process.on("unhandledRejection", (e) => {
  console.error(`[bench] unhandledRejection ${new Date().toISOString()}:`, e instanceof Error ? e.stack : e);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[bench] 收到 ${sig}，退出`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

server.on("error", (e) => {
  console.error(`[bench] 监听失败 ${HOST}:${PORT} —`, e.code === "EADDRINUSE" ? "端口已被占用" : e.message);
  process.exit(1);
});

/**
 * 启动时探测能力层状态（异步，不阻塞监听）。
 * 这样 /status 一打开就能看到「哪些能力现在就绪」。
 */
async function bootstrapCapabilities() {
  // LLM
  try {
    const p = await capabilities.llm.probe();
    // 超时是「慢」不是「不可用」——降级而非不可用
    const isTimeout = !p.ok && /abort|timeout/i.test(p.error ?? "");
    capabilities.degrade.report("llm", p.ok ? "ok" : isTimeout ? "degraded" : "unavailable", p.ok ? null : p.error);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    capabilities.degrade.report("llm", /abort|timeout/i.test(msg) ? "degraded" : "unavailable", msg);
  }

  // 检索（用通道可用率判定）
  try {
    const s = await capabilities.search.probeAll(2);
    const ratio = s.ok / s.total;
    capabilities.degrade.report(
      "search",
      ratio >= 0.8 ? "ok" : ratio >= 0.4 ? "degraded" : "unavailable",
      ratio >= 0.8 ? null : `${s.ok}/${s.total} 个通道可用`,
    );
  } catch (e) {
    capabilities.degrade.report("search", "unavailable", e instanceof Error ? e.message : String(e));
  }

  // 判分器：需要先加载应用模块（它们才会注册任务），所以延迟判定
  // 这里先标记为 unknown 状态，等应用第一次被访问或 3 秒后再判
  setTimeout(async () => {
    try {
      // 强制加载有后端的应用，触发它们注册任务
      const apps = registry.discover().filter((a) => a.hasServer);
      for (const a of apps) await loadRoutes(a.id);
      const list = capabilities.evaluator.apps();
      const total = list.reduce((n, x) => n + x.tasks, 0);
      capabilities.degrade.report("evaluator", total > 0 ? "ok" : "unavailable", total > 0 ? null : "没有任务注册");
    } catch (e) {
      capabilities.degrade.report("evaluator", "unavailable", e instanceof Error ? e.message : String(e));
    }
  }, 3000);
}

server.listen(PORT, HOST, () => {
  const apps = registry.discover();
  console.log(`bench 已启动  http://${HOST}:${PORT}`);
  console.log(`应用目录 ${registry.APPS_ROOT}`);
  console.log(`已发现 ${apps.length} 个应用：${apps.map((a) => `${a.icon}${a.name}`).join("  ")}`);
  console.log(`新增应用：node bench/bench.mjs new <id>   或从 Web UI 的「应用管理」`);
  // 后台探测能力层
  bootstrapCapabilities().then(() => {
    const o = capabilities.degrade.overview();
    console.log(`能力层探测完成：${o.status}（${o.capabilities.map((c) => c.name + "=" + c.status).join(", ")}）`);
  }).catch(() => {});
});
