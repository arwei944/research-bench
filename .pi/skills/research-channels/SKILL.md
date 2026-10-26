---
name: research-channels
description: 多源研究通道工具箱。当需要检索文献、核验引用、查基准分数、看价格与上下文、找开源实现、扫描社区信号时使用。封装了 arXiv / Crossref / OpenAlex（含引用网络）/ Epoch AI 官方 API / GitHub / Hacker News / Hugging Face / OpenRouter / Vals AI / Scale SEAL / Stanford HAI / ARC Prize / METR 共 14 个通道。触发场景：查文献、验引用、查谁引用了某篇、查某个基准的精确分数、比模型价格、找现成项目、看领域最新动态。
---

# Research Channels · 多源研究通道

> 所有命令都在工作区根目录运行：`node tools/research/research-cli.mjs <命令>`。
> 先跑 `probe` 确认通道可用，再开始检索。

## 0. 为什么要用这个工具箱

上一版研究报告（`knowledge-base/academic/2026-10-24-AI能力边界与各领域前沿.md`）的核心教训是：
**单一来源会系统性误导。** 同一个模型、同一套题，换外壳分数差一个量级；基准本身可被 100% 攻破。
因此检索必须多源、核验必须双通道、数字必须带日期。

## 1. 通道清单（14 个，实测可用 13）

| 通道 | 用途 | 命令 | 备注 |
|---|---|---|---|
| arXiv | 预印本检索 | `arxiv "<query>" [n]` | 按提交时间倒序 |
| arXiv | 按 ID 取全文元数据 | `verify arXiv:2503.14499` | |
| Crossref | DOI / 标题 → 期刊元数据 | `paper "<title>" [n]` / `verify 10.xxxx/yyy` | 引用核验主力 |
| OpenAlex | 被引排序检索 + **引用网络** | `oa "<query>" [n]` / `cites <doi> [n]` | `cites` 能查「谁引用了它」 |
| Epoch AI | 基准元信息 + **精确分数** | `bench <id>` / `bench-score <bench> <model-ver>` | 有 stderr，比页面可靠 |
| GitHub | 找现成项目/参考实现 | `github "<query>" [n]` | 按 star 排序 |
| Hacker News | 社区真实关注点 | `hn "<query>" [n]` | 点数 >100 过滤噪音 |
| Hugging Face | 每日热门论文 | `hf [n]` | 官方 JSON API |
| OpenRouter | 模型价格 / 上下文长度 | `models [n]` | 469 个模型实时价 |
| Vals AI | 金融/法律/税务等专业任务评测 | 直接抓页面 | 有行业指数 |
| Scale SEAL | 前沿/安全/agentic 评测 | 直接抓页面 | 含 RLI、HiL-Bench |
| Stanford HAI | 宏观趋势与采用率 | 直接抓页面 | AI Index 年度 |
| ARC Prize | 抽象推理 / AGI 进度 | 直接抓页面 | 有 harness 对照 |
| METR | 长程自主能力 | 直接抓页面 | 时间跨度权威 |
| Semantic Scholar | 引文图（备用） | — | 免费额度常 429，有 key 再用 |

## 2. 标准检索流程

### 2.1 文献调研（四步）
```bash
# 1) 先探通道
node tools/research/research-cli.mjs probe

# 2) 宽检索：看这个方向有什么
node tools/research/research-cli.mjs arxiv "all:\"long-horizon agent\"" 8
node tools/research/research-cli.mjs oa "long horizon agent evaluation" 5

# 3) 找奠基工作：按被引排序，挑高被引的那几篇
node tools/research/research-cli.mjs oa "<核心概念>" 10

# 4) 顺引用网络往下游走：谁在用它、谁反驳它
node tools/research/research-cli.mjs cites <奠基论文DOI> 15
```

### 2.2 引用核验（写报告前必做）
```bash
node tools/research/research-cli.mjs verify arXiv:2503.14499        # arXiv 通道
node tools/research/research-cli.mjs verify 10.1038/s41586-024-07566-y   # Crossref 通道
node tools/research/research-cli.mjs verify "Measuring AI Ability to Complete Long Tasks"  # 标题双源
```
输出 `✅已核验 / ⚠️未找到`。**未核验的引用一律不得写进报告。**

### 2.3 基准取分（不要靠肉眼看页面）
```bash
node tools/research/research-cli.mjs bench frontiermath-tier-4-v2
node tools/research/research-cli.mjs bench-score frontiermath-tier-4-v2 gpt-6-astra_max
# → {"score":0.976,"stderr":0.024,...}   ← 带标准误，能判断样本量是否够
```
**判断标准**：stderr > 0.03 时，不要把该分数当精确结论引用。

### 2.4 成本与可行性
```bash
node tools/research/research-cli.mjs models 8
```
用于回答「这个方案跑得起吗」。注意区分 per-M token 价与 per-task 成本。

## 3. 证据分级（沿用 research-protocol）

| 级别 | 定义 | 本工具箱对应 |
|---|---|---|
| A | 一手数据/论文/官方 API | arXiv、Crossref、OpenAlex、Epoch API、METR/ARC 官方页 |
| B | 权威二手评测 | Vals AI、Scale SEAL、Stanford HAI、Artificial Analysis |
| C | 社区信号/线索 | Hacker News、GitHub star、HF 热度 |

C 级只用来**发现问题**，不能用来**支撑结论**。

## 4. 已知坑

1. **Semantic Scholar 免费额度极易 429。** 本工具箱默认跳过，需要时自备 API key 并设 `S2_API_KEY`。
2. **Node 默认不走 `HTTPS_PROXY`。** 工具箱已自动以 `NODE_USE_ENV_PROXY=1` 重启自身；若你自写脚本访问 huggingface/scale.com 超时，就是这个原因。
3. **Epoch 的 `/scores/{model_version}` 需要精确的 model_version 串**（如 `gpt-6-astra_max`），不是显示名。先用 `bench` 看资源路径，再从 Epoch CSV 或模型目录里取 version。
4. **GitHub 无 token 时限 10 次/分钟。** 批量检索请设 `GITHUB_TOKEN`。
5. **HF 的 HTML 页面结构会变**，本工具箱改用 `/api/daily_papers` 稳定接口。
6. **代理环境下 curl 与 node 行为可能不同**：curl 读 `HTTPS_PROXY`，node 需要显式开启。

## 5. 与其它技能的配合

- `research-protocol` 提供五阶段流程与质量门禁 → 本技能提供**执行通道**。
- `academic-research` 提供文献精读与综述结构 → 本技能提供**检索与核验**。
- `finance-research` 需要公司数据 → 本技能的 GitHub/HN/Vals 只能补充「技术侧信号」，财务数据仍需官方披露。
- `learning-coach` 需要最新进展 → 用 `hf` + `arxiv` 快速定位领域前沿。

## 6. 通道健康度自检

```bash
node tools/research/research-cli.mjs snapshot .atlas/research-snapshot.json
```
产出 JSON 快照，记录每个通道的 ok/fail 与生成时间。**每次重要研究开始前跑一次**，避免在挂掉的通道上浪费时间。
