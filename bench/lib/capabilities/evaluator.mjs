/**
 * L1 能力 · 判分器（evaluator）
 *
 * 这是整个系统可信度的地基：**判分器本身必须被测试**。
 *
 * 之前它在 labset/lib 里，与具体任务集耦合。抽出来后变成通用能力：
 *   - 注册任务（prompt + verify）
 *   - 双向自检（标准答案必过 / 已知错答必拒）
 *   - 样本回归（历史真实输出必须判定稳定）
 *   - **闸门**：未通过自检的判分器，产出的证据不可信
 *
 * 任意应用都可以注册自己的任务集并复用这套闸门逻辑。
 */

/** 全局注册表：appId -> { tasks: Map<id, task>, fixtures: [] } */
const registry = new Map();

function slot(appId) {
  let s = registry.get(appId);
  if (!s) {
    s = { tasks: new Map(), fixtures: [] };
    registry.set(appId, s);
  }
  return s;
}

/**
 * 注册一组任务。
 * @param {string} appId
 * @param {Array<{id, kind, prompt, answer, verify, note}>} tasks
 */
function registerTasks(appId, tasks) {
  const s = slot(appId);
  for (const t of tasks) {
    if (!t.id) throw new Error("任务缺少 id");
    if (typeof t.verify !== "function") throw new Error(`任务 ${t.id} 缺少 verify 函数`);
    s.tasks.set(t.id, t);
  }
  return s.tasks.size;
}

/**
 * 注册回归夹具。
 * @param {string} appId
 * @param {Array<{task, expect:boolean, why, out}>} fixtures
 */
function registerFixtures(appId, fixtures) {
  const s = slot(appId);
  s.fixtures.push(...fixtures);
  return s.fixtures.length;
}

/** 取任务。 */
function task(appId, taskId) {
  return slot(appId).tasks.get(taskId) ?? null;
}

/** 判分：给定任务与输出，返回 {pass, reason}。 */
function grade(appId, taskId, output) {
  const t = task(appId, taskId);
  if (!t) return { pass: false, reason: `任务 ${taskId} 不存在` };
  try {
    const v = t.verify(output);
    return { pass: !!v?.pass, reason: v?.reason ?? "" };
  } catch (e) {
    return { pass: false, reason: `验证器异常: ${e.message}` };
  }
}

/**
 * 双向自检：对每个任务
 *   1. 标准答案必须 pass（否则会把对的判错）
 *   2. 已知错答必须 fail（否则会把错的判对）
 */
function selfTest(appId, wrongAnswers = {}) {
  const s = slot(appId);
  const results = [];
  for (const t of s.tasks.values()) {
    const pos = t.verify(t.answer);
    const negs = (wrongAnswers[t.id] ?? []).map((w) => ({ w, v: t.verify(w) }));
    const falseNeg = !pos?.pass;
    const falsePos = negs.filter((n) => n.v?.pass);
    results.push({
      task: t.id,
      ok: !falseNeg && falsePos.length === 0,
      answerAccepted: !!pos?.pass,
      answerReason: pos?.reason ?? "",
      falseNegatives: falseNeg ? [pos?.reason ?? ""] : [],
      falsePositives: falsePos.map((n) => n.w),
    });
  }
  const bad = results.filter((r) => !r.ok);
  return { total: results.length, passed: results.length - bad.length, bad: bad.length, ok: bad.length === 0, results };
}

/**
 * 样本回归：用历史真实输出检验判分稳定性。
 * 只要有一条不符合预期，说明判分器变了（可能是修 bug，也可能是引入 bug）。
 */
function regression(appId) {
  const s = slot(appId);
  const out = [];
  for (const fx of s.fixtures) {
    const t = s.tasks.get(fx.task);
    if (!t) { out.push({ ...fx, got: null, ok: false, reason: "任务不存在" }); continue; }
    let v;
    try { v = t.verify(fx.out); } catch (e) { out.push({ ...fx, got: null, ok: false, reason: e.message }); continue; }
    out.push({ task: fx.task, expect: fx.expect, got: !!v?.pass, ok: !!v?.pass === fx.expect, reason: v?.reason ?? "", why: fx.why });
  }
  const bad = out.filter((r) => !r.ok);
  return { total: out.length, passed: out.length - bad.length, failed: bad.length, ok: bad.length === 0, failures: bad };
}

/**
 * **闸门**：判分器是否可信。
 * 只有两者都过，产出的证据才允许进入知识层。
 */
function gate(appId, wrongAnswers = {}) {
  const st = selfTest(appId, wrongAnswers);
  const rg = regression(appId);
  return {
    passed: st.ok && rg.ok,
    selfTest: st,
    regression: rg,
    checkedAt: new Date().toISOString(),
  };
}

/** 列出已注册的 app。 */
function apps() {
  return [...registry.entries()].map(([id, s]) => ({ appId: id, tasks: s.tasks.size, fixtures: s.fixtures.length }));
}

export const evaluator = { registerTasks, registerFixtures, task, grade, selfTest, regression, gate, apps };
