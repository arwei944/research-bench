/**
 * 知识库（knowledge-base/）读写 —— 平台级能力。
 *
 * 为什么需要这个模块：
 *   `AGENTS.md` 规定「研究产出写入 knowledge-base/」，但工作台从来不读那里。
 *   结果是两处割裂：knowledge-base 是手工目录（无人读），
 *   research 应用把报告写在自己 data/reports 下，kernel 又存另一份 Claim。
 *
 *   现在 knowledge-base 成为工作台的一等公民：可列、可读、可写、可从报告沉淀。
 *
 * 安全边界（重要）：
 *   所有路径必须解析后仍落在 knowledge-base 内，防止 `../` 穿越。
 *   只允许 .md 文件，不允许其它类型。
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KB_ROOT = path.resolve(HERE, "..", "..", "knowledge-base");

/** 允许的顶层领域目录。 */
export const DOMAINS = ["academic", "finance", "learning", "projects", "inbox"];

const DOMAIN_LABEL = {
  academic: "学科研究",
  finance: "金融研究",
  learning: "知识学习",
  projects: "跨领域项目",
  inbox: "随手笔记",
};

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/**
 * 把用户给的相对路径解析成绝对路径，并校验没有越界。
 * @returns {{ok:true, abs:string, rel:string} | {ok:false, error:string}}
 */
export function resolvePath(rel) {
  const clean = String(rel ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean) return { ok: false, error: "缺少路径" };
  if (clean.includes("..")) return { ok: false, error: "路径不允许包含 .." };

  const abs = path.resolve(KB_ROOT, clean);
  if (!abs.startsWith(KB_ROOT + path.sep) && abs !== KB_ROOT) {
    return { ok: false, error: "路径越界" };
  }
  return { ok: true, abs, rel: path.relative(KB_ROOT, abs).replace(/\\/g, "/") };
}

/** 递归列出所有 .md 文件（含 frontmatter 摘要）。 */
export function listFiles({ domain, limit = 500 } = {}) {
  if (!existsSync(KB_ROOT)) return [];
  const out = [];
  const roots = domain
    ? [path.join(KB_ROOT, domain)]
    : DOMAINS.map((d) => path.join(KB_ROOT, d)).filter(existsSync);

  for (const root of roots) {
    if (!existsSync(root)) continue;
    walk(root, out, limit);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

function walk(dir, out, limit) {
  if (out.length >= limit) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (out.length >= limit) return;
    const abs = path.join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { walk(abs, out, limit); continue; }
    if (!name.endsWith(".md")) continue;

    const rel = path.relative(KB_ROOT, abs).replace(/\\/g, "/");
    const domainId = rel.split("/")[0];
    const meta = readFrontmatter(abs);

    out.push({
      rel,
      name,
      domain: domainId,
      domainLabel: DOMAIN_LABEL[domainId] ?? domainId,
      size: st.size,
      modified: st.mtime.toISOString(),
      title: meta.title ?? name.replace(/\.md$/, ""),
      date: meta.date ?? null,
      confidence: meta.confidence ?? null,
      status: meta.status ?? null,
      sources: meta.sources?.length ?? 0,
      // 列表里不带全文，避免一次拉太多
      excerpt: readExcerpt(abs),
    });
  }
}

/** 解析 YAML frontmatter（只处理本项目用到的扁平字段，不引依赖）。 */
export function readFrontmatter(abs) {
  try {
    const txt = readFileSync(abs, "utf8");
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const out = {};
    let curKey = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (kv) {
        const [, k, v] = kv;
        curKey = k;
        const val = v.trim();
        if (val === "") out[k] = [];
        else if (val.startsWith("[") && val.endsWith("]")) {
          out[k] = val.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        } else {
          out[k] = val.replace(/^["']|["']$/g, "");
        }
        continue;
      }
      // 列表项 "- xxx"
      const li = line.match(/^\s*-\s+(.*)$/);
      if (li && curKey) {
        if (!Array.isArray(out[curKey])) out[curKey] = [];
        out[curKey].push(li[1].trim().replace(/^["']|["']$/g, ""));
      }
    }
    return out;
  } catch {
    return {};
  }
}

function readExcerpt(abs) {
  try {
    const txt = readFileSync(abs, "utf8");
    const body = txt.replace(/^---\r?\n[\s\S]*?\r?\n---/, "").trim();
    // 跳过标题行，取第一段正文
    const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith(">"));
    return (lines[0] ?? "").slice(0, 160);
  } catch {
    return "";
  }
}

/** 读单个文件全文。 */
export function readFile(rel) {
  const r = resolvePath(rel);
  if (!r.ok) return r;
  if (!r.abs.endsWith(".md")) return { ok: false, error: "只允许 .md 文件" };
  if (!existsSync(r.abs)) return { ok: false, error: "文件不存在" };
  try {
    return { ok: true, rel: r.rel, content: readFileSync(r.abs, "utf8"), meta: readFrontmatter(r.abs) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 写文件（覆盖或新建）。
 * @param {string} rel        相对 knowledge-base 的路径，如 "academic/2026-10-27-xxx.md"
 * @param {string} content    markdown 全文（含 frontmatter）
 */
export function writeFile(rel, content) {
  const r = resolvePath(rel);
  if (!r.ok) return r;
  if (!r.abs.endsWith(".md")) return { ok: false, error: "只允许写 .md 文件" };

  const domain = r.rel.split("/")[0];
  if (!DOMAINS.includes(domain)) {
    return { ok: false, error: `未知领域目录 "${domain}"，可选：${DOMAINS.join(", ")}` };
  }

  try {
    ensureDir(path.dirname(r.abs));
    writeFileSync(r.abs, String(content ?? ""), "utf8");
    const st = statSync(r.abs);
    return { ok: true, rel: r.rel, size: st.size, modified: st.mtime.toISOString() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 从一份研究产出沉淀到 knowledge-base。
 *
 * 自动生成 frontmatter，文件名按 `YYYY-MM-DD-主题.md` 规范。
 */
export function deposit({ domain = "inbox", title, body, meta = {} }) {
  if (!DOMAINS.includes(domain)) {
    return { ok: false, error: `未知领域 "${domain}"` };
  }
  const date = meta.date ?? new Date().toISOString().slice(0, 10);
  const safeTitle = String(title ?? "未命名")
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const rel = `${domain}/${date}-${safeTitle}.md`;

  const fm = [
    "---",
    `title: ${safeTitle}`,
    `date: ${date}`,
    `domain: ${domain}`,
    `confidence: ${meta.confidence ?? "medium"}`,
    `status: ${meta.status ?? "active"}`,
  ];
  if (Array.isArray(meta.sources) && meta.sources.length) {
    fm.push("sources:");
    for (const s of meta.sources) fm.push(`  - ${String(s).replace(/\r?\n/g, " ")}`);
  }
  if (meta.tags?.length) fm.push(`tags: [${meta.tags.join(", ")}]`);
  fm.push("---", "");

  const content = fm.join("\n") + "\n" + String(body ?? "").trim() + "\n";
  const w = writeFile(rel, content);
  return w.ok ? { ...w, domain, title: safeTitle } : w;
}

/** 统计概览。 */
export function stats() {
  const files = listFiles();
  const byDomain = {};
  for (const f of files) {
    byDomain[f.domain] ??= { count: 0, bytes: 0 };
    byDomain[f.domain].count++;
    byDomain[f.domain].bytes += f.size;
  }
  return {
    root: KB_ROOT,
    total: files.length,
    domains: DOMAINS.map((d) => ({
      id: d,
      label: DOMAIN_LABEL[d],
      count: byDomain[d]?.count ?? 0,
      bytes: byDomain[d]?.bytes ?? 0,
    })),
    latest: files[0] ? { rel: files[0].rel, title: files[0].title, modified: files[0].modified } : null,
  };
}

export const domainList = DOMAINS.map((d) => ({ id: d, label: DOMAIN_LABEL[d] }));
