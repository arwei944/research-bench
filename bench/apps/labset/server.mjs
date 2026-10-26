/**
 * 实验器应用 —— HTTP 接口层。
 *
 * 它不自己 listen，只导出 routes 给平台挂到 /api/labset/*。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, tasksByKind, taskById, selfTest, fullSelfTest } from "./lib/tasks.mjs";
import { CONFIGS, FACTORS, configById } from "./lib/configs.mjs";
import { runExperiment, summarize, loadRun, listRuns } from "./lib/runner.mjs";
import { exportEvidence, listEvidence } from "./lib/evidence.mjs";
import { bench } from "../../kernel/index.mjs";
import { evaluator } from "../../lib/capabilities/index.mjs";
import { TASKS as ALL_TASKS } from "./lib/tasks.mjs";
import { FIXTURES } from "./lib/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 启动时把任务集与回归夹具注册到 L1 能力层
evaluator.registerTasks("labset", ALL_TASKS);
evaluator.registerFixtures("labset", FIXTURES);

/** 已知错答：用于判分器双向自检（错的必须被拒）。 */
const WRONG_ANSWERS = {
  "A-arith-long": ["1", "2", "5261"],
  "A-count-letters": ["2", "1", "4"],
  "A-logic-syllogism": ["A", "B", "D"],
  "A-code-trace": ["18", "3", "30"],
  "B-multistep-money": ["1360", "513", "340"],
  "B-multistep-dependency": ["6", "24", "1"],
  "C-novel-rule": ["10", "1000", "70"],
  "C-novel-rule-2": ["4", "2", "6"],
  "D-long-chain": ["343", "4439", "5000"],
  "D-subset-count": ["3", "5", "6"],
  "D-liar-puzzle": ["A=真 B=假 C=真", "A=真 B=真 C=假", "A=假 B=假 C=真"],
  "D-closure-trace": ["808", "710", "18"],
  "D-rule-priority": ["40", "400", "3999"],
  "D-bayes": ["99", "95", "1", "5"],
  "E-digit-count": ["29", "31", "300"],
  "E-constraint-perm": ["6", "8", "120"],
  "E-nested-branches": ["206", "208", "190"],
  "E-counterfactual": ["0", "60", "66.67"],
  "E-rule-chain": ["420", "105", "8"],
  "E-logic-negation": ["A", "C", "D", "E"],
  // F 类：多轮（典型错误=沿用旧前提的中间结果）
  "F-multiturn-revise": ["68", "77", "9", "70"],
  "F-multiturn-restate": ["21", "189", "195", "14"],
  "F-multiturn-distract": ["90", "100", "60", "6"],
  // G 类：长上下文（典型错误=漏规则/顺序错/取了示例里的数）
  "G-longctx-rules": ["153", "148", "51", "6"],
  "G-longctx-mapping": ["18", "15", "6", "3"],
};


const RUNS = path.join(HERE, "data", "runs");
if (!existsSync(RUNS)) mkdirSync(RUNS, { recursive: true });

export const routes = {
  "GET /ping": async () => ({ ok: true, app: "labset" }),

  // 任务集
  "GET /tasks": async () => ({
    tasks: TASKS.map((t) => ({
      id: t.id,
      kind: t.kind,
      note: t.note,
      prompt: t.prompt ?? (t.turns ? t.turns[0] : ""),
      turns: t.turns ?? null,
      answer: t.answer,
    })),
    byKind: Object.fromEntries(Object.entries(tasksByKind()).map(([k, v]) => [k, v.map((t) => t.id)])),
  }),

  // 配置集
  "GET /configs": async () => ({
    configs: CONFIGS,
    factors: Object.fromEntries(
      Object.entries(FACTORS).map(([k, v]) => [k, { name: v.name, desc: v.desc }]),
    ),
  }),

  // 验证器自检（实验可信度的地基）：双向自检 + 历史样本回归
  "GET /selftest": async () => fullSelfTest(),

  // 跑实验
  "POST /run": async (_ctx, b) => {
    const st = await fullSelfTest();
    if (!st.ok) {
      return {
        error: "验证器自检未通过，拒绝跑实验（否则结论不可信）",
        selftest: st,
      };
    }
    const r = await runExperiment({
      tasks: Array.isArray(b.tasks) && b.tasks.length ? b.tasks : undefined,
      configs: Array.isArray(b.configs) && b.configs.length ? b.configs : undefined,
      repeats: Math.max(1, Math.min(Number(b.repeats) || 1, 5)),
      onProgress: () => {},
    });
    // ---- 写入内核：一次实验 → 每个配置一个 Run，附闸门状态 ----
    // 整批写入包在同一个因果上下文里：以后能回答「这条结论是哪次实验产生的」
    const gateState = { selfTest: st.basic, fixtures: st.fixtures, passed: !!st.ok };
    const createdRuns = [];
    const createdClaims = [];

    bench.withCause({ by: "labset", reason: "experiment", refId: r.runId }, () => {
      for (const c of r.summary.configStats) {
        const run = bench.run.record({
          task: [...new Set(r.summary.taskStats.map((t) => t.task))].join(","),
          config: c.config,
          model: r.model,
          repeats: Math.max(1, Math.round(c.runs / Math.max(1, r.summary.taskStats.length))),
          result: {
            pass: c.pass,
            total: c.runs,
            passRate: c.passRate,
            passK: c.passK,
            avgMs: c.avgMs,
          },
          gate: gateState,
          meta: {
            experimentId: r.runId,
            evidenceFile: r.file,
            baselineDelta: r.summary.deltas.find((d) => d.config === c.config)?.deltaPassRate ?? null,
          },
        });
        createdRuns.push({ id: run.id, config: c.config, passRate: c.passRate, gated: gateState.passed });
      }

      // ---- 闭环补全：自动把实验结论写成 Claim（带 A 级 Evidence）----
      // 这一步让「跑实验」本身就能产出知识，不需要人工写报告。
      if (gateState.passed) {
        for (const t of r.summary.taskStats) {
          // 只对「有区分度」或「处于悬崖区」的任务生成断言——
          // 100% 通过且安全的题没有信息量，不该进知识层当结论
          const informative = t.passRate < 0.99 || t.zone === "cliff";
          if (!informative) continue;

          const text = t.zone === "cliff"
            ? `任务「${t.task}」处于悬崖区：最慢 ${Math.round((t.maxMs || 0) / 1000)}s，接近超时线，pass@1 仅 ${(t.passRate * 100).toFixed(0)}%`
            : `任务「${t.task}」在基线配置下 pass@1 为 ${(t.passRate * 100).toFixed(0)}%（${t.pass}/${t.runs}）`;

          const claim = bench.claim.create({
            text,
            confidence: "medium",
            tags: ["from-experiment", t.zone === "cliff" ? "悬崖区" : "有区分度"],
            note: `由实验 ${r.runId} 自动生成`,
          });

          // 挂 A 级证据：指向该配置的 Run
          const runId = (createdRuns[0] && createdRuns[0].id) || null;
          if (runId) {
            bench.claim.attachEvidence(claim.id, {
              kind: "run",
              refId: runId,
              tier: "A",
              summary: `可执行验证器判分：${t.pass}/${t.runs} 通过，${t.timeouts} 次超时`,
              strength: t.passRate < 0.5 || t.zone === "cliff" ? 3 : 2,
            });
          }
          createdClaims.push({ id: claim.id, text, task: t.task });
        }
      }
    });

    r.kernelRuns = createdRuns;
    r.kernelClaims = createdClaims;
    return r;
  },

  // 历史运行
  "GET /runs": async () => ({ runs: listRuns() }),

  // 导出证据（Markdown + JSON）
  "POST /export": async (_ctx, b) => {
    const runId = String(b.runId ?? "");
    if (!runId) return { error: "缺少 runId" };
    return exportEvidence(runId, { model: b.model ?? "auto/qfmodel", note: b.note ?? "" });
  },

  "GET /evidence": async () => ({ evidence: listEvidence() }),

  // ---- 内核视图：让实验产物进入统一数据层 ----
  "GET /kernel/stats": async () => bench.stats(),

  "GET /kernel/runs": async () => ({
    runs: bench.run.list().map((r) => ({
      id: r.id,
      config: r.config,
      model: r.model,
      passRate: r.result?.passRate ?? null,
      passK: r.result?.passK ?? null,
      gated: !!r.gate?.passed,
      experimentId: r.meta?.experimentId,
      createdAt: r.createdAt,
    })),
  }),

  "GET /kernel/events": async () => ({ events: bench.events(40) }),

  // 因果链：这个结论是哪次操作造成的
  "GET /kernel/trace": async (_ctx, b) => ({
    trace: bench.trace(String(b.type ?? "claim"), String(b.id ?? "")),
  }),
};

export const dynamicRoutes = [
  {
    method: "GET",
    pattern: /^\/runs\/([\w-]+)$/,
    handler: async (ctx, body, mm) => {
      const r = loadRun(mm[1]);
      if (!r) return { __status: 404, error: "运行不存在" };
      return r;
    },
  },
];
