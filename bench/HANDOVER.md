# 交接文档

> 日期：2026-10-27（**第三轮**：大模型词汇课程并入 learn，改为多课程结构）
> 状态：**服务运行中**，全量验证通过
> 本文给接手的人（或三个月后的自己）一份能快速上手的完整交代。

> **第三轮做了什么，一句话**：把大模型工程术语做成**带前置门禁的课程**，
> 用「三种追问」判定真懂，通过后写入 kernel 形成闭环，并**并入现有 learn 应用**（多课程结构）。
> 101 词 · 163 条追问 · 依赖图无环。详见第十六节与 `apps/learn/README.md`。
>
> **上一轮（第二轮）**：F/G 任务类 + 校准 + 因果链 + kit 迁移。
> 诚实结论：**F/G 类也饱和了（20/20 全过）**。详见第十四节。

---

## 一、这是什么

一个**个人研究工作台**，用一条流水线把「研究 → 结论 → 证据 → 实验 → 复习」连起来。

核心不是"工具集合"，而是三件事：

1. **结论必须有证据才能升级**（状态是推导的，不是手填的）
2. **证据必须过判分闸门才可信**（判分器本身被测试）
3. **能力降级必须可见**（不静默失败）

零依赖：只用 Node 内置模块（≥20）+ curl。不需要 `npm install`。

---

## 二、当前状态（可验证）

```
服务：http://127.0.0.1:7800    PID 27156    内存 97MB
状态：healthy（刚启动）/ degraded（跑过慢通道后会出现「N 次慢请求」）
闭环：✓ 成立（结论9 / 证据10 / 实验11 / 产物6）
```

| 检查项 | 结果 |
|---|---|
| 页面 | 全 200（首页三 Tab + `/designs` + **7 个应用**） |
| API | 14/14 全 200 |
| 能力层 | llm=ok · search=ok · evaluator=ok |
| 判分闸门 | ✅ 通过（双向自检 **25/25** · 样本回归 **56/56**） |
| 任务集 | **25 道**（A4 B2 C2 D6 E6 **F3 G2**） |
| 配置集 | **7 个**（含新增 `calibration` 置信度校准） |
| 数据健康 | 孤立结论 0 · 未过闸门实验 0 |
| 应用 | **8 个**，后端异常 0 |

> **关于 status=degraded**：只要打过 `GET /api/research/channels`（14 条外部通道探活），
> 就会累积一条「N 次慢请求（>2000ms）」。这是**真实性能特征，不是故障**——
> 14 个外部 API 串行探测本来就要 1~13 秒。重启服务即恢复 healthy。


## 三、启动与停止

```bash
cd C:/work/newmax/研究智能体

node bench/bench.mjs start --open   # 启动并打开浏览器
node bench/bench.mjs status         # 状态
node bench/bench.mjs stop           # 停止
node bench/bench.mjs restart        # 重启
node bench/bench.mjs logs           # 看日志
```

**三个关键入口**：

| 地址 | 用途 |
|---|---|
| `http://127.0.0.1:7800/` | 首页：分层视图 + 依赖图 + 应用管理 |
| `http://127.0.0.1:7800/#health` | **体检**（首页 Tab）：闭环 / 问题清单 / 观测 / 慢请求 |
| `http://127.0.0.1:7800/#kernel` | **知识层**（首页 Tab）：结论 + 证据链 + 知识库 + 技能 |

> 旧地址 `/status` `/kernel` 已 302 重定向到对应 Tab。

---

## 四、架构地图

### 4.1 内核（L0）

```
kernel/
├── entities.mjs   206 行  四实体定义 + 状态推导 + 闸门检查
├── store.mjs      189 行  文件存储 + 事件流 + 健康统计
├── observe.mjs    193 行  请求追踪 + 指标聚合 + 慢请求日志
└── index.mjs      252 行  门面层（应用唯一该 import 的入口）
```

**四种实体**（存在 `bench/data/kernel/`）：
| 实体 | 定义 | 谁产生 |
|---|---|---|
| **Artifact** | 原始产物（报告正文） | research |
| **Claim** | 可核验的断言 | research（抽「结论速览」）/ labset（自动） |
| **Run** | 带配置的执行记录 + 闸门状态 | labset |
| **Evidence** | 支撑 Claim 的证据 | 自动生成 |

**门面用法**（应用不该直接碰 store/entities）：

```js
import { bench } from "../../kernel/index.mjs";

bench.claim.create({ text })
bench.claim.attachEvidence(id, { kind:"run", refId, tier:"A", strength:3 })
bench.run.record({ task, config, model, result, gate })
bench.dashboard()   // 一屏数据

// 新增：因果上下文（第二轮）
bench.withCause({ by:"labset", reason:"experiment", refId: runId }, () => {
  bench.run.record({...});      // 这些写入的事件都会带 causedBy
  bench.claim.create({...});
});
bench.trace("claim", claimId);  // 反查：这条结论是被什么造成的
```

### 4.2 能力层（L1）

```
lib/capabilities/
├── llm.mjs        169 行  LLM 调用（统一超时/统计/错误格式）
├── search.mjs     425 行  14 通道检索 + 中文扩展 + 相关性 + 去重 + 引用核验
├── evaluator.mjs  134 行  判分器注册 + 双向自检 + 样本回归 + 闸门
├── degrade.mjs    181 行  降级契约（统一降级规则 + 影响面推导）
└── index.mjs       17 行  统一出口
```

**为什么要有这一层**：改造前 LLM 调用在三个地方各写一遍（research/labset/learn），
判分逻辑绑在 labset 里。现在统一：

```js
import { llm, search, evaluator, degrade } from "../../lib/capabilities/index.mjs";
```

### 4.3 实验器的任务分类（第二轮重点）

```
A 单点能力（4）   算术/数数/形式逻辑/代码追踪 —— 测能力天花板
B 多步推理（2）   一步错全错 —— 测颗粒度效应
C 上下文学习（2） 虚构语言规则 —— 测能否吸收 prompt 里的新规则
D 困难（6）       长链/穷举/骑士骗子/闭包/规则优先/贝叶斯
E 高难（6）       逐字计数/多约束/嵌套分支/反事实/规则链/量词否定
F 多轮（3）★新    后一轮依赖前一轮，中途改前提/加干扰 —— 测上下文一致性
G 长上下文（2）★新 规则埋在长文中段，前后有干扰 —— 测中段遗忘
```

**F 类的实现要点**（`tasks.mjs` 的 `turns` 字段 + `runner.mjs`）：

- 任务用 `turns: [p1, p2, p3]` 声明多轮，**不用 `prompt`**
- 运行器按轮累积对话历史（`messages` 数组逐轮追加 user/assistant）
- **只判末轮**——因为末轮才是任务的最终交付
- 验证器必须用 `finalNumber()` 而非 `numeric()`：模型常在末轮复述前几轮的中间结果，
  `numeric()` 的「任意一个数字命中」会把中间结果误判为正确（**这个 bug 真的发生过**，见下）
- 配置因子分两类：**结构类**（scaffold/selfcheck）只作用于首轮；
  **格式类**（formatNudge/calibration）必须作用于每一轮，否则末轮输出不可解析

### 4.4 应用（8 个，分 4 层）

| 层 | 应用 | 说明 |
|---|---|---|
| L0 平台 | `shell` | 平台自述（路由分发流程可视化） |
| L1 基础 | `mode` | 专家/小白模式并排演示 |
| L1 基础 | `design-system` | 10 款外壳设计的 token 卡片 |
| L2 应用 | `labset` ⚗ | 实验器：任务 × 配置 × 客观判分 + 可视化 |
| L2 应用 | `research` 🔬 | 研究：14 通道检索 → 核验 → 报告 → Claim |
| L2 应用 | `learn` 🎓 | **学习（多课程）**：计算理论（λ 演算/类型论）+ **大模型（101 词/前置门禁/追问）** + 间隔复习 + 苏格拉底 |
| L3 实验 | `scratchpad` ◇ | 实验层示例 |

**依赖规则**（`lib/layers.mjs` 强制检查，违规在 UI 红字标出）：
```
L0 不依赖任何层 · L1 只能依赖 L0 · L2 只能依赖 L0/L1 · L3 不受限
```

### 4.5 learn 的多课程结构（第三轮改造）

**改造前**：`learn` 只讲计算理论（λ 演算/类型论/SK/单子），13 节点 25 卡。
**改造后**：两门课共用一套复习、追问、笔记与 kernel 闭环。

| 课程 | 类型 | 规模 | 特色 |
|---|---|---|---|
| `compute` 计算理论 | graph | 4 轨 · 13 节点 · 25 卡 | 可执行笔记本（真跑 λ 归约）、苏格拉底 |
| `llm` 大模型 | terms | 10 层 · **101 词 · 163 追问** | **前置门禁、三种追问判真懂、实验互通** |

**为什么合成一个应用**：复习是同一个行为。分两个应用会导致「今天该复习什么」要跑两个地方。
共用一个 `srs.json`，id 命名空间天然隔离（`c-*`/`n-*` vs `t-*`）。

**导航随课程变化**：
- 计算理论：实验室 · 概念地图 · 间隔复习 · 苏格拉底 · 笔记
- 大模型：词条地图 · 追问测验 · 间隔复习 · 笔记
- **间隔复习是两门课合并的队列**（逾期优先，新卡次之），每张卡标课程来源

```
apps/learn/
├── content/courses.json          课程清单（2 门）
├── content/curriculum.json       计算理论：4 轨 13 节点
├── content/cards/core.json       计算理论：25 卡
├── content/llm/layers.json       大模型：10 层
├── content/llm/terms/L1..L10.json 大模型：101 词 + 163 追问
├── lib/srs.mjs                   SM-2（两门课共用）
├── lib/terms.mjs                 大模型：加载 / 图校验 / 掌握度 / 前置门禁
├── lib/probe.mjs                 大模型：追问判定（LLM + 关键词降级）
└── server.mjs                    /llm/* 全部路由并入
```

**三个机制**：

| 机制 | 做法 | 理论依据 |
|---|---|---|
| 前置门禁 | 前置词没 mastered → 该词锁住，不进复习队列、追问返回 409 | arXiv:2508.11892（学生无法识别自己缺什么前置） |
| 三种追问 | 对比 / 反事实 / 应用，只判 shallow/partial/deep，不给答案 | arXiv:2610.22949（cave detection：换个变量还能站得住才算懂） |
| Claim 闭环 | 通过深度追问 → 写 kernel Claim（tier **D**） | 与 bench 的 pass^k 同一思想 |

**掌握度规则（刻意严格）**：
```
new      → 没学过
learning → 复习过但没通过深度追问（counterfactual / application）
mastered → SM-2 连续答对 ≥2 且 lapses=0 且 通过 ≥1 条深度追问
```

**闭环的诚实性设计**：学习证据固定为 **D 级（个人推断）**，按 `deriveStatus` 规则
**永远不能升到 supported**。实测验证：`clm_d41154c6` 状态为 `draft`。
这是刻意的——`supported` 只留给 A 级（可执行验证）与 B 级（多源交叉）。
「我学过」≠「这是事实」。

**实验互通（`/llm/bridges`）**：把 labset/research 的真实实测结论映射到术语，
用用户自己的数据当教材。匹配不到真实 Claim 时明确标注「这是预置教学案例」，不假装有证据。

### 4.6 前端

```
public/
├── shell.html    1075 行  外壳（标签栏 + iframe + 应用管理 + 依赖图 + 设计切换器）
├── status.html    267 行  体检页
├── kernel.html    242 行  知识层（事件流现在显示 causedBy）
├── designs.html   457 行  设计选择
└── kit.js         346 行  公共前端套件（主题/模式/API/Markdown）
```

**kit.js 覆盖情况（第二轮后）**：

| 应用 | 用 kit.js | 说明 |
|---|---|---|
| labset | ✅ | 一开始就用 |
| learn | ✅ | 一开始就用 |
| research | ✅ **第二轮迁移** | 删了自带 md()/esc()/主题/模式共约 130 行重复代码 |
| kernel / status 页 | ✅ | 平台页 |
| shell / mode / design-system / scratchpad | ❌ | 纯静态展示页，没有 API 调用，迁移收益低，**刻意不迁** |

---

## 五、三个核心机制

### 5.1 闭环（自动，不需要人工写报告）

```
跑实验 → Run(带闸门) → 自动生成 Claim → 挂 A 级证据 → supported → 复习卡 → 置信度回写
```

**关键设计**：实验只对有信息量的结果生成断言。

| 任务状态 | 生成 Claim？ | 理由 |
|---|---|---|
| pass@1=100% + zone=safe | ❌ | 没信息量，不该当结论记 |
| pass@1 < 99% | ✅ | 有区分度 |
| zone=cliff (>80s) | ✅ | 有风险信号 |

**实测**：跑 `E-digit-count` 后自动产出
```
[supported/1证] 任务「E-digit-count」在基线配置下 pass@1 为 50%（1/2）
```

### 5.2 判分闸门（系统可信度的地基）

**背景**：第一版实验得出「自检有害 -12.5pp」，真相是**模型 12/12 全对，验证器把 2 次正确答案误判成错误**（它取了输出里第一个 A-D 字母，而模型推理时总会先复述选项）。

修正后结论完全反转。**如果没有肉眼核对失败样本，这个错误结论会被当成"发现"记录。**

**现在的机制**：

```js
const g = evaluator.gate("labset", WRONG_ANSWERS);
// g.passed = selfTest.ok && regression.ok
```

- **双向自检**：标准答案必须通过 / 已知错答必须被拒（20/20）
- **样本回归**：38 条带标注的历史真实输出必须判定稳定
- **闸门**：未通过时 `POST /api/labset/run` **拒绝跑实验**
- **证据标记**：指向未过闸门 Run 的证据会被标红 `warning`，不可升级为 supported

### 5.3 降级契约（L1 挂了 L2 怎么办）

```
能力状态              应用行为
ok                   正常返回
degraded             返回结果 + degraded 标记 + 原因
unavailable          返回兜底结果或明确报错
```

三条硬性要求：**降级必须可见**（返回体有 `degraded:true` + `reason`）、
**必须可查**（`/api/_platform/capabilities`）、**不能静默**（写事件流）。

实测：

```json
{"status":"unavailable",
 "capabilities":[{"name":"llm","status":"unavailable","reason":"ECONNREFUSED 127.0.0.1:9999"},
                 {"name":"search","status":"degraded","reason":"This operation was aborted"}],
 "impact":{"llm":["research（报告生成降级为仅检索）","learn（教练降级为内置问题链）","labset（实验无法运行）"]}}
```

---

## 六、关键决策与踩过的坑

### 6.1 用 curl 而不是 Node fetch

**原因**：本机走 HTTP 代理，Node 的 undici 只在**进程启动时**读 `NODE_USE_ENV_PROXY`，
运行时设置无效，且子进程场景偶发 `fetch failed`。

**结果**：改用 curl 子进程后，通道可用率从 9/14 稳定到 13/14。

### 6.2 通道探测必须限并发

**实测数据**（同样的 14 个通道）：

| 并发 | 可用数 |
|---|---|
| 14（全并发） | 5/14 |
| 4 | 7/14 |
| **2** | **13/14** |

**结论**：并发 2 是真实上限，不是 bug。`probeAll(concurrency=2)` 是默认值。

### 6.3 双重 spawnSync 导致 PID 错位（曾导致服务"莫名消失"）

**现场**：`bench.mjs` 启动 server.mjs（PID A）→ server 自己 spawnSync 重启（PID B，真正监听）。
pid 文件记的是 A，`stop` 杀不掉 B，B 占着端口，下次启动被迫换端口。

**修法**：干掉自我重启，改由 `bench.mjs` 启动时注入环境变量。
`stop` 改为**按端口查真实监听者**，并按 PID 记录校正。

### 6.4 heredoc 会吃掉 `\n`（反复踩了 3 次）

写含转义的 JS 到 heredoc 里，`\n` 会先被 shell 解释，导致 `split("\n")` 变成 `split("<换行>")`。

**规范：写含转义的 JS 代码，一律用文件（write 工具），不用 heredoc。**

### 6.5 端口语义：`activeRound` 与目录名的关系

应用目录名必须与 `app.json` 的 `id` 一致，否则 `rm` 会删错目录。

### 6.6 E-digit-count 的真正教训

加了两批共 12 道困难题，**11 道仍然 100% 通过**。

唯一有区分度的 `E-digit-count`（301 位数字里数 9）：

| 尝试 | 结果 | 耗时 |
|---|---|---|
| 1 | ✓ PASS | 82s |
| 2 | ✗ 超时 | 120s |
| 3 | ✗ 超时 | 120s |
| 4 | ✓ PASS | 109s |
| 5 | ✗ 超时 | 120s |

**pass@1 = 40%，pass^5 = 0%。失败全是超时，没有一条是算错。**

> **教训：难度 ≠ 长度。** 模型能处理极难的短推理，但处理不了长的（即使每步都简单）。
> 下一步不该继续加更难的题，而应加**需要更长时间的任务**并测 pass^k。

---

## 七、三条可直接用的操作规范（从实验得出）

1. **单次任务控制在 30 秒内完成** —— 超过 80 秒进入高风险区
2. **验收用 pass^k（k≥3）而非 pass@1** —— pass@1=90% 听起来好，pass^5 只有 59%
3. **区分失败类型**：超时要切分任务，算错要改提示，两者处理方式完全不同

---

## 八、技术债状态

按严重程度排序（上次交接列的 6 条）：

| # | 债务 | 状态 | 说明 |
|---|---|---|---|
| 1 | 没有 L1 能力层的真实抽象 | ✅ **已完成** | `lib/capabilities/` 五个模块，LLM 调用从三处统一到一处 |
| 2 | 分层约束不生效于运行时 | ✅ **已完成** | `degrade.mjs` 降级契约 + 能力状态上报 + 影响面推导 |
| 3 | 只有 2/7 应用用 kit.js | ✅ **本轮完成** | research 已迁（删约 130 行重复）；剩下 4 个是纯静态页，**刻意不迁** |
| 4 | 概念地图/苏格拉底未接 kernel | ⏳ 未做 | 学习产出不进知识层 |
| 5 | 事件流无因果 | ✅ **本轮完成** | `causedBy` + `bench.withCause()` + `bench.trace()` |
| 6 | 无并发保护 | ⏳ 未做 | 单用户场景可接受 |

**新增的债**：

| # | 债务 | 影响 |
|---|---|---|
| 7 | `apps/labset/lib/` 与 `lib/capabilities/` 有部分职责重叠 | 任务集仍在应用侧，未抽成通用能力 |
| 8 | `search.mjs` 425 行偏大 | 可拆成 transport / sources / rank 三个文件 |
| 9 | **F 类多轮任务的配置因子归因是近似值** | 结构类因子只作用首轮，严格讲这已经不是「只改一个变量」，跨轮交互无法拆开 |
| 10 | 任务集开始饱和（25/25 里 20 道 100%） | 再加同类题意义不大，需要换测量方式而不是换题 |

---

## 九、下一步建议（按优先级）

### 优先级 0（本轮新结论）：不要再加题了

本轮按上一轮建议加了 F（多轮）与 G（长上下文）共 5 道题，结果 **20/20 全过**。
连「中途改前提」「规则埋在中段」都没难住它。

**结论：问题不在题目类型，而在任务时长。**
唯一产生区分度的仍然是 `E-digit-count`——它是**唯一一道需要逐字处理 300 位数字**的题，
失败全部是**超时**（不是算错）。

### 优先级 1：把「时长」做成可控制的实验变量

现在的 `repeats` / `zone` 只是被动观察。下一步应该：

- **可调的 token 预算**：同一道题，限制 `max_tokens`，看质量如何随预算下降
- **可调的轮数**：F 类任务加长到 10 轮，看第几轮开始崩塌（现在 3 轮太短）
- **可调的超时线**：同一题在 60s / 120s / 300s 下分别测，画出真实的悬崖曲线

### 优先级 2：校准需要「不会做的题」才有信号

本轮 ECE 实测 0.0157（看起来很好），但 `caveat` 字段如实指出：
**样本里没有任何错答**。模型只在自己会做的题上自评 98% 且真的对。

要得到有意义的 ECE，必须构造**模型大概率做错**的任务（或人为降预算），
否则校准指标永远是「优秀」——这是一种**假阳性**。

### 优先级 3：把「可靠性」做成实验器默认视角

已部分完成（UI 已显示 pass^k、失败分类、悬崖区警示）。可继续：
- 自动计算「建议的任务颗粒度」
- 累积多次运行，看可靠性是否随模型版本变化

### 优先级 4：补齐技术债 4 和 6

剩下两条都不是紧急项。`#4 学习产出接 kernel` 可以接，但优先级低；
`#6 并发保护` 单用户场景可接受。

### 优先级 5：清理零数据应用

`scratchpad` 是示例，`shell`/`mode`/`design-system` 是脚手架自述页。
如果不再需要它们的存在感，可以合并成一个「设置」应用。

---

## 十、怎么验证系统是好的

三条命令，都能在 1 分钟内跑完：

### 检查 1：门面隔离成立

```bash
cd C:/work/newmax/研究智能体
grep -rn "kernel/store\|kernel/entities" bench/apps/*/server.mjs
# 期望：无输出
```

### 检查 2：闭环成立 + 无问题

```bash
curl -s http://127.0.0.1:7800/api/_platform/status | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    console.log('闭环:', j.loop.closed);
    console.log('问题:', j.issues.length ? j.issues : '无');
  })"
# 期望：闭环 true，问题清单为空（或只有「N 次慢请求」这类真实性能特征）
```

### 检查 3：判分闸门通过

```bash
curl -s http://127.0.0.1:7800/api/labset/selftest | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    console.log('闸门:', j.ok, '| 双向', j.basic.passed+'/'+j.basic.total,
                '| 回归', j.fixtures.passed+'/'+j.fixtures.total);
  })"
# 期望：闸门 true，双向 25/25，回归 56/56
```

### 检查 4：多轮任务真的走了多轮

```bash
curl -s http://127.0.0.1:7800/api/labset/tasks | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    const m=j.tasks.filter(t=>t.turns);
    console.log('多轮任务:', m.map(t=>t.id+'('+t.turns.length+'轮)').join(', '));
    console.log('分类:', JSON.stringify(j.byKind));
  })"
# 期望：3 道 F 类各 3 轮；byKind 包含 F 和 G
```

### 检查 5：因果链成立

```bash
curl -s http://127.0.0.1:7800/api/_platform/kernel | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    const withCause=j.events.filter(e=>e.causedBy);
    console.log('带因果的事件:', withCause.length+'/'+j.events.length);
    console.log(JSON.stringify(withCause.slice(0,2).map(e=>e.causedBy),null,1));
  })"
# 期望：至少有几条带 causedBy（新写入的 Run/Evidence 都有）
```

### 检查 6：校准指标可用

```bash
curl -s http://127.0.0.1:7800/api/labset/runs/2026-10-26T18-17-22-894Z | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d);
    console.log('ECE:', j.summary.calibration.ece, '| n:', j.summary.calibration.n);
    console.log('盲区:', j.summary.calibration.coverage.blindSpot || '无');
    console.log('局限:', j.summary.calibration.caveat || '无');
  })"
# 期望：能读出 ECE，且 blindSpot/caveat 如实披露（这正是设计意图）
```

---

## 十一、文档索引

| 文件 | 内容 |
|---|---|
| `README.md` | 总览、启动、核心架构 |
| `ARCHITECTURE.md` | **设计**方案（最初的想法） |
| `ARCHITECTURE-V2.md` | **实现现状**（vs 设计的差异，技术债） |
| `DELIVERY.md` | 交付报告（含 6 道困难任务的完整记录） |
| `apps/labset/DIAGNOSIS.md` | 为什么 20 道题全过 —— 实验设计诊断 |
| `apps/learn/README.md` | **learn 多课程文档**（两门课、判定规则、API、验证清单） |
| **`HANDOVER.md`** | **本文件**（交接） |
---

## 十二、常见操作

```bash
# 跑一轮实验
curl -X POST http://127.0.0.1:7800/api/labset/run \
  -H "Content-Type: application/json" \
  -d '{"tasks":["D-liar-puzzle"],"configs":["baseline"],"repeats":3}'

# 跑多轮任务（F 类）
curl -X POST http://127.0.0.1:7800/api/labset/run \
  -H "Content-Type: application/json" \
  -d '{"tasks":["F-multiturn-revise"],"configs":["baseline"],"repeats":2}'

# 测校准（必须用 calibration 配置）
curl -X POST http://127.0.0.1:7800/api/labset/run \
  -H "Content-Type: application/json" \
  -d '{"tasks":["D-bayes","E-constraint-perm"],"configs":["calibration"],"repeats":2}'

# 反查一条结论的因果链
curl -s "http://127.0.0.1:7800/api/labset/kernel/trace?type=claim&id=clm_xxxx" | node -e "..."

# 存一份报告（会自动抽出 Claim）
curl -X POST http://127.0.0.1:7800/api/research/report/save \
  -H "Content-Type: application/json" \
  -d '{"title":"标题","markdown":"# 报告\n\n## 结论速览\n\n1. 结论一\n2. 结论二"}'

# 查知识层
curl -s http://127.0.0.1:7800/api/_platform/kernel | node -e "..."

# 建新应用
node bench/bench.mjs new my-app --name "我的应用" --icon "🔧" --template api

# 删除应用
node bench/bench.mjs rm my-app --force
```

---

## 十三、一句话总结

> 这个系统的价值不在于功能多少，而在于**它知道自己什么时候不可信**——
> 结论必须挂证据才能升级，证据必须过闸门才算数，能力降级必须显示出来。
>
> 下一步的重点不是加功能，而是**让它跑满一段时间，用真实使用来检验这套机制**。

---

## 十四、本轮（第二轮）交付与诚实结论

### 14.1 做了什么

| # | 内容 | 验证 |
|---|---|---|
| 1 | **F 类：多轮任务 3 道**（改前提重算 / 中途换数据重算 / 夹无关干扰） | 闸门通过，实测 20/20 全过 |
| 2 | **G 类：长上下文 2 道**（规则埋在长文档中段，前后有干扰） | 闸门通过，实测 20/20 全过 |
| 3 | **运行器支持多轮**（`turns` 逐轮累积、只判末轮、usage 累计、失败轮定位） | 实测 3 轮 × 多任务正常 |
| 4 | **校准测量（ECE + Brier + 分箱）**，新增 `calibration` 配置 | ECE=0.0157（含 caveat 披露） |
| 5 | **技术债 #5：事件流因果**（`causedBy` + `withCause()` + `trace()`） | 实验写入的 Run 已带因果 |
| 6 | **技术债 #3：research 迁到 kit.js**（删约 130 行重复代码） | 页面 200，md 渲染回归通过 |
| 7 | **实验器 UI**：单轮/多轮对比、失败轮定位、校准区块、范围选择器 | 页面 200，无语法错 |

### 14.2 三个必须诚实说的结论

**① F/G 类也饱和了 —— 加题型没有解决问题**

| 任务类 | 本轮实测 |
|---|---|
| F 多轮（3 道 × 2 配置 × 2 重复 = 12 次） | **12/12 全过** |
| G 长上下文（2 道 × 2 配置 × 2 重复 = 8 次） | **8/8 全过** |
| 合计 | **20/20，pass@1 = 100%，passK = 100%** |

上一轮说「该加多轮和长上下文」，这一轮加了，**结果仍然测不出差异**。

**真正的区分变量仍然是时长**：F 类虽然全过，但 `F-multiturn-revise` 最慢一次 **107.6s**、
`F-multiturn-distract` 最慢 **104.4s**——都已进入悬崖区（>80s）。
只要再长一点，就会像 `E-digit-count` 一样开始超时。

> **教训升级版**：不是「难度 ≠ 长度」，而是「**只要还在单次能力范围内，什么题型都测不出差异**」。
> 唯一能测出的是「它会不会超时」。

**② 校准指标目前是假阳性**

ECE = 0.0157、Brier = 0.0006，看起来「校准良好」。但代码里会主动吐出两个警告：

```
caveat: "样本里没有任何错答——ECE 只证明了「会做的题上自信」，
         没有测到「不会做时是否也知道」"
coverage.blindSpot: "1 条超时/错误样本没有置信度，ECE 看不到它们——
                     这部分风险不在校准指标里"
```

这是刻意设计的：**不让指标漂亮得误导人**。要得到有意义的 ECE，必须先有「模型大概率做错」的样本。

**③ 一个真实 bug 被回归夹具拦下了**

第一版校准实验里，`F-multiturn-restate` 模型**答对了**（末轮输出 126），
却因为末轮复述了前面的 `100`（另一题的中间值）而被 `numeric()` 判错。

修法：为多轮任务引入 `finalNumber()`（只比较**最后一个**数字），并补了 10 条 F/G 回归夹具。
这正好复现了上一轮记录的那个教训——**判分器本身必须被测试**。

### 14.3 当前数据快照

```
任务集：25 道（A4 B2 C2 D6 E6 F3 G2）
配置集：7 个（baseline / scaffold / selfcheck / format / scaffold+check / all / calibration）
闸门：双向 25/25 · 回归 56/56
闭环：true（结论9 / 证据10 / 实验11 / 产物6）
已知有区分度的任务：E-digit-count（pass@1 ≈ 40~50%，失败全部为超时）
```

### 14.4 留给下一轮的真问题

1. **怎么把「时长」变成可控变量？**（而不是被动等超时）
   建议：限制 `max_tokens`、把 F 类加长到 10 轮、同一题在 60/120/300s 三档超时下分别测。
2. **怎么造出模型大概率做错的任务？**（否则 ECE 永远是假的优秀）
3. **多轮任务的配置归因怎么才算严谨？**（现在结构类因子只作用首轮，严格讲已不是单变量实验）

---

## 十五、本轮新增/修改文件清单

```
apps/labset/lib/tasks.mjs      + F 类 3 道、G 类 2 道、finalNumber()、长文档常量、isMultiTurn/firstPrompt
apps/labset/lib/runner.mjs     多轮执行、usage 累计、失败轮定位、calibration() ECE 计算、turnBreakdown
apps/labset/lib/configs.mjs    calibration 因子、parseConfidence()、everyTurn 区分（结构类 vs 格式类）
apps/labset/lib/fixtures.mjs   + 18 条 F/G 回归夹具（共 56 条）
apps/labset/server.mjs         因果上下文包裹、WRONG_ANSWERS 补 F/G、/kernel/trace、tasks 返回 turns
apps/labset/public/index.html  单轮/多轮对比、失败轮定位、校准区块、实验范围选择器、kind 配色 F/G
kernel/store.mjs               causedBy / withCause() / traceOf()
kernel/index.mjs               透传 causedBy、暴露 bench.trace / bench.withCause
public/kernel.html             事件流显示因果来源
public/kit.js                  md() 支持裸 URL 自动链接
apps/research/public/index.html 迁移到 kit.js（删 md/esc/主题/模式共约 130 行）
HANDOVER.md                    本文件
```

---

## 十六、第三轮：大模型词汇课程（并入 learn）

### 16.1 任务来源

用户要求：「进行关于大模型的词汇以及原理和理论知识的学习，先调研再定方案，需要与现有的工作台实现闭环。」

**过程说明（诚实记录）**：第一版实现成了独立应用 `llm-lab`，用户随后明确
「我需要的是统一进现有的工作台」。于是把内容与机制**全部并入 `learn`**，
改造为多课程结构，并删除 `llm-lab`。应用数从 8 回到 7。

### 16.2 调研产出

| 产出 | 位置 |
|---|---|
| 完整术语清单（10 层 230 词，分级 ★/☆/·） | `../knowledge-base/learning/2026-10-27-大模型词汇与原理-术语清单调研.md` |
| 应用文档 | `apps/learn/README.md` |

**调研方法论（9 条，全部经 arXiv 核验）**：

| 方法 | 论文 | 对设计的直接影响 |
|---|---|---|
| 前置知识追踪 | arXiv:2508.11892 (RPKT) | → **前置门禁**是核心机制，不是可选功能 |
| 苏格拉底提问 | arXiv:2610.22949 | → 核心指标是 **cave detection**：换个变量还能站得住才算懂 |
| LLM 误解分类学 | arXiv:2608.20421 | → 词条必须带「为什么重要」，不是只给定义 |
| 自我解释忠实性 | arXiv:2609.17119 | → 模型自解释不可信，所以追问判定要标注 `source`/`degraded` |
| 交互式闪卡（17 种） | arXiv:2607.25096 | → 传统「翻面+自评」太贫乏，但也不堆交互，只加**追问**一种 |
| 概念级间隔重复 | arXiv:2508.03275 (LECTOR) | → 按概念而非卡片调度 |
| 教中学 | arXiv:2610.17860 | → 留待第二期 |

### 16.3 第一期交付

```
10 层 · 101 个 ★ 必会词 · 163 条追问
依赖图：101 节点 / 84 条边 / 0 环 / 0 悬空引用
根节点 15 个 · 被前置锁住 86 个
```

| 层 | 词数 | 追问 |
|---|---|---|
| L1 分词与表示 | 7 | 12 |
| L2 架构 | 15 | 21 |
| L3 预训练 | 12 | 18 |
| L4 后训练与对齐 | 11 | 17 |
| L5 推理与解码 | 14 | 22 |
| L6 提示与上下文 | 11 | 20 |
| L7 评测与度量 | 10 | 17 |
| L8 Agent 与工具 | 9 | 14 |
| L9 基础设施 | 6 | 11 |
| L10 可解释性与安全 | 6 | 11 |

### 16.4 闭环验证（实测）

| 检查 | 结果 |
|---|---|
| 内容与图完整性 | 101 词 / 163 追问 / **无环 ✓** |
| 前置门禁 | 锁住词追问 → **409 + "需要先掌握：自注意力、查询/键/值"** |
| kernel 闭环 | 学习产出 1 条 Claim（`clm_d41154c6`），状态 **draft**（D 级证据永不升 supported） |
| 同应用闭环 | 该 Claim 自动出现在 learn 自己的复习队列里（标「◈ 知识层」） |
| 合并队列 | 两门课共用一个队列，每张卡标课程来源（λ 计算理论 / 🧠 大模型 / ◈ 知识层） |
| 页面与 API | 13/13 全 200 |
| 分层合规 | `depViolations: []` |

### 16.5 开发中真实抓到并修掉的问题

**① 依赖图有 15 个环**

第一版写完 101 词后，`validateGraph()` 直接报出 15 个「互为前置」的环，例如：

```
t-ntp → t-cross-entropy → t-ntp
t-rlhf → t-reward-model → t-rlhf
t-rag → t-grounding → t-rag
```

**这说明图校验是必要的**——如果没写校验，运行时算「解锁状态」会死循环或永远锁住。

修法：为每个环选定「更基础」的一方作为根（`depends: []`），共调整 14 个词 + 拆掉 1 对。

**② 46 条 depends/contrasts 指向未收录的词**

因为 `contrasts` 里引用的是 ☆ 级词（第一期未收录）。修法：`contrasts` 清理指向未收录词的引用（42 条），`depends` 改为合理前置或置空（4 条）。

**教训**：内容规模一大，「引用完整性」必须用脚本校验，人眼查不出来。

**③ LLM 超时，但降级路径正确工作**

首次测 `POST /probe` 时 LLM 超时 60s，返回：

```json
{"level":"deep","source":"fallback","degraded":true,
 "note":"LLM 不可用（This operation was aborted），已降级为关键词判定——结果仅供方向参考，不代表真实深度"}
```

降级契约（能力降级必须可见）实测有效。后续 LLM 恢复后，同一条追问返回 `source: "llm"` 且判定更准确。

### 16.6 已知限制（诚实记录）

| # | 限制 | 影响 |
|---|---|---|
| 1 | 只收 ★ 必会 101 词，☆ 常用 96 词未收 | 覆盖面约 44% |
| 2 | 每词 1-2 条追问（163 条，方案目标 303 条） | 判定深度略粗 |
| 3 | 追问降级用关键词启发式 | 假阴/假阳都可能；已标 `degraded:true` |
| 4 | `contrasts` 只剩同层 ★ 词 | 易混淆对照变弱 |
| 5 | 掌握度要求「连续答对 ≥2」且 lapses=0 | 学得慢（刻意：宁可严，不可假熟练） |
| 6 | 前置门禁无「我确实懂，跳过」通道 | 少数情况会挡路 |

### 16.7 第二期待办

- 补 ☆ 常用 96 词（并恢复 contrasts 引用）
- 追问补满 3 条/词（共 303 条）
- 追问历史记录，看同一词的回答深度是否提升
- 层完成度达标后解锁「下一层」推荐
- 与 research 打通：读到论文自动抽取其中涉及的术语

### 16.8 第三轮新增/修改文件

```
apps/learn/content/courses.json          课程清单（2 门）
apps/learn/content/llm/layers.json       大模型：10 层定义
apps/learn/content/llm/terms/L1..L10.json 大模型：101 词 + 163 追问
apps/learn/lib/terms.mjs                 大模型：加载 / 图校验 / 掌握度 / 前置门禁
apps/learn/lib/probe.mjs                 大模型：追问判定（LLM + 关键词降级）
apps/learn/lib/srs.mjs                   改：dueQueue 返回 course 字段（多课程需要）
apps/learn/server.mjs                    改：/courses + /llm/* 全部路由；review 队列两门课合并
apps/learn/public/index.html             改：课程切换条 + 词条地图 + 追问测验 + 合并复习
apps/learn/README.md                     应用文档（两门课）
knowledge-base/learning/2026-10-27-大模型词汇与原理-术语清单调研.md   调研
HANDOVER.md                              本文件
```

**已删除**：`apps/llm-lab/`（内容已并入 learn）、`bench/LLM-LAB-PLAN.md`（方案已并入本文件与 README）。

### 16.9 改造中的两个真实问题

**① `srs.dueQueue()` 丢字段**

合并两门课后，前端要显示「这张卡属于哪门课」，但 `dueQueue()` 的返回映射是白名单式的，
`_course` 字段被丢弃，前端拿到的全是 `undefined`。

修法：在 `dueQueue()` 的返回体里显式加 `course: x.card._course ?? null`。

**② 复习统计口径**

两门课共用 `srs.json`，`/review/stats` 原本只统计计算理论的卡。
改成合并统计，并额外返回 `llmLocked`（被前置锁住的数量），否则用户会困惑
「为什么 101 个词只看到 15 个」。
