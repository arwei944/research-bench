/**
 * research 应用的通道层 —— **已废弃为薄适配层**。
 *
 * 历史：这里曾有一份 481 行的独立通道实现，与 `bench/lib/capabilities/search.mjs`
 * （425 行）以及 `tools/research/research-cli.mjs`（624 行）三份并存，
 * 同一个「14 通道检索 + 引用核验」能力写了三遍。
 *
 * 现在：唯一实现是 `bench/lib/capabilities/search.mjs`（L1 能力层）。
 * 本文件只做**命名适配**，因为 research 应用的历史调用点用的是
 * `channels.searchArxiv()` 这类名字，而能力层用的是 `search.arxiv()`。
 *
 * 保留本文件而不是直接改 research/server.mjs 的 import，是为了：
 *   1. 未来若 research 需要研究特有的通道定制，有地方放
 *   2. 减少一次性大改引入的风险
 *
 * 但它**不再包含任何实现**。如果发现这里又长出逻辑，说明有人走错了路。
 */

import { search } from "../../../lib/capabilities/search.mjs";

// ---- 通道清单 ----
export const CHANNELS = search.CHANNELS;

// ---- 健康探测 ----
export const probeAll = search.probeAll;

// ---- 检索 ----
export const searchAll = search.searchAll;

/** 单通道检索（历史命名 → 能力层命名）。 */
export const searchArxiv = search.arxiv;
export const searchOpenAlex = search.openalex;
export const searchCrossref = search.crossref;
export const searchGithub = search.github;
export const searchHn = search.hn;

// ---- 核验 ----
export const verifyCitation = search.verifyCitation;
export const verifyMany = search.verifyMany;

// ---- 查询扩展与相关性 ----
export const expandQuery = search.expandQuery;

/**
 * 相关性打分。
 *
 * 能力层的 `searchAll` 内部已做相关性过滤，不再单独导出 relevance 函数。
 * 这里给一个等价的最小实现，供外部按需调用（保持向后兼容）。
 */
export function relevance(query, item) {
  const q = String(query ?? "").toLowerCase();
  const text = [
    item?.title, item?.snippet, item?.abstract, item?.summary, item?.desc,
  ].filter(Boolean).join(" ").toLowerCase();

  if (!q || !text) return 0;

  // 中文按 2-gram，英文按词
  const terms = /[\u4e00-\u9fa5]/.test(q)
    ? [...q].filter((c) => /[\u4e00-\u9fa5a-z0-9]/.test(c))
    : q.split(/\s+/).filter(Boolean);

  if (!terms.length) return 0;
  const hits = terms.filter((t) => text.includes(t)).length;
  return hits / terms.length;
}
