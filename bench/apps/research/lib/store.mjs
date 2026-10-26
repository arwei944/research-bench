/**
 * 本地存储层 —— 研究工作台自己的数据，全部落在 workbench/data/ 下。
 *
 *   data/
 *   ├── notes/       研究笔记（每条一个 .md，带 frontmatter）
 *   ├── reports/     导出的报告（.md）
 *   ├── evidence/    引用核验结果快照（.json）
 *   └── sessions/    工作台会话记录（.json）
 *
 * 刻意不依赖数据库：纯文件，可 grep、可 git、可手改。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 可变：应用可覆盖（平台迁移后数据落在应用自己的目录里）
export let DATA_DIR = path.resolve(HERE, "..", "data");
export function setDataDir(d) { DATA_DIR = d; }
export const SUBDIRS = ["notes", "reports", "evidence", "sessions"];

export function ensureDirs() {
  for (const d of SUBDIRS) {
    const p = path.join(DATA_DIR, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function safeName(s) {
  return String(s)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// 笔记
// ---------------------------------------------------------------------------

export function saveNote({ title, body, domain = "academic", tags = [], sources = [], confidence = "medium" }) {
  ensureDirs();
  const file = `${today()}-${safeName(title) || "note"}-${stamp().slice(-6)}.md`;
  const front = [
    "---",
    `title: ${title}`,
    `date: ${today()}`,
    `domain: ${domain}`,
    `confidence: ${confidence}`,
    `tags: [${tags.join(", ")}]`,
    `sources:`,
    ...(sources.length ? sources.map((s) => `  - ${s}`) : ["  - (none)"]),
    "status: active",
    "---",
    "",
  ].join("\n");
  const full = front + body.trim() + "\n";
  writeFileSync(path.join(DATA_DIR, "notes", file), full, "utf8");
  return { file, path: path.join("data", "notes", file), size: Buffer.byteLength(full) };
}

export function listNotes() {
  ensureDirs();
  const dir = path.join(DATA_DIR, "notes");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const p = path.join(dir, f);
      const st = statSync(p);
      const head = readFileSync(p, "utf8").slice(0, 400);
      const title = head.match(/^title:\s*(.+)$/m)?.[1] ?? f;
      const domain = head.match(/^domain:\s*(.+)$/m)?.[1] ?? "";
      return { file: f, title, domain, size: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

export function readNote(file) {
  const p = path.join(DATA_DIR, "notes", safeName(file));
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

export function deleteNote(file) {
  const p = path.join(DATA_DIR, "notes", safeName(file));
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

export function saveReport({ title, markdown }) {
  ensureDirs();
  const file = `${today()}-${safeName(title) || "report"}.md`;
  writeFileSync(path.join(DATA_DIR, "reports", file), markdown, "utf8");
  return { file, path: path.join("data", "reports", file), size: Buffer.byteLength(markdown) };
}

export function listReports() {
  ensureDirs();
  const dir = path.join(DATA_DIR, "reports");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const st = statSync(path.join(dir, f));
      return { file: f, size: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

export function readReport(file) {
  const p = path.join(DATA_DIR, "reports", safeName(file));
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// ---------------------------------------------------------------------------
// 证据快照
// ---------------------------------------------------------------------------

export function saveEvidence({ label, payload }) {
  ensureDirs();
  const file = `${today()}-${safeName(label) || "evidence"}-${stamp().slice(-6)}.json`;
  const full = JSON.stringify(payload, null, 2);
  writeFileSync(path.join(DATA_DIR, "evidence", file), full, "utf8");
  return { file, path: path.join("data", "evidence", file) };
}

export function listEvidence() {
  ensureDirs();
  const dir = path.join(DATA_DIR, "evidence");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const st = statSync(path.join(dir, f));
      return { file: f, size: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

// ---------------------------------------------------------------------------
// 会话（工作台自己的轻量记录，用于「最近研究」）
// ---------------------------------------------------------------------------

export function appendSession(entry) {
  ensureDirs();
  const file = `${today()}.jsonl`;
  const p = path.join(DATA_DIR, "sessions", file);
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + "\n";
  if (existsSync(p)) {
    writeFileSync(p, readFileSync(p, "utf8") + line, "utf8");
  } else {
    writeFileSync(p, line, "utf8");
  }
  return { file, path: path.join("data", "sessions", file) };
}

export function recentSessions(limit = 20) {
  ensureDirs();
  const dir = path.join(DATA_DIR, "sessions");
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  const out = [];
  for (const f of files) {
    const lines = readFileSync(path.join(dir, f), "utf8").trim().split("\n").filter(Boolean);
    for (const l of lines.reverse()) {
      try { out.push(JSON.parse(l)); } catch { /* skip */ }
      if (out.length >= limit) return out;
    }
  }
  return out;
}
