# archive · 历史资产归档

> 归档日期：2026-10-27
> 原则：**归档而非删除**。这些东西有历史价值、可随时恢复，但不再是当前工作区的一部分。

---

## 一、为什么归档

本工作区曾经有**两套平行的「研究工作台」**：

| | 旧：atlas-web | 新：bench |
|---|---|---|
| 技术栈 | Next.js 16 + React + 39 个 TSX 组件 | 零依赖 Node + 原生 HTML |
| 启动 | `npx next dev`（依赖 node_modules 1.8GB） | `node bench/bench.mjs start` |
| 研究能力 | 检索/报告/通道 | 检索/报告/核验 + **Claim 闭环** |
| 学习能力 | 无 | 计算理论 + 大模型（101 词） |
| 实验能力 | 无 | labset（任务×配置×判分闸门） |
| 知识层 | 无 | kernel（四实体 + 状态推导） |
| 观测 | 无 | traceId + 指标聚合 + 体检页 |

**决策：以 `bench` 为唯一工作台，atlas 系列归档。**

理由：
1. bench 已覆盖 atlas-web 的全部研究能力，且多了闭环、实验、知识层
2. 两套并存导致「研究工作台」指代不明——用户不知道该开哪个
3. atlas-web 依赖 1.8GB node_modules，且上次运行崩溃过（`Cannot find module 'node:path'`）
4. atlas-web 是上游 `agegr/pi-web` 的 fork，维护成本高，与 bench 的设计哲学（零依赖、可读、可改）冲突

---

## 二、归档内容

### `archive/atlas-web/`（1.84 GB）

Next.js 前端，独立 git 仓库（origin: `arwei944/atlas-web`，upstream: `agegr/pi-web`）。

- 最后提交：`e7ecdd4 chore: 收尾——元数据与文档研究化`
- 有未提交改动（`ResearchDashboard.tsx` 等）
- **可独立启动**（实测 `next dev` 1471ms ready），但只提供研究单场景

**独有能力**（bench 没有，如果将来需要可从这里挖）：
- `app/api/agent/` —— agent 会话管理
- `app/api/terminal/` —— 终端集成
- `app/api/git/` —— git status/diff
- `app/api/worktrees/` —— worktree 管理
- `app/api/files/` + `file-index` —— 文件浏览与索引
- `app/api/skills/` —— 技能列表
- `app/api/subagents/` —— 子智能体
- `components/ResearchDashboard.tsx` —— 研究仪表盘

### `archive/atlas/`（222 MB）

atlas-web 的 monorepo 后端，10 个子包：
`agent / ai / chord / client / coding-agent / evals / protocol / server / session-backends / telemetry / tui`

### `archive/dot-atlas/`（原 `.atlas/`）

运行时残留：
- `atlas.config.json` —— 端口 63480
- `web.pid` —— PID 25596（**已死**）
- `web.log` —— 崩溃日志
- `research-snapshot.json` —— 14 通道健康快照（2026-10-24）

---

## 三、如何恢复

```bash
cd C:/work/newmax/研究智能体

# 恢复全部
mv archive/atlas-web .
mv archive/atlas .
mv archive/dot-atlas .atlas

# 恢复后 atlas-web 启动（需要 node_modules）
cd atlas-web && npx next dev --port 3000
```

**注意**：恢复 atlas 系列不会影响 bench，两者端口不同（atlas 63480 / bench 7800），可以并存。
但**不建议**——这正是本次归档要消除的认知负担。

---

## 四、如果要从 atlas-web 挖功能

优先考虑**用 bench 的方式重写**，而不是恢复整个 Next.js 应用。理由：
- bench 的应用模型是「一个目录 + app.json + server.mjs」，加功能成本极低
- Next.js 方案要处理构建、依赖、打包，与零依赖原则冲突

真需要时，参考 `archive/atlas-web/app/api/<功能>/route.ts` 的实现逻辑，
在 `bench/apps/<新应用>/server.mjs` 里重写（通常只需几十行）。

---

## 五、其他归档

见 `archive/legacy/`（历史脚本、日志、临时文件）。
