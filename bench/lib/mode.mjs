/**
 * 模式模块 —— 专家模式 / 小白模式。
 *
 * 这是一个**基础模块**：平台、外壳、以及每个应用都可以读它，
 * 用来决定「同一份内容该以什么密度呈现」。
 *
 * 两种模式的差别不是「显示/隐藏按钮」，而是**内容密度与解释深度**：
 *
 *   小白模式（novice）
 *     - 每个专业术语后面带一句话解释
 *     - 关键操作前有「这是什么 / 点它会怎样」
 *     - 隐藏高级选项，默认值取「最安全」的
 *     - 出错时给「怎么修」而不是堆栈
 *
 *   专家模式（expert）
 *     - 只显示术语本身（不加括号解释）
 *     - 全部参数可见，含默认值
 *     - 出错给完整堆栈 / 原始 JSON
 *     - 提供快捷键、批量操作、原始数据入口
 *
 * 约定：应用通过 `data-mode="novice|expert"` 属性感知模式，
 * CSS 用 `[data-mode="novice"] .expert-only { display:none }` 这类规则切换。
 * 也可以读 `window.__benchMode` 做逻辑分支。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "data", "mode.json");

export const MODES = ["novice", "expert"];
export const DEFAULT_MODE = "novice";

export function read() {
  try {
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    const mode = MODES.includes(d.mode) ? d.mode : DEFAULT_MODE;
    return {
      mode,
      // 每个应用可以单独覆盖（例如「学习」默认小白，「研究」默认专家）
      perApp: d.perApp && typeof d.perApp === "object" ? d.perApp : {},
      updatedAt: d.updatedAt ?? null,
    };
  } catch {
    return { mode: DEFAULT_MODE, perApp: {}, updatedAt: null };
  }
}

export function write({ mode, perApp }) {
  const cur = read();
  const next = {
    mode: mode && MODES.includes(mode) ? mode : cur.mode,
    perApp: perApp && typeof perApp === "object" ? perApp : cur.perApp,
    updatedAt: new Date().toISOString(),
  };
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(next, null, 2), "utf8");
  } catch { /* 写不了不阻塞 */ }
  return next;
}

/** 取某个应用实际生效的模式（应用级覆盖优先）。 */
export function modeFor(appId) {
  const s = read();
  const override = s.perApp?.[appId];
  return MODES.includes(override) ? override : s.mode;
}

/**
 * 内容适配器 —— 给应用用的统一接口。
 *
 * 用法（服务端）：
 *   import { adapt } from "../../lib/mode.mjs";
 *   const a = adapt("expert");
 *   a.pick({ novice: "点这里开始", expert: "POST /api/x {q}" })
 *
 * 用法（前端）：
 *   <span class="novice-only">这是什么</span>
 *   <code class="expert-only">--verbose</code>
 */
export function adapt(mode) {
  const m = MODES.includes(mode) ? mode : DEFAULT_MODE;
  return {
    mode: m,
    isExpert: m === "expert",
    isNovice: m === "novice",
    /** 二选一文案 */
    pick(pair) {
      if (pair == null) return "";
      if (typeof pair === "string") return pair;
      return (m === "expert" ? pair.expert : pair.novice) ?? pair.novice ?? "";
    },
    /** 专家才显示 */
    expertOnly(v) {
      return m === "expert" ? v : "";
    },
    /** 小白才显示 */
    noviceOnly(v) {
      return m === "novice" ? v : "";
    },
    /** 按模式给出解释深度：小白给长解释，专家给术语 */
    explain(term, plain) {
      return m === "expert" ? term : `${term}（${plain}）`;
    },
  };
}

/**
 * 术语表 —— 小白模式下给术语加括号解释。
 * 应用可以在渲染文本时调用 `annotate(text, mode)`。
 */
export const GLOSSARY = {
  "arXiv": "预印本论文库，物理/数学/计算机的论文常先发这里",
  "DOI": "论文或文档的永久编号，用它一定能找到原文",
  "Crossref": "查论文是否真实存在的数据库",
  "OpenAlex": "开放学术图谱，能查论文被谁引用",
  "基准 benchmark": "一套标准题目，用分数比较不同 AI 的能力",
  "λ 演算": "只用「定义函数」和「调用函数」来描述一切计算的语言",
  "β 归约": "把参数代进函数体，相当于「算一步」",
  "α 重命名": "换个变量名以避免撞名",
  "Church 编码": "用函数来表示数字和布尔值",
  "不动点": "一个东西作用到自己身上后不变，用它实现递归",
  "SM-2": "一种按遗忘曲线安排复习时间的算法",
  "EF": "难度因子，卡片越难这个值越低，间隔增长越慢",
  "Curry–Howard": "类型就是命题、程序就是证明的对应关系",
  "单调性": "输入变大输出也变大（或变小），二分查找的前提",
  "复杂度 O()": "数据量变大时，耗时增长的速度",
  "闭包": "函数 + 它能看到的那些变量",
  "单子 monad": "一种把「有副作用的操作」串起来还不失控的包装",
  "正交": "两个功能互不影响，可以自由组合",
};

/** 给小白模式下的文本加术语解释。 */
export function annotate(text, mode) {
  if (mode === "expert") return text;
  let out = String(text);
  for (const [term, plain] of Object.entries(GLOSSARY)) {
    // 只替换第一次出现，避免啰嗦
    const i = out.indexOf(term);
    if (i < 0) continue;
    out = out.slice(0, i + term.length) + `（${plain}）` + out.slice(i + term.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 实时预览 —— 同一份内容在两种模式下的并排渲染
// ---------------------------------------------------------------------------

/** 一组示例内容，用于让用户直观看到两种模式的差别。 */
const SAMPLES = {
  default: {
    title: "执行一次检索",
    term: "arXiv",
    action: "检索",
    detail: "GET https://export.arxiv.org/api/query?search_query=…",
    error: "HTTP 429",
    stack: "429 Too Many Requests\n  at channels.mjs:142 (curlGet)\n  at async searchArxiv (channels.mjs:165)",
    hint: "请求太频繁了。等 10 秒，或者换一个通道再试。",
    params: [
      { name: "perSource", def: "5", desc: "每个源取几条" },
      { name: "sources", def: "全部", desc: "限定检索哪些通道" },
    ],
  },
  lambda: {
    title: "求值一个表达式",
    term: "β 归约",
    action: "运行",
    detail: "(λx.x) y",
    error: "词法错误：位置 11 处出现意外字符 \"~\"",
    stack: "LexError: unexpected '~' at 11\n  at lex (lambda.mjs:58)\n  at parse (lambda.mjs:96)",
    hint: "有个字符不认识。λ 演算只认字母、点、括号、反斜杠 —— 检查是不是打错了。",
    params: [
      { name: "trace", def: "false", desc: "显示每一步归约" },
      { name: "maxSteps", def: "2000", desc: "最多归约多少步" },
    ],
  },
  review: {
    title: "复习一张卡",
    term: "EF",
    action: "评分",
    detail: "grade ∈ {0,1,2,3}",
    error: "grade 必须是 0-3",
    stack: "RangeError: grade 必须是 0-3\n  at review (srs.mjs:52)",
    hint: "评分只能填 0、1、2、3 这四个数字，分别代表：完全不会 / 想起来了 / 正确费力 / 秒答。",
    params: [
      { name: "interval", def: "1 天", desc: "下次复习间隔" },
      { name: "ef", def: "2.5", desc: "难度因子，范围 1.3–2.8" },
    ],
  },
};

/** 把一段内容按两种模式渲染成「给人看的字符串」，供前端并排展示。 */
export function preview(sampleName = "default") {
  const s = SAMPLES[sampleName] ?? SAMPLES.default;

  const novice = {
    title: s.title,
    blocks: [
      { k: "术语", v: `${s.term}（${GLOSSARY[s.term] ?? "这是一个专业名词"}）` },
      { k: "要做什么", v: `点「${s.action}」就行。简单说：${s.hint}` },
      { k: "如果出错", v: s.hint },
      { k: "参数", v: "（已为你选好默认值，一般不用改）" },
    ],
    visibleParams: [],
    showStack: false,
  };

  const expert = {
    title: s.title,
    blocks: [
      { k: "术语", v: s.term },
      { k: "调用", v: s.detail },
      { k: "错误", v: s.error },
      { k: "堆栈", v: s.stack },
      { k: "参数", v: s.params.map((p) => `${p.name} = ${p.def}   // ${p.desc}`).join("\n") },
    ],
    visibleParams: s.params.map((p) => p.name),
    showStack: true,
  };

  return {
    sample: sampleName,
    available: Object.keys(SAMPLES),
    novice,
    expert,
    diff: {
      noviceHides: ["堆栈", "原始请求", "参数名"],
      expertHides: [],
      noviceAdds: ["术语解释", "出错了怎么修", "把选项藏起来"],
    },
    at: new Date().toISOString(),
  };
}
