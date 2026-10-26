/**
 * learn · 大模型课程（术语型课程）
 *
 * 从原 llm-lab 应用迁移进来，成为 learn 的第二门课程。
 *
 * 设计要点（与「计算理论」课程的区别）：
 *   - 计算理论是 graph 型：4 轨 13 节点，有可执行笔记本
 *   - 大模型是 terms 型：10 层 101 词，有前置门禁 + 三种追问
 *
 * 共用：SM-2 复习（srs.mjs）、kernel 闭环、笔记。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(HERE, "..", "content", "llm");
const TERMS_DIR = path.join(CONTENT, "terms");

function readJson(f, fallback) {
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; }
}

export function loadLayers() {
  return readJson(path.join(CONTENT, "layers.json"), { layers: [] }).layers ?? [];
}

export function loadTerms() {
  if (!existsSync(TERMS_DIR)) return [];
  const out = [];
  for (const f of readdirSync(TERMS_DIR).filter((x) => x.endsWith(".json")).sort()) {
    const d = readJson(path.join(TERMS_DIR, f), { terms: [] });
    for (const t of d.terms ?? []) {
      out.push({
        ...t,
        layer: d.layer ?? t.layer ?? "L0",
        depends: Array.isArray(t.depends) ? t.depends : [],
        contrasts: Array.isArray(t.contrasts) ? t.contrasts : [],
        probes: Array.isArray(t.probes) ? t.probes : [],
        _file: f,
      });
    }
  }
  const layerOrder = new Map(loadLayers().map((l, i) => [l.id, i]));
  out.forEach((t, i) => { t._order = i; });
  out.sort((a, b) => (layerOrder.get(a.layer) ?? 99) - (layerOrder.get(b.layer) ?? 99) || a._order - b._order);
  return out;
}

/** 校验依赖图：无环、无悬空引用。 */
export function validateGraph(terms) {
  const byId = new Map(terms.map((t) => [t.id, t]));
  const dangling = [];
  for (const t of terms) {
    for (const d of t.depends) if (!byId.has(d)) dangling.push({ from: t.id, to: d, field: "depends" });
    for (const c of t.contrasts) if (!byId.has(c)) dangling.push({ from: t.id, to: c, field: "contrasts" });
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(terms.map((t) => [t.id, WHITE]));
  const cycles = [];
  const stack = [];
  function dfs(id) {
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of byId.get(id)?.depends ?? []) {
      if (!byId.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        const i = stack.indexOf(dep);
        cycles.push([...stack.slice(i), dep]);
      } else if (color.get(dep) === WHITE) dfs(dep);
    }
    stack.pop();
    color.set(id, BLACK);
  }
  for (const t of terms) if (color.get(t.id) === WHITE) dfs(t.id);
  return { ok: cycles.length === 0 && dangling.length === 0, cycles, dangling, terms: terms.length };
}

/**
 * 单个词的掌握状态。
 *
 * 判定规则（刻意严格）：
 *   new      → 没学过
 *   learning → 复习过但没通过深度追问
 *   mastered → SM-2 连续答对 >= 2 且 lapses=0 且 通过 >=1 条 counterfactual/application 追问
 *
 * 为什么要求追问：光答对不算懂（arXiv:2610.22949 的 cave detection）。
 */
export function termState(term, progress) {
  const p = progress[term.id];
  if (!p) return { state: "new", reps: 0, deepProbes: 0, reason: "还没学过" };

  const reps = p.reps ?? 0;
  const lapses = p.lapses ?? 0;
  const deepKinds = new Set(["counterfactual", "application"]);
  const deepOk = (p.probes ?? []).some((x) => deepKinds.has(x.kind) && (x.level === "deep" || x.level === "partial"));
  const deepPassed = (p.probes ?? []).filter((x) => x.level === "deep" || x.level === "partial").length;

  if (reps >= 2 && deepOk && lapses === 0) {
    return { state: "mastered", reps, deepProbes: deepPassed, reason: "复习稳定 + 通过深度追问" };
  }
  if (reps >= 2 && !deepOk) {
    return { state: "learning", reps, deepProbes: deepPassed, reason: "复习稳定，但还没通过深度追问（反事实/应用）" };
  }
  return { state: "learning", reps, deepProbes: deepPassed, reason: `复习 ${reps} 次，还需 ${Math.max(0, 2 - reps)} 次连续答对` };
}

/** 解锁状态：前置词必须全部 mastered。 */
export function unlockState(term, terms, progress) {
  if (!term.depends.length) return { unlocked: true, lockedBy: [], reason: null };
  const byId = new Map(terms.map((t) => [t.id, t]));
  const lockedBy = [];
  for (const d of term.depends) {
    const dt = byId.get(d);
    if (!dt) continue;
    if (termState(dt, progress).state !== "mastered") lockedBy.push(d);
  }
  return {
    unlocked: lockedBy.length === 0,
    lockedBy,
    reason: lockedBy.length ? `需要先掌握：${lockedBy.map((x) => byId.get(x)?.cn ?? x).join("、")}` : null,
  };
}

/** 全量视图。 */
export function buildIndex(terms, progress) {
  const byId = new Map(terms.map((t) => [t.id, t]));
  return terms.map((t) => {
    const st = termState(t, progress);
    const un = unlockState(t, terms, progress);
    return {
      id: t.id, layer: t.layer, cn: t.cn, en: t.en, def: t.def, why: t.why,
      depends: t.depends,
      dependsCn: t.depends.map((d) => byId.get(d)?.cn ?? d),
      contrasts: t.contrasts,
      contrastsCn: t.contrasts.map((d) => byId.get(d)?.cn ?? d),
      probeCount: t.probes.length,
      probeKinds: [...new Set(t.probes.map((p) => p.kind))],
      ...st, ...un,
    };
  });
}

/** 各层完成度。 */
export function layerProgress(terms, layers, progress) {
  return layers.map((l) => {
    const inLayer = terms.filter((t) => t.layer === l.id);
    const mastered = inLayer.filter((t) => termState(t, progress).state === "mastered").length;
    const learning = inLayer.filter((t) => termState(t, progress).state === "learning").length;
    return {
      ...l, total: inLayer.length, mastered, learning,
      fresh: inLayer.length - mastered - learning,
      ratio: inLayer.length ? +(mastered / inLayer.length).toFixed(3) : 0,
    };
  });
}
