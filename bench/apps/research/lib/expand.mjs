/**
 * 查询扩展 —— 让中文问题也能检索到英文文献。
 *
 * 问题：arXiv / OpenAlex / Crossref 的文献几乎全是英文。用户用中文提问时，
 * 直接把中文串丢给这些 API，命中率极低（实测「AI agent 的长程任务可靠性」
 * 只返回 1 条无关结果）。
 *
 * 方案：两级扩展
 *   1. 内置术语表（零延迟、可离线）：常见研究领域的中→英对照
 *   2. LLM 生成（可选，慢但覆盖任意领域）：让模型只输出检索关键词
 *
 * 最终把「原始查询 + 英文关键词」拼成检索式。
 */

// ---------------------------------------------------------------------------
// 内置术语表：覆盖本工作区三大场景的高频词
// ---------------------------------------------------------------------------

const GLOSSARY = [
  // AI / 能力评测
  ["人工智能", "artificial intelligence AI"],
  ["大模型", "large language model LLM"],
  ["语言模型", "language model"],
  ["智能体", "agent"],
  ["智能体", "AI agent"],
  ["能力", "capability"],
  ["能力边界", "capability frontier"],
  ["评测", "evaluation benchmark"],
  ["基准", "benchmark"],
  ["可靠性", "reliability"],
  ["长程", "long-horizon long-horizon task"],
  ["长任务", "long-horizon task"],
  ["时间跨度", "time horizon"],
  ["自主", "autonomous autonomy"],
  ["幻觉", "hallucination"],
  ["对齐", "alignment"],
  ["可解释", "interpretability explainability"],
  ["强化学习", "reinforcement learning"],
  ["微调", "fine-tuning"],
  ["推理", "reasoning"],
  ["上下文", "context long context"],
  ["多模态", "multimodal"],
  ["具身", "embodied"],
  ["机器人", "robot robotics"],
  ["形式化", "formal verification autoformalization"],
  ["证明", "proof theorem proving"],
  ["基准污染", "benchmark contamination"],
  ["奖励黑客", "reward hacking"],

  // 学科
  ["因果推断", "causal inference"],
  ["综述", "survey review"],
  ["元分析", "meta-analysis"],
  ["随机对照", "randomized controlled trial"],
  ["统计显著性", "statistical significance"],
  ["样本量", "sample size power analysis"],
  ["量子计算", "quantum computing"],
  ["蛋白质", "protein"],
  ["基因组", "genome genomics"],
  ["气候", "climate"],
  ["材料", "materials"],
  ["物理", "physics"],
  ["化学", "chemistry"],
  ["生物", "biology"],
  ["医学", "medicine clinical"],
  ["神经", "neural neuroscience"],

  // 金融
  ["金融", "finance financial"],
  ["财报", "financial statement earnings"],
  ["估值", "valuation"],
  ["股票", "stock equity"],
  ["债券", "bond fixed income"],
  ["风险", "risk"],
  ["回测", "backtest"],
  ["因子", "factor"],
  ["行业", "industry sector"],
  ["市场", "market"],
  ["投资", "investment"],
  ["宏观", "macroeconomic"],
  ["波动", "volatility"],
  ["流动性", "liquidity"],
  ["公司治理", "corporate governance"],

  // 学习
  ["学习", "learning"],
  ["记忆", "memory"],
  ["遗忘", "forgetting catastrophic forgetting"],
  ["持续学习", "continual learning"],
  ["迁移", "transfer"],
  ["课程", "curriculum"],
  ["教学", "teaching education"],
];

const CJK = /[\u4e00-\u9fff]/;

function hasCJK(s) {
  return CJK.test(s);
}

/** 从术语表提取英文关键词（按出现顺序，去重）。 */
function glossaryExpand(query) {
  const found = [];
  for (const [zh, en] of GLOSSARY) {
    if (query.includes(zh)) {
      for (const w of en.split(/\s+/)) {
        if (w && !found.includes(w)) found.push(w);
      }
    }
  }
  return found;
}

/**
 * 把中文查询转成检索式。
 *
 * 规则：
 *  - 纯英文查询：原样返回
 *  - 中英混排：去掉中文，保留英文 + 术语表扩展
 *  - 纯中文：术语表扩展；若术语表覆盖不足，回退到 LLM
 *
 * @returns {Promise<{query: string, expansion: string[], method: string}>}
 */
export async function expandQuery(rawQuery, llmExpand) {
  const q = String(rawQuery || "").trim();
  if (!q) return { query: "", expansion: [], method: "empty" };
  if (!hasCJK(q)) return { query: q, expansion: [], method: "passthrough" };

  const expansion = glossaryExpand(q);

  // 中英混排：把已有英文单词也保留
  const latinWords = q
    .split(/[^A-Za-z0-9-]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));

  const parts = [...new Set([...latinWords, ...expansion])];

  // 术语表命中 ≥3 个词，够用了
  if (parts.length >= 3) {
    return { query: parts.join(" "), expansion: parts, method: "glossary" };
  }

  // 覆盖不足 → 尝试 LLM 扩展
  if (llmExpand) {
    try {
      const extra = await llmExpand(q);
      const llmWords = String(extra || "")
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter((s) => s && /^[A-Za-z0-9\s\-]+$/.test(s));
      const merged = [...new Set([...parts, ...llmWords.flatMap((s) => s.split(/\s+/))])].filter(Boolean);
      if (merged.length >= 2) {
        return { query: merged.join(" "), expansion: merged, method: "glossary+llm" };
      }
    } catch {
      /* LLM 扩展失败不阻塞检索 */
    }
  }

  // 最后兜底：至少去掉中文，避免把中文丢给英文 API
  return {
    query: parts.join(" ") || q,
    expansion: parts,
    method: parts.length ? "glossary-partial" : "raw",
  };
}
