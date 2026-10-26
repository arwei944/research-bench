/**
 * L1 能力 · 降级契约
 *
 * 解决的问题：**L1 能力挂了，L2 应用应该怎么办？**
 *
 * 之前没有任何契约——每个应用自己 try/catch，行为不一致，
 * 而且用户看不出「这个结果是不是降级的」。
 *
 * 本模块定义统一的降级规则：
 *
 *   能力状态                  应用行为
 *   ────────────────────────────────────────────
 *   ok                       正常返回
 *   degraded（部分可用）       返回结果 + degraded 标记 + 原因
 *   unavailable（全不可用）    返回兜底结果 + unavailable 标记，或明确报错
 *
 * 三条硬性要求：
 *   1. **降级必须可见** —— 返回体里有 `degraded: true` 与 `reason`
 *   2. **降级必须可查** —— /status 与 /api/_platform/capabilities 能列出当前降级项
 *   3. **降级不能静默** —— 降级事件写入内核事件流，可追溯
 */

/** 能力健康状态缓存（由各能力自己上报）。 */
const healthMap = new Map(); // capName -> { status, reason, since, checks }

const STATUS = { ok: "ok", degraded: "degraded", unavailable: "unavailable" };

/**
 * 上报能力状态。能力实现方在探测后调用。
 * @param {string} name   能力名（llm / search / evaluator）
 * @param {"ok"|"degraded"|"unavailable"} status
 * @param {string} [reason]
 */
function report(name, status, reason) {
  const prev = healthMap.get(name);
  const changed = !prev || prev.status !== status;

  healthMap.set(name, {
    status,
    reason: reason ?? null,
    since: changed ? new Date().toISOString() : prev.since,
    checks: (prev?.checks ?? 0) + 1,
    lastCheckAt: new Date().toISOString(),
  });

  // 状态变化写事件流（可追溯）
  if (changed) {
    try {
      fsApi.appendEvent({
        action: "capability",
        type: "health",
        id: name,
        detail: { from: prev?.status ?? null, to: status, reason: reason ?? null },
        at: new Date().toISOString(),
      });
    } catch { /* 事件写失败不影响主流程 */ }
  }
  return healthMap.get(name);
}

// ESM 里避免直接 require：用顶层 import 的别名
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVENT_FILE = path.resolve(HERE, "..", "..", "data", "kernel", "events.jsonl");

const fsApi = {
  appendEvent(ev) {
    const dir = path.dirname(EVENT_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(EVENT_FILE, JSON.stringify(ev) + "\n", "utf8");
  },
};

/** 读取当前能力状态。 */
function health() {
  const out = {};
  for (const [k, v] of healthMap.entries()) out[k] = v;
  return out;
}

/** 是否有任何能力不可用。 */
function anyUnavailable() {
  return [...healthMap.values()].some((v) => v.status === STATUS.unavailable);
}

/** 是否有任何能力降级。 */
function anyDegraded() {
  return [...healthMap.values()].some((v) => v.status !== STATUS.ok);
}

/**
 * 降级包装：把一个异步操作包成「失败时自动降级」。
 *
 * @param {object} opts
 *   - name      能力名（用于状态上报）
 *   - run       正常执行函数
 *   - fallback  降级时返回什么（函数或值）；不提供则抛错
 *   - reason    降级原因前缀
 *
 * @returns {Promise<{ok:boolean, value:any, degraded:boolean, reason?:string}>}
 */
async function withFallback({ name, run, fallback, reason }) {
  try {
    const value = await run();
    report(name, STATUS.ok, null);
    return { ok: true, value, degraded: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isHardFail = /ENOTFOUND|ECONNREFUSED|401|403/.test(msg);

    if (fallback === undefined) {
      report(name, STATUS.unavailable, msg);
      throw e;
    }

    report(name, isHardFail ? STATUS.unavailable : STATUS.degraded, msg);
    const value = typeof fallback === "function" ? await fallback(e) : fallback;
    return {
      ok: false,
      value,
      degraded: true,
      reason: (reason ? reason + ": " : "") + msg,
    };
  }
}

/**
 * 给 API 响应附加降级信息。
 * 应用返回前调用一次，确保前端能看出这是不是降级结果。
 */
function decorate(result, degradation) {
  if (!degradation || !degradation.degraded) return result;
  if (typeof result !== "object" || result === null) {
    return { value: result, degraded: true, reason: degradation.reason };
  }
  return { ...result, degraded: true, degradedReason: degradation.reason };
}

/** 一屏降级概览（给 /status 用）。 */
function overview() {
  const h = health();
  const items = Object.entries(h).map(([name, v]) => ({ name, ...v }));
  return {
    status: anyUnavailable() ? "unavailable" : anyDegraded() ? "degraded" : "ok",
    capabilities: items,
    // 影响面：哪些应用在依赖这个能力
    impact: buildImpact(items),
  };
}

/** 根据能力状态推导受影响的应用。 */
function buildImpact(items) {
  const bad = items.filter((i) => i.status !== "ok").map((i) => i.name);
  const impact = {};
  for (const cap of bad) {
    if (cap === "llm") impact[cap] = ["research（报告生成降级为仅检索）", "learn（苏格拉底教练降级为内置问题链）", "labset（实验无法运行）"];
    else if (cap === "search") impact[cap] = ["research（检索降级为单源或空结果）"];
    else if (cap === "evaluator") impact[cap] = ["labset（闸门未过，证据不可信）"];
    else impact[cap] = ["未知影响"];
  }
  return impact;
}

function reset() {
  healthMap.clear();
}

export const degrade = {
  STATUS,
  report,
  health,
  overview,
  withFallback,
  decorate,
  anyDegraded,
  anyUnavailable,
  reset,
};
