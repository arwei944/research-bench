/**
 * 实验器 · 任务集
 *
 * 一条铁律：**每个任务必须有可执行的客观验证器。**
 * 没有验证器的任务（"写篇综述"、"给个判断"）不进这里，因为无法测出真实成功率。
 *
 * 任务分三类（对应研究里最重要的一条结构性差异）：
 *   A. verifiable   有确定性验证器，答案是唯一解 —— 能测"能力天花板"
 *   B. multi-step   需要多步推理，中途一步错全错 —— 能测"颗粒度效应"
 *   C. longcontext  规则在长上下文里，需要真正"吸收"而非检索 —— 能测"上下文学习"
 *
 * 后续按 DIAGNOSIS.md 的结论又加了两类（测「可靠性」而非「能力天花板」）：
 *   F. multiturn    需要多轮对话，后一轮依赖前一轮的中间结果，中途还会改前提
 *   G. longctx2     规则藏在长文档中段，需要真正读完并保持上下文一致
 *
 * 每个任务：
 *   id         唯一标识
 *   kind       A | B | C | D | E | F | G
 *   prompt     给模型的题面（不含答案）
 *   turns      （可选）多轮任务的逐轮 prompt；给了它就忽略 prompt，按轮次连续对话
 *   verify     验证函数：输入模型输出字符串，返回 {pass:boolean, reason:string}
 *   answer     标准答案（部分任务给，便于人看）
 *   note       这个任务在测什么
 */

/** 从模型输出里抽出最后一个代码块 / 纯文本，做归一化。 */
function extract(s) {
  let t = String(s ?? "").trim();
  // 去掉 markdown 代码围栏
  const fence = t.match(/```(?:[a-zA-Z0-9]*)\n([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 去掉常见前缀
  t = t.replace(/^(答案|结果|输出|Answer|Result)\s*[:：]\s*/i, "");
  return t.trim();
}

/** 抽出所有数字（用于数值题）。 */
function numbers(s) {
  return (String(s).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/** 归一化后精确比较。 */
function exact(expected) {
  return (out) => {
    const got = extract(out).replace(/\s+/g, " ").toLowerCase();
    const want = String(expected).replace(/\s+/g, " ").toLowerCase();
    return {
      pass: got === want,
      reason: got === want ? "精确匹配" : `期望 "${want}"，得到 "${got.slice(0, 80)}"`,
    };
  };
}

/** 数值容差比较。 */
function numeric(expected, tol = 1e-6) {
  return (out) => {
    const ns = numbers(extract(out));
    if (!ns.length) return { pass: false, reason: "输出里没有数字" };
    const hit = ns.some((n) => Math.abs(n - expected) <= tol);
    return {
      pass: hit,
      reason: hit ? `命中 ${expected}` : `期望 ${expected}，得到 [${ns.slice(0, 6).join(", ")}]`,
    };
  };
}

/**
 * 只比较**最后一个**数字。
 *
 * 用于多轮任务：模型常在末轮复述前几轮的中间结果，
 * 用 numeric() 的「任意一个数命中」会被中间结果误判为正确。
 */
function finalNumber(expected, tol = 1e-6) {
  return (out) => {
    const ns = numbers(extract(out));
    if (!ns.length) return { pass: false, reason: "输出里没有数字" };
    const n = ns[ns.length - 1];
    const hit = Math.abs(n - expected) <= tol;
    return {
      pass: hit,
      reason: hit
        ? `末位数字 ${n} 命中 ${expected}`
        : `期望末位 ${expected}，得到 ${n}（全部数字 ${ns.slice(0, 6).join(", ")}）`,
    };
  };
}

const PI_DIGITS = "141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067982148086513282306647093844609550582231725359408128481117450284102701938521105559644622948954930381964428810975665933446128475648233786783165271201909145648566923460348610454326648213393607260249141273";

// ---------------------------------------------------------------------------
// 长上下文材料：规则埋在中段，前后都有无关干扰
// ---------------------------------------------------------------------------

const LONG_DOC_HEAD = `# 数据处理规范（v4.2）

## 0 前言

本规范定义了一套内部数据加工流程，用于统一各子系统的输出口径。
规范自发布之日起生效，历史数据不回跑。任何修订须经评审。

## 1 术语

1.1 「原始数值」指未经任何变换的输入值。
1.2 「加工后数值」指经过第 3 节处理后的值。
1.3 「汇总」指第 4 节定义的求和过程。

## 2 输入格式

2.1 输入是一个整数序列，元素间无顺序要求。
2.2 序列长度不限，但单批次不超过一万个元素。
2.3 空序列视为非法输入，应报错而非返回 0。
2.4 输入中不得包含小数或分数；若出现，先四舍五入到整数。
2.5 历史遗留的浮点输入应按 2.4 处理，不单独开分支。
2.6 输入编码统一使用 UTF-8。
2.7 分隔符为半角逗号，不得使用中文逗号。`;

const LONG_DOC_TAIL = `## 5 异常处理

5.1 任何步骤失败均中止整个批次，不做部分提交。
5.2 日志保留 90 天。
5.3 告警发送到值班群。

## 6 变更记录

6.1 v4.0 引入第 3 节加工规则。
6.2 v4.1 修正了 4.2 的奇偶判定（旧版将 0 当奇数处理）。
6.3 v4.2 仅调整措辞，语义未变。

## 7 附则

7.1 本规范的解释权归数据平台组。
7.2 本规范与旧版冲突时，以本版为准。`;

const LONG_DOC_HEAD2 = `# 编码与取值规范（内部）

## 0 适用范围

本规范适用于旧系统迁移期间的编码换算，新系统不再使用。
迁移完成后本规范自动失效。

## 1 背景

旧系统用字母表示小整数，编码串由 1–5 个字母组成，无分隔符。
早期版本曾允许小写字母，v3 起统一大写。

## 2 字符集

2.1 只允许 A、B、C、D、E 五个字母。
2.2 其他字母均为非法输入，应报错。
2.3 编码串不得包含空格或标点。

## 3 历史注记

3.1 早期版本曾用 A=0 作为起点，后因容易与「空串」混淆而改为 A=1。
3.2 下面第 4 节的取值为现行标准，历史注记不适用于新计算。
3.3 本节的任何例子都已作废，不应引用。`;

const LONG_DOC_TAIL2 = `## 5 示例（仅供理解，不作为计算依据）

5.1 示例：编码串 "AB"，初始值 3，长度为 2（偶）→ 6，不大于 20 → 6，无 A/E 之外重复 → 6。
5.2 示例仅用于说明步骤顺序，数值不得直接引用到实际计算中。

## 6 失效与归档

6.1 迁移完成后本规范归档，不再维护。
6.2 归档后如需查阅，联系数据平台组。`;

export const TASKS = [
  // ─────────────────────────────────────────────────────────────────────
  // A 类：单点能力（验证器绝对可靠）
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "A-arith-long",
    kind: "A",
    prompt: `计算：(17 * 23 + 89) * 13 - 456 / 8

只输出最终数字，不要解释。`,
    answer: "6183",
    verify: numeric(6183),
    note: "纯算术。测基础可靠性与是否会被长表达式绊倒",
  },
  {
    id: "A-count-letters",
    kind: "A",
    prompt: `英文单词 "strawberry" 中有几个字母 r？只输出数字。`,
    answer: "3",
    verify: numeric(3),
    note: "经典陷阱题。测模型是否真的逐字处理而非凭印象",
  },
  {
    id: "A-logic-syllogism",
    kind: "A",
    prompt: `已知：
1. 所有 A 都是 B
2. 有些 B 不是 C
3. 所有 C 都是 A

问：以下哪项必然成立？只输出选项字母。
(A) 有些 A 是 C
(B) 有些 B 不是 A
(C) 所有 C 都是 B
(D) 以上都不必然成立`,
    answer: "C",
    verify: (out) => {
      // 关键：不能「取第一个 A-D 字母」——模型常在推理里复述选项 (A)、(B)…，
      // 第一个字母永远是被分析的第一个选项，必然误判。
      // 正确做法：优先取「答案/结论/正确」附近的字母，其次取最后出现的独立字母。
      const raw = String(out ?? "");
      const t = raw.toUpperCase();

      const patterns = [
        // 1) 明确的答案标记
        /答案\s*[:：]?\s*\(?\s*([ABCD])\s*\)?/,
        // 2) 结论/因此/所以 附近
        /(?:结论|因此|所以|应选|正确答案是|故)\s*[:：]?[^A-D]{0,12}?\(?\s*([ABCD])\s*\)?/,
        // 3) 加粗的独立字母 **(C)**
        /\*\*\s*\(?\s*([ABCD])\s*\)?\s*\*\*/,
        // 4) 整行只有一个字母或 (字母)
        /^\s*\(?\s*([ABCD])\s*\)?\s*[.。]?\s*$/,
      ];

      for (const re of patterns) {
        const m = t.match(re);
        if (m) return { pass: m[1] === "C", reason: `选了 ${m[1]}（命中答案标记）` };
      }

      // 5) 兜底：取最后一个「独立出现」的字母（前后不能是别的字母）
      const all = [...t.matchAll(/(?<![A-Z])([ABCD])(?![A-Z])/g)];
      if (all.length) {
        const last = all[all.length - 1][1];
        return { pass: last === "C", reason: `选了 ${last}（取最后一个独立字母）` };
      }
      return { pass: false, reason: "没给出选项" };
    },
    note: "形式逻辑。C⊆A⊆B ⟹ C⊆B，故 (C) 必成立。测模型是否会被'必然'二字绕住，以及格式遵从",
  },
  {
    id: "A-code-trace",
    kind: "A",
    prompt: `下面的 Python 代码输出什么？只输出最终结果，不要解释。

x = [1, 2, 3, 4, 5]
y = [i * 2 for i in x if i % 2 == 1]
z = sum(y) - len(y)
print(z)`,
    answer: "15",
    verify: numeric(15),
    note: "代码追踪。y=[2,6,10], sum=18, len=3, 18-3=15",
  },

  // ─────────────────────────────────────────────────────────────────────
  // B 类：多步推理（中途一步错全错）
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "B-multistep-money",
    kind: "B",
    prompt: `甲有 240 元，是乙的 3/4。乙的钱是丙的 2/5。
三人各花掉自己 1/4 的钱后，三人剩余总额是多少元？

只输出最终数字。`,
    answer: "1020",
    verify: numeric(1020),
    note: "四步：乙=240/(3/4)=320，丙=320/(2/5)=800，总额1360，各花1/4 后剩 1020",
  },
  {
    id: "B-multistep-dependency",
    kind: "B",
    prompt: `有四个任务 A、B、C、D，依赖关系：
- A 必须在 B 之前完成
- B 必须在 D 之前完成
- C 必须在 D 之前完成
- A 和 C 之间没有约束

问：所有合法的执行顺序共有多少种？只输出数字。`,
    answer: "3",
    verify: numeric(3),
    note: "拓扑序计数。A<B<D 且 C<D：D 必须最后；A,B,C 中 A<B，排列有 AB C / A CB / C AB = 3 种",
  },

  // ─────────────────────────────────────────────────────────────────────
  // C 类：上下文学习（规则只在 prompt 里，模型不可能预训练见过）
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "C-novel-rule",
    kind: "C",
    prompt: `下面是一种虚构语言的数字规则（该语言不存在于任何真实语料中）：

- "ka" = 1, "lo" = 2, "mi" = 5
- 按顺序书写多个词时，数值为各词之积
- 词尾加 "-su" 表示该数加 3
- 词首加 "ze-" 表示该数乘以 10

把 "ze-ka-lo-mi" 翻译成阿拉伯数字。只输出数字。`,
    answer: "100",
    verify: numeric(100),
    note: "纯虚构规则。测能否真正吸收 prompt 里的新规则并应用（对应 CL-bench 27.9% 那个现象）",
  },
  {
    id: "C-novel-rule-2",
    kind: "C",
    prompt: `虚构规则（同上一题）：

- "ka" = 1, "lo" = 2, "mi" = 5
- 按顺序书写多个词时，数值为各词之积
- 词尾加 "-su" 表示该数加 3
- 词首加 "ze-" 表示该数乘以 10

把 "ka-su-lo" 翻译成阿拉伯数字。只输出数字。`,
    answer: "8",
    verify: numeric(8),
    note: "同上，但 -su 作用在单个词上：ka-su = 1+3 = 4，4*2 = 8。测规则作用域理解",
  },
  // ═════════════════════════════════════════════════════════════════════
  // D 类：困难任务（目标基线 30–60%，用于测出脚手架的真实效果）
  // 所有答案都用可执行代码核算过，不靠心算
  // ═════════════════════════════════════════════════════════════════════
  {
    id: "D-long-chain",
    kind: "D",
    prompt: `从一个初始值开始做 13 步运算，求最终结果。每一步都基于上一步的结果。

1. 从 7 开始
2. × 13
3. + 29
4. × 3
5. − 17
6. ÷ 5（向下取整）
7. 平方（自乘）
8. − 156
9. + 732
10. ÷ 8（向下取整）
11. × 7
12. − 111
13. + 561
14. ÷ 25（向下取整）

只输出最终数字。`,
    answer: "200",
    verify: numeric(200),
    note: "13 步长链。验证链：7→91→120→360→343→68→4624→4468→5200→650→4550→4439→5000→200。测误差累积",
  },
  {
    id: "D-subset-count",
    kind: "D",
    prompt: `给定集合 {3, 5, 2, 7, 4, 6}。

问：有多少个不同的子集，其元素之和恰好等于 13？
（空集和全集也算子集；只按「选了哪些数」区分，不按顺序。）

只输出数字。`,
    answer: "4",
    verify: numeric(4),
    note: "组合计数。穷举得 4 组：{2,7,4} {5,2,6} {7,6} {3,4,6}。测穷举是否完整",
  },
  {
    id: "D-liar-puzzle",
    kind: "D",
    prompt: `三个人 A、B、C，每人要么总说真话，要么总说假话。

- A 说：「B 在说谎。」
- B 说：「C 在说谎。」
- C 说：「A 和 B 都在说谎。」

问：谁在说真话？
请用这种格式回答（真说真话，假说假话）：A=真 B=假 C=假

只输出这一行。`,
    answer: "A=假 B=真 C=假",
    verify: (out) => {
      const t = String(out).toUpperCase().replace(/\s+/g, "");
      // 容忍 A=真B=假C=假 等形式，按顺序抓 A/B/C 各自真假
      const grab = (letter) => {
        const m = t.match(new RegExp(letter + "=(真|假|TRUE|FALSE|T|F)"));
        if (!m) return null;
        const v = m[1];
        return (v === "真" || v === "TRUE" || v === "T") ? "T" : "F";
      };
      const a = grab("A"), b = grab("B"), c = grab("C");
      if (!a || !b || !c) return { pass: false, reason: "没按 A= B= C= 格式给出真假" };
      const got = `A=${a === "T" ? "真" : "假"} B=${b === "T" ? "真" : "假"} C=${c === "T" ? "真" : "假"}`;
      return { pass: got === "A=假 B=真 C=假", reason: `给出 ${got}` };
    },
    note: "骑士与骗子。唯一解：A假 B真 C假（验证：A假⟹B不假✓；B真⟹C假✓；C假⟹'A和B都说谎'为假✓）",
  },
  {
    id: "D-closure-trace",
    kind: "D",
    prompt: `读下面的 JavaScript，问最终输出什么。

\`\`\`js
function make() {
  let n = 0;
  return {
    inc: () => ++n,
    add: (k) => (n += k),
    get: () => n,
  };
}
const a = make();
const b = make();
a.inc(); a.inc(); a.add(5);
b.add(10);
a.inc();
console.log(a.get() * 100 + b.get());
\`\`\`

只输出最终打印的数字。`,
    answer: "810",
    verify: numeric(810),
    note: "闭包独立性。a: 1→2→7→8，b: 10，8*100+10=810。测是否理解每次 make() 产生独立闭包",
  },
  {
    id: "D-rule-priority",
    kind: "D",
    prompt: `一种虚构语言（不存在于任何真实语料），规则如下：

- 基础词值：ka=1, lo=2, mi=5
- 多个词连写时，数值为各词之积
- 词 X 后加 "-su" 表示「把 X 的值加 3」，该修饰只作用于紧邻的那个词
- 整个词序列前加 "ze-" 表示「最终结果乘以 10」
- 整个词序列后加 "-mu" 表示「最终结果减 1」
- 应用顺序：先算各词（含 -su），再连乘，再乘 ze-，最后减 mu

求 "ze-ka-su-lo-mi-mu" 的值。只输出数字。`,
    answer: "399",
    verify: numeric(399),
    note: "规则优先级。ka-su=4，4*2*5=40，×10=400，−1=399。测多规则叠加时的作用域与顺序理解",
  },
  {
    id: "D-bayes",
    kind: "D",
    prompt: `某疾病在人群中的患病率为 1%。
检测手段：患病者中 99% 检测为阳性；未患病者中 5% 也检测为阳性（假阳性）。

某人检测结果为阳性。他实际患病的概率是多少？

只输出百分比数字，保留两位小数，不带百分号（例如 12.34）。`,
    answer: "16.67",
    verify: (out) => {
      const ns = numbers(extract(out));
      if (!ns.length) return { pass: false, reason: "输出里没有数字" };
      const hit = ns.some((n) => Math.abs(n - 16.67) <= 0.05);
      return { pass: hit, reason: hit ? "命中 16.67%" : `期望 16.67，得到 [${ns.slice(0, 5).join(", ")}]` };
    },
    note: "贝叶斯。P(+)=0.01*0.99+0.99*0.05=0.0594，P(D|+)=0.0099/0.0594=16.67%。经典反直觉题",
  },

  // ═════════════════════════════════════════════════════════════════════
  // E 类：高难任务（D 类仍 100% 通过后加，针对已知弱项）
  //   弱项来自研究：逐字精确处理 / 多约束同时满足 / 长上下文规则 / 反事实
  // ═════════════════════════════════════════════════════════════════════
  {
    id: "E-digit-count",
    kind: "E",
    prompt: `下面是圆周率小数点后的 300 位：

${PI_DIGITS}

问：这段数字里，数字 9 出现了多少次？

只输出数字。`,
    answer: "30",
    verify: numeric(30),
    note: "逐字精确计数 301 位。测能否真的逐字扫而非估算（已知弱项：逐字处理）",
  },
  {
    id: "E-constraint-perm",
    kind: "E",
    prompt: `5 个会议 A、B、C、D、E 要安排在周一至周五，每天一个。

约束：
- A 必须在周一或周二
- B 必须在 A 之后
- C 不能在周三
- D 必须在周四

问：满足全部约束的安排共有多少种？

只输出数字。`,
    answer: "7",
    verify: numeric(7),
    note: "多约束联立。5!=120 中筛出 7 种。测能否同时满足 4 个约束不遗漏",
  },
  {
    id: "E-nested-branches",
    kind: "E",
    prompt: `给定函数：

\`\`\`js
function f(x) {
  if (x > 10) {
    if (x % 3 === 0) return x * 2;
    else if (x % 3 === 1) return x + 5;
    else return x - 7;
  } else {
    if (x > 5) {
      if (x % 2 === 0) return x * x;
      return x + 100;
    }
    if (x < 0) return -x;
    return x;
  }
}
\`\`\`

求 f(14) + f(13) + f(11) + f(8) + f(7) + f(-3) + f(4) 的值。

只输出数字。`,
    answer: "207",
    verify: numeric(207),
    note: "嵌套分支 7 个输入。f 值依次 7,18,4,64,107,3,4，和=207。测是否漏分支",
  },
  {
    id: "E-counterfactual",
    kind: "E",
    prompt: `某笔 120 元按 2:3:5 分给甲乙丙三人，三人分别得 24、36、60 元。

现在假设分配比例改为 1:3:5（总额不变）。

问：丙比原来多拿多少元？（只问增加值，保留两位小数）

只输出数字。`,
    answer: "6.67",
    verify: (out) => {
      const ns = numbers(extract(out));
      if (!ns.length) return { pass: false, reason: "输出里没有数字" };
      const hit = ns.some((n) => Math.abs(n - 6.67) <= 0.02);
      return { pass: hit, reason: hit ? "命中 6.67" : `期望 6.67，得到 [${ns.slice(0, 5).join(", ")}]` };
    },
    note: "反事实。原丙=60，新丙=120*5/9=66.67，增 6.67。测能否正确重算而非套用旧值",
  },
  {
    id: "E-rule-chain",
    kind: "E",
    prompt: `给定数列：[3, -2, 5, 7, -8, 4]

按以下三条规则依次处理：
1. 先取出所有正数
2. 若取出的正数个数是奇数，则把它们相加；若是偶数，则把它们相乘
3. 若上一步结果大于 20，则除以 2 并向下取整；否则保持不变

只输出最终数字。`,
    answer: "210",
    verify: numeric(210),
    note: "多规则链。正数 3,5,7,4 共4个(偶)→3*5*7*4=420→>20→210。测多步规则的执行顺序",
  },
  {
    id: "E-logic-negation",
    kind: "E",
    prompt: `命题 P：「所有学生都通过了所有科目。」

下列哪一项是 P 的精确否定（逻辑等价于 ¬P）？只输出选项字母。

(A) 所有学生都没有通过任何科目
(B) 有的学生有的科目没有通过
(C) 有的学生所有科目都没通过
(D) 并非所有科目都被所有学生通过
(E) 至少有一门科目没有任何学生通过`,
    answer: "B",
    verify: (out) => {
      const raw = String(out ?? "");
      const t = raw.toUpperCase();
      // 优先「答案」标记
      const m1 = t.match(/(?:答案|选|答)\s*[:：]?\s*\(?\s*([A-E])\s*\)?/);
      if (m1) return { pass: m1[1] === "B", reason: `选了 ${m1[1]}（命中答案标记）` };
      // 加粗独立字母
      const m2 = t.match(/\*\*\s*\(?\s*([A-E])\s*\)?\s*\*\*/);
      if (m2) return { pass: m2[1] === "B", reason: `选了 ${m2[1]}（加粗）` };
      // 整行只有一个字母
      const m3 = t.match(/^\s*\(?\s*([A-E])\s*\)?\s*[.。]?\s*$/m);
      if (m3) return { pass: m3[1] === "B", reason: `选了 ${m3[1]}（整行）` };
      // 兜底：最后一个独立字母
      const all = [...t.matchAll(/(?<![A-Z])([A-E])(?![A-Z])/g)];
      if (all.length) {
        const last = all[all.length - 1][1];
        return { pass: last === "B", reason: `选了 ${last}（最后一个独立字母）` };
      }
      return { pass: false, reason: "没给出选项" };
    },
    note: "量词否定。¬∀∀ ≡ ∃∃¬。注意 (D) 看似正确但'被所有学生通过'与原命题不同构",
  },

  // ═════════════════════════════════════════════════════════════════════
  // F 类：多轮任务（后一轮依赖前一轮，中途改前提/加干扰）
  //
  // 为什么加这一类：DIAGNOSIS.md 的结论是——20 道单轮题测的是「能力天花板」，
  // 而真实工作是多轮的：第 1 轮给中间结果，第 2 轮基于它继续，中途还会改需求。
  // 多轮测的不是「能不能算」，而是「能不能保持上下文一致」。
  // ═════════════════════════════════════════════════════════════════════
  {
    id: "F-multiturn-revise",
    kind: "F",
    turns: [
      `从 7 开始，依次执行：
1. × 13
2. + 29
3. × 3
4. − 17
5. ÷ 5（向下取整）

只输出最终数字。`,
      `现在把第 1 步的「× 13」改成「× 15」，其余步骤完全不变，重新算一遍。

只输出最终数字。`,
      `把上一轮的结果再 ÷ 7（向下取整）。

只输出数字。`,
    ],
    answer: "11",
    verify: finalNumber(11),
    note: "多轮改前提。t1=68；t2 用 ×15 重算=77；t3=11。测能否按新前提重算而不是在旧结果上打补丁",
  },
  {
    id: "F-multiturn-restate",
    kind: "F",
    turns: [
      `给定列表 [4, 9, 2, 7, 5]，求其中所有奇数之和。只输出数字。`,
      `把上一轮的结果乘以这个列表里的最大值。只输出数字。`,
      `现在假设列表里的 7 被替换成 6，其余不变。请从第 1 轮重新算到第 2 轮。只输出最终数字。`,
    ],
    answer: "126",
    verify: finalNumber(126),
    note: "多轮重算。t1 奇数 9+7+5=21；t2 21×9=189；t3 列表 7→6 后奇数 9+5=14，max 仍为 9 → 126。测是否真的重算而非复用旧值",
  },
  {
    id: "F-multiturn-distract",
    kind: "F",
    turns: [
      `把 180 元按 2:3:5 的比例分给甲、乙、丙。丙得多少元？只输出数字。`,
      `（顺带一提：明天北京可能下雨，与本问题无关。）
现在把分配比例改为 1:3:5，总额不变。丙得多少元？只输出数字。`,
      `丙比原来多拿了多少元？只输出数字。`,
    ],
    answer: "10",
    verify: finalNumber(10),
    note: "多轮 + 干扰项。t1 丙=90；t2 丙=100；t3 差=10。测无关信息是否会污染上下文",
  },

  // ═════════════════════════════════════════════════════════════════════
  // G 类：长上下文（规则藏在长文中段，必须真正读完）
  //
  // 与 E-digit-count 的区别：E 类测「长文本 + 简单操作」（数数），
  // G 类测「长文本 + 多规则」，规则埋在中段，前后都有无关干扰。
  // 这才是「中段遗忘」的真实形态。
  // ═════════════════════════════════════════════════════════════════════
  {
    id: "G-longctx-rules",
    kind: "G",
    prompt: `${LONG_DOC_HEAD}

## 3 数值加工

3.1 对每个原始数值：若能被 3 整除，则乘 2。
3.2 对每个原始数值：若不能被 3 整除，则保持不变。
3.3 不得对同一数值重复加工两次。

## 4 汇总

4.1 把所有加工后的数值相加，得到 S。
4.2 若 S 为奇数，则减 1；否则不变。
4.3 最终结果只取一个整数，不带单位。

${LONG_DOC_TAIL}

问题：对序列 [5, 9, 14, 21, 8, 33] 按上述规范处理，最终结果是多少？只输出数字。`,
    answer: "152",
    verify: numeric(152),
    note: "长上下文 + 多规则。加工后 [5,18,14,42,8,66]，S=153（奇）→ 152。测能否在长文中定位规则并正确叠加",
  },
  {
    id: "G-longctx-mapping",
    kind: "G",
    prompt: `${LONG_DOC_HEAD2}

## 4 取值规则（本节为准）

4.1 字母取值：A=1, B=2, C=3, D=4, E=5。
4.2 编码串的初始值 = 各字母取值之和。
4.3 若编码串长度为偶数，则初始值乘 2；若为奇数，则加 3。
4.4 若上一步结果大于 20，则减 15；否则不变。
4.5 最后再加上「字母 A 与字母 E 在串中出现的次数之和」。

${LONG_DOC_TAIL2}

问题：编码串 "CBEDA" 按上述规则计算的最终值是多少？只输出数字。`,
    answer: "20",
    verify: numeric(20),
    note: "长上下文 + 规则优先级。初始 15 → 长度 5 奇 → 18 → 不>20 → +2（A、E 各 1 次）= 20。测规则顺序是否被误解",
  },
];

export const taskById = (id) => TASKS.find((t) => t.id === id);

/** 按类型分组（用于实验设计）。 */
export function tasksByKind() {
  const out = { A: [], B: [], C: [], D: [], E: [], F: [], G: [] };
  for (const t of TASKS) (out[t.kind] ??= []).push(t);
  return out;
}

/** 这个任务是不是多轮（有 turns）。 */
export const isMultiTurn = (t) => Array.isArray(t?.turns) && t.turns.length > 0;

/** 取一个任务的首轮 prompt（多轮取第 1 轮）。 */
export function firstPrompt(t) {
  return isMultiTurn(t) ? t.turns[0] : t.prompt;
}


// ---------------------------------------------------------------------------
// 验证器自检 —— 这是实验可信度的地基
// ---------------------------------------------------------------------------

/**
 * 对每个任务的验证器做双向检查：
 *   1. 标准答案必须 pass（否则验证器有 bug，会把正确判成错误）
 *   2. 一组已知错答必须 fail（否则验证器太松，会把错误判成正确）
 *
 * 必须两边都过，实验结论才可信。
 *
 * 为什么要做这件事：第一版就因为逻辑题答案写成 D（正确是 C），
 * 导致模型答对反而被判错，整个结论会反向。
 */
export function selfTest() {
  const wrong = {
    "A-arith-long": ["1", "2", "5261"],
    "A-count-letters": ["2", "1", "4"],
    "A-logic-syllogism": ["A", "B", "D"],
    "A-code-trace": ["18", "3", "30"],
    "B-multistep-money": ["1360", "513", "340"],
    "B-multistep-dependency": ["6", "24", "1"],
    "C-novel-rule": ["10", "1000", "70"],
    "C-novel-rule-2": ["4", "2", "6"],
    // D 类：每个都给出「典型错误答案」
    "D-long-chain": ["343", "4439", "5000"],
    "D-subset-count": ["3", "5", "6"],
    "D-liar-puzzle": ["A=真 B=假 C=真", "A=真 B=真 C=假", "A=假 B=假 C=真"],
    "D-closure-trace": ["808", "710", "18"],
    "D-rule-priority": ["40", "400", "3999"],
    "D-bayes": ["99", "95", "1", "5"],
    // F 类：多轮（典型错误=沿用旧前提的中间结果）
    "F-multiturn-revise": ["68", "77", "9", "70"],
    "F-multiturn-restate": ["21", "189", "195", "14"],
    "F-multiturn-distract": ["90", "100", "60", "6"],
    // G 类：长上下文（典型错误=漏规则/顺序错/取了示例里的数）
    "G-longctx-rules": ["153", "148", "51", "6"],
    "G-longctx-mapping": ["18", "15", "6", "3"],
  };

  const results = [];
  for (const t of TASKS) {
    const pos = t.verify(t.answer);
    const negs = (wrong[t.id] ?? []).map((w) => ({ w, v: t.verify(w) }));
    const falseNeg = !pos.pass;                       // 标准答案被判错
    const falsePos = negs.filter((n) => n.v.pass);    // 错答被判对
    results.push({
      task: t.id,
      ok: !falseNeg && falsePos.length === 0,
      answerAccepted: pos.pass,
      answerReason: pos.reason,
      falseNegatives: falseNeg ? [pos.reason] : [],
      falsePositives: falsePos.map((n) => n.w),
    });
  }
  const bad = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - bad.length,
    bad: bad.length,
    ok: bad.length === 0,
    results,
  };
}

/**
 * 完整自检 = 双向自检 + 历史真实样本回归。
 * 只有两者都过，实验结论才可信。
 */
export async function fullSelfTest() {
  const basic = selfTest();
  const { runFixtures } = await import("./fixtures.mjs");
  const fixtures = runFixtures((id) => TASKS.find((t) => t.id === id));
  return {
    ok: basic.ok && fixtures.ok,
    basic,
    fixtures,
  };
}
