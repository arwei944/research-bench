/**
 * 判分回归测试 —— 用**历史真实输出**验证判分器是否正确。
 *
 * 为什么需要这个：
 *   第一版实验得出「自检有害（-12.5pp）」，但真相是——**模型 12/12 全对，
 *   验证器把 2 次正确答案误判为错误**。原因是它取输出里第一个 A-D 字母，
 *   而模型总会先复述选项 (A)、(B)…
 *
 *   这类 bug 靠人看几千条输出发现不了。必须用「带标注的真实样本」做回归。
 *
 * 本文件的做法：
 *   1. 收集历史上被判 fail 的记录，人工标注其「真实结果」
 *   2. 每次改验证器后，跑一遍这个夹具，确认没有 regression
 *   3. 新发现一条误判，就往夹具里加一条
 *
 * 这是让实验结论可信的唯一办法——**判分器本身也要被测试**。
 */

/**
 * 夹具格式：
 *   task    任务 id
 *   expect  期望判定（true=应该 pass）
 *   why     这条为什么这样标注
 *   out     模型原始输出（截断到关键部分）
 */
export const FIXTURES = [
  // ── 第一版误判案例：模型答对了，但验证器取了第一个字母 ──
  {
    task: "A-logic-syllogism",
    expect: true,
    why: "模型答 C（正确），但推理里先出现 (A)、(B)，旧验证器取了 A",
    out: `## 推理过程

**前提：**
1. A ⊆ B
2. ∃x: B(x) ∧ ¬C(x)
3. C ⊆ A

**逐项验证：**

**(A) 有些 A 是 C？**
- 由前提3知 C ⊆ A，但 C 可能为空集。❌ 不必然成立。

**(B) 有些 B 不是 A？**
- 反例：A = B = {a, b}，C = {a}。❌ 不必然成立。

**(C) 所有 C 都是 B？**
- 传递性：C ⊆ A ⊆ B → C ⊆ B ✓

**C**`,
  },
  {
    task: "A-logic-syllogism",
    expect: true,
    why: "同上，另一种排版",
    out: `## 逐步验证

**(A) 有些 A 是 C？**
- ❌ 不必然成立。

**(B) 有些 B 不是 A？**
- ❌ 不必然成立。

**(C) 所有 C 都是 B？**
- ✅ **必然成立。**

## 答案

**(C)**`,
  },

  // ── D 类：困难任务，正确答案的不同写法必须判对 ──
  { task: "D-long-chain", expect: true, why: "纯数字", out: "200" },
  { task: "D-long-chain", expect: true, why: "带前缀", out: "最终结果是 200" },
  { task: "D-long-chain", expect: false, why: "中途停下的值", out: "4439" },
  { task: "D-subset-count", expect: true, why: "纯数字", out: "4" },
  { task: "D-subset-count", expect: true, why: "带单位", out: "共 4 个" },
  { task: "D-subset-count", expect: false, why: "漏数", out: "3" },
  { task: "D-liar-puzzle", expect: true, why: "标准格式", out: "A=假 B=真 C=假" },
  { task: "D-liar-puzzle", expect: true, why: "英文真假", out: "A=FALSE B=TRUE C=FALSE" },
  { task: "D-liar-puzzle", expect: false, why: "典型错解", out: "A=真 B=假 C=真" },
  { task: "D-closure-trace", expect: true, why: "纯数字", out: "810" },
  { task: "D-closure-trace", expect: false, why: "误以为共享闭包", out: "808" },
  { task: "D-rule-priority", expect: true, why: "纯数字", out: "399" },
  { task: "D-rule-priority", expect: false, why: "漏掉 -mu", out: "400" },
  { task: "D-bayes", expect: true, why: "两位小数", out: "16.67" },
  { task: "D-bayes", expect: true, why: "带百分号", out: "16.67%" },
  { task: "D-bayes", expect: false, why: "忽略先验（最常见错误）", out: "99" },

  // ── 反向案例：真的是错答，必须判 fail ──
  {
    task: "A-logic-syllogism",
    expect: false,
    why: "模型选 A，确实错",
    out: `分析后，我认为答案是 (A)。答案：A`,
  },
  {
    task: "A-logic-syllogism",
    expect: false,
    why: "模型选 D，确实错",
    out: `结论：以上都不必然成立，选 D。`,
  },

  // ── 数值题：正确答案的各种写法都必须判对 ──
  { task: "A-arith-long", expect: true, why: "纯数字", out: "6183" },
  { task: "A-arith-long", expect: true, why: "带解释前缀", out: "答案：6183" },
  { task: "A-arith-long", expect: true, why: "代码块包裹", out: "```\n6183\n```" },
  { task: "A-arith-long", expect: false, why: "错数", out: "5261" },

  { task: "A-count-letters", expect: true, why: "纯数字", out: "3" },
  { task: "A-count-letters", expect: false, why: "常见错误答案", out: "2" },

  { task: "A-code-trace", expect: true, why: "纯数字", out: "15" },
  { task: "A-code-trace", expect: true, why: "带前缀", out: "输出结果是 15" },
  { task: "A-code-trace", expect: false, why: "只算了 sum 忘了减 len", out: "18" },

  { task: "B-multistep-money", expect: true, why: "纯数字", out: "1020" },
  { task: "B-multistep-money", expect: true, why: "带单位", out: "1020 元" },
  { task: "B-multistep-money", expect: false, why: "忘了扣掉花销", out: "1360" },

  { task: "B-multistep-dependency", expect: true, why: "纯数字", out: "3" },
  { task: "B-multistep-dependency", expect: false, why: "算成排列数", out: "6" },

  { task: "C-novel-rule", expect: true, why: "纯数字", out: "100" },
  { task: "C-novel-rule", expect: false, why: "漏了 ze- 的 ×10", out: "10" },

  { task: "C-novel-rule-2", expect: true, why: "纯数字", out: "8" },
  { task: "C-novel-rule-2", expect: false, why: "-su 作用域搞错", out: "4" },

  // ── F 类（多轮）：末轮输出里常带前面轮次的中间结果，必须只看末位数字 ──
  {
    task: "F-multiturn-revise",
    expect: true,
    why: "模型复述了 t1=68、t2=77，末位才是 11（若用「任意数字命中」会误判）",
    out: `第 1 轮结果是 68。\n第 2 轮改成 ×15 重算，得到 77。\n第 3 轮 77 ÷ 7 = 11。\n\n11`,
  },
  { task: "F-multiturn-revise", expect: true, why: "纯末位数字", out: "11" },
  { task: "F-multiturn-revise", expect: false, why: "停在 t1 的结果（没按新前提重算）", out: "68" },
  { task: "F-multiturn-revise", expect: false, why: "停在 t2 的结果（忘了最后一轮）", out: "77" },

  {
    task: "F-multiturn-restate",
    expect: true,
    why: "复述 t1=21、t2=189，末位 126 是重算后的正确值",
    out: "第一轮奇数和 21；第二轮 21×9=189；把 7 换成 6 后重算：奇数和 14，14×9=126。\n126",
  },
  { task: "F-multiturn-restate", expect: false, why: "直接复用旧结果没重算", out: "189" },
  { task: "F-multiturn-restate", expect: false, why: "重算了奇数但忘了乘最大值", out: "14" },

  { task: "F-multiturn-distract", expect: true, why: "带干扰句后的正确末位", out: "丙原 90，新 100，多拿 10。\n10" },
  { task: "F-multiturn-distract", expect: false, why: "把「多拿多少」答成了新值", out: "100" },
  { task: "F-multiturn-distract", expect: false, why: "停在第一轮的值", out: "90" },

  // ── G 类（长上下文）：规则在中段，典型错误是漏规则或顺序错 ──
  { task: "G-longctx-rules", expect: true, why: "纯数字", out: "152" },
  { task: "G-longctx-rules", expect: true, why: "带推理前缀", out: "加工后为 [5,18,14,42,8,66]，S=153，奇数减 1 得 152" },
  { task: "G-longctx-rules", expect: false, why: "忘了奇偶判定那一步", out: "153" },
  { task: "G-longctx-rules", expect: false, why: "只把被 3 整除的乘了但漏了某些项", out: "51" },

  { task: "G-longctx-mapping", expect: true, why: "纯数字", out: "20" },
  { task: "G-longctx-mapping", expect: true, why: "分步说明", out: "初始 15 → 长度 5 为奇 → 18 → 不大于 20 → 加 A/E 共 2 次 → 20" },
  { task: "G-longctx-mapping", expect: false, why: "长度奇偶搞反（当偶数乘 2）", out: "30" },
  { task: "G-longctx-mapping", expect: false, why: "漏了 4.5 那一步", out: "18" },
];

/**
 * 跑夹具回归。
 * @param {(taskId:string)=>object|null} getTask 取任务定义（提供 verify）
 */
export function runFixtures(getTask) {
  const results = [];
  for (const fx of FIXTURES) {
    const task = getTask(fx.task);
    if (!task) {
      results.push({ ...fx, got: null, ok: false, reason: "任务不存在" });
      continue;
    }
    let v;
    try {
      v = task.verify(fx.out);
    } catch (e) {
      results.push({ ...fx, got: null, ok: false, reason: `验证器抛错: ${e.message}` });
      continue;
    }
    results.push({
      task: fx.task,
      expect: fx.expect,
      got: !!v.pass,
      ok: !!v.pass === fx.expect,
      reason: v.reason,
      why: fx.why,
    });
  }
  const bad = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - bad.length,
    failed: bad.length,
    ok: bad.length === 0,
    failures: bad,
    results,
  };
}

/** 只在开发时用的快速自检：把夹具结果打印成表。 */
export function formatFixtureReport(report) {
  const lines = [];
  lines.push(`判分回归：${report.passed}/${report.total} ${report.ok ? "✅ 全部通过" : `❌ ${report.failed} 项失败`}`);
  for (const f of report.failures) {
    lines.push(`  ✗ ${f.task}: 期望 ${f.expect ? "pass" : "fail"}，得到 ${f.got === null ? "错误" : f.got ? "pass" : "fail"}`);
    lines.push(`    标注原因：${f.why}`);
    lines.push(`    验证器说：${f.reason}`);
  }
  return lines.join("\n");
}
