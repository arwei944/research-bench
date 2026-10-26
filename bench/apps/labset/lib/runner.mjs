/**
 * 实验器 · 运行器
 *
 * 职责：把「任务 × 配置 × 重复次数」跑成一个结果矩阵，并用**可执行验证器**判分。
 *
 * 设计要点：
 *   1. 每次运行记录：配置、任务、重复序号、原始输出、判分结果、耗时、token
 *   2. 判分只依赖 verify()，不依赖人看
 *   3. 支持重复 k 次 → 能算 pass@1 和 pass^k（可靠性的核心指标）
 *   4. 结果落盘为 jsonl，可随时追加、可中断续跑
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, taskById, isMultiTurn, firstPrompt } from "./tasks.mjs";
import { CONFIGS, configById, buildPrompt, parseConfidence } from "./configs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const RUNS = path.join(DATA, "runs");

import { llm } from "../../../lib/capabilities/index.mjs";

const MODEL = llm.config.model;

function ensure() {
  for (const d of [DATA, RUNS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/** 单次调用模型。 */
/** 单次调用模型（走 L1 能力层，统一超时/统计）。 */
async function callOnce(messages, { temperature = 0, maxTokens = 1200 } = {}) {
  const r = await llm.chat(messages, {
    temperature,
    maxTokens,
    caller: "labset.runner",
    timeoutMs: 120_000,
  });
  return r;
}

/**
 * 跑单个 (任务, 配置) 的一个重复。
 * 返回可直接落盘的一条记录。
 *
 * 单轮任务：一次调用。
 * 多轮任务（task.turns）：按轮次连续对话，历史累积；配置因子只作用于**首轮**
 * （否则“只改一个因子”的归因逻辑会被多轮放大成不可解释的复合变量）。
 */
async function runOne(task, config, rep) {
  const multi = isMultiTurn(task);
  const turns = multi ? task.turns : [task.prompt];

  const messages = [];
  const turnLog = [];
  let totalMs = 0;
  let lastText = "";
  let usage = null;
  let confidence = null;

  // 多轮时 usage 必须**累计**，否则只记末轮，成本会被严重低估
  const addUsage = (u) => {
    if (!u) return;
    usage = usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    usage.prompt_tokens += u.prompt_tokens ?? 0;
    usage.completion_tokens += u.completion_tokens ?? 0;
    usage.total_tokens += u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0));
  };

  for (let i = 0; i < turns.length; i++) {
    // 首轮应用全部因子；后续轮只应用“格式类”因子（everyTurn），结构类不重复加
    const built = buildPrompt(turns[i], config, { everyTurn: i > 0 });
    const { prompt, postprocess } = built;
    messages.push({ role: "user", content: prompt });

    const r = await callOnce(messages, { temperature: config.temperature ?? 0 });
    totalMs += r.ms ?? 0;

    if (!r.ok) {
      return {
        task: task.id,
        kind: task.kind,
        config: config.id,
        rep,
        turns: turns.length,
        failedTurn: i + 1,
        ok: false,
        pass: false,
        error: r.error,
        turnLog,
        ms: totalMs,
        at: new Date().toISOString(),
      };
    }

    messages.push({ role: "assistant", content: r.text });
    lastText = postprocess ? postprocess(r.text) : r.text;
    addUsage(r.usage);
    if (built.parseConfidence) confidence = parseConfidence(r.text);   // 只取末轮的自评置信度
    turnLog.push({ turn: i + 1, text: String(r.text).slice(0, 1200), ms: r.ms ?? 0 });
  }

  // 只判末轮（多轮任务的所有轮都汇入末轮结论）
  let verdict;
  try {
    verdict = task.verify(lastText);
  } catch (e) {
    verdict = { pass: false, reason: `验证器异常: ${e.message}` };
  }

  return {
    task: task.id,
    kind: task.kind,
    config: config.id,
    rep,
    turns: turns.length,
    ok: true,
    pass: !!verdict.pass,
    reason: verdict.reason,
    confidence,                 // 仅 calibration 配置有值（0-1）
    raw: lastText.slice(0, 2000),
    graded: String(lastText).slice(0, 400),
    turnLog,
    ms: totalMs,
    usage,
    at: new Date().toISOString(),
  };
}

/**
 * 跑一批实验。
 * @param {object} opts
 * @param {string[]} opts.tasks      任务 id 列表（缺省=全部）
 * @param {string[]} opts.configs    配置 id 列表（缺省=全部）
 * @param {number}   opts.repeats    每个组合重复几次（缺省=1）
 * @param {function} opts.onProgress 进度回调
 */
export async function runExperiment({ tasks, configs, repeats = 1, onProgress } = {}) {
  ensure();
  const taskList = (tasks?.length ? tasks.map(taskById).filter(Boolean) : TASKS);
  const configList = (configs?.length ? configs.map(configById).filter(Boolean) : CONFIGS);
  const total = taskList.length * configList.length * repeats;

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const records = [];
  let done = 0;

  for (const config of configList) {
    for (const task of taskList) {
      for (let rep = 1; rep <= repeats; rep++) {
        const rec = await runOne(task, config, rep);
        records.push(rec);
        done++;
        onProgress?.({ done, total, rec });
      }
    }
  }

  const file = path.join(RUNS, `${runId}.jsonl`);
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  return {
    runId,
    file,
    model: MODEL,
    total,
    summary: summarize(records, configList, taskList),
  };
}

/**
 * 校准度量：ECE（Expected Calibration Error）+ Brier + 分箱表。
 *
 * 为什么需要：一个 pass@1=90% 但校准很差的模型是不可托付的——
 * 你不知道该不该信它。ECE 衡量的是「它说自己 80% 把握时，实际真对的比例是不是 80%」。
 *
 * 口径：只用带 confidence 的记录（即 calibration 配置）。
 * 错误样本（ok=false）不计入——它们没有“自信”可言。
 */
export function calibration(records, bins = 5) {
  const pts = records.filter((r) => r.ok && typeof r.confidence === "number");
  const noConf = records.filter((r) => r.ok && typeof r.confidence !== "number");
  const failedHard = records.filter((r) => !r.ok);

  // 重要诚实声明：超时/报错的样本根本没机会给出置信度，
  // 而它们恰恰是最危险的那类失败。ECE 看不见它们，必须单独报告。
  const coverage = {
    total: records.length,
    withConfidence: pts.length,
    withoutConfidence: noConf.length,
    hardFailures: failedHard.length,
    blindSpot: failedHard.length > 0
      ? `${failedHard.length} 条超时/错误样本没有置信度，ECE 看不到它们——这部分风险不在校准指标里`
      : null,
  };

  if (!pts.length) {
    return { n: 0, ece: null, brier: null, bins: [], coverage, note: "没有带置信度的样本" };
  }

  const rows = pts.map((r) => ({ conf: r.confidence, correct: r.pass ? 1 : 0 }));

  // ECE：按置信度分箱，加权平均 |acc - conf|
  const width = 1 / bins;
  const table = [];
  let ece = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i * width, hi = (i + 1) * width;
    const inBin = rows.filter((r) => (i === bins - 1 ? r.conf >= lo && r.conf <= hi : r.conf >= lo && r.conf < hi));
    if (!inBin.length) continue;
    const avgConf = inBin.reduce((a, r) => a + r.conf, 0) / inBin.length;
    const acc = inBin.reduce((a, r) => a + r.correct, 0) / inBin.length;
    const gap = Math.abs(acc - avgConf);
    ece += (inBin.length / rows.length) * gap;
    table.push({
      range: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      n: inBin.length,
      avgConf: +avgConf.toFixed(3),
      acc: +acc.toFixed(3),
      gap: +gap.toFixed(3),
      // 过自信 = 说得很满但常错；欠自信 = 说得保守但常对
      bias: acc < avgConf ? "过自信" : acc > avgConf ? "欠自信" : "准",
    });
  }

  const brier = rows.reduce((a, r) => a + (r.conf - r.correct) ** 2, 0) / rows.length;

  return {
    n: rows.length,
    ece: +ece.toFixed(4),
    brier: +brier.toFixed(4),
    avgConfidence: +(rows.reduce((a, r) => a + r.conf, 0) / rows.length).toFixed(3),
    accuracy: +(rows.reduce((a, r) => a + r.correct, 0) / rows.length).toFixed(3),
    bins: table,
    coverage,
    // 样本里没有任何错答时，ECE 只能证明「它在自己会做的题上很自信」，不证明校准好
    caveat: rows.every((r) => r.correct === 1)
      ? "样本里没有任何错答——ECE 只证明了「会做的题上自信」，没有测到「不会做时是否也知道」"
      : null,
    note: ece < 0.05 ? "校准良好" : ece < 0.15 ? "轻度失准" : "校准差（不可托付）",
  };
}

/**
 * 汇总：按配置聚合 pass@1、按任务聚合、算 pass^k 可靠性。
 */
export function summarize(records, configList = CONFIGS, taskList = TASKS) {
  const byConfig = {};
  const byTask = {};

  for (const r of records) {
    // 按配置
    if (!byConfig[r.config]) byConfig[r.config] = { runs: 0, pass: 0, msSum: 0, tasks: {} };
    const c = byConfig[r.config];
    c.runs++;
    if (r.pass) c.pass++;
    c.msSum += r.ms ?? 0;
    if (!c.tasks[r.task]) c.tasks[r.task] = [];
    c.tasks[r.task].push(r.pass ? 1 : 0);

    // 按任务
    if (!byTask[r.task]) byTask[r.task] = { runs: 0, pass: 0, kind: r.kind };
    byTask[r.task].runs++;
    if (r.pass) byTask[r.task].pass++;
  }

  // 配置级指标
  const configStats = Object.entries(byConfig).map(([id, v]) => {
    // pass^k：每个任务 k 次全过
    let allPass = 0;
    let taskCount = 0;
    for (const arr of Object.values(v.tasks)) {
      taskCount++;
      if (arr.every((x) => x === 1)) allPass++;
    }
    return {
      config: id,
      name: configById(id)?.name ?? id,
      runs: v.runs,
      pass: v.pass,
      passRate: v.runs ? +(v.pass / v.runs).toFixed(3) : 0,
      passK: taskCount ? +(allPass / taskCount).toFixed(3) : 0,
      avgMs: v.runs ? Math.round(v.msSum / v.runs) : 0,
    };
  });
  // 保持配置定义顺序
  configStats.sort(
    (a, b) => (configById(a.config) ? CONFIGS.indexOf(configById(a.config)) : 99) -
              (configById(b.config) ? CONFIGS.indexOf(configById(b.config)) : 99),
  );

  // 任务级（含失败类型与耗时分位）
  const byTaskFull = {};
  for (const r of records) {
    (byTaskFull[r.task] ??= []).push(r);
  }

  const taskStats = Object.entries(byTaskFull).map(([id, list]) => {
    const runs = list.length;
    const pass = list.filter((r) => r.pass).length;
    const timeouts = list.filter((r) => !r.ok && /abort|timeout/i.test(r.error ?? "")).length;
    const errors = list.filter((r) => !r.ok && !/abort|timeout/i.test(r.error ?? "")).length;
    const wrongs = list.filter((r) => r.ok && !r.pass).length;
    const okTimes = list.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
    const p50 = okTimes.length ? okTimes[Math.floor(okTimes.length / 2)] : null;
    const maxT = okTimes.length ? okTimes[okTimes.length - 1] : null;
    const tokens = list.filter((r) => r.usage?.completion_tokens).map((r) => r.usage.completion_tokens);
    const avgTokens = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null;
    const turns = Math.max(...list.map((r) => r.turns ?? 1));
    // 多轮任务：在哪一轮挂掉（定位“上下文崩塌点”）
    const failedTurns = list.filter((r) => r.failedTurn).map((r) => r.failedTurn);

    // 悬崖判定：成功的最大耗时占超时预算的比例
    const TIMEOUT_MS = 120_000;
    const cliffRatio = maxT ? +(maxT / TIMEOUT_MS).toFixed(2) : null;
    const zone = !maxT ? "unknown" : maxT < 30_000 ? "safe" : maxT < 80_000 ? "warn" : "cliff";

    return {
      task: id,
      kind: byTask[id].kind,
      runs,
      pass,
      passRate: runs ? +(pass / runs).toFixed(3) : 0,
      passK: runs && pass === runs ? 1 : 0,
      turns,
      failedTurns,
      // 失败分类
      timeouts,
      errors,
      wrongs,
      // 耗时与成本
      p50ms: p50,
      maxMs: maxT,
      avgTokens,
      cliffRatio,
      zone,
    };
  });

  // 基线对比（相对 baseline 的提升）
  const baseline = configStats.find((c) => c.config === "baseline");
  const deltas = baseline
    ? configStats
        .filter((c) => c.config !== "baseline")
        .map((c) => ({
          config: c.config,
          name: c.name,
          deltaPassRate: +(c.passRate - baseline.passRate).toFixed(3),
          deltaPassK: +(c.passK - baseline.passK).toFixed(3),
          ratio: baseline.passRate ? +(c.passRate / baseline.passRate).toFixed(2) : null,
        }))
    : [];

  const timeoutsTotal = records.filter((r) => !r.ok && /abort|timeout/i.test(r.error ?? "")).length;
  const errorsTotal = records.filter((r) => !r.ok && !/abort|timeout/i.test(r.error ?? "")).length;
  const wrongsTotal = records.filter((r) => r.ok && !r.pass).length;

  // 整体可靠性：所有任务都全过的比例
  const allTaskIds = [...new Set(records.map((r) => r.task))];
  const reliableTasks = allTaskIds.filter((tid) => {
    const list = records.filter((r) => r.task === tid);
    return list.length >= 2 && list.every((r) => r.pass);
  }).length;

  return {
    totalRuns: records.length,
    overallPassRate: records.length ? +(records.filter((r) => r.pass).length / records.length).toFixed(3) : 0,
    failureBreakdown: { timeouts: timeoutsTotal, errors: errorsTotal, wrongAnswers: wrongsTotal },
    // 多轮 vs 单轮：分开统计，否则两种难度混在一起看不出问题
    turnBreakdown: {
      singleTurn: records.filter((r) => (r.turns ?? 1) === 1).length,
      multiTurn: records.filter((r) => (r.turns ?? 1) > 1).length,
      multiTurnPassRate: (() => {
        const m = records.filter((r) => (r.turns ?? 1) > 1);
        return m.length ? +(m.filter((r) => r.pass).length / m.length).toFixed(3) : null;
      })(),
      singleTurnPassRate: (() => {
        const s = records.filter((r) => (r.turns ?? 1) === 1);
        return s.length ? +(s.filter((r) => r.pass).length / s.length).toFixed(3) : null;
      })(),
    },
    reliability: {
      tasksTotal: allTaskIds.length,
      tasksFullyReliable: reliableTasks,
      ratio: allTaskIds.length ? +(reliableTasks / allTaskIds.length).toFixed(3) : 0,
    },
    configStats,
    taskStats,
    deltas,
    calibration: calibration(records),
  };
}

/** 读一次历史运行。 */
export function loadRun(runId) {
  const f = path.join(RUNS, `${runId}.jsonl`);
  if (!existsSync(f)) return null;
  const records = readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { runId, records, summary: summarize(records) };
}

/** 列出历史运行。 */
export function listRuns() {
  ensure();
  return readdirSync(RUNS)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const p = path.join(RUNS, f);
      const st = statSync(p);
      const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
      return { runId: f.replace(/\.jsonl$/, ""), file: f, records: lines.length, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}
