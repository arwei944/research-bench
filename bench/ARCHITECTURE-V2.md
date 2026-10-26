# 架构现状（V2）

> 日期：2026-10-26
> 本文记录**实际实现了什么**，与 `ARCHITECTURE.md`（设计方案）对照。
> 一句话：设计里的三层已落地，加了两样设计时没想到但必需的东西——**可观测性**和**门面层**。

---

## 一、现在的分层

```
┌──────────────────────────────────────────────────────────────┐
│ L2 工作流层                                                    │
│   research  检索 → 核验 → 报告 → Claim                        │
│   labset    任务 × 配置 → Run → Claim（自动）                  │
│   learn     Claim → 复习卡 → 置信度回写                        │
├──────────────────────────────────────────────────────────────┤
│ L1 门面层（新）                                                │
│   kernel/index.mjs                                            │
│   bench.claim / bench.run / bench.artifact                    │
│   bench.ingestExperiment / bench.dashboard                    │
├──────────────────────────────────────────────────────────────┤
│ L0 内核层                                                      │
│   kernel/entities.mjs   四实体 + 状态推导 + 闸门检查           │
│   kernel/store.mjs      文件存储 + 事件流 + 健康统计           │
│   kernel/observe.mjs    请求追踪 + 指标 + 慢请求日志（新）      │
└──────────────────────────────────────────────────────────────┘
```

### 为什么加门面层

**改造前**：应用里写的是

```js
import * as entities from "../../kernel/entities.mjs";
import * as kernel from "../../kernel/store.mjs";
```

问题：应用**直接依赖内核内部结构**。内核一改，所有应用都要改。

**改造后**：

```js
import { bench } from "../../kernel/index.mjs";

const c = bench.claim.create({ text: "..." });
bench.claim.attachEvidence(c.id, { kind: "run", refId: r.id, tier: "A" });
```

验证：三个应用的 `kernel.` / `entities.` 直接引用残留全部为 **0**，平台层的 `kb._raw` 残留也为 **0**。

> 保留 `bench._raw` 作为逃生口，但当前没有任何代码使用它。

---

## 二、闭环：现在的完整链路

```
① 跑实验                     labset /api/labset/run
      ↓  每次运行产生 Run（带闸门状态 selfTest 8/8 + fixtures 38/38）
② Run 写入内核                bench.run.record()
      ↓
③ 自动产出 Claim              bench.claim.create()
   （只对有信息量的任务：pass@1 <99% 或处于悬崖区）
      ↓  100% 通过且安全的题不生成断言——没有信息量
④ 挂 A 级证据                 bench.claim.attachEvidence(tier:"A")
      ↓
⑤ 状态自动推导                draft → supported
      ↓
⑥ 变成复习卡                  learn 的 cardsFromKernel()
      ↓
⑦ 复习反馈                   连续答对 3 次 → confidence medium → high
```

### 关键改变：实验现在能自己产生知识

**改造前**：只有 `research` 保存报告时才产生 Claim。labset 跑完实验只留下 Run，结论需要人工写报告才进知识层。

**改造后**：labset 跑完自动生成 Claim，条件是任务有信息量：

| 任务状态 | 是否生成 Claim | 理由 |
|---|---|---|
| pass@1 = 100%，zone = safe | ❌ 跳过 | 没有信息量，不该当结论记 |
| pass@1 = 100%，zone = warn | ❌ 跳过 | 同上 |
| pass@1 < 99% | ✅ 生成 | 有区分度 |
| zone = cliff（>80s） | ✅ 生成 | 有风险信号 |

**实测证据**：跑 `E-digit-count`（1 次）后自动生成

```
[supported/1证] 任务「E-digit-count」在基线配置下 pass@1 为 50%（1/2）
```

### 闭环是否成立的判定

`bench.dashboard().loop.closed` —— 只要有一条 Claim 同时满足「status = supported」且「有 A 级证据且该证据指向的 Run 过了闸门」，闭环即成立。

当前状态：

```json
{"artifacts":5,"claims":4,"runs":5,"evidences":5,
 "closed":true,"orphanClaims":0,"ungatedRuns":0}
```

---

## 三、可观测性（设计时没想到，但没有它无法判断系统好坏）

### 三个层次

| 层次 | 内容 | 位置 |
|---|---|---|
| **请求级** | 每个请求有 traceId、耗时、状态码 | 响应头 `X-Bench-Trace` |
| **聚合级** | 按路由模板聚合的计数、耗时分布、错误率 | `/api/_platform/metrics` |
| **系统级** | 各维度状态 + 问题清单 + 闭环判定 | `/api/_platform/status` |

### traceId 贯穿

每个请求分配短 id（如 `tpevhfy002`），通过响应头回传：

```bash
curl -D- http://127.0.0.1:7800/api/_platform/ping | grep -i trace
# X-Bench-Trace: tpevhfy002
```

慢请求和 5xx 会落盘到 `data/trace.jsonl`，可追溯。

### 指标聚合（按路由模板，避免高基数）

```json
{"route":"GET /api/research/channels","count":1,"avgMs":12736,"maxMs":12736,
 "errors":0,"buckets":{"<50":0,"<200":0,"<1000":0,"<3000":0,">=3000":1}}
```

路径归一化规则：
- `/api/learn/notes/2026-10-26-xxx.md` → `/api/learn/notes/:file`
- `/clm_abc123` → `/:id`

### 健康自评逻辑

不是"看看有没有报错"，而是按判据给结论：

```js
if (错误率 > 5%)          issues.push("错误率偏高")
if (慢请求数 > 0)          issues.push("N 次慢请求（>2000ms）")
if (最慢路由平均 > 5000ms) issues.push("路由 X 平均 Nms")

status = issues.length === 0 ? "healthy"
       : issues.length <= 2  ? "degraded"
       : "unhealthy"
```

**实测捕捉到的真实问题**：

```
{"status":"degraded","issues":["1 次慢请求（>2000ms）"],
 "uptimeSec":43,"totalRequests":9}
```

对应 `GET /api/research/channels → 200 (12736ms)` —— 14 条外部通道并发探活确实慢，这是真实的性能特征，不是 bug。

### 一屏体检页 `/status`

| 区块 | 内容 |
|---|---|
| 状态条 | healthy / degraded / unhealthy + 一句话说明 + 问题数 |
| 闭环 | 结论 → 证据 → 实验 → 产物 → ✓闭环（每个环节显示数量） |
| 问题清单 | 分级列出（错误/警告），没有就说"没有待处理问题" |
| 进程 | PID / Node 版本 / 运行时长 / 内存 / 平台 |
| 观测 | 请求总数 / 错误率 / 慢请求数 / RPS / 最慢 5 个路由 |
| 应用 | 每个应用的层、后端状态、路由数 |
| 慢请求日志 | traceId + 请求 + 状态 + 耗时 + 时间 |

---

## 四、与应用分层的关系

应用的四层（platform / core / app / lab）与 kernel 三层是**正交**的：

| 应用层 | 含义 | kernel 关系 |
|---|---|---|
| L0 platform | 外壳、路由、注册表 | 使用 `kernel/observe.mjs` |
| L1 core | 模式、设计系统 | 不使用 kernel |
| L2 app | research / learn / labset | **通过门面使用 kernel** |
| L3 lab | 草稿台 | 不使用 kernel |

依赖规则仍由 `lib/layers.mjs` 检查，违规在 UI 红字标出。

---

## 五、与设计方案的差异（诚实记录）

| 设计方案 | 实际实现 | 差异原因 |
|---|---|---|
| 三种实体 | **四种**（多了 Artifact） | 报告正文需要存原文，不能只存 Claim |
| L1 能力层（检索/判分/评测） | **L1 是门面层** | 能力层实际在各自应用里，抽出来反而增加耦合 |
| 统一事件总线 | 只有 append-only 事件流 | 没有订阅者需求，先留最小的 |
| 归档为「淘汰零数据应用」 | **未做** | 优先做闭环和观测，清理留后 |
| 分层有运行时约束 | **仍只有静态检查** | 依赖违规不影响加载，只标红 |

---

## 六、当前已知的技术债

按严重程度排序：

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | **没有 L1 能力层的真实抽象** | 判分器、检索各自散在应用里，复用时靠复制 | 等第二个应用需要同一能力时再抽 |
| 2 | **分层约束不生效于运行时** | L1 挂了 L2 不知道，无降级契约 | 需要定义降级接口，工作量大 |
| 3 | **只有 2 个应用用了 kit.js** | 其余 5 个仍各写一份主题/Markdown | 逐步迁移，不急 |
| 4 | **概念地图/苏格拉底未接 kernel** | 学习产出不进知识层 | 可以接，但优先级低 |
| 5 | **事件流无因果** | 只记录「改了什么」，不记录「因为什么改」 | 加 `causedBy` 字段即可 |
| 6 | **无并发保护** | 两个请求同时写同一实体可能丢更新 | 单用户场景可接受 |

---

## 七、怎么验证架构是好的

三条可执行的检查，都能在 1 分钟内跑完：

### 检查 1：门面隔离是否真的成立

```bash
# 应用里不应出现对内核内部模块的直接引用
grep -rn "kernel/store\|kernel/entities" bench/apps/*/server.mjs
# 期望：无输出
```

### 检查 2：闭环是否成立

```bash
curl -s http://127.0.0.1:7800/api/_platform/status | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d); console.log('闭环:', j.loop.closed); console.log('问题:', j.issues)})"
# 期望：闭环 true，问题清单为空
```

### 检查 3：可观测性是否有效

```bash
# 打一个慢请求，看指标是否捕捉到
curl -s -o /dev/null http://127.0.0.1:7800/api/research/channels
curl -s http://127.0.0.1:7800/api/_platform/metrics | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const j=JSON.parse(d); console.log('慢请求数:', j.slowCount);
    console.log('最慢:', j.routes.filter(r=>r.avgMs>2000).map(r=>r.route+' '+r.avgMs+'ms'))})"
# 期望：慢请求数 >= 1，最慢路由列表非空
```
