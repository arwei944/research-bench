# 人读 → AI 代读 结构调整实施说明

> 日期：2026-09-12 ｜ 仓库：github.com/arwei944/modu-reader（`18ad657f`）
> 关联调研：《人读转AI代读-结构调整调研报告.md》

## 一、已实现（本次提交）

### 后端（atlas-agent）— 逐章代读引擎
| 文件 | 内容 |
|---|---|
| `src/daidu-engine.ts` | **逐章代读引擎**：复用 `runBookCli content` 分章正文 → 逐章调 LLM（章摘要/关键事实/金句），**断点续读**（`current_ci`）、**运行摘要记忆苗**（最近 3 章）、**MapReduce 全书 12 维**（复用 DaiduPage DIMENSIONS 结构）、单章失败隔离 + 断点保存、取消支持 |
| `src/store/daidu.ts` | 三表 CRUD：`daidu_tasks`（作业/断点/进度）、`daidu_chapters`（章摘要+key_facts+quotes）、`daidu_book`（全书 12 维） |
| `src/routes/daidu.ts` | API：`/api/daidu/read|cancel|summarize|status/:id|book/:id|books|prewarm|queue`，含**全量预读队列**（串行、单本失败隔离、断点续读） |
| `src/schema.sql` | 新增第 25-27 号代读三表 |

### 前端（modu-web）— AI 代读书页
| 文件 | 内容 |
|---|---|
| `pages/AiReadPage.tsx` | `/daidu/$bookId` AI 代读书页：代读状态+进度条、开始/停止/断点续读/汇总全书、**全书 12 维报告**（12 卡片）、**逐章粗览列表**（章摘要/关键事实/金句，可展开）、**「查看原文校对」**入口 |
| `pages/ShelfPage.tsx` | 书架书籍点击 → **AI 代读书页**（epub/mobi/rtf/txt）；pdf/html 保留浏览器原生预览；「继续阅读」卡片 → 代读书页 |
| `app/routes.tsx` | 新增 `/daidu/$bookId` 路由；`/reader` 保留为**只读原文核对视图** |

## 二、验证证据（全绿）

```
✅ 后端 tsc --noEmit 通过 + 227 单测全过
✅ 前端 4 包 typecheck 通过 + 60 文件 363 用例全绿
✅ 端到端真实代读：《atomic habits》33 章 100% 完成 + 全书 12 维生成
   overview：「通过四步模型与四大定律，以微小习惯的复利效应重塑身份，实现持久改变。」
✅ build:single 产物已同步（含「开始 AI 代读 / 查看原文校对 / 代读报告」标记）
✅ GET /daidu/bk_86 SPA 路由 200
✅ pi 品牌残留 0
✅ 已推送 18ad657f → github.com/arwei944/modu-reader
```

## 三、使用方式

- **书架点书** → AI 代读书页（逐章代读进度 + 章摘要 + 全书 12 维）
- **开始 AI 代读**：单本触发（后端排队异步跑，进度实时轮询）
- **断点续读**：中断后回到书页点「断点续读」从上次位置继续
- **查看原文校对**：AI 答案引用/金句 → 跳只读原文视图核对
- **全量预读**：`POST /api/daidu/prewarm`（全部）或带 `{ category }`（按分类）

## 四、全量预读说明（559 本）

- **引擎速率**：约 5-10 分钟/本（含全书 12 维，视章数/正文长度）
- **全量估算**：559 本 ≈ **50-90 小时** 串行耗时（队列后台跑）
- **模型**：走现有 `LLM_API_BASE`（localhost:3003 relay → sensenova-01/deepseek-v4-flash 等），API 用量按 token 计
- **建议**：
  1. 现在触发全量（后台常驻跑，随时可查 `/api/daidu/queue`）
  2. 先只预读重点分类（如 16 个交易书分类）再扩散
  3. 暂不全量，点哪本代读哪本（懒生成，零闲置成本）
- 队列已实现单本失败隔离 + 断点续读 + 取消，随时可暂停/续跑

## 五、后续（Phase 2+ 未做，待你指示）
- 全书问答（FTS5 + sqlite-vec 混合检索 + 答案带引用回查）
- 音频概览（12 维 → TTS 播客式）
- 知识图谱关联（金句/概念自动入图谱）
- 代读质量评测集（忠实度/幻觉率持续校准）
