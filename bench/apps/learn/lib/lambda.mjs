/**
 * λ 演算解释器 —— 无类型 λ 演算 + 常用编码 + 惰性/正规序求值 + 归约轨迹。
 *
 * 支持语法：
 *   x                 变量
 *   \x. M   λx. M     lambda（\ 和 λ 都行）
 *   \x y. M           多参数（语法糖，展开成 \x.\y.M）
 *   M N               应用（左结合）
 *   (M)               括号
 *   数字字面量        自动转 Church 数（可选，见 NUMERALS）
 *   注释              -- 到行尾
 *
 * 常用编码（内置宏，可直接用）：
 *   I = \x.x
 *   K = \x.\y.x
 *   S = \x.\y.\z.x z (y z)
 *   TRUE/FALSE/IF/AND/OR/NOT
 *   PAIR/FST/SND
 *   0-9, SUCC, PLUS, MULT, PRED, ISZERO
 *   Y（不动点组合子）
 *
 * 求值策略：**正规序**（最左最外，对应 call-by-name 的完全版）
 *   —— 这是唯一能保证「若范式存在则必求得」的策略。
 *   若要模拟 JS 的 call-by-value，看 `strict` 选项（未实现，说明见 README）。
 */

// ---------------------------------------------------------------------------
// 词法
// ---------------------------------------------------------------------------

const TOKEN = {
  LAMBDA: "LAMBDA",
  DOT: "DOT",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  IDENT: "IDENT",
  NUM: "NUM",
  EOF: "EOF",
};

function lex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "\\" || c === "λ") { out.push({ t: TOKEN.LAMBDA }); i++; continue; }
    if (c === ".") { out.push({ t: TOKEN.DOT }); i++; continue; }
    if (c === "(") { out.push({ t: TOKEN.LPAREN }); i++; continue; }
    if (c === ")") { out.push({ t: TOKEN.RPAREN }); i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j++;
      out.push({ t: TOKEN.NUM, v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_']/.test(src[j])) j++;
      out.push({ t: TOKEN.IDENT, v: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`词法错误：位置 ${i} 处出现意外字符 "${c}"`);
  }
  out.push({ t: TOKEN.EOF });
  return out;
}

// ---------------------------------------------------------------------------
// 语法（AST）
// ---------------------------------------------------------------------------
// Term := Lam | App | Var
// Lam  = λ IDENT... . Term
// App  = Atom+
// Atom = IDENT | NUM | ( Term )

function parse(src) {
  const toks = lex(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (t) => {
    if (toks[pos].t !== t) throw new Error(`语法错误：期望 ${t}，实际 ${toks[pos].t}`);
    return toks[pos++];
  };

  function parseTerm() {
    if (peek().t === TOKEN.LAMBDA) {
      eat(TOKEN.LAMBDA);
      const params = [];
      while (peek().t === TOKEN.IDENT) params.push(eat(TOKEN.IDENT).v);
      if (!params.length) throw new Error("语法错误：λ 后缺少参数名");
      eat(TOKEN.DOT);
      const body = parseTerm();
      // 多参数展开成嵌套 λ
      return params.reduceRight((acc, name) => ({ k: "lam", name, body: acc }), body);
    }
    return parseApp();
  }

  function parseApp() {
    let fn = parseAtom();
    // 只要下一个 token 能开启一个 Atom，就继续应用（左结合）
    while (
      peek().t === TOKEN.IDENT ||
      peek().t === TOKEN.NUM ||
      peek().t === TOKEN.LPAREN
    ) {
      const arg = parseAtom();
      fn = { k: "app", fn, arg };
    }
    return fn;
  }

  function parseAtom() {
    const t = peek();
    if (t.t === TOKEN.IDENT) { eat(TOKEN.IDENT); return { k: "var", name: t.v }; }
    if (t.t === TOKEN.NUM) {
      eat(TOKEN.NUM);
      // 数字字面量 → Church 数
      return church(parseInt(t.v, 10));
    }
    if (t.t === TOKEN.LPAREN) {
      eat(TOKEN.LPAREN);
      const inner = parseTerm();
      eat(TOKEN.RPAREN);
      return inner;
    }
    if (t.t === TOKEN.LAMBDA) return parseTerm();
    throw new Error(`语法错误：位置 ${pos} 处无法解析 token ${t.t}`);
  }

  const term = parseTerm();
  if (peek().t !== TOKEN.EOF) throw new Error("语法错误：表达式后有多余内容");
  return term;
}

// ---------------------------------------------------------------------------
// Church 数
// ---------------------------------------------------------------------------

/** n = λf.λx. f (f ... (f x)) */
function church(n) {
  let body = { k: "var", name: "x" };
  for (let i = 0; i < n; i++) body = { k: "app", fn: { k: "var", name: "f" }, arg: body };
  return { k: "lam", name: "f", body: { k: "lam", name: "x", body } };
}

// ---------------------------------------------------------------------------
// 内置宏
// ---------------------------------------------------------------------------

export const MACROS = {
  I: "\\x.x",
  K: "\\x.\\y.x",
  S: "\\x.\\y.\\z.x z (y z)",
  TRUE: "\\t.\\f.t",
  FALSE: "\\t.\\f.f",
  IF: "\\c.\\t.\\f.c t f",
  NOT: "\\c.c FALSE TRUE",
  AND: "\\p.\\q.p q p",
  OR: "\\p.\\q.p p q",
  PAIR: "\\a.\\b.\\f.f a b",
  FST: "\\p.p TRUE",
  SND: "\\p.p FALSE",
  NIL: "\\c.\\n.n",
  SUCC: "\\n.\\f.\\x.f (n f x)",
  PLUS: "\\m.\\n.\\f.\\x.m f (n f x)",
  MULT: "\\m.\\n.\\f.m (n f)",
  POW: "\\b.\\e.e b",
  ISZERO: "\\n.n (\\x.FALSE) TRUE",
  PRED: "\\n.\\f.\\x.n (\\g.\\h.h (g f)) (\\u.x) (\\u.u)",
  SUB: "\\m.\\n.n PRED m",
  Y: "\\f.(\\x.f (x x)) (\\x.f (x x))",
  OMEGA: "(\\x.x x) (\\x.x x)",
  Z: "\\f.(\\x.f (\\v.x x v)) (\\x.f (\\v.x x v))",
};

const MACRO_AST = {};
for (const [k, v] of Object.entries(MACROS)) {
  try { MACRO_AST[k] = parse(v); } catch { /* 忽略坏宏 */ }
}

/** 把宏名展开成定义（只展开一层，避免无限膨胀）。 */
function expandMacros(term, depth = 0) {
  if (depth > 6) return term;
  if (term.k === "var" && MACRO_AST[term.name]) return expandMacros(MACRO_AST[term.name], depth + 1);
  if (term.k === "lam") return { k: "lam", name: term.name, body: expandMacros(term.body, depth) };
  if (term.k === "app") return { k: "app", fn: expandMacros(term.fn, depth), arg: expandMacros(term.arg, depth) };
  return term;
}

// ---------------------------------------------------------------------------
// 自由变量与替换（带 α 重命名，防变量捕获）
// ---------------------------------------------------------------------------

function freeVars(t, acc = new Set()) {
  switch (t.k) {
    case "var": acc.add(t.name); break;
    case "lam": { const inner = freeVars(t.body, new Set()); inner.delete(t.name); for (const v of inner) acc.add(v); break; }
    case "app": freeVars(t.fn, acc); freeVars(t.arg, acc); break;
  }
  return acc;
}

let freshCounter = 0;
function freshName(base) {
  return `${base}$${++freshCounter}`;
}

/** 替换 t[x := s]，必要时 α 重命名避免捕获。 */
function substitute(t, x, s) {
  switch (t.k) {
    case "var":
      return t.name === x ? s : t;
    case "lam": {
      if (t.name === x) return t; // 被遮蔽
      const fv = freeVars(s);
      if (fv.has(t.name)) {
        // α 重命名
        const fresh = freshName(t.name);
        const renamed = substitute(t.body, t.name, { k: "var", name: fresh });
        return { k: "lam", name: fresh, body: substitute(renamed, x, s) };
      }
      return { k: "lam", name: t.name, body: substitute(t.body, x, s) };
    }
    case "app":
      return { k: "app", fn: substitute(t.fn, x, s), arg: substitute(t.arg, x, s) };
    default:
      return t;
  }
}

// ---------------------------------------------------------------------------
// 求值：正规序（最左最外）+ 单步归约
// ---------------------------------------------------------------------------

/** 找最左最外的可归约点，做一步 β 归约。返回 null 表示已是范式。 */
function step(t) {
  switch (t.k) {
    case "var":
      return null;
    case "app": {
      // 1) 如果 fn 是 lam，直接 β 归约（最外优先）
      if (t.fn.k === "lam") {
        return substitute(t.fn.body, t.fn.name, t.arg);
      }
      // 2) 否则先归约 fn
      const f2 = step(t.fn);
      if (f2) return { k: "app", fn: f2, arg: t.arg };
      // 3) 再归约 arg
      const a2 = step(t.arg);
      if (a2) return { k: "app", fn: t.fn, arg: a2 };
      return null;
    }
    case "lam": {
      const b2 = step(t.body);
      return b2 ? { k: "lam", name: t.name, body: b2 } : null;
    }
    default:
      return null;
  }
}

/** 完全求值到范式（带步数上限）。 */
function normalize(t, maxSteps = 2000) {
  let cur = t;
  let n = 0;
  while (n < maxSteps) {
    const next = step(cur);
    if (!next) return { term: cur, steps: n, exhausted: false };
    cur = next;
    n++;
  }
  return { term: cur, steps: n, exhausted: true };
}

// ---------------------------------------------------------------------------
// 打印
// ---------------------------------------------------------------------------

function toStr(t, prec = 0) {
  switch (t.k) {
    case "var": return t.name;
    case "lam": {
      // 收集嵌套
      let params = [];
      let body = t;
      while (body.k === "lam") { params.push(body.name); body = body.body; }
      const s = `λ${params.join(" ")}. ${toStr(body, 0)}`;
      return prec > 0 ? `(${s})` : s;
    }
    case "app": {
      // 右结合打印，左结合 AST
      const s = `${toStr(t.fn, 1)} ${toStr(t.arg, 2)}`;
      return prec > 1 ? `(${s})` : s;
    }
    default: return "?";
  }
}

/** 尝试识别 Church 数，返回数字或 null。 */
function asChurch(t) {
  // n = λf.λx. f^n x
  if (t.k !== "lam" || t.body.k !== "lam") return null;
  const f = t.name;
  const x = t.body.name;
  let cur = t.body.body;
  let n = 0;
  while (cur.k === "app" && cur.fn.k === "var" && cur.fn.name === f) {
    n++;
    cur = cur.arg;
    if (n > 1000) return null;
  }
  if (cur.k === "var" && cur.name === x) return n;
  return null;
}

/** 尝试识别 Church 布尔。 */
function asBool(t) {
  const s = toStr(t);
  if (s === "λt f. t") return true;
  if (s === "λt f. f") return false;
  return null;
}

function describe(t) {
  const n = asChurch(t);
  if (n !== null) return `Church 数 ${n}`;
  const b = asBool(t);
  if (b !== null) return `Church 布尔 ${b}`;
  return null;
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

export function run(code, { trace = false, maxSteps = 2000 } = {}) {
  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    return { ok: false, stage: "parse", error: e.message };
  }

  const before = toStr(ast);
  const expanded = expandMacros(ast);
  const expandedStr = toStr(expanded);
  const hasMacro = expandedStr !== before;

  // 逐步归约（仅在需要轨迹时记录）
  let cur = expanded;
  let n = 0;
  const traceLines = [];
  if (trace) traceLines.push({ n: 0, term: toStr(cur) });
  while (n < maxSteps) {
    const next = step(cur);
    if (!next) break;
    cur = next;
    n++;
    if (trace && traceLines.length < 60) traceLines.push({ n, term: toStr(cur) });
    if (trace && traceLines.length > 60) break;
  }

  const normal = n >= maxSteps;
  const result = toStr(cur);
  return {
    ok: true,
    input: code.trim(),
    expanded: hasMacro ? expandedStr : null,
    normalForm: result,
    steps: n,
    exhausted: normal,
    interpretation: describe(cur),
    trace: trace ? traceLines : undefined,
  };
}

/** 供前端做「语法检查」用。 */
export function check(code) {
  try {
    const ast = parse(code);
    return { ok: true, ast: toStr(ast), freeVars: [...freeVars(expandMacros(ast))] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const macroList = Object.entries(MACROS).map(([name, def]) => ({ name, def }));
