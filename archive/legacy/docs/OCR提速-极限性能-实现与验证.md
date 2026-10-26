# OCR 极限提速：PP-OCRv6 small + det max1200（v3→v5→v6 演进记录）

> 日期：2026-09-12 ｜ 范围：`modu-reader/books/book_api.py`（本地运行时工具，books/ 在 .gitignore 内，不入库、即时生效）

## 一、背景与瓶颈

扫描版 PDF（109/267 本无文本层）此前走 RapidOCR v3（`rapidocr-onnxruntime` 1.2.3），单页 **9.11s**，217 页 ≈ 36 分钟/本，过慢。

实测排除的提速路径（均有数据）：
| 尝试 | 结果 |
|---|---|
| 4/8 进程并行（v3） | 仅 1.1~1.4x（onnxruntime 默认抢占全部 20 核，线程争抢） |
| 限制 `intra_op_num_threads` | 仅 ±20%（CPU 推理是硬瓶颈） |
| 引擎常驻进程池 | 仍 1.1~1.3x（旧 CPU 上 onnxruntime 推理扩展性天然受限） |
| DirectML/GPU | GTX660 是 Kepler 老架构，无实际收益 |
| **4 进程并行（v6）** | **75.8s 比串行 63.9s 更慢**（内存带宽/争抢，彻底排除） |

## 二、极限性能实测链路（本次新增）

### 2.1 阶段剖析 → det 是主瓶颈
```
普通书页（1667×2500 大图）：det=5.32s(77%)  rec=1.60s(23%)  cls=0.03s(≈0)
```
**结论**：det（文本框检测）是大图直接进网络所致；rec 已内建 batch 且 batch=6 最优（16/32 因长行 padding 反而更慢）。

### 2.2 det 尺寸杠杆（`limit_type`）
关键发现：det 默认 `min+736` 语义——对 DPI150 渲染的大图（min边≥736）**ratio=1.0 不缩放**，det 直接吃原始大图。改为 **`max+1200`**（最长边压到 1200）：
```
普通书页：当前 5.03s → max1200 3.08s（-39%，框数 17→17 全保留）
学术页：  当前 10.41s → max1200 9.34s（-10%，框数 26→26）
```
max960/736 反而更慢或持平（模型 resize 后特征损失/尺寸波动），**max1200 为最优**。

### 2.3 模型换代：v5 mobile → v6 small（决定性）
config.yaml 默认模型本就是 **PP-OCRv6 small**（我们此前强制用 v5 mobile）。实测：
| 样本页 | v5 mobile | **v6 small** | 加速 |
|---|---|---|---|
| 普通书页（告白） | 3.64s | **3.38s** | -7% |
| 学术页（rational-expectations） | 11.99s | **5.86s** | **-51%** |

中文质量对比（同一页）：
```
v5 mobile：奇运(奇迹) / 权盛的象征(权威的象征) / 胶市(股市) … 明显错别字
v6 small ：安德烈·科斯托兰尼 / 权威的象征 / 股市的无冕之王 / 标点完整 ✅
```
> 注：v6 无独立 Cls 模型，沿用 v4 cls（方向分类，仅 ~0.03s，无影响）。

## 三、最终极限配置（已落盘）

| 项 | 配置 |
|---|---|
| Det | `PP-OCRv6` + `SMALL` + **`limit_type=max` + `limit_side_len=1200`** |
| Rec | `PP-OCRv6` + `SMALL` + batch=6（最优） |
| Cls | `PP-OCRv4`（v6 无 cls 模型，~0.03s） |
| 并行 | **串行**（4 worker 实测比串行更慢） |
| `_OCR_ENGINE_VER` | `v6`（缓存 key 隔离 v5/v3 旧缓存） |

## 四、性能总结（v3 → v5 → v6 演进）

| 指标 | v3（起点） | v5 mobile | **v6 small（极限）** |
|---|---|---|---|
| 普通书页 | 9.11s | 3.1~4.5s | **~3.4s**（-63% vs v3） |
| 密集学术页 | — | 16.7s | **5.86s**（-65%） |
| 19 页整本首次（CLI 实测） | — | 261.9s | **167.5s（-36%）** |
| 缓存命中 | — | 2.6s | **3.0s（服务 API）** |
| 中文质量 | 错别字多 | 少量错别字 | **干净正确** |

## 五、生产路径端到端验证（真实 content CLI + 运行中服务）

```
样本：投资组合与资产配置/426_rational-expectations.pdf（19 页扫描版）
v6 首次全量：exit=0 耗时=167.5s totalPages=2 章节数=2 ocr=True 缓存 35253d56a58ee727
v6 缓存命中：服务 API GET /api/books/content → HTTP 200, 3.0s, ok=True, ocr=True
```

## 六、结论与说明

1. **本机极限 ≈ 5.9s/学术页、3.4s/普通页（首次）**；再快需换硬件（新款 CPU AVX-512/核显 GPU）或批处理多页渲染后并行（受内存带宽制约，收益有限）。
2. `book_api.py` 位于 gitignore 的 `books/`，本地即时生效，atlas-agent 每次 spawn 子进程读取最新版本，**无需重启、无需提交**。
3. v5/v3 旧缓存保留但已被版本标记隔离，不会被误读；全部 109 本扫描版首次代读用 v6 重跑后即进入永久缓存。
4. 验证脚本留存：`scripts/ocr_v5_bench.py`、`ocr_v5_e2e_check.py`、`ocr_v5_timing.py`、`ocr_v5_vs_v6.py`、`ocr_v5_vs_v6_zh.py`、`ocr_v6_parallel.py`、`ocr_det_size_scan.py`、`ocr_stage_profiler.py`。
