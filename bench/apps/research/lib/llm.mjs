/**
 * LLM 层 —— 研究工作台的「思考」部分。
 *
 * 默认使用本机已有的 OpenAI 兼容端点（pi 的 magpie 代理）。
 * 可通过环境变量切换到任意 OpenAI 兼容服务：
 *
 *   WB_LLM_BASE_URL   默认 http://127.0.0.1:3425/v1
 *   WB_LLM_API_KEY    默认 magpie
 *   WB_LLM_MODEL      默认 auto/qfmodel
 *
 * 关键设计：**检索由通道层完成，LLM 只负责归纳与写作。**
 * 这样即使 LLM 幻觉，也不会伪造出不存在的文献——所有文献都来自真实抓取。
 */

import { llm as cap } from "../../../lib/capabilities/index.mjs";

const MODEL = cap.config.model;
const BASE_URL = cap.config.baseUrl;

export const llmConfig = { baseUrl: BASE_URL, model: MODEL };

/** 调用 LLM，返回纯文本。失败抛错（由上层决定降级策略）。 */
export async function chat(messages, { temperature = 0.3, maxTokens = 4000 } = {}) {
  const r = await cap.chat(messages, {
    temperature,
    maxTokens,
    caller: "research.llm",
    timeoutMs: 180_000,
  });
  if (!r.ok) throw new Error(r.error || "LLM 调用失败");
  return r.text;
}

/** 探活：能否连通 LLM。 */
export async function llmProbe() {
  return cap.probe();
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

const SYSTEM_RESEARCHER = `你是用户的个人研究助手。你的唯一信息来源是用户在消息里给出的「检索结果」。

铁律：
1. 只能引用「检索结果」里出现过的文献。绝不允许补充、想象或回忆任何未列出的文献。
2. 每个论断后面用 [n] 标注它来自第几条检索结果；没有来源支撑的判断必须显式写「（无来源，属推断）」。
3. 区分事实与观点：数据是事实，判断是观点，明确标注。
4. 不确定就写不确定，并给出置信度（高/中/低）。
5. 如果检索结果不足以回答问题，直接说「现有检索结果不足以回答」，并列出还需要查什么。
6. 用中文输出。`;

/**
 * 生成研究报告。
 * @param {object} p
 * @param {string} p.question   研究问题
 * @param {Array}  p.results    通道层抓到的检索结果（真实数据）
 * @param {object} p.verification 引用核验结果（可选）
 */
export async function writeReport({ question, results, verification }) {
  const evidenceBlock = results
    .map((r, i) => {
      const bits = [
        `[${i + 1}] (${r.source} · 证据${r.evidence}级)`,
        `标题：${r.title}`,
        r.authors?.length ? `作者：${r.authors.join(", ")}` : "",
        r.date ? `日期：${r.date}` : "",
        r.citedBy != null ? `被引：${r.citedBy}` : "",
        r.url ? `链接：${r.url}` : "",
        r.snippet ? `摘要：${r.snippet}` : "",
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");

  const verifBlock = verification
    ? `\n\n引用核验结果（这些是我用 Crossref/arXiv/OpenAlex 实测的，你必须如实转述）：\n${verification.results
        .map((v) => `- ${v.target} → ${v.status}${v.hits[0] ? `（${v.hits[0].title}）` : ""}`)
        .join("\n")}`
    : "";

  const prompt = `研究问题：${question}

下面是真实的检索结果（共 ${results.length} 条，来自 arXiv / OpenAlex / Crossref / GitHub / Hacker News）：

${evidenceBlock}${verifBlock}

请写一份结构化的研究报告，严格使用以下 Markdown 结构：

# ${question}

## 结论速览
（3-5 条要点，每条带 [n] 来源标注）

## 检索到的主要证据
（按证据级别分组，A 级在前。每条：标题、来源、日期、一句话说明它支撑了什么）

## 分析
（基于上述证据的归纳。明确区分「证据显示的」与「我推断的」）

## 不确定与缺口
（哪些问题现有证据回答不了？还需要检索什么？）

## 引用清单
（只列检索结果里真实存在的条目，格式：[n] 标题, 来源, 日期, 链接）

## 置信度
（整体置信度：高/中/低，并说明理由）`;

  return chat(
    [
      { role: "system", content: SYSTEM_RESEARCHER },
      { role: "user", content: prompt },
    ],
    { maxTokens: 6000, temperature: 0.25 },
  );
}

/** 把一条笔记做费曼式讲解。 */
export async function explainConcept({ concept, level = "大学生" }) {
  return chat(
    [
      {
        role: "system",
        content:
          "你是学习教练。用费曼学习法讲解概念：先给最简定义，再打比方，再讲为什么需要它，最后指出最常见的误解。不编造事实。用中文。",
      },
      {
        role: "user",
        content: `请按「${level}」能听懂的水平讲解：${concept}`,
      },
    ],
    { maxTokens: 2500, temperature: 0.4 },
  );
}

/** 对一组证据做批判性审视（找出反方观点与弱点）。 */
export async function critique({ question, results }) {
  const block = results
    .map((r, i) => `[${i + 1}] ${r.title} (${r.source}, ${r.date}) — ${r.snippet?.slice(0, 200) ?? ""}`)
    .join("\n");
  return chat(
    [
      {
        role: "system",
        content:
          "你是严苛的同行评审。只针对给出的证据，指出：①证据的弱点 ②可能的反方观点 ③被忽略的变量 ④结论被过度推广的地方。不引入未给出的事实。用中文。",
      },
      { role: "user", content: `研究问题：${question}\n\n证据：\n${block}` },
    ],
    { maxTokens: 2500, temperature: 0.5 },
  );
}
