/**
 * 脚手架 —— 一键新建 / 删除应用。
 *
 * 命令行：
 *   node bench/bench.mjs new   <id> [--name "显示名"] [--icon "🔧"] [--template blank|api|data]
 *   node bench/bench.mjs rm    <id> [--force]
 *   node bench/bench.mjs list
 *
 * 也可以从 Web UI 调用（POST /api/_platform/apps），走同一套函数。
 *
 * 新建出来的应用默认是**可直接运行**的：有自己的页面、API、数据目录。
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { APPS_ROOT, appDir, discover } from "./registry.mjs";
import { isValidLayer } from "./layers.mjs";

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export function validateId(id) {
  if (!ID_RE.test(String(id || ""))) {
    return "id 必须是小写字母开头、只含小写字母/数字/连字符，长度 2-31";
  }
  return null;
}

// ---------------------------------------------------------------------------
// 模板
// ---------------------------------------------------------------------------

const TEMPLATES = {
  blank: {
    label: "空白页",
    desc: "只有一个页面，什么都要自己写",
    files: (id, name, icon) => ({
      "app.json": JSON.stringify(
        { id, name, icon, tagline: "一句话说明这个应用做什么", color: "#5b93f8", order: 100, version: "1.0.0" },
        null, 2,
      ),
      "public/index.html": `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${name}</title>
<style>
  /* 这些变量由 bench 平台注入（含浅色/深色）；这里的兜底值只用于独立打开时 */
  :root { --bg:#0b0d12; --panel:#12151d; --elev:#181c26; --line:#232936;
          --fg:#e8ecf4; --fg2:#a2adc0; --fg3:#697586; --ac:#5b93f8; }
  [data-theme="light"] { --bg:#f6f7f9; --panel:#fff; --elev:#f0f2f5; --line:#e2e6ec;
          --fg:#161b22; --fg2:#4c5866; --fg3:#7b8794; --ac:#2563eb; }
  body { margin:0; padding:32px; font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
         background:var(--bg); color:var(--fg); }
  h1 { font-size:20px; margin:0 0 8px; }
  .muted { color:var(--fg3); font-size:12.5px; }
  .box { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin-top:18px; }
  code { background:var(--elev); padding:1px 5px; border-radius:4px;
         font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  button { background:var(--ac); color:#fff; border:none; border-radius:8px;
           padding:8px 16px; cursor:pointer; font:inherit; }
  pre { background:var(--elev); border:1px solid var(--line); border-radius:8px;
        padding:11px; overflow:auto; font-family:ui-monospace,Consolas,monospace; font-size:12px; }
</style></head>
<body>
  <h1>${icon} ${name}</h1>
  <p class="muted">这个应用由 bench 脚手架生成。改 <code>apps/${id}/public/index.html</code> 后刷新即可。</p>
  <div class="box">
    <button id="ping">测试后端</button>
    <pre id="out" class="muted" style="margin-top:12px"></pre>
  </div>
  <script>
    // 平台在 iframe 里注入主题变量；这里直接用即可
    document.getElementById("ping").onclick = async () => {
      const r = await fetch("/api/${id}/ping");
      document.getElementById("out").textContent = await r.text();
    };
  </script>
</body></html>
`,
      "server.mjs": `/** ${name} —— 后端路由。平台自动挂载到 /api/${id}。 */
export const routes = {
  "GET /ping": async () => ({ ok: true, app: "${id}", at: new Date().toISOString() }),
};
`,
    }),
  },

  api: {
    label: "带 API",
    desc: "前后端交互，含示例接口",
    files: (id, name, icon) => ({
      "app.json": JSON.stringify(
        { id, name, icon, tagline: "带 API 的应用", color: "#34d399", order: 100, version: "1.0.0" },
        null, 2,
      ),
      "public/index.html": `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${name}</title>
<style>
  :root { --bg:#0b0d12; --panel:#12151d; --elev:#181c26; --line:#232936;
          --fg:#e8ecf4; --fg2:#a2adc0; --fg3:#697586; --ac:#5b93f8; }
  [data-theme="light"] { --bg:#f6f7f9; --panel:#fff; --elev:#f0f2f5; --line:#e2e6ec;
          --fg:#161b22; --fg2:#4c5866; --fg3:#7b8794; --ac:#2563eb; }
  body { margin:0; padding:28px; font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
         background:var(--bg); color:var(--fg); }
  h1 { font-size:19px; margin:0 0 6px; }
  .muted { color:var(--fg3); font-size:12.5px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; margin-top:14px; }
  input,button { font:inherit; }
  input { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 11px; color:var(--fg); width:min(320px,60%); }
  button { background:var(--ac); color:#fff; border:none; border-radius:8px; padding:8px 16px; cursor:pointer; }
  code { background:var(--elev); padding:1px 5px; border-radius:4px;
         font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:11px; overflow:auto;
        font-family:ui-monospace,Consolas,monospace; font-size:12px; }
</style></head>
<body>
  <h1>${icon} ${name}</h1>
  <p class="muted">带 API 的示例应用。数据存在 <code>apps/${id}/data/</code>。</p>
  <div class="card">
    <input id="text" placeholder="输入点什么" />
    <button id="add">追加</button>
    <button id="list" style="background:var(--elev);color:var(--fg2)">刷新列表</button>
    <pre id="out">（点按钮）</pre>
  </div>
  <script>
    const out = document.getElementById("out");
    const api = async (p, o) => (await fetch("/api/${id}" + p, { headers: {"Content-Type":"application/json"}, ...o })).json();
    document.getElementById("add").onclick = async () => {
      const v = document.getElementById("text").value.trim();
      if (!v) return;
      await api("/items", { method: "POST", body: JSON.stringify({ text: v }) });
      document.getElementById("text").value = "";
      list();
    };
    document.getElementById("list").onclick = list;
    async function list() { out.textContent = JSON.stringify(await api("/items"), null, 2); }
    list();
  </script>
</body></html>
`,
      "server.mjs": `/** ${name} —— 带持久化的示例。数据落在 apps/${id}/data/items.json */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.dirname(fileURLToPath(import.meta.url)) + "/data";
const FILE = path.join(DATA, "items.json");

function load() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; }
}
function save(v) {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  writeFileSync(FILE, JSON.stringify(v, null, 2), "utf8");
}

export const routes = {
  "GET /items": async () => ({ items: load() }),

  "POST /items": async (_ctx, body) => {
    const items = load();
    items.push({ text: String(body.text ?? ""), at: new Date().toISOString() });
    save(items);
    return { ok: true, count: items.length };
  },

  "DELETE /items": async () => {
    save([]);
    return { ok: true };
  },
};
`,
    }),
  },

  data: {
    label: "数据 + 内容",
    desc: "读本地 JSON 内容展示（类似 learnbench 的模式）",
    files: (id, name, icon) => ({
      "app.json": JSON.stringify(
        { id, name, icon, tagline: "内容驱动的应用", color: "#a78bfa", order: 100, version: "1.0.0" },
        null, 2,
      ),
      "content/items.json": JSON.stringify(
        [{ id: "a", title: "第一条", body: "改 apps/" + id + "/content/items.json 后刷新就生效。" }], null, 2,
      ),
      "public/index.html": `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${name}</title>
<style>
  :root { --bg:#0b0d12; --panel:#12151d; --elev:#181c26; --line:#232936;
          --fg:#e8ecf4; --fg2:#a2adc0; --fg3:#697586; --ac:#5b93f8; }
  [data-theme="light"] { --bg:#f6f7f9; --panel:#fff; --elev:#f0f2f5; --line:#e2e6ec;
          --fg:#161b22; --fg2:#4c5866; --fg3:#7b8794; --ac:#2563eb; }
  body { margin:0; padding:28px; font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
         background:var(--bg); color:var(--fg); }
  h1 { font-size:19px; margin:0 0 6px; }
  .muted { color:var(--fg3); font-size:12.5px; }
  .item { background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:14px 16px; margin-top:11px; }
  code { background:var(--elev); padding:1px 5px; border-radius:4px;
         font-family:ui-monospace,Consolas,monospace; font-size:12px; }
  .item h3 { margin:0 0 5px; font-size:14px; }
  .item p { margin:0; color:var(--fg2); font-size:13px; }
</style></head>
<body>
  <h1>${icon} ${name}</h1>
  <p class="muted">内容驱动。改 <code>apps/${id}/content/*.json</code> 后刷新即生效，不用重启。</p>
  <div id="list"></div>
  <script>
    fetch("/api/${id}/items").then(r => r.json()).then(d => {
      document.getElementById("list").innerHTML = d.items.map(i =>
        '<div class="item"><h3>' + i.title + '</h3><p>' + i.body + '</p></div>').join("");
    });
  </script>
</body></html>
`,
      "server.mjs": `/** ${name} —— 每次请求重新读内容文件，天生支持热改。 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "content", "items.json");

export const routes = {
  "GET /items": async () => {
    if (!existsSync(CONTENT)) return { items: [] };
    try { return { items: JSON.parse(readFileSync(CONTENT, "utf8")) }; }
    catch (e) { return { items: [], error: String(e) }; }
  },
};
`,
    }),
  },
};

export const templateList = Object.entries(TEMPLATES).map(([k, v]) => ({ id: k, label: v.label, desc: v.desc }));

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

export function create(id, { name, icon = "▦", template = "api" } = {}) {
  const err = validateId(id);
  if (err) throw new Error(err);
  const dir = appDir(id);
  if (!dir) throw new Error("非法路径");
  if (existsSync(dir)) throw new Error(`应用 ${id} 已存在`);

  const tpl = TEMPLATES[template];
  if (!tpl) throw new Error(`未知模板 ${template}，可选：${Object.keys(TEMPLATES).join(", ")}`);

  const display = name || id;
  const files = tpl.files(id, display, icon);

  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
    written.push(rel);
  }
  // 每个应用默认带上 .gitignore（隔离它自己的数据）
  writeFileSync(path.join(dir, ".gitignore"), "data/\nnode_modules/\n", "utf8");

  return { id, dir, template, files: written };
}

export function remove(id, { force = false } = {}) {
  const dir = appDir(id);
  if (!dir) throw new Error("非法路径");
  if (!existsSync(dir)) throw new Error(`应用 ${id} 不存在`);
  if (!force) {
    const hasData = existsSync(path.join(dir, "data"));
    if (hasData) {
      const files = readdirSync(path.join(dir, "data"));
      if (files.length) throw new Error(`应用 ${id} 的 data/ 里有 ${files.length} 个条目，加 --force 才会删除`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { id, removed: true };
}

/**
 * 修改某个应用的层。
 * 「转正」= lab → app；也支持任意层间迁移（会做依赖合法性预检）。
 */
export function setLayer(id, layer) {
  if (!isValidLayer(layer)) throw new Error(`未知层 "${layer}"，可选：platform / core / app / lab`);
  const dir = appDir(id);
  if (!dir || !existsSync(dir)) throw new Error(`应用 ${id} 不存在`);
  const mf = path.join(dir, "app.json");
  if (!existsSync(mf)) throw new Error(`应用 ${id} 缺少 app.json`);

  let m;
  try { m = JSON.parse(readFileSync(mf, "utf8")); }
  catch (e) { throw new Error(`app.json 解析失败: ${e.message}`); }

  const prev = m.layer ?? "app";
  m.layer = layer;
  writeFileSync(mf, JSON.stringify(m, null, 2) + "\n", "utf8");
  return { id, from: prev, to: layer };
}

export function list() {
  return discover();
}
