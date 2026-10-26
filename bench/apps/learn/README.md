# learn · 学习工作台（多课程）

> 日期：2026-10-27
> 状态：两门课程均已并入，闭环已验证

---

## 一、这是什么

一个**多课程**的长期学习工作台。两门课共用一套复习、追问、笔记与 kernel 闭环。

| 课程 | 类型 | 规模 | 特色 |
|---|---|---|---|
| **计算理论** `compute` | graph | 4 轨 · 13 节点 · 25 卡 | 可执行笔记本（真跑 λ 归约）、苏格拉底对话 |
| **大模型** `llm` | terms | 10 层 · 101 词 · 163 追问 | 前置门禁、三种追问判真懂、实验互通 |

**为什么合成一个应用而不是两个**：
复习是同一个行为。分成两个应用会出现「今天该复习什么」要跑两个地方的问题。
共用一个 `srs.json`，id 命名空间天然隔离（计算理论 `c-*`/`n-*`，大模型 `t-*`）。

---

## 二、课程切换

顶部课程条切换，导航 tab 随课程变化：

| 课程 | 可用 Tab |
|---|---|
| 计算理论 | 实验室 · 概念地图 · 间隔复习 · 苏格拉底 · 笔记 |
| 大模型 | 词条地图 · 追问测验 · 间隔复习 · 笔记 |

「间隔复习」是**两门课合并**的队列：逾期优先，新卡次之。

---

## 三、大模型课程的核心机制

### 3.1 前置门禁（硬拦截）

```
前置词没 mastered → 该词锁住
  → 不能复习（不进队列）
  → 不能追问（返回 409 + lockedBy）
```

**实测**：101 词里只有 **15 个根节点可学，86 个被锁**。

理论依据：arXiv:2508.11892（RPKT）—— 学生无法识别自己缺什么前置，
所以必须由系统强制。这是与普通闪卡 App 的最大区别。

### 3.2 三种追问（判真懂，不给答案）

| 类型 | 问什么 | 判定什么 |
|---|---|---|
| `contrast` 对比 | 它和易混词差在哪 | 是否只记住字面 |
| `counterfactual` 反事实 | 去掉它/改成 X 会怎样 | 是否理解因果而非相关 |
| `application` 应用 | 给真实场景，用它解释 | 能否迁移，还是只会复述 |

判定三档：`shallow`（复述）/ `partial`（说到机制没推到底）/ `deep`（因果链完整）。

理论依据：arXiv:2610.22949 —— 核心指标是 **cave detection**：
改变场景的一个变量，看学习者是否放弃原本正确的思路。

### 3.3 掌握度判定（刻意严格）

```
new      → 没学过
learning → 复习过但没通过深度追问
mastered → SM-2 连续答对 ≥2 且 lapses=0 且 通过 ≥1 条 counterfactual/application 追问
```

**为什么要求追问**：光答对不算懂。这是 bench 里 `pass^k` 思想在学习台的落地。

### 3.4 追问判定的降级

LLM 不可用时退化为关键词启发式，返回体带：

```json
{"source":"fallback","degraded":true,
 "note":"LLM 不可用（...），已降级为关键词判定——结果仅供方向参考，不代表真实深度"}
```

**降级必须可见**，这是平台既有规范。

---

## 四、闭环

```
复习（SM-2）→ 追问（LLM 判 deep）→ 写 kernel Claim（tier D）
   → learn 的复习队列自动出现这张卡 → 再复习 → 置信度回写
```

### 诚实性设计（重要）

学习证据固定为 **D 级（个人推断）**，按 `entities.deriveStatus` 规则
**永远不能升到 supported**。实测验证：`clm_d41154c6` 状态为 `draft`。

这是刻意的：
- `supported` 只留给 A 级（可执行验证）与 B 级（多源交叉）
- 「我学过」≠「这是事实」
- UI 上明确写这句话

### 因果链

每次写 Claim 带 `causedBy: { by: "learn.probe", reason: "learning", refId: termId }`，
可在 `/api/_platform/kernel` 的 events 里反查。

---

## 五、实验互通（`/llm/bridges`）

**用你自己的实测数据当教材。**

| 实验/研究结论 | 对应术语 |
|---|---|
| E-digit-count：pass@1≈40%，pass^5=0%，失败全超时 | `t-pass-k` |
| ECE=0.0157 但样本无错答 | `t-calibration`、`t-ece` |
| 判分器 bug：模型答对被判错 | `t-harness-effect` |
| ARC-AGI-3：62.7% → 99.9% | `t-contamination` |
| GPT-3.5 虚构引用率 55% | `t-hallucination`、`t-citation-verification` |
| 上下文 8k→128k 不是改数字 | `t-context-window` |

**诚实设计**：每条桥都去 kernel 匹配真实 Claim；匹配不到时明确输出
「kernel 里暂时没有匹配的结论（这条是预置的教学案例，不是来自你的数据）」。

---

## 六、API

### 通用
```
GET  /ping                    健康检查
GET  /courses                 课程清单 + 各自统计
GET  /curriculum              计算理论课程（轨/节点/边）
GET  /cards                   计算理论卡片（含 kernel Claim 卡）
GET  /notebooks               可执行笔记本
POST /eval                    运行 λ / JS 代码
GET  /review/queue?limit=12   **两门课合并**的复习队列
GET  /review/stats            合并统计（含 llmLocked）
POST /review/answer           提交复习 {id, grade}
GET  /coach  POST /coach      苏格拉底对话
GET  /notes  POST /notes      笔记
GET  /kernel/claims           kernel 结论
GET  /kernel/stats            kernel 统计
```

### 大模型课程
```
GET  /llm/layers              10 层 + 每层完成度 + 图校验
GET  /llm/terms?layer=&q=     词条列表（含解锁状态、掌握度）
GET  /llm/terms/:id           词条详情（dependsDetail / contrastsDetail / progress）
GET  /llm/graph               前置依赖图
GET  /llm/queue?limit=12      仅大模型的队列（已过滤锁定词）
POST /llm/review              仅大模型的复习提交
POST /llm/probe               追问判定 {termId, probeIndex, answer}
                              （锁定词返回 409 + lockedBy）
GET  /llm/progress            进度 + 各层 + 追问统计
GET  /llm/bridges             实验结论 ↔ 术语
POST /llm/progress/reset      只清 t- 前缀的进度（不动计算理论）
```

---

## 七、文件布局

```
apps/learn/
├── app.json
├── content/
│   ├── courses.json            课程清单（2 门）
│   ├── curriculum.json         计算理论：4 轨 13 节点
│   ├── cards/core.json         计算理论：25 卡
│   ├── notebooks/              可执行笔记本
│   └── llm/                    大模型课程
│       ├── layers.json         10 层
│       └── terms/L1..L10.json  101 词 + 163 追问
├── lib/
│   ├── lambda.mjs              λ 演算解释器
│   ├── srs.mjs                 SM-2（两门课共用）
│   ├── coach.mjs               苏格拉底（LLM + 内置问题链降级）
│   ├── terms.mjs               大模型：加载 / 图校验 / 掌握度 / 门禁
│   └── probe.mjs               大模型：追问判定（LLM + 关键词降级）
├── data/
│   ├── progress/srs.json       两门课共用的复习状态
│   └── notes/
├── public/index.html           7 个 Tab（按课程显示）
└── server.mjs
```

**内容热改**：每次请求重读 `content/*.json`，改完刷新即生效。

---

## 八、验证清单

```bash
cd C:/work/newmax/研究智能体

# 1) 课程清单
curl -s http://127.0.0.1:7800/api/learn/courses | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    j.courses.forEach(c=>console.log(c.id, JSON.stringify(c.stats)))})"
# 期望：compute 13 节点 / llm 101 词 163 追问

# 2) 图无环
curl -s http://127.0.0.1:7800/api/learn/llm/layers | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    console.log('词数',j.total,'追问',j.probeTotal,'图',j.graph.ok?'无环✓':'有环✗')})"
# 期望：101 / 163 / 无环✓

# 3) 前置门禁
curl -s -X POST http://127.0.0.1:7800/api/learn/llm/probe \
  -H "Content-Type: application/json" \
  -d '{"termId":"t-kv-cache","probeIndex":0,"answer":"test"}' -w "\n%{http_code}\n"
# 期望：409 + "需要先掌握：自注意力、查询/键/值"

# 4) 合并复习队列（含课程来源）
curl -s "http://127.0.0.1:7800/api/learn/review/queue?limit=5" | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    console.log('队列',j.queue.length,'锁住',j.llmLocked);
    j.queue.forEach(q=>console.log(' ',q.course,'|',q.question.slice(0,30)))})"

# 5) 闭环：学习产出状态必须是 draft
curl -s http://127.0.0.1:7800/api/_platform/kernel | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    const l=j.claims.filter(c=>(c.tags||[]).includes('llm'));
    console.log('学习产出:',l.length,'| 状态:',l.map(c=>c.status).join(','))})"
# 期望：>=1 条，状态全部 draft（D 级证据永不升 supported）
```

---

## 九、已知限制（诚实记录）

| # | 限制 | 影响 |
|---|---|---|
| 1 | 大模型课只收 ★ 必会 101 词，☆ 常用 96 词未收 | 覆盖约 44% |
| 2 | 每词 1-2 条追问（163 条，目标 303 条） | 判定深度略粗 |
| 3 | 追问降级用关键词启发式 | 假阴/假阳都可能；已标 `degraded:true` |
| 4 | 大模型课的 `contrasts` 只剩同层 ★ 词 | 易混淆对照变弱 |
| 5 | 掌握度要求「连续答对 ≥2」且 lapses=0 | 学得慢（刻意：宁可严，不可假熟练） |
| 6 | 前置门禁无「我确实懂，跳过」通道 | 少数情况会挡路 |
| 7 | 两门课共用 `srs.json`，但统计口径未分课 | 想看「大模型课单独学了多少」需前端过滤 |

---

## 十、下一步

- 补 ☆ 常用 96 词（并恢复 contrasts 引用）
- 追问补满 3 条/词
- 追问历史，看同一词的回答深度是否提升
- 复习统计按课程拆分
- 与 research 打通：读到论文自动抽取涉及的术语
