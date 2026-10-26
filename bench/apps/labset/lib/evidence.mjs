/**
 * 证据导出 —— 把一次实验的 jsonl 原始记录，转成可读、可复现、可引用的证据文件。
 *
 * 为什么需要这一步：
 *   jsonl 只是数据，不是证据。证据要满足三件事：
 *     1. 人能看懂（有排版、有汇总、有失败样本）
 *     2. 可复现（记录配置、模型、时间、任务定义）
 *     3. 可引用（每个数字都能追到具体哪一次调用）
 *
 * 输出：
 *   <app>/data/evidence/<runId>.md    人读版（Markdown）
 *   <app>/data/evidence/<runId>.json  机读版（含全部原始输出）
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS, taskById } from "./tasks.mjs";
import { CONFIGS, configById } from "./configs.mjs";
import { summarize } from "./runner.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "..", "data");
const RUNS = path.join(DATA, "runs");
const EVIDENCE = path.join(DATA, "evidence");

function ensure() {
  for (const d of [EVIDENCE]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function loadRecords(runId) {
  const f = path.join(RUNS, `${runId}.jsonl`);
  if (!existsSync(f)) return null;
  return readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** 生成可引用的证据包。 */
export function exportEvidence(runId, { model = "unknown", note = "" } = {}) {
  ensure();
  const records = loadRecords(runId);
  if (!records) throw new Error(`运行 ${runId} 不存在`);

  const summary = summarize(records);

  // ── 机读版 ────────────────────────────────────────────────
  const json = {
    runId,
    exportedAt: new Date().toISOString(),
    model,
    note,
    environment: {
      node: process.version,
      platform: process.platform,
    },
    taskDefinitions: TASKS.map((t) => ({
      id: t.id,
      kind: t.kind,
      prompt: t.prompt,
      answer: t.answer,
      note: t.note,
    })),
    configDefinitions: CONFIGS,
    summary,
    records,
  };
  writeFileSync(path.join(EVIDENCE, `${runId}.json`), JSON.stringify(json, null, 2), "utf8");

  // ── 人读版 ────────────────────────────────────────────────
  const md = renderMarkdown({ runId, model, note, records, summary });
  writeFileSync(path.join(EVIDENCE, `${runId}.md`), md, "utf8");

  return {
    runId,
    markdown: path.join(EVIDENCE, `${runId}.md`),
    json: path.join(EVIDENCE, `${runId}.json`),
    records: records.length,
  };
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function renderMarkdown({ runId, model, note, records, summary }) {
  const lines = [];
  const push = (s = "") => lines.push(s);

  const taskIds = [...new Set(records.map((r) => r.task))];
  const configIds = [...new Set(records.map((r) => r.config))];
  const repeats = Math.max(...records.map((r) => r.rep ?? 1));

  push(`# 实验证据 · ${runId}`);
  push();
  push(`> 导出时间：${new Date().toISOString()} ｜ 模型：\`${model}\``);
  push(`> 规模：${taskIds.length} 任务 × ${configIds.length} 配置 × ${repeats} 重复 = **${records.length} 次调用**`);
  if (note) push(`> 备注：${note}`);
  push();

  // ── 一句话结论 ──
  push(`## 0. 结论速览`);
  push();
  const base = summary.configStats.find((c) => c.config === "baseline");
  if (base) {
    push(`- **基线 pass@1 = ${pct(base.passRate)}**（${base.pass}/${base.runs}）`);
    const best = [...summary.configStats].sort((a, b) => b.passRate - a.passRate)[0];
    const worst = [...summary.configStats].sort((a, b) => a.passRate - b.passRate)[0];
    push(`- 最高：${best.name} = ${pct(best.passRate)}；最低：${worst.name} = ${pct(worst.passRate)}`);
    const upgraded = summary.deltas.filter((d) => d.deltaPassRate > 0);
    const degraded = summary.deltas.filter((d) => d.deltaPassRate < 0);
    push(`- 相对基线：**${upgraded.length} 个配置变好，${degraded.length} 个变差**`);
    if (best.passRate >= 0.99) {
      push(`- ⚠️ **天花板警告**：最高配置已达 ${pct(best.passRate)}，任务过简单，无法区分配置差异。这批数据只能证明「在简单任务上脚手架无效」，不能推广。`);
    }
  }
  push();

  // ── 配置对比表 ──
  push(`## 1. 配置对比（这是核心表格）`);
  push();
  push(`| 配置 | 说明 | 通过/总数 | pass@1 | pass^k | 平均耗时 | 相对基线 |`);
  push(`|---|---|---|---|---|---|---|`);
  for (const c of summary.configStats) {
    const def = configById(c.config);
    const d = summary.deltas.find((x) => x.config === c.config);
    const deltaStr = d
      ? d.deltaPassRate === 0
        ? "±0"
        : `${d.deltaPassRate > 0 ? "+" : ""}${(d.deltaPassRate * 100).toFixed(1)}pp`
      : "—（基线）";
    push(
      `| **${c.name}** | ${def?.desc ?? ""} | ${c.pass}/${c.runs} | ${pct(c.passRate)} | ${pct(c.passK)} | ${c.avgMs}ms | ${deltaStr} |`,
    );
  }
  push();

  // ── 任务难度表 ──
  push(`## 2. 任务难度（哪些题有区分度）`);
  push();
  push(`| 任务 | 类型 | 通过率 | 说明 |`);
  push(`|---|---|---|---|`);
  for (const t of summary.taskStats) {
    const def = taskById(t.task);
    push(`| \`${t.task}\` | ${t.kind} | ${pct(t.passRate)} | ${def?.note ?? ""} |`);
  }
  push();
  const saturated = summary.taskStats.filter((t) => t.passRate >= 0.99);
  if (saturated.length) {
    push(`> ⚠️ **${saturated.length}/${summary.taskStats.length} 个任务已达 100%**（${saturated.map((t) => t.task).join(", ")}）。`);
    push(`> 这些任务对配置差异**没有区分度**，下一轮应替换为更难的题。`);
    push();
  }

  // ── 逐次明细 ──
  push(`## 3. 逐次运行明细（可追溯到每一次调用）`);
  push();
  for (const cid of configIds) {
    const def = configById(cid);
    const rows = records.filter((r) => r.config === cid);
    const pass = rows.filter((r) => r.pass).length;
    push(`### ${def?.name ?? cid}（${pass}/${rows.length}）`);
    push();
    push(`| 任务 | # | 结果 | 判分依据 | 耗时 |`);
    push(`|---|---|---|---|---|`);
    for (const r of rows) {
      const verdict = r.pass ? "✅" : r.ok ? "❌" : "⚠️错误";
      push(`| \`${r.task}\` | ${r.rep} | ${verdict} | ${(r.reason || r.error || "").slice(0, 60)} | ${r.ms}ms |`);
    }
    push();
  }

  // ── 失败样本原文 ──
  const fails = records.filter((r) => !r.pass && r.ok);
  if (fails.length) {
    push(`## 4. 失败样本原文（最有信息量的部分）`);
    push();
    for (const f of fails) {
      const def = taskById(f.task);
      push(`### \`${f.task}\` × ${f.config}`);
      push();
      push(`**题面**`);
      push("```");
      push(def?.prompt ?? "");
      push("```");
      push(`**标准答案**：\`${def?.answer ?? "?"}\``);
      push();
      push(`**模型原始输出**`);
      push("```");
      push((f.raw ?? "").trim());
      push("```");
      push(`**判分**：${f.reason}`);
      push();
    }
  }

  // ── 可复现性 ──
  push(`## 5. 如何复现`);
  push();
  push("```bash");
  push(`# 1) 验证器自检（必须先通过）`);
  push(`curl -s http://127.0.0.1:7800/api/labset/selftest`);
  push();
  push(`# 2) 重跑同一组任务与配置`);
  push(`curl -s -X POST http://127.0.0.1:7800/api/labset/run \\`);
  push(`  -H "Content-Type: application/json" \\`);
  push(`  -d '{"tasks":${JSON.stringify(taskIds)},"configs":${JSON.stringify(configIds)},"repeats":${repeats}}'`);
  push("```");
  push();
  push(`原始记录：\`data/runs/${runId}.jsonl\``);
  push();

  return lines.join("\n");
}

/** 列出已有证据。 */
export function listEvidence() {
  ensure();
  return readdirSync(EVIDENCE)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const st = statSync(path.join(EVIDENCE, f));
      return { runId: f.replace(/\.md$/, ""), size: st.size, modified: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.modified < b.modified ? 1 : -1));
}

