/**
 * 可观测性 · 请求追踪与指标
 *
 * 三件事：
 *   1. **trace**      每个请求一个 traceId，贯穿平台与应用的日志
 *   2. **metrics**    计数、耗时分布、错误率，按路由聚合
 *   3. **慢请求/错误** 写入内核事件流（可被知识层页面看到）
 *
 * 为什么这是必需的：
 *   之前平台崩了两次（PID 错位、import 缺失），都没有任何痕迹。
 *   一个不能自我观测的系统，无法判断「现在是健康的还是正在退化」。
 *
 * 设计取舍：
 *   - 环形缓冲（不无限增长），默认保留最近 500 条请求
 *   - 指标按「方法 + 路由模板」聚合，避免高基数（不按具体 id 分组）
 *   - 慢请求阈值可配（默认 2000ms）
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "data");
const TRACE_LOG = path.join(DATA, "trace.jsonl");

const MAX_RECENT = 500;
const SLOW_MS = Number(process.env.BENCH_SLOW_MS ?? 2000);

let seq = 0;
const recent = [];      // 最近请求（环形）
const byRoute = new Map(); // 聚合
const slow = [];        // 最近慢请求

let startedAt = Date.now();
let totalRequests = 0;
let totalErrors = 0;

function ensure() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
}

/** 生成短 traceId。 */
export function newTraceId() {
  seq = (seq + 1) % 1e9;
  return "t" + Date.now().toString(36).slice(-6) + seq.toString(36).padStart(3, "0");
}

/**
 * 把具体路径归一化，避免高基数。
 *   /api/learn/notes/2026-10-26-xxx.md → /api/learn/notes/:file
 *   /app/research/  → /app/research/
 */
export function routeTemplate(p) {
  return String(p)
    .replace(/\/(clm|run|art|evd)_[a-z0-9]+/gi, "/:id")
    .replace(/\/\d{4}-\d{2}-\d{2}[^/]*\.(md|json)/g, "/:file")
    .replace(/\/[a-f0-9]{8}(-[a-f0-9]{4}){0,4}\/?$/i, "/:id");
}

function bump(route, key, delta = 1) {
  let r = byRoute.get(route);
  if (!r) {
    r = { route, count: 0, errors: 0, slow: 0, msSum: 0, msMax: 0, buckets: { "<50": 0, "<200": 0, "<1000": 0, "<3000": 0, ">=3000": 0 } };
    byRoute.set(route, r);
  }
  r.count += delta;
  if (key === "error") r.errors += delta;
  if (key === "slow") r.slow += delta;
  return r;
}

function bucketOf(ms) {
  if (ms < 50) return "<50";
  if (ms < 200) return "<200";
  if (ms < 1000) return "<1000";
  if (ms < 3000) return "<3000";
  return ">=3000";
}

/** 记录一次请求结束。 */
export function record({ traceId, method, path: p, status, ms, appId, note }) {
  totalRequests++;
  const route = routeTemplate(p);
  const isError = status >= 500;
  if (isError) totalErrors++;

  const r = bump(`${method} ${route}`, null);
  r.msSum += ms;
  r.msMax = Math.max(r.msMax, ms);
  r.buckets[bucketOf(ms)] = (r.buckets[bucketOf(ms)] ?? 0) + 1;
  if (isError) r.errors++;
  const isSlow = ms >= SLOW_MS;
  if (isSlow) r.slow++;

  const entry = {
    t: traceId,
    m: method,
    p: route,
    raw: p,
    s: status,
    ms,
    app: appId || null,
    note: note || null,
    at: new Date().toISOString(),
  };

  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();

  if (isSlow) {
    slow.push(entry);
    if (slow.length > 50) slow.shift();
  }

  // 慢请求与 5xx 落盘（可追溯，且能被知识层看到）
  if (isSlow || isError) {
    try {
      ensure();
      appendFileSync(TRACE_LOG, JSON.stringify(entry) + "\n", "utf8");
    } catch { /* 写不了不阻塞 */ }
  }

  return entry;
}

/** 读回慢请求/错误日志。 */
export function traceLog(limit = 60) {
  if (!existsSync(TRACE_LOG)) return [];
  const lines = readFileSync(TRACE_LOG, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** 聚合指标快照。 */
export function snapshot() {
  const routes = [...byRoute.values()]
    .map((r) => ({
      route: r.route,
      count: r.count,
      errors: r.errors,
      slow: r.slow,
      avgMs: r.count ? Math.round(r.msSum / r.count) : 0,
      maxMs: r.msMax,
      errorRate: r.count ? +(r.errors / r.count).toFixed(3) : 0,
      buckets: r.buckets,
    }))
    .sort((a, b) => b.count - a.count);

  const uptimeSec = Math.round((Date.now() - startedAt) / 1000);

  return {
    uptimeSec,
    totalRequests,
    totalErrors,
    errorRate: totalRequests ? +(totalErrors / totalRequests).toFixed(4) : 0,
    rps: uptimeSec ? +(totalRequests / uptimeSec).toFixed(3) : 0,
    slowMsThreshold: SLOW_MS,
    slowCount: [...byRoute.values()].reduce((n, r) => n + r.slow, 0),
    routes,
    recent: recent.slice(-40).reverse(),
    slowRecent: slow.slice(-15).reverse(),
    at: new Date().toISOString(),
  };
}

/** 健康自评：给出一个明确的状态与原因。 */
export function health() {
  const snap = snapshot();
  const issues = [];

  if (snap.errorRate > 0.05) issues.push(`错误率 ${(snap.errorRate * 100).toFixed(1)}% 偏高`);
  if (snap.slowCount > 0) issues.push(`${snap.slowCount} 次慢请求（>${SLOW_MS}ms）`);

  const worst = snap.routes.filter((r) => r.count >= 3).sort((a, b) => b.avgMs - a.avgMs)[0];
  if (worst && worst.avgMs > 5000) issues.push(`最慢路由 ${worst.route} 平均 ${worst.avgMs}ms`);

  return {
    status: issues.length === 0 ? "healthy" : issues.length <= 2 ? "degraded" : "unhealthy",
    issues,
    uptimeSec: snap.uptimeSec,
    totalRequests: snap.totalRequests,
  };
}

/** 重置（测试用）。 */
export function resetMetrics() {
  recent.length = 0;
  slow.length = 0;
  byRoute.clear();
  startedAt = Date.now();
  totalRequests = 0;
  totalErrors = 0;
}
