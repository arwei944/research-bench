/**
 * L1 能力 · LLM 接入
 *
 * 之前三处各自实现：research/lib/llm.mjs、labset/lib/runner.mjs、learn/lib/coach.mjs
 * 每处都要处理：baseUrl、apiKey、model、超时、错误格式、usage 统计。
 *
 * 抽到这里后，应用只需：
 *   import { llm } from "../../../lib/capabilities/index.mjs";
 *   const r = await llm.chat([{ role: "user", content: "..." }]);
 *
 * 统一带来三个好处：
 *   1. 换模型只改一处
 *   2. 超时/重试策略统一
 *   3. 所有调用都记 usage，可做成本统计
 */

const BASE_URL =
  process.env.BENCH_LLM_BASE_URL ??
  process.env.LB_LLM_BASE_URL ??
  process.env.WB_LLM_BASE_URL ??
  "http://127.0.0.1:3425/v1";
const API_KEY =
  process.env.BENCH_LLM_API_KEY ??
  process.env.LB_LLM_API_KEY ??
  process.env.WB_LLM_API_KEY ??
  "magpie";
const MODEL =
  process.env.BENCH_LLM_MODEL ??
  process.env.LB_LLM_MODEL ??
  process.env.WB_LLM_MODEL ??
  "auto/qfmodel";

const DEFAULT_TIMEOUT = Number(process.env.BENCH_LLM_TIMEOUT_MS ?? 120_000);

/** 调用统计（进程内累计，供 /metrics 或 /status 用）。 */
const stats = {
  calls: 0,
  errors: 0,
  timeouts: 0,
  tokensIn: 0,
  tokensOut: 0,
  msSum: 0,
  byCaller: new Map(), // caller -> { calls, errors, msSum }
};

function bumpStat(caller, { ms, ok, usage, timeout }) {
  stats.calls++;
  stats.msSum += ms;
  if (!ok) stats.errors++;
  if (timeout) stats.timeouts++;
  if (usage) {
    stats.tokensIn += usage.prompt_tokens ?? 0;
    stats.tokensOut += usage.completion_tokens ?? 0;
  }
  let c = stats.byCaller.get(caller);
  if (!c) {
    c = { calls: 0, errors: 0, msSum: 0, tokensOut: 0 };
    stats.byCaller.set(caller, c);
  }
  c.calls++;
  c.msSum += ms;
  if (!ok) c.errors++;
  if (usage?.completion_tokens) c.tokensOut += usage.completion_tokens;
}

/**
 * 单次对话调用。
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} opts
 *   - temperature  默认 0.3
 *   - maxTokens    默认 2000
 *   - timeoutMs    默认 120s
 *   - caller       调用方标识（用于统计与排障，如 "labset.runner"）
 *   - retries      失败重试次数（默认 0，超时不重试）
 * @returns {Promise<{ok:boolean, text?:string, usage?:object, ms:number, error?:string, timeout?:boolean}>}
 */
async function chat(messages, opts = {}) {
  const {
    temperature = 0.3,
    maxTokens = 2000,
    timeoutMs = DEFAULT_TIMEOUT,
    caller = "unknown",
    retries = 0,
  } = opts;

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: maxTokens }),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 160)}`);
      }
      const d = await res.json();
      const ms = Date.now() - t0;
      bumpStat(caller, { ms, ok: true, usage: d.usage });
      return {
        ok: true,
        text: d.choices?.[0]?.message?.content ?? "",
        usage: d.usage ?? null,
        ms,
        model: d.model ?? MODEL,
      };
    } catch (e) {
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const isTimeout = /abort|timeout/i.test(e?.message ?? "");
      lastErr = { ok: false, ms, error: e instanceof Error ? e.message : String(e), timeout: isTimeout };
      bumpStat(caller, { ms, ok: false, timeout: isTimeout });
      // 超时不重试（重试只会更慢），其它错误可重试
      if (isTimeout || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return lastErr;
}

/** 便捷：单条 user 消息。 */
function ask(prompt, opts = {}) {
  return chat([{ role: "user", content: prompt }], opts);
}

/** 探活。 */
async function probe() {
  const r = await ask("只回复两个字：可用", { maxTokens: 20, temperature: 0, timeoutMs: 45_000, caller: "probe" });
  return {
    ok: r.ok,
    model: MODEL,
    baseUrl: BASE_URL,
    sample: r.ok ? r.text.trim().slice(0, 30) : undefined,
    error: r.ok ? undefined : r.error,
  };
}

/** 统计快照。 */
function snapshot() {
  return {
    model: MODEL,
    baseUrl: BASE_URL,
    calls: stats.calls,
    errors: stats.errors,
    timeouts: stats.timeouts,
    errorRate: stats.calls ? +(stats.errors / stats.calls).toFixed(3) : 0,
    avgMs: stats.calls ? Math.round(stats.msSum / stats.calls) : 0,
    tokensIn: stats.tokensIn,
    tokensOut: stats.tokensOut,
    byCaller: [...stats.byCaller.entries()]
      .map(([k, v]) => ({ caller: k, ...v, avgMs: v.calls ? Math.round(v.msSum / v.calls) : 0 }))
      .sort((a, b) => b.calls - a.calls),
  };
}

function reset() {
  stats.calls = 0; stats.errors = 0; stats.timeouts = 0;
  stats.tokensIn = 0; stats.tokensOut = 0; stats.msSum = 0;
  stats.byCaller.clear();
}

export const llm = { chat, ask, probe, snapshot, reset, config: { model: MODEL, baseUrl: BASE_URL } };
