#!/usr/bin/env node
/**
 * research-cli —— 研究智能体的多源检索通道工具箱（零依赖）
 *
 * 把本次研究中验证可用的外部通道固化成命令，供任何研究任务复用：
 *   学术   arXiv / Crossref / OpenAlex（含引用网络）
 *   基准   Epoch AI（含官方 API，可精确取分） / Vals AI / Scale SEAL
 *   代码   GitHub Search API
 *   社区   Hacker News (Algolia)
 *   前沿   Hugging Face Daily Papers / OpenRouter 价格与上下文
 *   宏观   Stanford HAI AI Index
 *
 * 用法：
 *   node tools/research/research-cli.mjs probe
 *   node tools/research/research-cli.mjs arxiv "long-horizon agent" [n]
 *   node tools/research/research-cli.mjs paper "Measuring AI Ability to Complete Long Tasks"
 *   node tools/research/research-cli.mjs verify arXiv:2503.14499 | DOI:10.1038/s41586-024-07566-y
 *   node tools/research/research-cli.mjs cites 10.52202/085713-3086 [n]
 *   node tools/research/research-cli.mjs bench frontiermath-tier-4-v2
 *   node tools/research/research-cli.mjs bench-score frontiermath-tier-4-v2 gpt-6-astra_max
 *   node tools/research/research-cli.mjs github "deep research agent" [n]
 *   node tools/research/research-cli.mjs hn "agent benchmark" [n]
 *   node tools/research/research-cli.mjs hf [n]
 *   node tools/research/research-cli.mjs models [n]        # OpenRouter 价格/上下文
 *   node tools/research/research-cli.mjs snapshot [out.json]
 *
 * 环境变量：
 *   EPOCH_API_KEY   可选，缺省用内置公共 key
 *   GITHUB_TOKEN    可选，提升 GitHub 速率上限
 *   OUT_LANG        zh(默认) | en
 */

// Node 默认不读取 HTTP(S)_PROXY。若环境里配置了代理，自动以开启代理的模式重启自身，
// 否则 huggingface / scale.com 这类站点会直接连接超时。
if (
  process.env.NODE_USE_ENV_PROXY !== "1" &&
  (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
) {
  const { safeSpawnSync } = await import("../../bench/lib/safe-proc.mjs");
  // stdio: "inherit" 本身不弹窗，但统一走 safe-proc，避免以后改动时退化
  const r = safeSpawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(r.status ?? 0);
}

// Epoch AI 需要 API key（可选通道）；未配置时 bench/epoch 命令会返回 401
const EPOCH_KEY = process.env.EPOCH_API_KEY || "";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const TIMEOUT = 40_000;

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 唯一实现：bench 的 L1 能力层
//
// 历史上本文件有一份 624 行的通道实现，与 bench/lib/capabilities/search.mjs
// 以及 research 应用的 channels.mjs 三份并存。现在数据获取全部走能力层，
// 本文件只保留**终端输出格式化**。
// ---------------------------------------------------------------------------
const { search: CAP } = await import("../../bench/lib/capabilities/search.mjs");

async function get(url, headers = {}, as = "text") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...BROWSER_HEADERS, ...headers },
      signal: ctl.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return as === "json" ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const warnc = (s) => `\x1b[33m${s}\x1b[0m`;

function head(t) {
  console.log(`\n${bold("## " + t)}`);
}

// ---------------------------------------------------------------------------
// 通道：arXiv
// ---------------------------------------------------------------------------

function parseAtom(xml) {
  const entries = xml.split(/<entry>/).slice(1);
  return entries.map((e) => {
    const pick = (tag) => {
      const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].replace(/\s+/g, " ").trim() : "";
    };
    return {
      id: pick("id"),
      title: pick("title").replace(/&#\d+;/g, " "),
      published: pick("published").slice(0, 10),
      summary: pick("summary"),
      authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)]
        .map((m) => m[1])
        .slice(0, 4),
    };
  });
}

async function arxiv(query, n = 5) {
  const items = await CAP.arxiv(query, n);
  head(`arXiv · ${query}`);
  for (const it of items) {
    console.log(`  ${dim(it.date || "")}  ${String(it.title).slice(0, 100)}`);
    console.log(`  ${dim(it.url || "")}`);
    if (it.authors?.length) console.log(`  ${dim(it.authors.join(", "))}`);
    console.log();
  }
  return items;
}

async function arxivById(id) {
  const xml = await get(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
  );
  return parseAtom(xml)[0] || null;
}

// ---------------------------------------------------------------------------
// 通道：Crossref
// ---------------------------------------------------------------------------

async function crossref(query, n = 3) {
  head(`Crossref · ${query}`);
  const out = await CAP.crossref(query, n);
  for (const row of out) {
    console.log(`  ${dim(row.year ?? "----")}  ${row.title.slice(0, 92)}`);
    console.log(`  ${dim("DOI " + row.doi + " · " + row.venue)}`);
    console.log();
  }
  return out;
}

// ---------------------------------------------------------------------------
// 通道：OpenAlex（含引用网络）
// ---------------------------------------------------------------------------

const OA_HEADERS = { "User-Agent": "research-agent/1.0 (mailto:agent@example.com)" };

function abstractOf(w) {
  const ab = w.abstract_inverted_index;
  if (!ab) return "";
  const words = [];
  for (const [k, pos] of Object.entries(ab)) for (const p of pos) words[p] = k;
  return words.filter(Boolean).join(" ");
}

async function openalex(query, n = 3) {
  const results = await CAP.openalex(query, n);
  head(`OpenAlex · ${query}（按被引排序）`);
  for (const w of results) {
    console.log(
      `  ${dim(String(w.cited_by_count).padStart(5) + " cites")}  ${dim(w.publication_date)}  ${w.title.slice(0, 88)}`,
    );
    console.log(`  ${dim(w.doi || "")}`);
  }
  return d.results;
}

async function cites(doiOrId, n = 10) {
  const r = await CAP.cites(doiOrId, n);
  head(`引用网络 · ${doiOrId} 的下游工作（${r.total} 篇，显示最近 ${r.results.length}）`);
  for (const w of r.results) {
    console.log(`  ${dim(w.date)}  ${w.title.slice(0, 88)}`);
    console.log(`  ${dim(w.doi || "")}`);
  }
  return r.results;
}

// ---------------------------------------------------------------------------
// 通道：Epoch AI（官方 API，可精确取分）
// ---------------------------------------------------------------------------

async function epochBench(id) {
  const d = await CAP.epochBench(id);
  head(`Epoch · ${d.title}`);
  console.log(`  ${dim(d.short_description?.trim() || "")}`);
  if (d.category) console.log(`  ${dim("category: " + d.category)}`);
  if (d.domains) console.log(`  ${dim("domains: " + d.domains.join(", "))}`);
  const res = d.resources || {};
  for (const [k, v] of Object.entries(res)) {
    console.log(`  ${dim(`${k}: ${v.url} (${v.access})`)}`);
  }
  return d;
}

async function epochScore(bench, modelVersion) {
  const d = await CAP.epochScore(bench, modelVersion);
  head(`Epoch 精确分数 · ${bench}`);
  console.log("  " + JSON.stringify(d, null, 2).replace(/\n/g, "\n  "));
  return d;
}

async function epochModels() {
  const data = await CAP.epochModels();
  head(`Epoch · 模型目录（${data.length} 条）`);
  return data;
}

// ---------------------------------------------------------------------------
// 通道：GitHub
// ---------------------------------------------------------------------------

async function github(query, n = 6) {
  const items = await CAP.github(query, n);
  head(`GitHub · ${query}（共 ${items.length} 个仓库）`);
  for (const r of items) {
    console.log(
      `  ${dim("⭐" + String(r.stars ?? 0).padStart(6))}  ${String(r.repo || r.title).padEnd(40)} ${dim(String(r.date || "").slice(0, 10))}`,
    );
    console.log(`  ${dim(String(r.snippet || r.desc || "").slice(0, 100))}`);
  }
  return items;
}

// ---------------------------------------------------------------------------
// 通道：Hacker News
// ---------------------------------------------------------------------------

async function hn(query, n = 6) {
  const hits = await CAP.hn(query, n);
  head(`Hacker News · ${query}（点数 > 100）`);
  for (const h of hits) {
    console.log(
      `  ${dim(String(h.points ?? 0).padStart(4) + "pts")} ${dim(String(h.date || "").slice(0, 10))}  ${String(h.title || "").slice(0, 88)}`,
    );
    if (h.url) console.log(`  ${dim(String(h.url).slice(0, 110))}`);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 通道：Hugging Face Daily Papers
// ---------------------------------------------------------------------------

async function hfPapers(n = 6) {
  const items = await CAP.hfPapers(n);
  head(`Hugging Face Daily Papers · 热门 ${n}`);
  for (const p of items) {
    console.log(`  ${dim(p.date || "")}  ${String(p.title).slice(0, 90)}`);
    if (p.url) console.log(`  ${dim(p.url)}`);
  }
  return items;
}

// ---------------------------------------------------------------------------
// 通道：OpenRouter（价格 / 上下文）
// ---------------------------------------------------------------------------

async function models(n = 8) {
  const rows = (await CAP.modelPricesAll()).filter((m) => m.completionPerM !== null);
  head(`OpenRouter · 共 ${rows.length} 个模型（按输出价降序，显示 ${n}）`);
  const byPrice = [...rows].sort((a, b) => b.completionPerM - a.completionPerM);
  for (const m of byPrice.slice(0, n)) {
    console.log(
      `  ${m.id.padEnd(46)} ${dim(`ctx=${String(m.contextLength).padStart(8)}  out=$${m.completionPerM.toFixed(2)}/M  in=$${m.promptPerM?.toFixed(2) ?? "?"}/M`)}`,
    );
  }
  const cheapest = [...rows].sort((a, b) => a.completionPerM - b.completionPerM).slice(0, 3);
  console.log(dim("  --- 最便宜 3 个 ---"));
  for (const m of cheapest) {
    console.log(`  ${m.id.padEnd(46)} ${dim(`out=$${m.completionPerM.toFixed(3)}/M`)}`);
  }
  const longest = [...rows].sort((a, b) => b.contextLength - a.contextLength).slice(0, 3);
  console.log(dim("  --- 上下文最长 3 个 ---"));
  for (const m of longest) {
    console.log(`  ${m.id.padEnd(46)} ${dim(`ctx=${m.contextLength}`)}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 引用核验
// ---------------------------------------------------------------------------

async function verify(target) {
  head(`引用核验 · ${target}`);
  const result = { target, arxiv: null, crossref: null, verdict: "⚠️未找到" };

  if (/^arXiv:/i.test(target) || /^\d{4}\.\d{4,5}/.test(target)) {
    const id = target.replace(/^arXiv:/i, "");
    try {
      const it = await arxivById(id);
      if (it) {
        result.arxiv = it;
        console.log(ok("  ✅ arXiv 命中"));
        console.log(`  ${it.title}`);
        console.log(`  ${dim(it.published + " · " + it.id)}`);
        console.log(`  ${dim(it.authors.join(", "))}`);
      } else {
        console.log(warnc("  ⚠️ arXiv 未命中"));
      }
    } catch (e) {
      console.log(bad("  ❌ arXiv 查询失败: " + e.message));
    }
  }

  if (target.startsWith("10.")) {
    try {
      const d = await get(
        `https://api.crossref.org/works/${encodeURIComponent(target)}`,
        {},
        "json",
      );
      const it = d.message;
      result.crossref = {
        doi: it.DOI,
        title: (it.title || [""])[0],
        year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
        venue: (it["container-title"] || [""])[0],
      };
      console.log(ok("  ✅ Crossref 命中"));
      console.log(`  ${result.crossref.title}`);
      console.log(
        `  ${dim(result.crossref.year + " · " + result.crossref.venue)}`,
      );
    } catch (e) {
      console.log(bad("  ❌ Crossref 未命中: " + e.message));
    }
  }

  if (!target.startsWith("10.") && !/^arXiv:|^\d{4}\./.test(target)) {
    // 当作标题，做双源交叉核验
    try {
      const cr = await crossref(target, 2);
      result.crossref = cr[0] || null;
      if (cr[0]) console.log(ok("  ✅ Crossref 命中（标题检索）"));
    } catch {}
    try {
      const oa = await openalex(target, 2);
      result.openalex = oa[0] || null;
      if (oa[0]) console.log(ok("  ✅ OpenAlex 命中（标题检索）"));
    } catch {}
  }

  result.verdict = result.arxiv || result.crossref ? "✅已核验" : "⚠️未找到";
  console.log(`\n  结论: ${result.verdict}`);
  return result;
}

// ---------------------------------------------------------------------------
// 通道健康检查
// ---------------------------------------------------------------------------

const CHANNELS = [
  ["arXiv", () => get("https://export.arxiv.org/api/query?search_query=all:test&max_results=1")],
  ["Crossref", () => get("https://api.crossref.org/works?rows=1", {}, "json")],
  ["OpenAlex", () => get("https://api.openalex.org/works?per_page=1", OA_HEADERS, "json")],
  [
    "Semantic Scholar",
    () =>
      get(
        "https://api.semanticscholar.org/graph/v1/paper/arXiv:2503.14499?fields=title",
        { "User-Agent": "research-agent/1.0" },
        "json",
      ),
  ],
  ["Epoch AI API", () => get("https://epoch.ai/api/internal/v1/models", { Authorization: `Bearer ${EPOCH_KEY}` }, "json")],
  ["GitHub", () => get("https://api.github.com/search/repositories?q=ai&per_page=1", { Accept: "application/vnd.github+json" }, "json")],
  ["Hacker News", () => get("https://hn.algolia.com/api/v1/search?query=ai&hitsPerPage=1", {}, "json")],
  [
    "Hugging Face",
    () => get("https://huggingface.co/api/models?limit=1", {}, "json"),
  ],
  ["OpenRouter", () => get("https://openrouter.ai/api/v1/models", {}, "json")],
  ["Vals AI", () => get("https://vals.ai")],
  ["Scale SEAL", () => get("https://scale.com/leaderboard")],
  ["Stanford HAI", () => get("https://hai.stanford.edu/ai-index")],
  ["ARC Prize", () => get("https://arcprize.org/leaderboard")],
  ["METR", () => get("https://metr.org/blog/")],
];

async function probe() {
  head("研究通道健康检查");
  const rows = [];
  for (const [name, fn] of CHANNELS) {
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      rows.push({ name, ok: true, ms });
      console.log(`  ${ok("✅")} ${name.padEnd(20)} ${dim(ms + "ms")}`);
    } catch (e) {
      const ms = Date.now() - t0;
      rows.push({ name, ok: false, ms, err: e.message });
      console.log(`  ${bad("❌")} ${name.padEnd(20)} ${dim(e.message.slice(0, 60))}`);
    }
  }
  const good = rows.filter((r) => r.ok).length;
  console.log(
    `\n  ${good}/${rows.length} 可用 · 平均延迟 ${Math.round(rows.reduce((a, b) => a + b.ms, 0) / rows.length)}ms`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

async function snapshot(outFile) {
  head("生成研究通道快照");
  const snap = { generatedAt: new Date().toISOString(), channels: {} };
  for (const [name, fn] of CHANNELS) {
    try {
      await fn();
      snap.channels[name] = "ok";
      console.log(`  ✅ ${name}`);
    } catch (e) {
      snap.channels[name] = "fail: " + e.message.slice(0, 80);
      console.log(`  ❌ ${name}`);
    }
  }
  const fs = await import("node:fs");
  const p = outFile || `research-snapshot-${Date.now()}.json`;
  fs.writeFileSync(p, JSON.stringify(snap, null, 2), "utf8");
  console.log(`\n  已写入 ${p}`);
  return p;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `research-cli —— 多源研究通道工具箱

  probe                              通道健康检查
  arxiv <query> [n]                  arXiv 检索（按提交时间倒序）
  paper <title> [n]                  Crossref 标题检索
  oa <query> [n]                     OpenAlex 检索（按被引排序）
  cites <doi|openalex-id> [n]        引用网络（谁引用了它）
  verify <arXiv:ID | DOI:10.x | 标题> 引用真实性核验
  bench <benchmark-id>               Epoch 基准元信息
  bench-score <bench> <model-ver>    Epoch 精确分数（含 stderr）
  models [n]                         OpenRouter 价格 / 上下文
  github <query> [n]                 GitHub 仓库检索
  hn <query> [n]                     Hacker News 信号
  hf [n]                             Hugging Face 每日论文
  snapshot [out.json]                全部通道连通性快照

示例：
  node tools/research/research-cli.mjs verify arXiv:2503.14499
  node tools/research/research-cli.mjs bench-score frontiermath-tier-4-v2 gpt-6-astra_max
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const n = (i, d) => {
    const v = Number(args[i]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  switch (cmd) {
    case "probe":
      await probe();
      break;
    case "arxiv":
      await arxiv(args[0], n(1, 5));
      break;
    case "paper":
      await crossref(args.join(" "), n(1, 3));
      break;
    case "oa":
      await openalex(args.join(" "), n(1, 3));
      break;
    case "cites":
      await cites(args[0], n(1, 10));
      break;
    case "verify":
      await verify(args.join(" "));
      break;
    case "bench":
      await epochBench(args[0]);
      break;
    case "bench-score":
      await epochScore(args[0], args[1]);
      break;
    case "models":
      await models(n(0, 8));
      break;
    case "github":
      await github(args.slice(0, -1).join(" ") || args[0], n(1, 6));
      break;
    case "hn":
      await hn(args.slice(0, -1).join(" ") || args[0], n(1, 6));
      break;
    case "hf":
      await hfPapers(n(0, 6));
      break;
    case "snapshot":
      await snapshot(args[0]);
      break;
    default:
      console.error(`未知命令: ${cmd}\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(bad("错误: " + e.message));
  process.exitCode = 1;
});
