/**
 * learn 应用 —— 学习工作台（多课程）。
 *
 * 两门课程：
 *   compute  计算理论（graph 型）：λ 演算 / 类型论，有可执行笔记本
 *   llm      大模型（terms 型）：10 层 101 词，有前置门禁 + 三种追问
 *
 * 共用：SM-2 复习（srs.mjs）、kernel 闭环、笔记。
 *
 * 内容仍是磁盘文件，每次请求重读 → 改 content/*.json 刷新即生效。
 */

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as lam from "./lib/lambda.mjs";
import * as srs from "./lib/srs.mjs";
import * as coach from "./lib/coach.mjs";
import * as T from "./lib/terms.mjs";
import * as P from "./lib/probe.mjs";
import { bench } from "../../kernel/index.mjs";
import { llm, degrade } from "../../lib/capabilities/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "data");
const CONTENT = path.join(HERE, "content");

for (const d of [DATA, path.join(DATA, "progress"), path.join(DATA, "notes")]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ---------------------------------------------------------------------------
// 内容加载（每次读盘 → 热改）
// ---------------------------------------------------------------------------
function loadCurriculum() {
  const f = path.join(CONTENT, "curriculum.json");
  if (!existsSync(f)) return { nodes: [], edges: [], tracks: [] };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { nodes: [], edges: [], tracks: [], error: String(e) }; }
}

/** 课程清单（两门课）。 */
function loadCourses() {
  const f = path.join(CONTENT, "courses.json");
  if (!existsSync(f)) return { courses: [] };
  try { return JSON.parse(readFileSync(f, "utf8")); }
  catch (e) { return { courses: [], error: String(e) }; }
}

/**
 * 从 kernel 里的 Claim 生成复习卡。
 *
 * 这是「闭环」的关键：研究/实验产生的结论会自动变成可复习的知识点。
 * 卡片 id 用 `clm_xxx`，这样复习结果能回写对应 Claim。
 *
 * 只有达到 supported 或有证据的 Claim 才生成卡片——
 * draft 状态还没有证据支撑，不该被当成知识去记。
 */
function cardsFromKernel() {
  const out = [];

  for (const c of bench.claim.list()) {
    const digest = c.digest;
    // 无证据的 Claim 不生成卡（还不知道真假，不该背）
    if (digest.evidenceCount === 0) continue;

    out.push({
      id: c.id,
      node: "kernel",
      tags: [...(c.tags ?? []), `status:${digest.status}`],
      question: c.text,
      answer: [
        `**状态**：${digest.status}`,
        `**证据**：${digest.evidenceCount} 条（${Object.entries(digest.byTier).map(([k, v]) => `${k}×${v}`).join(", ")}）`,
        digest.runCount ? `**支撑实验**：${digest.runCount} 次` : "",
        digest.warning ? `⚠️ ${digest.warning}` : "",
        c.note ? `**备注**：${c.note}` : "",
      ].filter(Boolean).join("\n"),
      _source: "kernel",
      _status: digest.status,
      _confidence: c.confidence,
    });
  }
  return out;
}

function loadCards() {
  const dir = path.join(CONTENT, "cards");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const d = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      for (const c of Array.isArray(d) ? d : [d]) out.push({ ...c, _file: f, _source: "file" });
    } catch { /* skip bad */ }
  }
  // 合并 kernel 里的 Claim 卡
  out.push(...cardsFromKernel());
  return out;
}

function loadNotebooks() {
  const dir = path.join(CONTENT, "notebooks");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try { out.push({ ...JSON.parse(readFileSync(path.join(dir, f), "utf8")), _file: f }); }
    catch { /* skip */ }
  }
  return out;
}

const PROGRESS = path.join(DATA, "progress", "srs.json");
function loadProgress() {
  if (!existsSync(PROGRESS)) return {};
  try { return JSON.parse(readFileSync(PROGRESS, "utf8")); } catch { return {}; }
}
function saveProgress(p) {
  mkdirSync(path.dirname(PROGRESS), { recursive: true });
  writeFileSync(PROGRESS, JSON.stringify(p, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// 大模型课程：词条进度（与计算理论共用同一个 srs.json）
//
// 为什么共用一个文件：用户只关心「我复习了什么」，不关心它属于哪门课；
// 且 id 命名空间已隔离（计算理论是 c-* / n-*，大模型是 t-*），不会冲突。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// JS 沙箱
// ---------------------------------------------------------------------------
async function runJs(code, timeoutMs) {
  const vm = await import("node:vm");
  const logs = [];
  const sandbox = {
    console: {
      log: (...a) => logs.push(a.map(fmt).join(" ")),
      error: (...a) => logs.push("[err] " + a.map(fmt).join(" ")),
      warn: (...a) => logs.push("[warn] " + a.map(fmt).join(" ")),
    },
    Math, JSON, Number, String, Boolean, Array, Object, Map, Set, Symbol, BigInt,
    parseInt, parseFloat, isNaN, isFinite, Date,
  };
  const ctx = vm.createContext(sandbox);
  const t0 = Date.now();
  try {
    const result = vm.runInContext(code, ctx, { timeout: timeoutMs, displayErrors: true });
    return { ok: true, ms: Date.now() - t0, logs, result: fmt(result), resultType: typeof result };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, logs, error: `${e.name}: ${e.message}` };
  }
}

function fmt(v) {
  if (typeof v === "string") return v;
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (v instanceof Map) return `Map(${v.size}) {${[...v.entries()].map(([k, x]) => `${fmt(k)} => ${fmt(x)}`).join(", ")}}`;
  if (v instanceof Set) return `Set(${v.size}) {${[...v].map(fmt).join(", ")}}`;
  try {
    return JSON.stringify(v, (k, x) => (typeof x === "bigint" ? String(x) + "n" : x), 2) ?? String(v);
  } catch { return String(v); }
}

// ---------------------------------------------------------------------------
// 闭环：实验/研究结论 ↔ 大模型术语 的桥
//
// 这是本应用最有价值的一环：**用用户自己的实测数据当教材**。
// 每条都对应 bench 里真实发生过的事，不是编的。
// ---------------------------------------------------------------------------
const BRIDGES = [
  {
    terms: ["t-pass-k"],
    source: "labset", tag: "悬崖区",
    title: "E-digit-count：pass@1≈40%，pass^5=0%",
    fact: "301 位数字里数 9，5 次尝试 2 成 3 败，失败全部是超时（不是算错）。",
    lesson: "「能算对一次」和「能稳定算对」差 100 个百分点。这就是 pass^k 存在的理由。",
  },
  {
    terms: ["t-calibration", "t-ece"],
    source: "labset", tag: "假阳性",
    title: "ECE=0.0157，但样本里没有任何错答",
    fact: "实验器算出校准误差极小，看着像「校准优秀」。",
    lesson: "ECE 只统计有置信度的样本；超时/崩溃的样本根本没机会自评，是盲区。指标漂亮不代表模型可托付。",
  },
  {
    terms: ["t-harness-effect"],
    source: "labset", tag: "判分器 bug",
    title: "模型答对了，判分器判它错",
    fact: "多轮任务末轮输出正确，但复述了前面的中间值，numeric() 取到中间值判错。",
    lesson: "裁判也会错。这正是「判分器本身必须被测试」和「harness 决定分数」的现场证据。",
  },
  {
    terms: ["t-contamination"],
    source: "research", tag: "别信榜",
    title: "ARC-AGI-3：标准 harness 62.7%，换 harness 99.9%",
    fact: "同一个模型，只换评测外壳，分数差一个量级。",
    lesson: "分数上升不一定是模型变强，可能是外壳变强。基准一旦公开就会被适配。",
  },
  {
    terms: ["t-hallucination", "t-citation-verification"],
    source: "research", tag: "虚构引用",
    title: "GPT-3.5 虚构引用率 55%，GPT-4 仍有 18%",
    fact: "模型能生成格式完全正确但根本不存在的文献引用。",
    lesson: "引用必须用外部数据库（Crossref/arXiv）核验，不能让另一个模型来判——那是用幻觉验证幻觉。",
  },
  {
    terms: ["t-context-window"],
    source: "labset", tag: "长上下文",
    title: "上下文从 8k 扩到 128k 不是改个数字",
    fact: "RoPE 频率设计决定未见位置会外推失真，需要插值并补训练。",
    lesson: "标称窗口是容量上限，不是有效容量。能放进去 ≠ 能用好。",
  },
];

function buildBridges() {
  const claims = bench.claim.list();
  return BRIDGES.map((b) => {
    const related = claims.filter((c) =>
      (c.tags ?? []).some((t) => b.tag.includes(t) || t.includes(b.tag)) ||
      c.text.includes(b.tag),
    );
    return {
      ...b,
      relatedClaims: related.map((c) => ({
        id: c.id, text: c.text, status: c.digest.status,
        evidenceCount: c.digest.evidenceCount, warning: c.digest.warning,
      })),
      note: related.length ? null : "kernel 里暂时没有匹配的结论（这条是预置的教学案例，不是来自你的数据）",
    };
  });
}

/**
 * 把「通过追问」写成 kernel Claim。
 *
 * **诚实性设计**：tier 固定 "D"（个人推断），按 deriveStatus 规则
 * **永远不能升到 supported**。这是刻意的：supported 只留给 A 级与 B 级。
 */
function recordLearningClaim({ term, probe, verdict }) {
  try {
    const kindLabel = P.judgeMeta.kinds[probe.kind] ?? probe.kind;
    const text = `我已理解「${term.cn}（${term.en}）」的${kindLabel}层面：能回答「${probe.q.slice(0, 40)}…」`;
    const claim = bench.claim.create({
      text,
      confidence: verdict.level === "deep" ? "medium" : "low",
      tags: ["from-learning", "learn", "llm", term.layer, `probe:${probe.kind}`],
      note: `判定：${verdict.level}（${verdict.source}）。${verdict.reason}`,
    });
    bench.claim.attachEvidence(claim.id, {
      kind: "inference",
      refId: `${term.id}#${probe.kind}`,
      tier: "D",
      summary: `学习追问通过（${verdict.level}）· ${verdict.source}`,
      strength: verdict.level === "deep" ? 2 : 1,
      causedBy: { by: "learn.probe", reason: "learning", refId: term.id },
    });
    return { id: claim.id, text, tier: "D", level: verdict.level };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
export const routes = {
  "GET /ping": async () => ({ ok: true, app: "learn" }),

  // ---- 课程 ----
  "GET /courses": async () => {
    const c = loadCourses();
    const progress = loadProgress();
    const terms = T.loadTerms();
    const layers = T.loadLayers();
    const cur = loadCurriculum();

    return {
      courses: (c.courses ?? []).map((co) => {
        if (co.kind === "terms") {
          const mastered = terms.filter((t) => T.termState(t, progress).state === "mastered").length;
          return {
            ...co,
            stats: {
              total: terms.length,
              probes: terms.reduce((a, t) => a + t.probes.length, 0),
              layers: layers.length,
              mastered,
              learning: terms.filter((t) => T.termState(t, progress).state === "learning").length,
            },
          };
        }
        // graph 型（计算理论）
        const cards = loadCards().filter((x) => x._source === "file");
        return {
          ...co,
          stats: {
            total: cur.nodes?.length ?? 0,
            edges: cur.edges?.length ?? 0,
            tracks: cur.tracks?.length ?? 0,
            cards: cards.length,
          },
        };
      }),
    };
  },

  "GET /curriculum": async () => ({ ...loadCurriculum(), progress: loadProgress() }),
  "GET /cards": async () => ({ cards: loadCards(), progress: loadProgress() }),
  "GET /notebooks": async () => ({ notebooks: loadNotebooks() }),

  "POST /eval": async (_ctx, b) => {
    const lang = b.lang === "js" ? "js" : "lambda";
    const code = String(b.code ?? "");
    if (lang === "lambda") return { lang, ...lam.run(code, { trace: b.trace === true }) };
    return { lang, ...(await runJs(code, Number(b.timeout) || 2000)) };
  },

  /**
   * 复习队列 —— 两门课合并。
   *
   * 计算理论：用文件里的卡（含 kernel Claim 卡）
   * 大模型：只放**已解锁**的词（前置门禁在这里生效）
   *
   * 合并后交给 srs.dueQueue 排序（逾期优先，新卡次之）。
   */
  "GET /review/queue": async (ctx) => {
    const limit = Number(ctx.url.searchParams.get("limit")) || 12;
    const progress = loadProgress();

    // 计算理论课
    const computeCards = loadCards().map((c) => ({ ...c, _course: c._source === "kernel" ? "kernel" : "compute" }));

    // 大模型课：只放解锁的
    const terms = T.loadTerms();
    const llmCards = [];
    let llmLocked = 0;
    for (const t of terms) {
      if (!T.unlockState(t, terms, progress).unlocked) { llmLocked++; continue; }
      llmCards.push({
        id: t.id,
        question: `${t.cn}（${t.en}）是什么？`,
        answer: `${t.def}\n\n**为什么重要**：${t.why}`,
        tags: [t.layer],
        node: t.id,
        _course: "llm",
      });
    }

    return {
      queue: srs.dueQueue([...computeCards, ...llmCards], progress, limit),
      llmLocked,
    };
  },

  "POST /review/answer": async (_ctx, b) => {
    if (!b.id) throw new Error("缺少 id");
    const grade = Number(b.grade);
    if (![0, 1, 2, 3].includes(grade)) throw new Error("grade 必须是 0-3");
    const prog = loadProgress();
    prog[b.id] = srs.review(prog[b.id], grade);
    saveProgress(prog);

    // ---- 闭环：如果这张卡来自 kernel Claim，把复习表现回写 ----
    let feedback = null;
    if (String(b.id).startsWith("clm_")) {
      const c = bench.claim.get(b.id);
      if (c) {
        const reps = prog[b.id].reps ?? 0;
        const lapses = prog[b.id].lapses ?? 0;
        // 连续答对 3 次以上且没遗忘过 → 提升置信度
        // 遗忘过 2 次以上 → 降低置信度
        let next = c.confidence;
        if (reps >= 3 && lapses === 0) next = "high";
        else if (lapses >= 2) next = "low";

        if (next !== c.confidence) {
          bench.claim.setConfidence(c.id, next);
          feedback = { claimId: c.id, from: c.confidence, to: next };
        }
      }
    }

    return { id: b.id, state: prog[b.id], claimFeedback: feedback };
  },

  // ---- kernel 视图 ----
  // ═════════════════════════════════════════════════════════════════
  // 大模型课程（原 llm-lab 并入）
  // ═════════════════════════════════════════════════════════════════
  "GET /llm/layers": async () => {
    const terms = T.loadTerms();
    const layers = T.loadLayers();
    const progress = loadProgress();
    return {
      layers: T.layerProgress(terms, layers, progress),
      total: terms.length,
      probeTotal: terms.reduce((a, t) => a + t.probes.length, 0),
      graph: T.validateGraph(terms),
    };
  },

  "GET /llm/terms": async (ctx) => {
    const terms = T.loadTerms();
    const progress = loadProgress();
    let idx = T.buildIndex(terms, progress);
    const layer = ctx.url.searchParams.get("layer");
    const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (layer) idx = idx.filter((t) => t.layer === layer);
    if (q) {
      idx = idx.filter((t) =>
        t.cn.toLowerCase().includes(q) || t.en.toLowerCase().includes(q) ||
        t.def.toLowerCase().includes(q) || t.id.includes(q));
    }
    return { terms: idx, total: idx.length };
  },

  "GET /llm/graph": async () => {
    const terms = T.loadTerms();
    const progress = loadProgress();
    const idx = T.buildIndex(terms, progress);
    const edges = [];
    for (const t of idx) for (const d of t.depends) edges.push({ from: t.id, to: d, kind: "depends" });
    return {
      nodes: idx.map((t) => ({
        id: t.id, cn: t.cn, en: t.en, layer: t.layer,
        state: t.state, unlocked: t.unlocked, depends: t.depends.length,
      })),
      edges,
      layers: T.loadLayers(),
    };
  },

  "GET /llm/queue": async (ctx) => {
    const limit = Math.min(30, Number(ctx.url.searchParams.get("limit")) || 12);
    const terms = T.loadTerms();
    const progress = loadProgress();

    // 只把「已解锁」的词放进队列 —— 前置门禁的落地
    const cards = [];
    const locked = [];
    for (const t of terms) {
      const un = T.unlockState(t, terms, progress);
      if (!un.unlocked) { locked.push({ id: t.id, cn: t.cn, reason: un.reason }); continue; }
      cards.push({
        id: t.id,
        question: `${t.cn}（${t.en}）是什么？`,
        answer: `${t.def}\n\n**为什么重要**：${t.why}`,
        tags: [t.layer],
        node: t.id,
      });
    }

    const queue = srs.dueQueue(cards, progress, limit).map((x) => {
      const t = terms.find((y) => y.id === x.id);
      return {
        ...x,
        layer: t?.layer,
        probeCount: t?.probes.length ?? 0,
        probes: t?.probes ?? [],
        def: t?.def,
        why: t?.why,
        dependsCn: t?.depends.map((d) => terms.find((y) => y.id === d)?.cn ?? d) ?? [],
      };
    });

    return { queue, lockedCount: locked.length, lockedSample: locked.slice(0, 5) };
  },

  "POST /llm/review": async (_ctx, b) => {
    if (!b.id) throw new Error("缺少 id");
    const grade = Number(b.grade);
    if (![0, 1, 2, 3].includes(grade)) throw new Error("grade 必须是 0-3");
    const prog = loadProgress();
    prog[b.id] = srs.review(prog[b.id], grade);
    saveProgress(prog);
    const terms = T.loadTerms();
    const term = terms.find((t) => t.id === b.id);
    return {
      id: b.id, state: prog[b.id],
      mastery: term ? T.termState(term, prog) : null,
      nextDue: prog[b.id].due,
    };
  },

  // 追问（核心机制）：只判深度，不给答案
  "POST /llm/probe": async (_ctx, b) => {
    const termId = String(b.termId ?? "");
    const probeIdx = Number(b.probeIndex);
    const answer = String(b.answer ?? "");
    const terms = T.loadTerms();
    const term = terms.find((t) => t.id === termId);
    if (!term) throw new Error(`词条不存在: ${termId}`);
    const probe = term.probes[probeIdx];
    if (!probe) throw new Error(`追问不存在: ${termId}#${probeIdx}`);

    // 前置门禁也管追问：锁住的词不能做追问
    const prog0 = loadProgress();
    const un = T.unlockState(term, terms, prog0);
    if (!un.unlocked) {
      return { error: un.reason, lockedBy: un.lockedBy, __status: 409 };
    }

    const verdict = await P.judge({ term, probe, answer });

    const prog = loadProgress();
    const cur = prog[termId] ?? srs.initState();
    cur.probes = Array.isArray(cur.probes) ? cur.probes : [];
    cur.probes.push({ kind: probe.kind, index: probeIdx, level: verdict.level, at: new Date().toISOString(), source: verdict.source });
    if (cur.probes.length > 20) cur.probes = cur.probes.slice(-20);
    prog[termId] = cur;
    saveProgress(prog);

    const mastery = T.termState(term, prog);

    // 闭环：通过深度追问 → 写 kernel Claim
    let claim = null;
    if ((verdict.level === "deep" || verdict.level === "partial") && !b.noClaim) {
      claim = recordLearningClaim({ term, probe, verdict });
    }

    return {
      termId, probeIndex: probeIdx, kind: probe.kind, verdict, mastery, claim,
      hint: verdict.level === "shallow"
        ? "你的回答停在复述层面。试着回答「如果去掉它会怎样」或「什么情况下它会失效」。"
        : verdict.level === "partial"
          ? "机制说到了，但没推到底。再想一步：这个机制会导致什么后果？边界在哪？"
          : "因果链完整。可以去看这个词的易混淆词，确认你不是靠直觉答对的。",
    };
  },

  "GET /llm/progress": async () => {
    const terms = T.loadTerms();
    const layers = T.loadLayers();
    const progress = loadProgress();
    const idx = T.buildIndex(terms, progress);
    const byState = { new: 0, learning: 0, mastered: 0 };
    for (const t of idx) byState[t.state] = (byState[t.state] ?? 0) + 1;

    const probeStats = { shallow: 0, partial: 0, deep: 0, total: 0, degraded: 0 };
    for (const p of Object.values(progress)) {
      for (const x of p.probes ?? []) {
        probeStats[x.level] = (probeStats[x.level] ?? 0) + 1;
        probeStats.total++;
        if (x.source === "fallback") probeStats.degraded++;
      }
    }

    return {
      total: terms.length, byState,
      layers: T.layerProgress(terms, layers, progress),
      review: srs.stats(terms.map((t) => ({ id: t.id })), progress),
      probes: probeStats,
      unlocked: idx.filter((t) => t.unlocked).length,
      graph: T.validateGraph(terms),
    };
  },

  "GET /llm/bridges": async () => ({
    bridges: buildBridges(),
    kernelClaims: bench.claim.list().length,
  }),

  "POST /llm/progress/reset": async (_ctx, b) => {
    const prog = loadProgress();
    if (b.scope === "one" && b.id) { delete prog[b.id]; saveProgress(prog); return { ok: true, cleared: b.id }; }
    // 只清大模型课程的进度（t- 前缀），不动计算理论
    for (const k of Object.keys(prog)) if (k.startsWith("t-")) delete prog[k];
    saveProgress(prog);
    return { ok: true, cleared: "llm" };
  },

  "GET /kernel/claims": async () => ({
    claims: bench.claim.list().map((c) => ({
      ...c.digest,
      text: c.text,
      confidence: c.confidence,
      tags: c.tags,
      createdAt: c.createdAt,
    })),
  }),

  "GET /kernel/stats": async () => bench.stats(),

  "GET /review/stats": async () => {
    const progress = loadProgress();
    const terms = T.loadTerms();
    const computeCards = loadCards();
    const llmCards = terms.filter((t) => T.unlockState(t, terms, progress).unlocked).map((t) => ({ id: t.id }));
    const merged = srs.stats([...computeCards, ...llmCards], progress);
    return { ...merged, llmLocked: terms.length - llmCards.length };
  },

  "POST /progress/reset": async () => {
    saveProgress({});
    return { ok: true };
  },

  "POST /coach": async (_ctx, b) => {
    const topic = String(b.topic ?? "").trim();
    if (!topic) throw new Error("缺少 topic");
    return coach.ask({
      topic,
      history: Array.isArray(b.history) ? b.history : [],
      userMessage: String(b.message ?? ""),
    });
  },

  "GET /notes": async () => {
    const dir = path.join(DATA, "notes");
    if (!existsSync(dir)) return { notes: [] };
    const notes = readdirSync(dir).filter((x) => x.endsWith(".md")).map((f) => {
      const st = statSync(path.join(dir, f));
      return { file: f, size: st.size, modified: st.mtime.toISOString() };
    }).sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return { notes };
  },

  "POST /notes": async (_ctx, b) => {
    const dir = path.join(DATA, "notes");
    mkdirSync(dir, { recursive: true });
    const name = `${new Date().toISOString().slice(0, 10)}-${String(b.title || "note").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60)}.md`;
    const body = `---\ntitle: ${b.title || "note"}\ndate: ${new Date().toISOString().slice(0, 10)}\ntopic: ${b.topic || ""}\nmode: ${b.mode || ""}\n---\n\n${b.body || ""}\n`;
    writeFileSync(path.join(dir, name), body, "utf8");
    return { file: name };
  },
};

export const dynamicRoutes = [
  {
    method: "GET",
    pattern: /^\/llm\/terms\/([\w-]+)$/,
    handler: async (_ctx, _b, mm) => {
      const terms = T.loadTerms();
      const progress = loadProgress();
      const t = terms.find((x) => x.id === mm[1]);
      if (!t) return { __status: 404, error: "词条不存在" };
      const idx = T.buildIndex([t], progress)[0];
      const un = T.unlockState(t, terms, progress);
      const byId = new Map(terms.map((x) => [x.id, x]));
      return {
        ...t,
        state: idx.state,
        masteryReason: idx.reason,
        ...un,
        dependsDetail: t.depends.map((d) => {
          const dt = byId.get(d);
          return dt ? { id: d, cn: dt.cn, state: T.termState(dt, progress).state } : { id: d, cn: d, state: "?" };
        }),
        contrastsDetail: t.contrasts.map((d) => {
          const dt = byId.get(d);
          return dt ? { id: d, cn: dt.cn, en: dt.en, def: dt.def } : { id: d, cn: d };
        }),
        progress: progress[t.id] ?? null,
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/notes\/(.+)$/,
    handler: async (ctx, body, mm) => {
      const f = decodeURIComponent(mm[1]);
      const p = path.join(DATA, "notes", f);
      if (!p.startsWith(path.join(DATA, "notes"))) return { __status: 404, error: "非法路径" };
      if (!existsSync(p)) return { __status: 404, error: "not found" };
      return { __raw: readFileSync(p, "utf8"), __type: "text/markdown; charset=utf-8" };
    },
  },
];
