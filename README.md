# 个人全能研究智能体

> 个人自用 ｜ 学科研究 · 金融研究 · 知识学习 ｜ 零成本优先
> 底座：[Pi Agent](https://pi.dev) ｜ 工作台：`bench/`（单端口 7800，零依赖）

---

## 一、只有一个入口

**所有日常使用都从 `bench` 工作台开始。**

```bash
cd C:/work/newmax/研究智能体
node bench/bench.mjs start --open     # 启动并打开 http://127.0.0.1:7800
node bench/bench.mjs status           # 状态
node bench/bench.mjs stop             # 停止
```

打开后你会看到 7 个应用：

| 层 | 应用 | 用途 |
|---|---|---|
| L0 | 🖥 外壳 | 平台自述、路由分发流程 |
| L1 | ◉ 模式 | 专家 / 小白模式演示 |
| L1 | ◉ 设计系统 | 10 款外壳设计 token |
| L2 | ⚗ 实验器 | 任务 × 配置 × 客观判分（带判分闸门） |
| L2 | 🔬 研究 | 14 通道检索 → 核验 → 报告 → Claim |
| L2 | 🎓 学习 | **计算理论**（λ 演算）+ **大模型**（101 词）+ 间隔复习 |
| L3 | ◇ 草稿台 | 实验层示例 |

**三个关键页面**：

**只有一个入口**：`http://127.0.0.1:7800`，首页三个 Tab 切换：

| Tab | 内容 |
|---|---|
| **应用** | 分层视图 + 依赖图 + 应用管理 |
| **体检** | 闭环 / 问题清单 / 进程 / 观测 / 慢请求 |
| **知识层** | 结论 + 证据链 + **知识库** + **技能** + 变更因果 |

> 旧地址 `/status` 与 `/kernel` 会 302 重定向到对应 Tab，书签不会失效。

---

## 二、工作区目录职责

```
研究智能体/
├── bench/                 ← 唯一工作台（日常都在这里）
│   ├── apps/              7 个应用
│   ├── kernel/            四实体 + 状态推导 + 判分闸门
│   ├── lib/capabilities/  L1 能力层（LLM / 检索 / 判分 / 降级）
│   ├── lib/knowledge-base.mjs  知识库读写
│   └── public/            外壳 / 体检 / 知识层页面
├── knowledge-base/        ← 长期知识沉淀（工作台可读可写）
│   ├── academic/          学科研究
│   ├── finance/           金融研究
│   ├── learning/          知识学习
│   ├── projects/          跨领域项目
│   └── inbox/             随手笔记
├── tools/research/        ← 研究 CLI（复用 bench 能力层）
├── workflows/             三类研究工作流模板
├── config/                模型配置示例
├── .pi/skills/            5 个 Agent 技能（工作台可查看）
└── archive/               ← 历史资产（归档不删除）
```

### 已经统一的部分

| 原来 | 现在 |
|---|---|
| 两套平行工作台（atlas-web + bench） | **只有 bench**，atlas 已归档 |
| 三份通道实现（624+481+425 行） | **一份** `bench/lib/capabilities/search.mjs` |
| knowledge-base 无人读 | 工作台可列/可读/可写，报告自动双写 |
| .pi/skills 工作台不认识 | 首页「知识层」Tab 可列可读 |
| 根目录 67 个历史脚本 + 6 个日志 | 全部归档到 `archive/legacy/` |

---

## 三、三个核心机制

### 3.1 闭环：结论必须有证据

```
跑实验 → Run(带闸门) → 自动生成 Claim → 挂 A 级证据 → supported
研究存报告 → Artifact → 抽「结论速览」→ Claim → C 级证据
学习通过追问 → Claim → D 级证据（永不升 supported）
```

**状态是推导的，不是手填的。** `supported` 只留给 A 级（可执行验证）与 B 级（多源交叉）。

### 3.2 判分闸门：证据必须可信

- 双向自检：标准答案必过 / 已知错答必拒（25/25）
- 样本回归：历史真实输出判定稳定（56/56）
- 未过闸门时**拒绝跑实验**

### 3.3 降级可见：不静默失败

能力不可用时返回 `degraded: true` + `reason`，写事件流，可在首页「体检」Tab 查到。

---

## 四、用 Pi Agent 做研究

工作台之外，你也可以直接在终端里用 Pi Agent：

```bash
pi

# 三类场景
「帮我调研因果推断在经济学中的最新方法」              # 学科
「/skill:finance-research 分析宁德时代 2025 年报」    # 金融
「/skill:learning-coach 教我理解 transformer 注意力」 # 学习
```

**5 个技能**（`.pi/skills/`，首页「知识层」Tab 可查看）：

| 技能 | 用途 |
|---|---|
| `research-protocol` | 通用研究协议（默认） |
| `academic-research` | 学科/学术研究 |
| `finance-research` | 金融研究 |
| `learning-coach` | 知识学习教练 |
| `research-channels` | 14 通道检索工具箱 |

### 研究 CLI

```bash
node tools/research/research-cli.mjs probe                       # 通道健康
node tools/research/research-cli.mjs arxiv "long-horizon agent" 8
node tools/research/research-cli.mjs verify arXiv:2503.14499     # 引用核验
node tools/research/research-cli.mjs cites 10.52202/085713-3086  # 引用网络
node tools/research/research-cli.mjs models 8                    # 价格/上下文
```

> CLI 与工作台**共用同一份通道实现**（`bench/lib/capabilities/search.mjs`）。

---

## 五、验证工作台是否健康

```bash
# 1) 闭环成立 + 无问题
curl -s http://127.0.0.1:7800/api/_platform/status | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    console.log('闭环:',j.loop.closed,'| 问题:',j.issues.length)})"

# 2) 判分闸门通过
curl -s http://127.0.0.1:7800/api/labset/selftest | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    console.log('闸门:',j.ok,'| 双向',j.basic.passed+'/'+j.basic.total,
                '| 回归',j.fixtures.passed+'/'+j.fixtures.total)})"

# 3) 知识库接入
curl -s http://127.0.0.1:7800/api/_platform/kb | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);
    console.log('知识库:',j.stats.total,'篇')})"
```

---

## 六、文档索引

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | Pi Agent 角色设定（进入本目录即生效） |
| `bench/HANDOVER.md` | **交接文档**（架构、决策、踩坑、验证） |
| `bench/README.md` | 工作台总览 |
| `bench/ARCHITECTURE-V2.md` | 实现现状与技术债 |
| `bench/apps/learn/README.md` | 学习应用（两门课） |
| `archive/README.md` | **归档说明**（atlas 三件套为何弃用、如何恢复） |
| `archive/legacy/README.md` | 历史脚本与临时文件 |
| `knowledge-base/README.md` | 知识库命名与 frontmatter 规范 |
| `workflows/*.md` | 三类研究工作流模板 |

---

## 六点五、环境变量（可选）

复制 `.env.example` 为 `.env` 后按需填写。**不配置也能跑**，只是个别通道降级：

| 变量 | 不配置的后果 |
|---|---|
| `EPOCH_API_KEY` | Epoch AI 通道返回 401（其余 13 个通道正常） |
| `GITHUB_TOKEN` | GitHub 搜索限 60 次/小时 |
| `BENCH_LLM_*` | 默认指向本地 magpie 中转，一般无需改 |
| `BENCH_PORT` / `BENCH_HOST` | 默认 7800 / 127.0.0.1 |

---

## 七、原则

1. **一个入口**：日常只用 bench，不再有第二套工作台
2. **零依赖**：只用 Node 内置模块，不需要 `npm install`
3. **证据优先**：结论必须挂证据才能升级，证据必须过闸门才算数
4. **诚实标注**：D 级证据永不升 supported；降级必须可见；没有关联就说没有
5. **归档不删除**：历史资产移到 `archive/`，随时可恢复
