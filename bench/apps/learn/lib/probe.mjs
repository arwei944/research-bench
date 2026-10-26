/**
 * learn · 追问判定（大模型课程）
 *
 * 核心原则：**不判对错，判「懂到什么程度」。**
 *
 * 为什么：追问是开放的（「如果去掉 KV cache 会怎样」没有唯一答案），
 * 用对错二元判定会退化成「猜老师想要什么」。
 *
 * 三档：
 *   shallow  只复述了定义/术语，没体现因果
 *   partial  说到了关键机制，但没推到底
 *   deep     因果链完整，能自己指出后果或边界
 *
 * 降级：LLM 不可用时退化为关键词/结构启发式，并**明确标注 degraded**。
 * 这是照抄平台既有规范：能力降级必须可见，不能静默失败。
 */

import { llm, degrade } from "../../../lib/capabilities/index.mjs";

const KIND_LABEL = {
  contrast: "对比",
  counterfactual: "反事实",
  application: "应用",
};

const SYSTEM = `你是一个严格但公正的评判者，判断学习者对一个技术概念的理解深度。

你会收到：概念、追问类型、追问本身、该追问的要点（expect）、学习者的回答。

请只输出 JSON，不要任何其它文字：
{"level":"shallow|partial|deep","reason":"一句中文说明","missed":["漏掉的关键点"]}

判定标准（务必严格）：
- shallow：只是复述了定义、重复了题面用词、或答非所问。没有体现任何因果或机制。
- partial：提到了关键机制的一部分，但没有推出后果，或只答对了一半。
- deep：因果链完整，能自己指出「因此会怎样」「边界在哪」「什么时候不成立」。

特别注意：
- 学习者答得长不等于 deep。堆砌术语但没因果的，判 shallow。
- 学习者用词与 expect 不同但道理对，判 deep。
- 如果学习者的回答暴露了错误理解，判 shallow 并在 missed 里指出。`;

/**
 * 判定一条追问的回答。
 *
 * @param {object} args
 * @param {object} args.term     词条（含 cn/en/def/why）
 * @param {object} args.probe    追问（含 kind/q/expect）
 * @param {string} args.answer   学习者的回答
 * @returns {Promise<{level, reason, missed, source, degraded?}>}
 */
export async function judge({ term, probe, answer }) {
  const text = String(answer ?? "").trim();
  if (!text) {
    return { level: "shallow", reason: "没有作答", missed: [], source: "empty" };
  }
  // 极短回答直接判 shallow，不必调模型（省钱也避免模型被短句误导）
  if (text.length < 8) {
    return { level: "shallow", reason: "回答过短，没有展开任何机制", missed: [], source: "heuristic" };
  }

  const user = [
    `概念：${term.cn}（${term.en}）`,
    `定义：${term.def}`,
    `为什么重要：${term.why}`,
    ``,
    `追问类型：${KIND_LABEL[probe.kind] ?? probe.kind}`,
    `追问：${probe.q}`,
    `要点（不要求用同样的词）：${probe.expect}`,
    ``,
    `学习者回答：${text}`,
  ].join("\n");

  try {
    const r = await llm.chat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      { temperature: 0.1, maxTokens: 400, caller: "learn.probe", timeoutMs: 60_000 },
    );
    if (!r.ok) throw new Error(r.error || "LLM 调用失败");

    const parsed = extractJson(r.text);
    if (!parsed || !parsed.level) throw new Error("模型未返回可解析的判定");

    const level = ["shallow", "partial", "deep"].includes(parsed.level) ? parsed.level : "shallow";
    degrade.report("llm", "ok", null);
    return {
      level,
      reason: String(parsed.reason ?? "").slice(0, 300),
      missed: Array.isArray(parsed.missed) ? parsed.missed.slice(0, 4).map(String) : [],
      source: "llm",
      model: llm.config.model,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    degrade.report("llm", "degraded", msg);
    return {
      ...heuristic(term, probe, text),
      source: "fallback",
      degraded: true,
      note: `LLM 不可用（${msg}），已降级为关键词判定——结果仅供方向参考，不代表真实深度`,
    };
  }
}

/** 从可能带 markdown 围栏或前后缀的文本里抽出第一个 JSON 对象。 */
function extractJson(s) {
  const t = String(s ?? "");
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : t;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 降级：关键词启发式
// ---------------------------------------------------------------------------

/**
 * 关键词启发式的局限（必须诚实说明）：
 *   - 只能检测「是否提到了相关概念」，检测不到因果是否成立
 *   - 用同义词但道理对的可能被判 shallow（假阴性）
 *   - 堆砌关键词但没逻辑的可能被判 deep（假阳性）
 * 所以结果必须标 degraded，且不作为「掌握」的充分证据。
 */
function heuristic(term, probe, text) {
  // 从 expect 里抽关键词：中文按标点/空格切，英文按词切，取长度 >= 2 的
  const kw = String(probe.expect ?? "")
    .split(/[，。、；：,.;:\s()（）「」【】]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !/^(的|了|是|在|和|与|或|不|就|会|这|那)$/.test(x));

  const hit = kw.filter((k) => text.includes(k));
  const ratio = kw.length ? hit.length / kw.length : 0;

  // 因果连接词：出现这些说明可能在讲机制而非复述
  const causal = /(因为|所以|因此|导致|否则|如果|会变|就会|结果|意味着|反之)/.test(text);

  let level = "shallow";
  if (ratio >= 0.5 && causal) level = "deep";
  else if (ratio >= 0.25 || causal) level = "partial";

  return {
    level,
    reason: `关键词命中 ${hit.length}/${kw.length}${causal ? "，且出现了因果表述" : "，未出现因果表述"}`,
    missed: kw.filter((k) => !text.includes(k)).slice(0, 4),
  };
}

export const judgeMeta = { kinds: KIND_LABEL };
