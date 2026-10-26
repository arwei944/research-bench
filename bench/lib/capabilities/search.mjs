/**
 * L1 能力 · 多源检索
 *
 * 之前绑在 research 里（channels.mjs 481 行）。抽成通用能力后：
 *   - 任意应用可检索
 *   - 查询扩展（中文→英文）内置
 *   - 相关性过滤 + 跨源去重内置
 *   - 统一的通道健康探测
 *
 * 依赖 curl：Node 的 fetch 在代理环境下不稳定（见 README 踩坑记录），
 * 用外部进程换来确定的行为。
 */

import { safeExecFile } from "../safe-proc.mjs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TIMEOUT = 25000;
const STATUS_MARK = "@@WBSTATUS@@";

function curlGet(url, headers = {}, timeoutSec = 25) {
  const args = [
    "-sS", "-L", "--max-time", String(timeoutSec), "--compressed",
    "-A", UA, "-H", "Accept-Language: en-US,en;q=0.9",
    "-w", "\n" + STATUS_MARK + "%{http_code}",
  ];
  for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
  args.push(url);

  return new Promise((resolve, reject) => {
    // 用 safeExecFile：Windows 上裸 execFile 会为每次 curl 弹一个控制台窗口
    safeExecFile("curl", args, { maxBuffer: 32 * 1024 * 1024, timeout: (timeoutSec + 5) * 1000 }, (err, stdout, stderr) => {
      if (err) {
        const m = String(stderr || err.message).trim().slice(0, 120);
        return reject(new Error(/timed out|Operation timed out/i.test(m) ? "超时" : m || "curl failed"));
      }
      const idx = stdout.lastIndexOf(STATUS_MARK);
      if (idx < 0) return reject(new Error("无状态码"));
      const status = Number(stdout.slice(idx + STATUS_MARK.length).trim());
      const body = stdout.slice(0, idx);
      if (status < 200 || status >= 300) return reject(new Error("HTTP " + status));
      resolve(body);
    });
  });
}

async function req(url, opts = {}) {
  const headers = opts.headers || {};
  const as = opts.as || "json";
  const timeout = opts.timeout || TIMEOUT;
  const body = await curlGet(url, headers, Math.round(timeout / 1000));
  if (as === "text") return body;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("响应不是合法 JSON");
  }
}

// ---------------------------------------------------------------------------
// 通道定义（探活用）
// ---------------------------------------------------------------------------

export const CHANNELS = [
  { id: "arxiv", name: "arXiv", group: "学术", url: "https://export.arxiv.org/api/query?search_query=all:test&max_results=1", as: "text" },
  { id: "crossref", name: "Crossref", group: "学术", url: "https://api.crossref.org/works?rows=1" },
  { id: "openalex", name: "OpenAlex", group: "学术", url: "https://api.openalex.org/works?per_page=1" },
  { id: "s2", name: "Semantic Scholar", group: "学术", url: "https://api.semanticscholar.org/graph/v1/paper/arXiv:2503.14499?fields=title" },
  { id: "epoch", name: "Epoch AI", group: "基准", url: "https://epoch.ai/api/internal/v1/models", headers: () => ({ Authorization: "Bearer " + EPOCH_KEY }) },
  { id: "vals", name: "Vals AI", group: "基准", url: "https://vals.ai", as: "text" },
  { id: "seal", name: "Scale SEAL", group: "基准", url: "https://scale.com/leaderboard", as: "text" },
  { id: "arc", name: "ARC Prize", group: "基准", url: "https://arcprize.org/leaderboard", as: "text" },
  { id: "metr", name: "METR", group: "基准", url: "https://metr.org/blog/", as: "text" },
  { id: "github", name: "GitHub", group: "工程", url: "https://api.github.com/search/repositories?q=ai&per_page=1", headers: { Accept: "application/vnd.github+json" } },
  { id: "hf", name: "Hugging Face", group: "工程", url: "https://huggingface.co/api/models?limit=1" },
  { id: "openrouter", name: "OpenRouter", group: "工程", url: "https://openrouter.ai/api/v1/models" },
  { id: "hn", name: "Hacker News", group: "社区", url: "https://hn.algolia.com/api/v1/search?query=ai&hitsPerPage=1" },
  { id: "hai", name: "Stanford HAI", group: "宏观", url: "https://hai.stanford.edu/ai-index", as: "text" },
];

/** 带并发上限的探测：14 个同时打会把本机代理压垮（实测降到 5/14）。 */
async function probeAll(concurrency = 2) {
  const queue = CHANNELS.slice();
  const rows = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const c = queue.shift();
      rows.push(await probeOne(c));
    }
  });
  await Promise.all(workers);
  // 保持原顺序
  const order = new Map(CHANNELS.map((c, i) => [c.id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const ok = rows.filter((r) => r.ok).length;
  const avgMs = Math.round(rows.reduce((a, b) => a + b.ms, 0) / rows.length);
  return { ok, total: rows.length, avgMs, channels: rows, fetchedAt: new Date().toISOString() };
}

async function probeOne(c) {
  const t0 = Date.now();
  try {
    // headers 可能是对象或函数（需要动态取 key 的通道用函数）
    const hdrs = typeof c.headers === "function" ? c.headers() : (c.headers || {});
    await req(c.url, { headers: hdrs, as: c.as || "json", timeout: 12000 });
    return { id: c.id, name: c.name, group: c.group, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id: c.id, name: c.name, group: c.group, ok: false, ms: Date.now() - t0,
      note: /超时/.test(msg) ? "超时" : msg.slice(0, 40),
    };
  }
}

// ---------------------------------------------------------------------------
// 单源检索
// ---------------------------------------------------------------------------

function parseAtom(xml) {
  return xml
    .split(/<entry>/)
    .slice(1)
    .map((e) => {
      const pick = (tag) => {
        const m = e.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
        return m ? m[1].replace(/\s+/g, " ").trim() : "";
      };
      return {
        id: pick("id"),
        title: pick("title"),
        published: pick("published").slice(0, 10),
        summary: pick("summary"),
        authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]),
      };
    });
}

function abstractOf(w) {
  const ab = w.abstract_inverted_index;
  if (!ab) return "";
  const words = [];
  for (const [k, pos] of Object.entries(ab)) for (const p of pos) words[p] = k;
  return words.filter(Boolean).join(" ");
}

async function arxiv(query, n) {
  n = n || 8;
  const url =
    "https://export.arxiv.org/api/query?search_query=" +
    encodeURIComponent(query) +
    "&start=0&max_results=" + n * 2 + "&sortBy=relevance&sortOrder=descending";
  const xml = await req(url, { as: "text" });
  return parseAtom(xml).slice(0, n).map((p) => ({
    source: "arXiv",
    title: p.title,
    url: p.id.replace("http://", "https://"),
    date: p.published,
    snippet: p.summary.slice(0, 320),
    authors: p.authors.slice(0, 4),
  }));
}

async function openalex(query, n) {
  n = n || 6;
  const from = new Date(Date.now() - 5 * 365 * 864e5).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    search: query,
    filter: "from_publication_date:" + from,
    sort: "relevance_score:desc",
    per_page: String(n * 2),
    select: "title,doi,publication_date,cited_by_count,abstract_inverted_index",
  });
  const d = await req("https://api.openalex.org/works?" + params, {
    headers: { "User-Agent": "bench/1.0 (mailto:agent@example.com)" },
  });
  const seen = new Set();
  return d.results
    .filter((w) => {
      if (!w.title || !w.title.trim()) return false;
      const k = w.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, n)
    .map((w) => ({
      source: "OpenAlex",
      title: w.title,
      url: w.doi || "",
      date: w.publication_date,
      snippet: abstractOf(w).slice(0, 320),
      citedBy: w.cited_by_count,
    }));
}

async function crossref(query, n) {
  n = n || 5;
  const params = new URLSearchParams({ "query.bibliographic": query, rows: String(n) });
  const d = await req("https://api.crossref.org/works?" + params);
  return d.message.items
    .filter((it) => it.title && it.title[0] && it.title[0].trim())
    .map((it) => ({
      source: "Crossref",
      title: it.title[0],
      url: it.DOI ? "https://doi.org/" + it.DOI : "",
      date: String((it.issued && it.issued["date-parts"] && it.issued["date-parts"][0] && it.issued["date-parts"][0][0]) || ""),
      snippet: ((it["container-title"] || [""])[0] || "—") + " · DOI " + it.DOI,
    }));
}

async function github(query, n) {
  n = n || 6;
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  const params = new URLSearchParams({ q: query, sort: "stars", order: "desc", per_page: String(n) });
  const d = await req("https://api.github.com/search/repositories?" + params, { headers });
  return d.items.map((r) => ({
    source: "GitHub",
    title: r.full_name,
    url: r.html_url,
    date: r.pushed_at.slice(0, 10),
    // 结构化字段：程序化使用不该去 parse snippet
    stars: r.stargazers_count,
    lang: r.language,
    snippet: r.stargazers_count + " stars · " + (r.description || "").slice(0, 200),
  }));
}

async function hn(query, n) {
  n = n || 6;
  const params = new URLSearchParams({ query, hitsPerPage: String(n), numericFilters: "points>100" });
  const d = await req("https://hn.algolia.com/api/v1/search?" + params);
  return d.hits.map((h) => ({
    source: "Hacker News",
    title: h.title || "",
    url: h.url || "https://news.ycombinator.com/item?id=" + h.objectID,
    date: (h.created_at || "").slice(0, 10),
    points: h.points,
    comments: h.num_comments,
    snippet: h.points + " pts · " + h.num_comments + " comments",
  }));
}

// ---------------------------------------------------------------------------
// 查询扩展（中文 → 英文）
// ---------------------------------------------------------------------------

const GLOSSARY = [
  ["人工智能", "artificial intelligence AI"], ["大模型", "large language model LLM"],
  ["智能体", "agent AI agent"], ["能力边界", "capability frontier"], ["能力", "capability"],
  ["评测", "evaluation benchmark"], ["基准污染", "benchmark contamination"], ["基准", "benchmark"],
  ["可靠性", "reliability"], ["长程", "long-horizon long-horizon task"], ["时间跨度", "time horizon"],
  ["自主", "autonomous autonomy"], ["幻觉", "hallucination"], ["对齐", "alignment"],
  ["推理", "reasoning"], ["上下文", "context long context"], ["多模态", "multimodal"],
  ["具身", "embodied"], ["机器人", "robot robotics"], ["形式化", "formal verification"],
  ["证明", "proof theorem proving"], ["奖励黑客", "reward hacking"],
  ["因果推断", "causal inference"], ["综述", "survey review"], ["量子计算", "quantum computing"],
  ["蛋白质", "protein"], ["基因组", "genome genomics"], ["金融", "finance financial"],
  ["财报", "financial statement earnings"], ["估值", "valuation"], ["回测", "backtest"],
  ["持续学习", "continual learning"], ["遗忘", "forgetting catastrophic forgetting"],
];

function hasCJK(s) {
  return /[\u4e00-\u9fff]/.test(s);
}

function expandQuery(raw) {
  const q = String(raw == null ? "" : raw).trim();
  if (!q) return { query: "", expansion: [], method: "empty" };
  if (!hasCJK(q)) return { query: q, expansion: [], method: "passthrough" };

  const found = [];
  for (const pair of GLOSSARY) {
    const zh = pair[0];
    const en = pair[1];
    if (!q.includes(zh)) continue;
    for (const w of en.split(/\s+/)) if (w && found.indexOf(w) < 0) found.push(w);
  }
  const latin = q.split(/[^A-Za-z0-9-]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const parts = [...new Set([...latin, ...found])];
  return { query: parts.join(" ") || q, expansion: parts, method: parts.length ? "glossary" : "raw" };
}

// ---------------------------------------------------------------------------
// 相关性 + 去重
// ---------------------------------------------------------------------------

const STOP = new Set(["the","a","an","of","and","or","in","on","for","to","with","is","are","was","were","be","been","by","as","at","from","how","what","why","when","which","that","this","it","its","的","了","和","与","在","是","有","对","从","到","被","把"]);

function tokens(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function relevance(query, item) {  const q = tokens(query);
  if (!q.length) return 1;
  const hay = new Set(tokens((item.title || "") + " " + (item.snippet || "")));
  let hit = 0;
  for (const t of q) {
    if (hay.has(t)) { hit++; continue; }
    for (const h of hay) {
      if (h.length >= 4 && (h.startsWith(t.slice(0, 5)) || t.startsWith(h.slice(0, 5)))) { hit++; break; }
    }
  }
  return hit / q.length;
}

const EVIDENCE = { arXiv: "A", Crossref: "A", OpenAlex: "A", GitHub: "C", "Hacker News": "C" };

// ---------------------------------------------------------------------------
// 以下 4 个能力原本只存在于 tools/research/research-cli.mjs（CLI 私有）。
// 合并到能力层后，CLI 与 research 应用共用同一实现。
// ---------------------------------------------------------------------------

// 从环境变量读取；未配置时探活会返回 401（不影响其它 13 个通道）
const EPOCH_KEY = process.env.EPOCH_API_KEY ?? "";
const OA_HEADERS = { "User-Agent": UA, mailto: "research@example.com" };

/**
 * 引用网络：查「谁引用了这篇」。
 *
 * 这是 OpenAlex 独有的能力，普通检索做不到。用途：从奠基论文往下游走，
 * 看谁在用、谁反驳。
 *
 * @param {string} doiOrId  DOI / arXiv:xxx / OpenAlex work id
 */
async function cites(doiOrId, n = 10) {
  let id = String(doiOrId);
  if (id.startsWith("10.")) id = "doi:" + id;

  // arXiv id 先解析成 OpenAlex work
  if (id.startsWith("arXiv:")) {
    const w = await req(
      `https://api.openalex.org/works?filter=doi:${encodeURIComponent(id)}`,
      { headers: OA_HEADERS },
    );
    id = w.results?.[0]?.id || id;
  }

  let wid = id.replace("https://openalex.org/", "");
  if (!wid.startsWith("W") && !wid.includes("openalex")) {
    const w = await req(`https://api.openalex.org/works/${wid}`, { headers: OA_HEADERS });
    wid = String(w.id).replace("https://openalex.org/", "");
  }

  const url =
    `https://api.openalex.org/works?filter=cites:${wid}` +
    `&per_page=${n}&sort=publication_date:desc&select=title,doi,publication_date,cited_by_count`;
  const d = await req(url, { headers: OA_HEADERS });

  return {
    source: "OpenAlex",
    of: doiOrId,
    total: d.meta?.count ?? 0,
    results: (d.results ?? []).map((w) => ({
      title: w.title,
      doi: w.doi,
      date: w.publication_date,
      citedBy: w.cited_by_count,
      url: w.doi ? `https://doi.org/${String(w.doi).replace(/^https?:\/\/doi.org\//, "")}` : null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

/** Epoch AI 基准元信息。 */
async function epochBench(id) {
  return req(`https://epoch.ai/api/internal/v1/benchmarks/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${EPOCH_KEY}` },
  });
}

/**
 * Epoch AI 精确分数（带 stderr）。
 *
 * 为什么不用页面上的分数：页面不带标准误，无法判断样本量够不够。
 * 判断标准：stderr > 0.03 时不要把该分数当精确结论引用。
 */
async function epochScore(bench, modelVersion) {
  return req(
    `https://epoch.ai/api/internal/v1/benchmarks/${encodeURIComponent(bench)}/scores/${encodeURIComponent(modelVersion)}`,
    { headers: { Authorization: `Bearer ${EPOCH_KEY}` } },
  );
}

/** Epoch AI 模型目录。 */
async function epochModels() {
  const d = await req("https://epoch.ai/api/internal/v1/models", {
    headers: { Authorization: `Bearer ${EPOCH_KEY}` },
  });
  return d.data ?? [];
}

/** Hugging Face 每日热门论文。 */
async function hfPapers(n = 6) {
  const d = await req(`https://huggingface.co/api/daily_papers?limit=${n}`);
  return (Array.isArray(d) ? d : []).map((x) => ({
    source: "Hugging Face",
    title: x.title ?? x.paper?.title ?? "",
    url: x.paper?.id ? `https://arxiv.org/abs/${x.paper.id}` : null,
    date: x.publishedAt ? String(x.publishedAt).slice(0, 10) : null,
    snippet: (x.paper?.summary ?? "").slice(0, 300),
    evidence: "B",
  }));
}

/**
 * OpenRouter 模型价格与上下文长度。
 *
 * 用于回答「这个方案跑得起吗」。注意区分 per-M token 价与 per-task 成本。
 */
async function modelPrices(n = 8) {
  const all = await modelPricesAll();
  return all.slice(0, n);
}

/** 价格清洗：负数与非数值视为无效（OpenRouter 有 -1000000 这类脏数据）。 */
function priceOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return +(n * 1e6).toFixed(4);
}

/** OpenRouter 全量模型列表（CLI 的 models 命令需要全量才能排序取极值）。 */
async function modelPricesAll() {
  const d = await req("https://openrouter.ai/api/v1/models");
  return (d.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    // OpenRouter 偶尔返回负价或非数值（脏数据），统一按「无效」处理
    promptPerM: priceOrNull(m.pricing?.prompt),
    completionPerM: priceOrNull(m.pricing?.completion),
  }));
}

async function searchAll(rawQuery, opts) {
  opts = opts || {};
  const n = opts.perSource || 5;
  const sources = opts.sources || ["arXiv", "OpenAlex", "Crossref", "GitHub", "Hacker News"];
  const ex = expandQuery(rawQuery);
  const query = ex.query || rawQuery;

  const tasks = [];
  if (sources.indexOf("arXiv") >= 0) tasks.push(arxiv(query, n));
  if (sources.indexOf("OpenAlex") >= 0) tasks.push(openalex(query, n));
  if (sources.indexOf("Crossref") >= 0) tasks.push(crossref(query, n));
  if (sources.indexOf("GitHub") >= 0) tasks.push(github(query, n));
  if (sources.indexOf("Hacker News") >= 0) tasks.push(hn(query, n));

  const settled = await Promise.allSettled(tasks);
  const results = [];
  const errors = [];
  for (const s of settled) {
    if (s.status === "fulfilled") results.push(...s.value);
    else errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason));
  }

  const basis = rawQuery + " " + query;
  for (const r of results) {
    r.evidence = EVIDENCE[r.source] || "C";
    r.relevance = relevance(basis, r);
  }

  const kept = results.filter((r) => r.relevance >= (r.evidence === "C" ? 0.3 : 0.4));
  const pool = kept.length ? kept : results;

  const byKey = new Map();
  for (const r of pool) {
    const k = String(r.title || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, "").slice(0, 60);
    if (!k) continue;
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, Object.assign({}, r, { alsoIn: [] })); continue; }
    const better = r.evidence < prev.evidence || (r.evidence === prev.evidence && r.relevance > prev.relevance);
    if (better) byKey.set(k, Object.assign({}, r, { alsoIn: (prev.alsoIn || []).concat([prev.source]) }));
    else prev.alsoIn.push(r.source);
  }
  const finalList = [...byKey.values()];

  const rank = { A: 0, B: 1, C: 2 };
  finalList.sort((a, b) => {
    const d = (rank[a.evidence] == null ? 3 : rank[a.evidence]) - (rank[b.evidence] == null ? 3 : rank[b.evidence]);
    if (d !== 0) return d;
    if (Math.abs(b.relevance - a.relevance) > 0.15) return b.relevance - a.relevance;
    return (b.citedBy || 0) - (a.citedBy || 0);
  });

  return {
    query, rawQuery, expansion: ex.expansion, expandMethod: ex.method,
    count: finalList.length, rawCount: results.length, filtered: results.length - finalList.length,
    results: finalList, errors, searchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 引用核验
// ---------------------------------------------------------------------------

async function verifyCitation(raw) {
  const target = String(raw == null ? "" : raw).trim();
  const out = { target, status: "⚠️未找到", hits: [], checkedAt: new Date().toISOString() };
  if (!target) return out;

  const isArxiv = /^arXiv:/i.test(target) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(target);
  const isDoi = /^10\.\d{4,9}\//.test(target);

  if (isArxiv) {
    const id = target.replace(/^arXiv:/i, "");
    try {
      const xml = await req("https://export.arxiv.org/api/query?id_list=" + encodeURIComponent(id), { as: "text" });
      const p = parseAtom(xml)[0];
      if (p) out.hits.push({ via: "arXiv", title: p.title, date: p.published, url: p.id.replace("http://", "https://"), authors: p.authors.slice(0, 5) });
    } catch { /* 忽略 */ }
  }

  if (isDoi) {
    try {
      const d = await req("https://api.crossref.org/works/" + encodeURIComponent(target));
      const it = d.message;
      out.hits.push({
        via: "Crossref",
        title: (it.title || [""])[0],
        date: String((it.issued && it.issued["date-parts"] && it.issued["date-parts"][0] && it.issued["date-parts"][0][0]) || ""),
        url: "https://doi.org/" + it.DOI,
        venue: (it["container-title"] || [""])[0],
      });
    } catch { /* 忽略 */ }
    try {
      const w = await req("https://api.openalex.org/works/doi:" + encodeURIComponent(target), {
        headers: { "User-Agent": "bench/1.0 (mailto:agent@example.com)" },
      });
      out.hits.push({ via: "OpenAlex", title: w.title, date: w.publication_date, url: w.doi, citedBy: w.cited_by_count });
    } catch { /* 忽略 */ }
  }

  if (!isArxiv && !isDoi) {
    try { const r = await crossref(target, 1); if (r[0]) out.hits.push(Object.assign({ via: "Crossref" }, r[0])); } catch { /* 忽略 */ }
    try { const r = await openalex(target, 1); if (r[0]) out.hits.push(Object.assign({ via: "OpenAlex" }, r[0])); } catch { /* 忽略 */ }
  }

  out.status = out.hits.length ? "✅已核验" : "⚠️未找到";
  return out;
}

async function verifyMany(list) {
  const results = [];
  for (const item of list) results.push(await verifyCitation(item));
  return {
    total: results.length,
    ok: results.filter((r) => r.status === "✅已核验").length,
    results,
    checkedAt: new Date().toISOString(),
  };
}

export const search = {
  CHANNELS, probeAll, searchAll, verifyCitation, verifyMany, expandQuery,
  arxiv, openalex, crossref, github, hn,
  // 原本只在 research-cli 里有的能力，现统一到这里
  cites, epochBench, epochScore, epochModels, hfPapers, modelPrices, modelPricesAll,
};
