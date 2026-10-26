/**
 * 内核 · 实体模型
 *
 * 四种实体，构成「研究 → 实验 → 知识」的骨架：
 *
 *   Artifact  原始产物：一段文本、一次抓取、一次模型输出
 *   Claim     可核验的断言（带来源与置信度）
 *   Run       一次带配置的执行记录
 *   Evidence  支撑某个 Claim 的证据（指向 Run 或 Artifact）
 *
 * 关系：
 *
 *   Run ──produces──▶ Artifact
 *   Artifact ──supports──▶ Claim        （通过 Evidence）
 *   Run ──supports──▶ Claim             （通过 Evidence）
 *   Claim ──derives──▶ Claim            （结论推结论）
 *   Claim ──revises──▶ Claim            （新证据推翻旧结论）
 *
 * 为什么要这四种而不是「各应用自己的数据」：
 *   研究产出的每个结论 = Claim
 *   实验的每次运行     = Run
 *   两者之间的支撑关系 = Evidence
 *   于是「这个结论有多可信」变成可计算的问题：数它的 Evidence，看 Run 是否通过判分闸门。
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/** Claim 的生命周期。 */
export const CLAIM_STATUS = {
  draft: "草稿",          // 只是写下来，还没找证据
  supported: "有证据",     // 至少一条 Evidence 支撑
  contested: "存疑",       // 有相互矛盾的 Evidence
  refuted: "被推翻",       // 证据明确不支持
  retired: "已废弃",       // 不再关心
};

/** Evidence 的可信等级（决定 Claim 能升到多高）。 */
export const EVIDENCE_TIER = {
  A: "A · 可执行验证",     // 有确定性判分器，通过
  B: "B · 多源交叉",       // 多个独立来源一致
  C: "C · 单一来源",       // 只有一个来源
  D: "D · 个人推断",       // 无外部证据，纯推理
};

// ---------------------------------------------------------------------------
// 工厂函数（统一构造，保证字段完整）
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();

export function newArtifact({ kind, source, content, meta = {} }) {
  return {
    type: "artifact",
    id: `art_${randomUUID().slice(0, 8)}`,
    kind,                 // "text" | "fetch" | "model_output" | "file" | ...
    source,               // 谁/什么产生的：URL、应用名、模型名
    content,              // 原始内容（字符串；大文件只存路径）
    meta,                 // 附加信息：hash、长度、抓取时间等
    createdAt: now(),
  };
}

export function newClaim({ text, status = "draft", confidence = "medium", tags = [], derivedFrom = [], note = "" }) {
  return {
    type: "claim",
    id: `clm_${randomUUID().slice(0, 8)}`,
    text,                 // 断言本身，一句话，可判断真假
    status,               // draft | supported | contested | refuted | retired
    confidence,           // high | medium | low（人工判断，不由证据数自动算）
    tags,
    derivedFrom,          // 从哪些 Claim 推出来的
    note,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function newRun({ task, config, model, repeats = 1, result = null, gate = null, meta = {} }) {
  return {
    type: "run",
    id: `run_${randomUUID().slice(0, 8)}`,
    task,                 // 任务 id
    config,               // 配置 id
    model,                // 模型标识
    repeats,
    result,               // { pass, total, passRate, passK, records? }
    gate,                 // 判分闸门状态：{ selfTest: {ok,...}, fixtures: {ok,...}, passed: bool }
    meta,
    createdAt: now(),
  };
}

export function newEvidence({ claimId, kind, refId, tier = "C", summary = "", strength = 1 }) {
  return {
    type: "evidence",
    id: `evd_${randomUUID().slice(0, 8)}`,
    claimId,
    kind,                 // "run" | "artifact" | "external" | "inference"
    refId,                // 指向 Run.id / Artifact.id / URL
    tier,                 // A|B|C|D
    summary,              // 一句话说明这条证据支持什么
    strength,             // 1=弱 2=中 3=强（人工判断）
    createdAt: now(),
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export function validate(entity) {
  const errs = [];
  if (!entity || typeof entity !== "object") return ["不是对象"];
  if (!entity.type) errs.push("缺少 type");
  if (!entity.id) errs.push("缺少 id");

  switch (entity.type) {
    case "artifact":
      if (!entity.kind) errs.push("artifact 缺少 kind");
      if (entity.content == null) errs.push("artifact 缺少 content");
      break;
    case "claim":
      if (!entity.text || !entity.text.trim()) errs.push("claim 缺少 text");
      if (entity.status && !CLAIM_STATUS[entity.status]) errs.push(`claim 状态非法: ${entity.status}`);
      break;
    case "run":
      if (!entity.task) errs.push("run 缺少 task");
      if (!entity.config) errs.push("run 缺少 config");
      break;
    case "evidence":
      if (!entity.claimId) errs.push("evidence 缺少 claimId");
      if (!entity.kind) errs.push("evidence 缺少 kind");
      if (entity.tier && !EVIDENCE_TIER[entity.tier]) errs.push(`evidence tier 非法: ${entity.tier}`);
      break;
    default:
      errs.push(`未知 type: ${entity.type}`);
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Claim 状态推导
// ---------------------------------------------------------------------------

/**
 * 根据证据情况推导 Claim 应有的状态。
 *
 * 规则（刻意简单，可解释）：
 *   - 无证据                 → draft
 *   - 有 A 级证据且 run 通过闸门 → supported
 *   - 只有 C/D 级证据         → draft（证据太弱，不能升级）
 *   - 有 refuting 标记的      → refuted
 *
 * 注意：状态是**推导出来**的，不是手工设的，这样「有证据」不会自欺。
 */
export function deriveStatus(claim, evidences) {
  const list = evidences.filter((e) => e.claimId === claim.id);
  if (!list.length) return "draft";

  const hasRefute = list.some((e) => e.meta?.refutes === true);
  if (hasRefute) return "refuted";

  const tiers = list.map((e) => e.tier);
  const hasA = tiers.includes("A");
  const hasB = tiers.includes("B");
  const strongCount = list.filter((e) => (e.strength ?? 1) >= 2).length;

  if (hasA && strongCount >= 1) return "supported";
  if (hasB && strongCount >= 2) return "supported";
  if (list.length >= 3 && strongCount >= 2) return "supported";

  return "draft";
}

/**
 * 计算一条 Claim 的「证据摘要」，用于 UI 显示与决策。
 */
export function claimDigest(claim, evidences, runs = []) {
  const list = evidences.filter((e) => e.claimId === claim.id);
  const runMap = new Map(runs.map((r) => [r.id, r]));

  const byTier = {};
  for (const e of list) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;

  // 指向 Run 的证据，检查其闸门是否通过
  const runEvidences = list.filter((e) => e.kind === "run");
  const gatedRuns = runEvidences
    .map((e) => runMap.get(e.refId))
    .filter(Boolean);
  const ungatedCount = gatedRuns.filter((r) => !r.gate?.passed).length;

  return {
    claimId: claim.id,
    status: deriveStatus(claim, evidences),
    evidenceCount: list.length,
    byTier,
    runCount: runEvidences.length,
    ungatedRuns: ungatedCount,
    // 可信度警告：有证据但闸门没过的 Run，不能算数
    warning: ungatedCount > 0 ? `${ungatedCount} 条指向未经判分闸门的 Run，证据不可信` : null,
  };
}
