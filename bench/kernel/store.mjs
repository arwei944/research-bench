/**
 * 内核 · 统一存储
 *
 * 布局（纯文件，单用户够用）：
 *
 *   bench/data/kernel/
 *   ├── artifacts/<id>.json    原始产物
 *   ├── claims/<id>.json       断言
 *   ├── runs/<id>.json         执行记录
 *   ├── evidence/<id>.json     证据
 *   ├── index.json             轻量索引（避免每次全扫目录）
 *   └── events.jsonl           追加式事件流（谁在什么时候改了什么）
 *
 * 为什么用文件而不是数据库：
 *   单用户、量小（几千条以内）、需要能 grep 能 git 能手改。
 *   真正的性能瓶颈不在这里，在模型调用（秒级）。
 *
 * 关键设计：**写操作同时记事件**。这样任何结论都能回溯到「哪次操作导致的」。
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "data", "kernel");

const DIRS = {
  artifact: "artifacts",
  claim: "claims",
  run: "runs",
  evidence: "evidence",
};

function ensure() {
  for (const d of Object.values(DIRS)) {
    const p = path.join(ROOT, d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function fileOf(type, id) {
  const dir = DIRS[type];
  if (!dir) throw new Error(`未知实体类型: ${type}`);
  return path.join(ROOT, dir, `${id}.json`);
}

/**
 * 追加事件（不阻塞主流程）。
 *
 * causedBy：这条变更**因为什么**而发生。
 * 之前事件流只记「改了什么」，事后无法回答「这个结论是哪次操作造成的」，
 * 这使审计只能靠时间戳猜。现在每条事件可以带一个因果引用：
 *
 *   { causedBy: { by: "labset", reason: "experiment", refId: "2026-10-26T..." } }
 */
function emit(event) {
  try {
    ensure();
    const line = JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n";
    const f = path.join(ROOT, "events.jsonl");
    const prev = existsSync(f) ? readFileSync(f, "utf8") : "";
    writeFileSync(f, prev + line, "utf8");
  } catch { /* 事件写失败不影响主流程 */ }
}

/**
 * 带因果的写上下文（可选）。
 *
 * 用法：把一次批量写包裹起来，期间所有事件都会带上同一个 causedBy。
 *
 *   S.withCause({ by: "labset", reason: "experiment", refId: runId }, () => {
 *     S.put(run); S.put(claim);
 *   });
 *
 * 为什么用同步上下文而不是参数透传：写操作有几十处，逐个加参数既侵入又易漏。
 */
let causeStack = [];

function withCause(cause, fn) {
  causeStack.push(cause);
  try { return fn(); } finally { causeStack.pop(); }
}

function currentCause() {
  return causeStack.length ? causeStack[causeStack.length - 1] : null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function put(entity, { causedBy } = {}) {
  ensure();
  const f = fileOf(entity.type, entity.id);
  writeFileSync(f, JSON.stringify(entity, null, 2), "utf8");
  emit({ action: "put", type: entity.type, id: entity.id, causedBy: causedBy ?? currentCause() ?? undefined });
  return entity;
}

export function get(type, id) {
  const f = fileOf(type, id);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

export function del(type, id, { causedBy } = {}) {
  const f = fileOf(type, id);
  if (!existsSync(f)) return false;
  unlinkSync(f);
  emit({ action: "delete", type, id, causedBy: causedBy ?? currentCause() ?? undefined });
  return true;
}

/** 列出某类型全部实体（按创建时间倒序）。 */
export function list(type) {
  const sub = DIRS[type];
  if (!sub) return [];              // 未知类型直接返回空，不要拼出 ROOT 然后全扫
  ensure();
  const dir = path.join(ROOT, sub);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(path.join(dir, f), "utf8"))); } catch { /* skip */ }
  }
  out.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return out;
}

/** 按条件筛选。 */
export function query(type, predicate) {
  return list(type).filter(predicate);
}

// ---------------------------------------------------------------------------
// 组合查询（流水线的关键）
// ---------------------------------------------------------------------------

/** 取一条 Claim 的全部证据。 */
export function evidencesOf(claimId) {
  return query("evidence", (e) => e.claimId === claimId);
}

/** 取某个 Claim 的支撑 Run 列表。 */
export function runsOf(claimId) {
  const evs = evidencesOf(claimId).filter((e) => e.kind === "run");
  return evs.map((e) => get("run", e.refId)).filter(Boolean);
}

/** 取某次 Run 产生了哪些 Artifact（通过 meta.runId 关联）。 */
export function artifactsOfRun(runId) {
  return query("artifact", (a) => a.meta?.runId === runId);
}

// ---------------------------------------------------------------------------
// 统计与健康
// ---------------------------------------------------------------------------

export function stats() {
  ensure();
  const counts = {};
  for (const t of Object.keys(DIRS)) counts[t] = list(t).length;

  // 数据健康度：有多少 Claim 是"有证据但证据未经闸门"
  const claims = list("claim");
  const evidences = list("evidence");
  const runs = list("run");
  const runMap = new Map(runs.map((r) => [r.id, r]));

  let ungated = 0;
  let noEvidence = 0;
  for (const c of claims) {
    const evs = evidences.filter((e) => e.claimId === c.id);
    if (!evs.length) { noEvidence++; continue; }
    const badRuns = evs
      .filter((e) => e.kind === "run")
      .map((e) => runMap.get(e.refId))
      .filter((r) => r && !r.gate?.passed);
    if (badRuns.length) ungated++;
  }

  const gatesPassed = runs.filter((r) => r.gate?.passed).length;

  return {
    counts,
    health: {
      claimsWithoutEvidence: noEvidence,
      claimsWithUngatedEvidence: ungated,
      runsWithGatePassed: gatesPassed,
      runsTotal: runs.length,
    },
    root: ROOT,
  };
}

/** 最近的变更事件（用于 UI 的"最近发生了什么"）。 */
export function recentEvents(limit = 30) {
  const f = path.join(ROOT, "events.jsonl");
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/**
 * 反查一条实体的完整因果链：它是被哪些事件、因为什么造成的。
 * 回答「这个结论是怎么来的」，而不只是「它什么时候变的」。
 */
export function traceOf(type, id, limit = 50) {
  const f = path.join(ROOT, "events.jsonl");
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
  const out = [];
  for (const l of lines) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    // 直接命中该实体，或被它引起的事件
    if ((e.type === type && e.id === id) || e.causedBy?.refId === id) out.push(e);
  }
  return out.slice(-limit);
}

export { withCause };

/** 清空（仅用于测试）。 */
export function reset() {
  for (const d of Object.values(DIRS)) {
    const p = path.join(ROOT, d);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) {
      if (f.endsWith(".json")) unlinkSync(path.join(p, f));
    }
  }
  const ef = path.join(ROOT, "events.jsonl");
  if (existsSync(ef)) unlinkSync(ef);
  return true;
}
