# archive/legacy · 历史遗留资产

> 归档日期：2026-10-27
> 这些是**上一个项目**（书籍 OCR / 格式替换 / 电子书下载）的产物，与当前 bench 工作台无关。

---

## 内容

### `scripts/`（67 个脚本，最后修改 9 月 9-13 日）

| 前缀 | 数量 | 用途 |
|---|---|---|
| `ocr_*` | 16 | OCR 性能实验（DPI 扫描、并行基准、v5/v6 对比） |
| `probe_*` | 9 | 书源探测（LibGen 镜像、Anna's Archive） |
| `dl_*` | 5 | 电子书下载 |
| `replace_*` | 3 | 书籍格式批量替换 |
| `libgen_*` | 3 | LibGen 镜像处理 |
| `check_*` / `verify_*` | 7 | 校验脚本 |
| `resume_*` / `retry_*` | 5 | 断点续传 |
| `atlas-*` / `rename-to-atlas` / `sync-*` / `push-*` | 6 | 早期 atlas 项目相关 |
| 其它 | 13 | 杂项（PDF 统计、MD5、等待下载等） |

### `_retry_tmp/`（67 个文件，358 MB）

PDF、HTML 抓取缓存、下载日志。纯临时产物。

### 日志与中间数据（6 个文件）

| 文件 | 大小 | 内容 |
|---|---|---|
| `replace-bulk.log` | 8.7 KB | 批量替换执行日志 |
| `replace-progress.tsv` | 15 KB | 替换进度表 |
| `replace-run.log` | 15 KB | 运行日志 |
| `replace-todo.tsv` | 14 KB | 待替换清单 |
| `scan-replace-list.txt` | 19 KB | 扫描结果 |
| `scan-replace-real.txt` | 11 KB | 真实替换项 |

---

## 为什么归档而不是删除

1. **有复用价值**：`ocr_*` 系列的性能实验方法（DPI 扫描、并行度测试）可迁移到别的场景
2. **可追溯**：如果将来需要查「当时那批书是怎么处理的」，日志还在
3. **不占认知**：归档后根目录干净，`ls` 一眼看到当前资产

---

## 如果要用

```bash
# 单个脚本
node archive/legacy/scripts/ocr_dpi_bench.py --help

# 恢复全部（不建议，会污染根目录）
mv archive/legacy/scripts .
mv archive/legacy/_retry_tmp .
```

**注意**：这些脚本依赖当时的环境（Python 包、本地路径、外部服务），
现在直接跑很可能失败。参考其**思路**比直接执行更有价值。

---

## 判断标准

归档 vs 保留的界线是：**这个文件是否还在当前的开发/使用循环里**。

- `scripts/` 最后修改 9 月 13 日，bench 从 10 月 24 日开始 → 归档
- `bench/` 是当前唯一工作台 → 保留
- `knowledge-base/` 是 AGENTS.md 规定的沉淀位置 → 保留（且已接入工作台）
- `tools/research/` 是当前研究 CLI → 保留（已改为复用能力层）
- `workflows/` 是研究流程模板 → 保留
- `config/` 是模型配置示例 → 保留

---

## 附：broken-reports/（3 个损坏报告）

`archive/legacy/broken-reports/broken-{1,2,3}.md`

原文件名与内容都是乱码，来源：`bench/apps/research/data/reports/`。

**损坏原因**：写入时用了错误的编码路径（UTF-8 文本被当作 GBK 再转 UTF-8），
产生 `锟斤拷` 这类二次损坏。文件里 86-131 个 U+FFFD 替换字符，**不可逆**。

**为什么直接归档而不是修复**：这三个是自检测试报告（内容都是「pass@1 100%」的重复结论），
没有保留价值。归档是为了留个证据：说明曾经踩过这个编码坑。

**教训**：写中文文件名/内容时，必须确保整条链路（shell → node → fs）都是 UTF-8。
本仓库的 `bench/lib/knowledge-base.mjs` 已用 `writeFileSync(..., "utf8")` 显式指定。

---

## 附：docs/（9 个历史文档）

这些文档描述的是**已归档的 atlas 方案**或**上一个项目**，与当前 bench 工作台无关：

| 文档 | 内容 | 归档原因 |
|---|---|---|
| `研究工作台-使用说明.md` | atlas-web 研究前端用法 | atlas 已归档 |
| `研究前端改造说明.md` | 把 atlas-web 改成研究前端 | atlas 已归档 |
| `atlas-embed-使用说明.md` | atlas 内置到任意项目 | atlas 已归档 |
| `上游同步说明.md` | 与 upstream 同步流程 | atlas 已归档 |
| `path-verification.md` | 路径校验记录 | 一次性检查 |
| `OCR提速-极限性能-实现与验证.md` | OCR 性能实验 | 上个项目 |
| `书籍格式替换-AI可直接读取-交付报告.md` | 书籍格式替换 | 上个项目 |
| `人读转AI代读-结构调整实施说明.md` | 同上 | 上个项目 |
| `人读转AI代读-结构调整调研报告.md` | 同上 | 上个项目 |

**保留在根目录的 4 个文档**：

| 文档 | 为什么保留 |
|---|---|
| `README.md` | 唯一入口说明（已重写） |
| `AGENTS.md` | Pi Agent 角色设定，进入目录即生效 |
| `搭建方案-基于Pi-Agent的个人全能研究智能体.md` | 工作区的**设计初衷**，仍有参考价值 |
| `研究智能体方向调研报告.md` | 领域方向调研，是 knowledge-base 之外的总纲 |
