/**
 * 内核门面（facade）—— 应用唯一该 import 的入口。
 *
 * 为什么需要这一层：
 *   现在应用里写的是 `import * as kernel from "../../kernel/store.mjs"`，
 *   这意味着应用**直接依赖内核内部结构**。一旦内核拆分/改名，所有应用都要改。
 *
 *   门面层把「应用需要什么」与「内核怎么实现」隔开：
 *     - 应用只调 `bench.claim.create()` / `bench.run.record()` 这类高层语义
 *     - 内核内部怎么存、怎么推导，应用不需要知道
 *     - 将来换存储（文件→SQLite）只改门面，应用不动
 *
 * 用法：
 *   import { bench } from "../../kernel/index.mjs";
 *
 *   // 实验产出
 *   const run = bench.run.record({ task, config, model, result, gate });
 *
 *   // 研究产出结论
 *   const claim = bench.claim.create({ text, tags });
 *   bench.claim.attachEvidence(claim.id, { kind: "run", refId: run.id, tier: "A", strength: 3 });
 *
 *   // 查询
 *   bench.claim.list();          // 带 digest（状态、证据数）
 *   bench.claim.get(id);
 *   bench.dashboard();           // 一屏数据
 */

import * as E from "./entities.mjs";
import * as S from "./store.mjs";
import * as O from "./observe.mjs";

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

const claim = {
  /**
   * 创建一条断言。
   * @param {{text:string, confidence?:string, tags?:string[], note?:string}} input
   */
  create(input) {
    if (!input?.text?.trim()) throw new Error("Claim 必须有 text");
    const c = E.newClaim({
      text: input.text.trim(),
      confidence: input.confidence ?? "medium",
      tags: input.tags ?? [],
      note: input.note ?? "",
      derivedFrom: input.derivedFrom ?? [],
    });
    S.put(c);
    return c;
  },

  get(id) {
    return S.get("claim", id);
  },

  /** 列出全部，附带 digest（推导状态、证据统计、闸门警告）。 */
  list({ status, tag, withWarning } = {}) {
    const claims = S.list("claim");
    const evs = S.list("evidence");
    const runs = S.list("run");
    let out = claims.map((c) => ({ ...c, digest: E.claimDigest(c, evs, runs) }));
    if (status) out = out.filter((c) => c.digest.status === status);
    if (tag) out = out.filter((c) => (c.tags ?? []).includes(tag));
    if (withWarning) out = out.filter((c) => !!c.digest.warning);
    return out;
  },

  /** 挂证据。 */
  attachEvidence(claimId, { kind, refId, tier = "C", summary = "", strength = 1, refutes = false, causedBy }) {
    if (!S.get("claim", claimId)) throw new Error(`Claim ${claimId} 不存在`);
    const ev = E.newEvidence({ claimId, kind, refId, tier, summary, strength });
    if (refutes) ev.meta = { ...(ev.meta ?? {}), refutes: true };
    S.put(ev, { causedBy: causedBy ?? { by: "kernel.claim.attachEvidence", reason: "support", refId: claimId } });
    return ev;
  },

  evidences(claimId) {
    return S.evidencesOf(claimId);
  },

  /** 更新置信度（复习反馈会用到）。 */
  setConfidence(claimId, confidence) {
    const c = S.get("claim", claimId);
    if (!c) return null;
    const next = { ...c, confidence, updatedAt: new Date().toISOString() };
    S.put(next);
    return next;
  },

  remove(id) {
    // 连带删掉它的证据，避免产生孤儿证据
    for (const ev of S.evidencesOf(id)) S.del("evidence", ev.id);
    return S.del("claim", id);
  },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const run = {
  /**
   * 记录一次执行。gate 是判分闸门状态，没有它证据不可信。
   * @param {{task:string, config:string, model:string, result:object, gate:object, meta?:object}} input
   */
  record(input) {
    if (!input?.task) throw new Error("Run 必须有 task");
    if (!input?.config) throw new Error("Run 必须有 config");
    const r = E.newRun({
      task: input.task,
      config: input.config,
      model: input.model ?? "unknown",
      repeats: input.repeats ?? 1,
      result: input.result ?? null,
      gate: input.gate ?? null,
      meta: input.meta ?? {},
    });
    S.put(r);
    return r;
  },

  get(id) {
    return S.get("run", id);
  },

  list({ gatedOnly, experimentId } = {}) {
    let out = S.list("run");
    if (gatedOnly) out = out.filter((r) => r.gate?.passed);
    if (experimentId) out = out.filter((r) => r.meta?.experimentId === experimentId);
    return out;
  },

  /** 这次 Run 是否可信（过闸门）。 */
  isTrustworthy(runId) {
    return !!S.get("run", runId)?.gate?.passed;
  },
};

// ---------------------------------------------------------------------------
// Artifact
// ---------------------------------------------------------------------------

const artifact = {
  create({ kind, source, content, meta }) {
    const a = E.newArtifact({ kind, source, content, meta });
    S.put(a);
    return a;
  },
  get(id) {
    return S.get("artifact", id);
  },
  list() {
    return S.list("artifact");
  },
};

// ---------------------------------------------------------------------------
// 跨实体操作
// ---------------------------------------------------------------------------

/**
 * 一次「实验 → 断言」的完整写入。
 *
 * 这是应用最常用的组合操作：跑完实验，把有信息量的结果直接变成知识。
 * 门面层负责：
 *   1. 记录 Run
 *   2. 对有信息量的指标生成 Claim
 *   3. 挂 A 级 Evidence（若闸门通过）
 *
 * @returns {{run, claims:Array}}
 */
function ingestExperiment({ task, config, model, result, gate, meta, conclusions = [] }) {
  const r = run.record({ task, config, model, result, gate, meta });
  const created = [];

  // 整批写入共用一个因果：都源于这次实验
  return S.withCause(
    { by: "labset", reason: "experiment", refId: meta?.experimentId ?? r.id },
    () => {
      for (const c of conclusions) {
        const claimObj = claim.create({
          text: c.text,
          confidence: c.confidence ?? "medium",
          tags: c.tags ?? ["from-experiment"],
          note: c.note ?? `由实验 ${meta?.experimentId ?? r.id} 自动生成`,
        });
        if (gate?.passed) {
          claim.attachEvidence(claimObj.id, {
            kind: "run",
            refId: r.id,
            tier: "A",
            summary: c.evidenceSummary ?? "可执行验证器判分",
            strength: c.strength ?? 2,
          });
        }
        created.push(claimObj);
      }
      return { run: r, claims: created };
    },
  );
}

/**
 * 一屏数据：给 /status 与 /kernel 页面用。
 */
function dashboard() {
  const claims = S.list("claim");
  const evs = S.list("evidence");
  const runs = S.list("run");
  const stats = S.stats();

  const enriched = claims.map((c) => {
    const d = E.claimDigest(c, evs, runs);
    return {
      ...c,
      digest: d,
      evidences: evs.filter((e) => e.claimId === c.id).map((e) => {
        const ref = e.kind === "run" ? runs.find((r) => r.id === e.refId) : null;
        return {
          ...e,
          gated: e.kind === "run" ? !!ref?.gate?.passed : null,
          refLabel: e.kind === "run"
            ? `Run · ${ref?.config ?? "?"} · pass@1 ${ref?.result?.passRate != null ? (ref.result.passRate * 100).toFixed(0) + "%" : "?"}`
            : e.refId,
        };
      }),
    };
  });

  // 闭环判定
  const loop = {
    closed: enriched.some((c) => c.digest.status === "supported" && c.evidences.some((e) => e.tier === "A" && e.gated)),
    orphanClaims: enriched.filter((c) => c.digest.evidenceCount === 0).length,
    ungatedRuns: runs.filter((r) => !r.gate?.passed).length,
  };

  return { claims: enriched, runs, evidences: evs, stats, loop, events: S.recentEvents(30) };
}

export const bench = {
  claim,
  run,
  artifact,
  ingestExperiment,
  dashboard,
  stats: S.stats,
  events: S.recentEvents,
  trace: S.traceOf,
  withCause: S.withCause,
  reset: S.reset,
  observe: O,
  // 底层能力（一般应用不需要，但保留逃生口）
  _raw: { entities: E, store: S },
};

export default bench;
