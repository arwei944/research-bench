# 书籍格式替换为 AI 可直接读取 — 最终交付报告

> 日期：2026-09-13 ｜ 项目：modu-reader（墨读）
> 背景：彻底放弃 OCR 路线，改为将书库格式替换为 AI 可直接读取的文本/标准格式。

## 一、最终结果

| 指标 | 数值 |
|---|---|
| 书库文件总数 | **498 本** |
| AI 可直接读取 | **494 本** |
| 不可读（扫描版/损坏） | **4 本** |
| **全库 AI 可读率** | **99.2%** |

## 二、三个阶段

### 阶段 1：全库盘点（716 文件 → 精确清单）
- 遍历全库逐本尝试提取正文（不触发 OCR），输出替换清单
- 排除封面图等非书文件后，真实需替换 **160 本**（扫描版 pdf + pdb + 损坏 epub + mobi + md）

### 阶段 2：本地可读化（无需外部来源）
| 动作 | 结果 |
|---|---|
| 9 本中文扫描版 PDF | 同目录已有可读同名 epub → **归档**到 `_scanned-archive/`（可恢复，非删除） |
| **AI 友好 txt 侧车** | **351 本 / 424MB** 纯文本生成到 `books/ai-read/`（代读引擎直接读） |
| epub 解析兼容性修复 | 支持 `opf:` 命名空间前缀的 epub（修复前 328 被误判不可读） |

### 阶段 3：LibGen 批量重取（151 本 → 147 本实际处理）
- 重写下载器修复截断三根因：**时效 key 未处理 / 完整性校验是假的 / 硬超时**
- 批量重取 **147 本**（去除 9 本已归档后剩余），首轮结果 140 OK / 11 FAIL

### 阶段 4：FAIL 批次定向攻坚（剩余 13 本 → 逐本突破）
在批量 FAIL 的基础上，对剩余书籍逐个找源并替换成功 **9 本**：

| 书（书库 id） | 替换前 | 替换后 |
|---|---|---|
| 229 Trading Commodities | 损坏 epub（975KB 非 zip） | LibGen epub（105 成员 / 24 章可读） |
| 444 Buffett 财报解读 | 扫描版 pdf（冗余并存） | epub（99 成员 / 75 章可读）+ 清理冗余 pdf |
| 226 An Introduction to Derivatives | 扫描版 pdf（2.7MB） | 文本层版（39.7MB / 641 页） |
| 230 The Art of Currency Trading | 损坏（0 页） | epub（41.5MB / 185 成员 / 32 内容文件） |
| 235 Foreign Exchange | 扫描版（0 页） | 文本层版（309 页真书《The Complete Deal》） |
| 200 Introductory Econometrics | 扫描版（97.8MB / 848 页） | 文本层版（5.9MB / 878 页 / 220 万字符） |
| 227/228 Schwager on Futures ×2 | 损坏 PDF（无法打开） | **整合版 epub**《A Complete Guide to the Futures Market》（330 章 / 126 万字符） |
| 442 The Analysis and Use of Financial Statements | 损坏（0 页） | 文本层版（784 页 / 79 章 / 6.8 万段） |

技术要点：
- 227/228 通过**宽松书名搜索**破局：`Schwager on Futures` 真实完整书名是《A Complete Guide to the Futures Market》，LibGen 有大量 epub 候选
- 442 候选 [5] 通过严格校验（784 页文本层）后确认身份替换
- 全部替换保持同名 rel，目录 id/状态经 `refresh_books_catalog.ts` 保留

## 三、最终不可读 4 本（诚实说明）

| 书 | 分类 | 原因 |
|---|---|---|
| 284 The Great Game（John Steele Gordon） | 交易员访谈与传记 | **扫描版**（430 页 0 字符） |
| 055 New Concepts in Technical Trading Systems | 技术分析与图表 | **扫描版**（116 页 0 字符） |
| 101 The Definitive Guide to Position Sizing（Van Tharp） | 趋势跟踪与系统交易 | **扫描版**（399 页 0 字符） |
| 110 Technical Analysis Using Multiple Timeframes（Brian Shannon） | 趋势跟踪与系统交易 | **扫描版**（198 页 0 字符） |

**已穷尽探测的源（均有实测证据）**：
- **LibGen 全镜像**（.li/.la/.lc/.vg/.fun/.bz/.is/.rs/.st）：仅扫描版大 PDF 或书评坏候选；ISBN 精确搜索无结果
- **Internet Archive**：有 OCR 文本（djvu.txt/epub）但全部 **401 printdisabled**（需登录借阅）
- **Anna's Archive**（.li/.gs/.org/.se）：全部 JS 反爬（DDoS-Guard/Antibot），内置浏览器在无显示环境不可用
- **Z-Library**（z-library.sk/1lib.sk）：自循环重定向需登录
- **Google Books API**：无公开可下载条目；**Open Library**：borrowable 需登录

这三本属于**受版权保护的专业交易书籍**，其可匿名获取渠道中不存在文本层版本；原扫描版文件保留在书库，可下载查看。

## 四、修复的工程问题

1. **LibGen 下载器 v2**：时效 key 重取 + 真实完整性校验（PDF 页数 / epub zipfile）+ 速度超时替代硬超时
2. **bookIndexer 排除规则**：新增 `_scanned-archive` / `ai-read` / `_ocr_cache` 不污染书架
3. **book_api.py epub 解析**：支持 `opf:` 命名空间前缀（328 由不可读 → 34章/119.9万字可读）
4. **refresh_books_catalog.ts**：pdf→epub 替换后保留 id/状态、仅更新 file_rel/format
5. **finalize-book-replace.py**：索引命令 npx→tsx.cmd 绝对路径 + subprocess 编码 GBK→UTF-8 修复
6. **严格校验**：拒绝 3 页书评类坏候选（页数下限 + 字符量门槛），防止误替换

## 五、工具脚本（留存于研究智能体工作区 scripts/）

| 脚本 | 作用 |
|---|---|
| `libgen_download.py` | LibGen 下载器 v2（断点续传 + 完整性校验） |
| `libgen_la.py` | libgen.la 镜像下载（ads.php 时效 key + file.php 直链） |
| `replace-books.py` | 批量重取主脚本（--limit 分步验证 + 断点续跑） |
| `finalize-book-replace.py` | 收尾验证（清理元数据 + 可读率终验 + 索引重建） |
| `check_text_layer.py` | PDF 文本层/损坏/扫描版三态检测（纯 get_text，不渲染） |
| `dl_442.py` | 单本候选严格校验下载模板 |
| 进度记录 | `replace-progress.tsv` / `replace-todo.tsv` / `replace-bulk.log` |

## 六、git 状态

modu-reader `main = origin/main` 完全同步（`03e46d7d` bookIndexer 排除规则已推送）。
`books/` 数据目录在 .gitignore 内（本地运行时工具 + 书库不入库），所有替换即时生效、无需提交。

## 七、使用方式

书架点任何一本书：
- **494/498（99.2%）** epub/txt/mobi/rtf + 有文本层 PDF → 直接进 AI 代读
- 仅剩 4 本扫描版 PDF → 明确报错（无文本层），原文件可下载
- `books/ai-read/` 侧车命中 → 秒开
