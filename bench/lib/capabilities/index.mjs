/**
 * L1 能力层 —— 跨应用复用的原子能力，全部无 UI、可独立测试。
 *
 * 为什么要有这一层：
 *   之前三处各自实现 LLM 调用、两处各自实现"判分闸门"、检索逻辑绑在 research 里。
 *   任何一处要改（换模型、改超时、加指标），都得改多个地方。
 *
 * 现在应用统一：
 *   import { llm, evaluator, search } from "../../../lib/capabilities/index.mjs";
 *
 * 这一层只依赖 L0（kernel 的存储/观测），不依赖任何应用。
 */

export { llm } from "./llm.mjs";
export { evaluator } from "./evaluator.mjs";
export { search } from "./search.mjs";
export { degrade } from "./degrade.mjs";
