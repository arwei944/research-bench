/**
 * research 应用 —— 研究通道 + 报告生成。
 *
 * 从原 workbench/server.mjs 迁移，改为 bench 的 routes 表形式：
 *   "METHOD /path": async (ctx, body) => result
 *
 * 平台自动挂载到 /api/research/*，
 * 前端在 /app/research/ 下用相对路径 /api/research/... 调用。
 */

import path from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as channels from "./lib/channels.mjs";
import * as store from "./lib/store.mjs";
import * as llm from "./lib/llm.mjs";
import { bench } from "../../kernel/index.mjs";
import * as knowledgeBase from "../../lib/knowledge-base.mjs";
import { search as capSearch, llm as capLlm, degrade } from "../../lib/capabilities/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 数据落在应用自己的目录里，与其他应用隔离
store.setDataDir(path.join(HERE, "data"));
store.ensureDirs();

// ---------------------------------------------------------------------------
// 存活 & 健康
// ---------------------------------------------------------------------------
/**
 * 从报告 Markdown 里抽「结论速览」的条目作为 Claim。
 *
 * 只抽「结论速览」小节下的列表项——那是作者明确标注为"结论"的部分。
 * 不抽正文，因为正文混着论证过程，不是可直接判真假的断言。
 */
function extractClaims(md, title, artifactId) {
  const lines = String(md).split("\n");
  const out = [];
  let inSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    // 进入「结论速览」小节
    if (/^#{1,3}\s*.*(结论速览|结论摘要|主要结论|Key findings)/i.test(line)) {
      inSection = true;
      continue;
    }
    // 遇到下一个标题就退出
    if (inSection && /^#{1,3}\s/.test(line)) break;
    if (!inSection) continue;

    // 抽有序/无序列表项
    const m = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (!m) continue;

    let text = m[1]
      .replace(/\[\d+\]/g, "")        // 去掉引用标记 [1]
      .replace(/\*\*/g, "")           // 去掉加粗
      .replace(/（无来源[^）]*）/g, "") // 去掉"（无来源，属推断）"这类标注
      .trim();

    // 太长就截断（Claim 应该是一句话）
    if (text.length > 200) text = text.slice(0, 200) + "…";
    if (text.length >= 8) out.push(text);
  }
  return out.slice(0, 12); // 最多 12 条，避免噪声
}

export const routes = {
  "GET /ping": async () => ({ ok: true, app: "research" }),

  "GET /health": async () => {
    const [ch, l] = await Promise.all([capSearch.probeAll(), llm.llmProbe()]);
    return {
      app: "research",
      channels: { ok: ch.ok, total: ch.total, avgMs: ch.avgMs },
      llm: l,
      dataDir: store.DATA_DIR,
      at: new Date().toISOString(),
    };
  },

  "GET /channels": async () => capSearch.probeAll(),

  // -------------------------------------------------------------------------
  // 检索
  // -------------------------------------------------------------------------
  "POST /search": async (_ctx, b) => {
    const q = String(b.query ?? "").trim();
    if (!q) throw new Error("缺少 query");
    const r = await channels.searchAll(q, { perSource: Math.min(Number(b.perSource) || 5, 10) });
    store.appendSession({ action: "search", query: r.query, count: r.count });
    return r;
  },

  // -------------------------------------------------------------------------
  // 引用核验
  // -------------------------------------------------------------------------
  "POST /verify": async (_ctx, b) => {
    const list = Array.isArray(b.items) ? b.items : b.target ? [b.target] : [];
    if (!list.length) throw new Error("缺少 target 或 items");
    const r = await channels.verifyMany(list.map(String));
    store.saveEvidence({ label: "verify", payload: r });
    store.appendSession({ action: "verify", total: r.total, ok: r.ok });
    return r;
  },

  // -------------------------------------------------------------------------
  // 写报告：检索 → 核验 → LLM 写作（禁止编造引用）
  // -------------------------------------------------------------------------
  "POST /report": async (_ctx, b) => {
    const question = String(b.question ?? "").trim();
    if (!question) throw new Error("缺少 question");

    const sr = await degrade.withFallback({
      name: "search",
      reason: "多源检索",
      run: () => capSearch.searchAll(question, { perSource: Math.min(Number(b.perSource) || 5, 8) }),
      fallback: { query: question, results: [], count: 0, errors: ["检索能力不可用"] },
    });
    const search = sr.value ?? { query: question, results: [], count: 0 };
    if (!search.results.length) {
      return {
        question, search, markdown: "",
        warning: "检索未返回任何结果，未生成报告（避免无依据编造）。",
        degraded: sr.degraded,
        degradedReason: sr.reason ?? null,
      };
    }

    const toVerify = search.results
      .filter((r) => r.evidence === "A" && /arxiv\.org|doi\.org/.test(r.url || ""))
      .slice(0, 6)
      .map((r) => {
        const m = r.url.match(/arxiv\.org\/abs\/([\w.\/-]+)/);
        if (m) return `arXiv:${m[1].replace(/v\d+$/, "")}`;
        const d = r.url.match(/doi\.org\/(.+)$/);
        return d ? d[1] : null;
      })
      .filter(Boolean);
    const verification = toVerify.length ? await channels.verifyMany(toVerify) : null;

    // 降级契约：LLM 不可用时，仍返回真实检索结果，并明确标注降级
    const gen = await degrade.withFallback({
      name: "llm",
      reason: "报告生成",
      run: () => llm.writeReport({ question, results: search.results, verification }),
      fallback: null,
    });

    const markdown = gen.ok ? gen.value : "";
    const llmError = gen.ok ? null : gen.reason;

    store.appendSession({ action: "report", question, results: search.count });
    const out = { question, search, verification, markdown, llmError };
    if (gen.degraded) {
      out.degraded = true;
      out.degradedReason = "LLM 不可用，仅返回检索结果与核验结论（未生成分析报告）";
    }
    return out;
  },

  "POST /report/save": async (_ctx, b) => {
    if (!b.title || !b.markdown) throw new Error("缺少 title 或 markdown");
    const saved = store.saveReport({ title: String(b.title), markdown: String(b.markdown) });
    store.appendSession({ action: "save-report", file: saved.file });

    // ---- 把报告正文存为 Artifact，把「结论速览」里的条目抽成 Claim ----
    const md = String(b.markdown);
    const art = bench.artifact.create({
      kind: "report",
      source: "research",
      content: md.slice(0, 20000),
      meta: { file: saved.file, title: String(b.title), chars: md.length },
    });

    const claims = extractClaims(md, String(b.title), art.id);
    for (const text of claims) {
      const c = bench.claim.create({
        text,
        confidence: "medium",
        tags: ["from-report", String(b.title).slice(0, 20)],
        note: `来自报告 ${saved.file}`,
      });
      // 报告本身是 C 级证据（单一来源，未交叉验证）
      bench.claim.attachEvidence(c.id, {
        kind: "artifact",
        refId: art.id,
        tier: "C",
        summary: `报告「${String(b.title).slice(0, 30)}」中的一条结论`,
        strength: 1,
      });
    }

    // ---- 双写 knowledge-base（AGENTS.md 规定的沉淀位置）----
    // 之前报告只落在 apps/research/data/reports/，工作台的知识库页面看不见。
    // 现在同时沉淀一份到 knowledge-base/academic/（研究类默认领域）。
    let kb = null;
    try {
      kb = knowledgeBase.deposit({
        domain: String(b.kbDomain ?? "academic"),
        title: String(b.title),
        body: md,
        meta: {
          confidence: "medium",
          status: "active",
          tags: ["research-report"],
          sources: Array.isArray(b.sources) ? b.sources.slice(0, 20) : [],
        },
      });
    } catch (e) {
      kb = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    return { ...saved, artifact: art.id, claims: claims.length, knowledgeBase: kb };
  },

  // ---- 内核视图 ----
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

  "GET /reports": async () => ({ reports: store.listReports() }),

  // -------------------------------------------------------------------------
  // 笔记
  // -------------------------------------------------------------------------
  "GET /notes": async () => ({ notes: store.listNotes() }),

  "POST /notes": async (_ctx, b) => {
    if (!b.title || !b.body) throw new Error("缺少 title 或 body");
    const saved = store.saveNote({
      title: String(b.title),
      body: String(b.body),
      domain: String(b.domain ?? "academic"),
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
      sources: Array.isArray(b.sources) ? b.sources.map(String) : [],
      confidence: String(b.confidence ?? "medium"),
    });
    store.appendSession({ action: "save-note", file: saved.file });
    return saved;
  },

  "GET /evidence": async () => ({ evidence: store.listEvidence() }),

  // -------------------------------------------------------------------------
  // 学习辅助
  // -------------------------------------------------------------------------
  "POST /explain": async (_ctx, b) => {
    if (!b.concept) throw new Error("缺少 concept");
    const markdown = await llm.explainConcept({ concept: String(b.concept), level: String(b.level ?? "大学生") });
    return { concept: b.concept, markdown };
  },

  "POST /critique": async (_ctx, b) => {
    const question = String(b.question ?? "").trim();
    if (!question) throw new Error("缺少 question");
    const search = await channels.searchAll(question, { perSource: 4 });
    if (!search.results.length) return { markdown: "", warning: "无检索结果" };
    const markdown = await llm.critique({ question, results: search.results });
    return { question, search, markdown };
  },

  "GET /sessions": async () => ({ sessions: store.recentSessions(20) }),
};

// ---------------------------------------------------------------------------
// 带路径参数的路由需要自己处理，平台只做前缀匹配。
// 这里用「动态路由」约定：键里含 :param 会被平台识别（见 bench/server.mjs）。
// ---------------------------------------------------------------------------

/** 读取单个报告原文（返回字符串由平台按 text 发送）。 */
export const dynamicRoutes = [
  {
    method: "GET",
    pattern: /^\/reports\/(.+)$/,
    handler: async (ctx, body, m) => {
      const f = decodeURIComponent(m[1]);
      const c = store.readReport(f);
      if (c == null) return { __status: 404, error: "not found" };
      return { __raw: c, __type: "text/markdown; charset=utf-8" };
    },
  },
  {
    method: "GET",
    pattern: /^\/notes\/(.+)$/,
    handler: async (ctx, body, m) => {
      const f = decodeURIComponent(m[1]);
      const c = store.readNote(f);
      if (c == null) return { __status: 404, error: "not found" };
      return { __raw: c, __type: "text/markdown; charset=utf-8" };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/notes\/(.+)$/,
    handler: async (ctx, body, m) => {
      const f = decodeURIComponent(m[1]);
      return { ok: store.deleteNote(f) };
    },
  },
];
