# bench · 统一工作台平台

> 一个服务，多个应用。新增或删除一个目录 = 新增或删除一个应用，**无需重启**。
> 零依赖：只用 Node 内置模块（≥20）。

当前运行在 **http://127.0.0.1:7800**

---

## 1. 启动

```bash
node bench/bench.mjs start --open   # 启动并打开浏览器
node bench/bench.mjs status         # 状态
node bench/bench.mjs stop           # 停止
node bench/bench.mjs restart        # 重启
node bench/bench.mjs logs           # 日志
```

---

## 2. 核心架构：一条链

```
研究 ──▶ 结论(Claim) ──▶ 证据(Evidence) ──▶ 实验(Run) ──▶ 复习(Learn)
  ▲                                                          │
  └──────────────── 置信度回写 ─────────────────────────────┘
```

四种实体存在 `bench/data/kernel/`，跨应用共享：

| 实体 | 定义 | 产出方 |
|---|---|---|
| **Artifact** | 原始产物（报告正文等） | research |
| **Claim** | 可核验的断言 | research（从「结论速览」自动抽） |
| **Run** | 带配置的执行记录 + 闸门状态 | labset |
| **Evidence** | 支撑 Claim 的证据（指向 Run/Artifact） | 自动生成 |

**Claim 的状态是推导的**：无证据→`draft`；有 A 级证据且过闸门→`supported`；只有 C 级→仍是 `draft`。

**知识层视图**：`/kernel` — 所有结论、证据链、闸门状态一屏可见。

**体检视图**：`/status` — 闭环、问题清单、进程、观测、应用状态一屏判读。

**公共前端套件**：`/static/kit.js` — 主题同步、模式切换、API 调用、Markdown 渲染，一次实现。

### 内核门面（L1）

应用只 import 一个入口：

```js
import { bench } from "../../kernel/index.mjs";

bench.claim.create({ text })
bench.claim.attachEvidence(id, { kind:"run", refId, tier:"A" })
bench.run.record({ task, config, model, result, gate })
bench.dashboard()   // 一屏数据
```

不再直接依赖 `kernel/store.mjs` / `kernel/entities.mjs`。验证：`grep -rn "kernel/store\|kernel/entities" apps/*/server.mjs` 应无输出。

### 可观测性

| 层次 | 能力 |
|---|---|
| 请求级 | 每个请求有 traceId（响应头 `X-Bench-Trace`）、耗时、状态 |
| 聚合级 | `/api/_platform/metrics` 按路由模板聚合计数/耗时/错误率/分桶 |
| 系统级 | `/api/_platform/status` 各维度状态 + 问题清单 + 闭环判定 |

慢请求（>2000ms）与 5xx 落盘 `data/trace.jsonl`，可追溯。

### 闭环（自动）

```
跑实验 → Run(带闸门) → 自动生成 Claim → 挂 A 级证据 → supported → 复习卡 → 置信度回写
```

**实验现在能自己产生知识**：labset 跑完自动把有信息量的结果写成 Claim（pass@1 <99% 或处于悬崖区才生成，100% 且安全的题跳过）。

### 文档索引

| 文件 | 内容 |
|---|---|
| **`HANDOVER.md`** | **★ 交接文档**（先读这个）：当前状态、架构地图、核心机制、踩过的坑、技术债、下一步 |
| `ARCHITECTURE.md` | 设计方案（最初的想法） |
| `ARCHITECTURE-V2.md` | 实现现状（vs 设计的差异、技术债清单） |
| `DELIVERY.md` | 交付报告（含 6 道困难任务的完整实验记录） |
| `apps/labset/DIAGNOSIS.md` | 为什么 20 道题全过 —— 实验设计诊断 |

### 三条自检命令

```bash
# 1) 门面隔离：应用不该直接依赖内核内部
grep -rn "kernel/store\|kernel/entities" bench/apps/*/server.mjs   # 期望无输出

# 2) 闭环 + 问题清单
curl -s http://127.0.0.1:7800/api/_platform/status                  # 期望 closed:true, issues:[]

# 3) 判分闸门
curl -s http://127.0.0.1:7800/api/labset/selftest                   # 期望 ok:true, 20/20, 38/38
```

---

## 3. 已有应用

| 应用 | id | 说明 |
|---|---|---|
| 🔬 研究 | `research` | 14 条外部通道：检索 → 核验 → 成稿。禁止模型编造引用。 |
| 🎓 学习 | `learn` | λ 演算实验室 · 概念地图 · 间隔复习 · 苏格拉底提问。禁止直接给答案。 |

两个应用的数据、进度、笔记完全隔离，各自在 `apps/<id>/data/` 下。

---

## 4. 分层模型 ★

工作台不是平的。分层给出**认知坐标**：我在哪一层？这一层坏了会影响谁？

| 层 | id | 名字 | 装什么 | 失效影响 |
|---|---|---|---|---|
| L0 | `platform` | 平台 | 外壳、路由分发、注册表 | **全部应用不可用** |
| L1 | `core` | 基础 | 模式、设计系统、通道、LLM 接入 | 依赖它的应用降级或失效 |
| L2 | `app` | 应用 | 面向具体任务的完整工具 | 只影响它自己 |
| L3 | `lab` | 实验 | 探索性、随时可能删掉重写 | 无（本来就不保证） |

**依赖规则（平台强制检查）**

```
L0 platform  不依赖任何层
L1 core      只能依赖 L0
L2 app       只能依赖 L0 / L1
L3 lab       可以依赖任何层
```

违例会在 UI 上红字标出。实测：把 `research`（应用层）写成 `bad-core`（基础层）的依赖 →
`✗ 依赖违规：基础层不应依赖应用层（app）`。

**当前分层**

| 层 | 应用 |
|---|---|
| L0 平台 | ◈ 外壳 |
| L1 基础 | ◉ 模式 · ◉ 设计系统 |
| L2 应用 | 🔬 研究 · 🎓 学习 |
| L3 实验 | ◇ 草稿台（示例） |

每一层不是虚的——点进去都有实际内容：
- **外壳**：可视化说明路由分发流程 + 实时状态
- **模式**：并排展示小白/专家两种渲染，可直接切换
- **设计系统**：10 款设计的 token 卡片，可当场应用
- **研究 / 学习**：完整功能
- **草稿台**：实验层示例（api 模板）

### 在 app.json 里声明层

```json
{ "id": "my-app", "layer": "core", "requires": ["mode"] }
```

- `layer` 缺省为 `app`。写错层名会被归入 `app` 并给出黄色警告。
- `requires` 里可以写应用 id，也可以直接写层名。

---

## 5. 三项新能力

### 4.1 实验层一键转正

实验层（L3）的应用卡片上有 **⬆ 转正** 按钮：

```bash
# 也可以走 API
curl -X POST http://127.0.0.1:7800/api/_platform/apps/scratchpad/layer   -H "Content-Type: application/json" -d '{"layer":"app"}'
# → {"ok":true,"id":"scratchpad","from":"lab","to":"app"}
```

转正 = 把 `app.json` 的 `layer` 从 `lab` 改成 `app`。改完立刻生效，卡片移动到应用层区块。

**为什么需要这个**：实验层的规则是"可以随便乱来"，但实验成功后要进入日常使用，就得有个明确动作把它"承诺"下来。转正按钮就是这个动作。

### 4.2 L0 层降级：应用崩了，首页还在

平台的错误处理分三层：

| 场景 | 表现 |
|---|---|
| 应用 `server.mjs` 加载时崩溃 | `/api/<id>` 返回 `{"error":"server.mjs 加载失败: ..."}`，平台继续服务 |
| 应用 handler 运行时报错 | 该请求 500，其他应用不受影响 |
| 首页渲染 | **永远可用**，崩溃的应用红边框 + `✗ 后端异常：<原因>` |

首页会用 `GET /api/_platform/apps/health` **主动探测**每个应用的后端：

```json
{ "total": 6, "ok": 5, "bad": 1,
  "apps": [{ "id": "research", "ok": true, "routes": 14 },
           { "id": "broken", "ok": false, "note": "我在加载时就崩了" }] }
```

实测：故意写一个 `throw new Error("我在加载时就崩了")` 的应用 →
- 首页仍是 200，卡片变红显示原因
- 其他 5 个应用全部正常
- 顶部计数变成「7 个 · 1 个异常」

> 踩过的坑：最初想用 `new Function(src)` 做静态语法检查，结果它不认 ESM 的 `import.meta`，
> 把 `research` / `learn` 这些正常应用**全部误报**为坏。改成运行时探测才准确。

### 4.3 依赖关系图

首页在分层图例下面有一张 SVG 依赖图：

- **横向 = 分层**（L0 最左，L3 最右）
- **箭头 = `requires`**（从依赖方指向被依赖方）
- **悬停节点**：高亮它的**上游**（它依赖的）和**下游**（会被它拖累的），其余变暗
- **点击节点**：打开该应用
- 红色虚线 = 跨层违规

当前图形：

```
L0 平台        L1 基础            L2 应用         L3 实验
◈ 外壳  ──┬─▶ ◉ 模式      ──┬─▶ 🔬 研究
          └─▶ ◉ 设计系统  ──┤
                            └─▶ 🎓 学习
                            ◉ 模式 ──▶ ◇ 草稿台
```

**影响链（实测）**：

| 挂掉 | 会连带影响 |
|---|---|
| 外壳 | design-system, learn, research, mode, scratchpad（全部） |
| 模式 | scratchpad, learn, research |
| 设计系统 | learn, research |

这就是分层的实际价值：**你能一眼看出「如果我要动 模式 这一层，会波及谁」**。

计算逻辑在 `lib/layers.mjs` 的 `impactChain()`——对 `requires` 建反向索引，求传递闭包。

### 4.4 现在每个应用都声明了真实依赖

```json
// apps/research/app.json
{ "layer": "app", "requires": ["mode", "design-system"] }
```

| 应用 | 层 | 依赖 |
|---|---|---|
| shell | platform | — |
| mode | core | shell |
| design-system | core | shell |
| research | app | mode, design-system |
| learn | app | mode, design-system |
| scratchpad | lab | mode |

7 条边，全部跨层，0 违规。

---

## 6. 核心机制：一键增删

### 3.1 命令行

```bash
# 列出全部应用
node bench/bench.mjs list

# 新建（三种模板任选）
node bench/bench.mjs new my-app --name "我的应用" --icon "🔧" --template api
node bench/bench.mjs new my-app --template blank    # 只有一个空页面
node bench/bench.mjs new my-app --template data     # 读本地 JSON 内容展示

# 删除
node bench/bench.mjs rm my-app            # data/ 有内容时会拒绝
node bench/bench.mjs rm my-app --force    # 强制删除

# 看模板列表
node bench/bench.mjs templates
```

### 3.2 Web UI

打开首页 → 往下滚到「应用管理」：

- 填 **应用 id**（小写字母开头，只含 `a-z 0-9 -`）
- 选模板 → 点「创建」→ **立刻出现在顶部标签栏**
- 每个应用行右侧有「删除」按钮

### 3.3 为什么不用重启

平台在每次请求 `/api/_platform/apps` 时**重新扫描** `apps/` 目录：

```js
// bench/lib/registry.mjs
export function discover() {
  for (const name of readdirSync(APPS_ROOT)) {
    if (!existsSync(path.join(dir, "app.json"))) continue;
    ...
  }
}
```

后端的 `server.mjs` 也按 **mtime 缓存失效**，改了代码下次请求自动重新 import：

```js
const cached = routeCache.get(id);
if (cached && cached.mtime === mtime) return { routes: cached.routes, dynamic: cached.dynamic };
const mod = await import(pathToFileURL(sf).href + `?t=${mtime}`);  // 加 ?t 打破 ESM 缓存
```

---

## 7. 应用约定（约定优于配置）

```
bench/apps/<id>/
├── app.json        必需。元数据
├── server.mjs      可选。后端，导出 routes + dynamicRoutes
├── public/         可选。静态文件，入口默认 index.html
├── content/        可选。内容数据（改完刷新生效）
└── data/           可选。运行时数据（gitignore）
```

### app.json

```json
{
  "id": "my-app",
  "name": "我的应用",
  "icon": "🔧",
  "tagline": "一句话说明",
  "color": "#5b93f8",
  "order": 100,
  "entry": "index.html",
  "version": "1.0.0"
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，缺省用目录名。API 挂在 `/api/<id>` |
| `name` / `icon` / `tagline` | 显示用 |
| `order` | 标签栏排序，小的在前（research=10, learn=20） |
| `entry` | 入口文件（相对 `public/`） |
| `enabled` | `false` 则不显示但保留 |

### server.mjs

```js
// 1) 精确路由
export const routes = {
  "GET /ping":    async () => ({ ok: true }),
  "POST /items":  async (ctx, body) => ({ ok: true, got: body }),
  "GET /items":   async (ctx) => ({ items: [] }),
};

// 2) 带路径参数的路由（平台只做前缀匹配，这里用正则）
export const dynamicRoutes = [
  {
    method: "GET",
    pattern: /^\/items\/(.+)$/,
    handler: async (ctx, body, match) => ({ id: match[1] }),
  },
];
```

`ctx` 里有：`{ req, res, url, id, method, path }`。

**特殊返回约定**（方便返回非 JSON）：

```js
return { __raw: "# Markdown", __type: "text/markdown; charset=utf-8" };  // 原样发送
return { __status: 404, error: "not found" };                            // 指定状态码
return undefined;                                                        // 自己写了 res
```

### 前端如何调后端

应用在 `/app/<id>/` 下运行，所以**必须带应用前缀**：

```js
await fetch("/api/my-app/ping");   // ✓
await fetch("/api/ping");          // ✗ 会 404
```

---

## 8. 专家模式 / 小白模式（基础模块）

### 5.1 它解决什么

同一份内容，对新手要解释、对专家要细节。传统做法是「用两套页面」或「显示/隐藏按钮」，都不对。
本模块的做法是：**同一份数据，按使用者水平决定解释深度与参数可见性**。

| 维度 | 小白模式 | 专家模式 |
|---|---|---|
| 术语 | 后面带一句话解释 | 只给术语本身 |
| 出错 | 给「怎么修」 | 给完整堆栈 |
| 参数 | 藏起来，用最安全的默认值 | 全部可见，含默认值 |
| 提示文案 | 「点运行就行」 | `Ctrl+Enter` / 命令行等价物 |
| 数据 | 「正常 / 有点慢 / 连不上」 | `137ms` / `HTTP 429` |

### 5.2 状态在哪

```
bench/data/mode.json
{ "mode": "novice", "perApp": { "learn": "novice", "research": "expert" }, "updatedAt": "..." }
```

`perApp` 允许按应用覆盖（例如研究默认专家、学习默认小白）。

### 5.3 前端用法（约定）

平台把模式写进 `<html data-mode="novice|expert">`，并推 `postMessage({type:"bench:theme", appMode})`。
应用只需要两条 CSS 规则：

```css
[data-mode="expert"] .novice-only { display: none !important; }
[data-mode="novice"] .expert-only { display: none !important; }
```

然后标记元素：

```html
<div class="hint novice-only">检索会查 5 个网站，结果都是真实抓的，不是 AI 编的。</div>
<div class="hint expert-only">GET arXiv/OpenAlex/Crossref · 相关性过滤(A≥0.4) · 跨源去重 · 证据分级</div>
```

需要换文案（不是隐藏）时用 `data-novice` / `data-expert` 属性：

```html
<span data-novice="平均难度" data-expert="平均 EF">平均难度</span>
```

逻辑分支读 `window.__benchMode`。

### 5.4 服务端用法

```js
import { adapt, annotate, modeFor } from "../../lib/mode.mjs";

const a = adapt(modeFor("research"));
a.pick({ novice: "点这里开始", expert: "POST /api/research/search" });
a.explain("β 归约", "把参数代进函数体");   // 小白 → "β 归约（把参数代进函数体）"
annotate(text, a.mode);                    // 自动给已知术语加括号解释
```

### 5.5 实时预览

`GET /api/_platform/mode/preview?sample=lambda|review|default`

返回同一份内容在两种模式下的**并排渲染结果**，用于：
- 设计选择页顶部的对比区（现在就能看到）
- 你自己验证「这条文案在小白模式下读得通吗」

```json
{
  "novice": { "blocks": [{"k":"术语","v":"β 归约（把参数代进函数体…）"}] },
  "expert": { "blocks": [{"k":"堆栈","v":"LexError: unexpected '~' at 11
  at lex..."}] },
  "diff": { "noviceHides": ["堆栈","原始请求","参数名"], "noviceAdds": ["术语解释","出错怎么修"] }
}
```

---

## 9. 10 款外壳设计

访问 **`/designs`** 查看全部方案（真实 HTML 排版预览，不是色块），点「应用」即刻切换。

每款都诚实标注了**借鉴哪个产品、借鉴什么、刻意不借鉴什么**：

| # | 名称 | 借鉴 | 布局 | 密度 | 一句话 |
|---|---|---|---|---|---|
| 1 | Linear 风 | Linear | `sidebar-narrow` | mid | 键盘优先，⌘K 解决一切 |
| 2 | Notion 风 | Notion | `sidebar-left` | low | 文档优先，白底大留白 |
| 3 | Vercel 风 | Vercel Dashboard | `top-tabs` | mid | 极致黑白，零圆角 |
| 4 | Raycast 风 | Raycast | `command` | mid | 一切皆命令，居中浮层 |
| 5 | Perplexity 风 | Perplexity | `centered` | low | 答案优先，界面退后 |
| 6 | Grafana 风 | Grafana / Datadog | `dashboard` | high | 一屏看到全部状态 |
| 7 | Obsidian 风 | Obsidian | `split` | mid | 文件就是数据，紫调双栏 |
| 8 | Warp 风 | Warp Terminal | `rail` | mid | 每次操作是一个块 |
| 9 | Superhuman 风 | Superhuman | `split` | mid | 速度即体验，深蓝渐变 |
| 10 | Stripe 风 | Stripe Dashboard | `sidebar-left` | mid | 精致渐变降低疲劳 |

### 实现机制

设计不是前端硬编码的，而是 `lib/designs.mjs` 里的 **token 集**：

```js
{
  id: "notion",
  layout: "sidebar-left",
  density: "low",
  tokens: { theme:"light", bg:"#ffffff", ac:"#2383e2", radius:"4px", headerH:"48px", ... }
}
```

外壳的 CSS 全部改读 `--d-*`：

```css
:root {
  --bg: var(--d-bg, #0b0d12);
  --ac: var(--d-ac, #5b93f8);
  --radius: var(--d-radius, 8px);
}
```

选中某款后，JS 把这些 token 写进 `documentElement.style`，整个外壳立刻换装。
`radius: "0px"` 的设计会自动给 `<body>` 加 `.no-radius` 类，强制去掉所有圆角。

**所以新增一款设计 = 往 `DESIGNS` 数组加一个对象，不改任何前端代码。**

### 颜色必须全部走变量（踩过的坑）

换到 Grafana（橙主色）时发现顶栏仍是紫色，排查到三类硬编码：

| 位置 | 原来的问题 | 修法 |
|---|---|---|
| logo 渐变 | 写死 `--violet` | 改用 `color-mix(in srgb, var(--ac) 55%, var(--ac2))` |
| 分层竖线 | 写死 `#5b93f8` 等四个色 | 改成 `var(--ac)` / `var(--ok)` / `var(--warn)`，平台层用 `color-mix` 弱化 |
| SVG 节点/文字 | 用 `fill="var(--x)"` 属性 | SVG 属性对 CSS 变量支持不稳，改用 `style="fill:var(--x)"` |

**验收方法**：切到一款主色差异大的设计（Grafana 橙 / Raycast 珊瑚红 / Stripe 紫），
用 `getComputedStyle` 抽查 `--ac`、`.layer-block` 的 `borderLeftColor`、节点 `stroke`，
三者都应是同一个色系。实测 Grafana 下全部为 `rgb(255,152,48)`。

---

## 10. 浅色模式

### 5.1 机制

平台是唯一主题源：

1. 顶部「◐」按钮切换 `dark` / `light`，写入 `bench/data/theme.json`（刷新后保持）
2. 外壳自己用 `<html data-theme="...">`
3. **iframe 内的应用通过两条路收到主题**：
   - 平台把全部关键变量打包 `postMessage({type:"bench:theme", mode, vars})` 推给子应用
   - 平台把 `data-theme` 属性直接写进子应用的 `<html>`

### 5.2 应用如何适配（三步）

**第一步**：CSS 变量用兜底 + 平台注入

```css
:root, [data-theme="dark"] {
  --bg: var(--bench-bg, #0b0d12);
  --fg: var(--bench-fg, #e8ecf4);
  --ac: var(--bench-ac, #5b93f8);
  /* ... */
}
[data-theme="light"] {
  --bg: var(--bench-bg, #f6f7f9);
  --fg: var(--bench-fg, #161b22);
  --ac: var(--bench-ac, #2563eb);
  /* ... */
}
```

变量映射表（平台 → 应用）：

| 平台变量 | 含义 |
|---|---|
| `--bench-bg` | 页面背景 |
| `--bench-panel` | 卡片背景 |
| `--bench-elev` | 次级背景（输入框、代码块底） |
| `--bench-line` / `--bench-line2` | 边框 / 强调边框 |
| `--bench-fg` / `--bench-fg2` / `--bench-fg3` | 主/次/弱文字 |
| `--bench-ac` / `--bench-ok` / `--bench-warn` / `--bench-err` | 主色/成功/警告/错误 |

**第二步**：加一段主题同步脚本（脚手架已自动生成，旧应用已注入）

```html
<script>
(function () {
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "bench:theme") return;
    document.documentElement.dataset.theme = e.data.mode;
    const r = document.documentElement.style;
    if (e.data.vars) for (const [k, v] of Object.entries(e.data.vars)) r.setProperty(k, v);
  });
  window.parent?.postMessage({ type: "bench:ready" }, "*");  // 告诉平台我加载好了
})();
</script>
```

**第三步**：检查硬编码颜色

常见漏网之鱼：`background: rgba(15,17,21,.88)`（半透明顶栏）、`#0a0c11`（代码块底）、`#080a0e`（画布底）。都改成变量：

```css
--header-bg: rgba(15,17,21,.88);   /* dark */
--header-bg: rgba(246,247,249,.9); /* light */
```

### 5.3 独立打开时的表现

应用不依赖平台也能跑：CSS 里都有 `var(--bench-xxx, 兜底值)`，没有平台注入就用深色兜底。

---

## 11. 平台 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/_platform/ping` | 存活 |
| GET | `/api/_platform/apps` | 应用列表 + 模板 + 分层分组 |
| GET | `/api/_platform/layers` | 四层定义 + 分组 + 影响链 + 依赖边 |
| GET | `/api/_platform/apps/health` | 运行时探测每个应用后端 |
| POST | `/api/_platform/apps/<id>/layer` | 改层（转正/降级）`{layer:"app"}` |
| POST | `/api/_platform/apps` | `{id, name, icon, template}` 新建 |
| DELETE | `/api/_platform/apps/<id>?force=1` | 删除 |
| GET | `/api/_platform/theme` | 读主题 |
| POST | `/api/_platform/theme` | `{mode:"light"|"dark"}` |
| GET | `/api/_platform/mode` | 读模式（含 perApp 覆盖） |
| POST | `/api/_platform/mode` | `{mode:"novice"|"expert", perApp?}` |
| GET | `/api/_platform/mode/preview` | `?sample=default|lambda|review` 实时预览 |
| GET | `/api/_platform/designs` | 10 款设计 + 当前选中 |
| POST | `/api/_platform/design` | `{id}` 切换设计 |
| GET | `/api/_platform/health` | 全部应用健康状态 |

应用路由：

| 路径 | 说明 |
|---|---|
| `/` | 外壳（首页 + 应用管理） |
| `/app/<id>/` | 应用前端 |
| `/api/<id>/<route>` | 应用后端 |

---

## 12. 目录结构

```
bench/
├── bench.mjs                命令行（new/rm/list/start/stop/…）
├── server.mjs               平台服务（外壳 + 路由分发）
├── lib/
│   ├── registry.mjs         应用发现（每次扫盘）
│   └── scaffold.mjs         脚手架 + 三套模板 + 增删
├── public/
│   └── shell.html           外壳页（标签栏 + iframe + 应用管理）
├── lib/layers.mjs           ★ 四层定义 + 依赖规则检查
├── apps/                    ← 所有应用在这
│   ├── shell/               L0 平台层：外壳自述
│   ├── mode/                L1 基础层：模式并排演示
│   ├── design-system/       L1 基础层：10 款设计 token
│   ├── scratchpad/          L3 实验层示例
│   ├── research/
│   │   ├── app.json
│   │   ├── server.mjs       routes + dynamicRoutes
│   │   ├── lib/             channels / expand / llm / store
│   │   ├── public/index.html
│   │   └── data/            报告、笔记、证据快照
│   └── learn/
│       ├── app.json
│       ├── server.mjs
│       ├── lib/             lambda / srs / coach
│       ├── public/index.html
│       ├── content/         curriculum / cards / notebooks
│       └── data/            复习进度、笔记
└── data/                    平台自己的数据（主题、日志、pid）
```

---

## 13. 迁移说明

原有两个独立工作台已迁入 `bench/apps/`，旧目录保留但**不再使用**：

| 旧位置 | 端口 | 现状 |
|---|---|---|
| `workbench/` | 7801 | 已迁移到 `bench/apps/research/`，旧服务已停 |
| `learnbench/` | 7810 | 已迁移到 `bench/apps/learn/`，旧服务已停 |
| `atlas-web/` + `scripts/atlas-embed.mjs` | 63480 | 独立方案，与本平台无关 |

迁移做了什么：
1. `server.mjs` 从「自己 listen」改成「导出 routes 表」
2. 前端 API 路径加前缀：`/api/xxx` → `/api/research/xxx`
3. 数据目录指向应用自己的 `data/`
4. 加主题同步脚本 + 浅色变量

---

## 14. 实测记录（2026-10-26）

### 一键增删（核心机制）
| 检查 | 结果 |
|---|---|
| `bench.mjs new demo-counter --template api` | ✓ 创建 4 个文件，**立刻**出现在标签栏，无需重启 |
| 访问 `/app/demo-counter/` | ✓ 200 |
| `GET /api/demo-counter/items` | ✓ `{"items":[]}` |
| `POST /api/demo-counter/items` | ✓ `{"ok":true,"count":1}`，数据落盘 `apps/demo-counter/data/items.json` |
| `bench.mjs rm demo-counter --force` | ✓ 目录完全移除 |
| Web UI 创建 `ui-created` | ✓ 立即出现在标签栏和表格里 |
| Web UI 新应用点「测试后端」 | ✓ 返回 `{"ok":true,"app":"ui-created","at":...}` |
| Web UI 删除 | ✓ 确认弹窗正常，删除后列表刷新 |

### 两个应用在统一平台下
| 检查 | 结果 |
|---|---|
| `GET /api/research/ping` | ✓ |
| `GET /api/research/channels` | ✓ 11–13/14 可用 |
| `POST /api/research/search` | ✓ 7 条真实结果 |
| `GET /api/learn/ping` | ✓ |
| `POST /api/learn/eval` (`PLUS 2 3`) | ✓ Church 数 5，6 步归约 |
| `GET /api/learn/review/stats` | ✓ 25 卡 |
| `GET /api/learn/notebooks` | ✓ 3 个笔记本 |

### 分层模型
| 检查 | 结果 |
|---|---|
| 四层分组 API | ✓ `L0 平台: ◈外壳 / L1 基础: ◉模式·◉设计系统 / L2 应用: 🔬研究·🎓学习 / L3 实验: ◇草稿台` |
| 层级视觉标识 | ✓ 左侧竖线按层着色：灰/蓝/绿，实验层为**黄色虚线** |
| 每层说明 | ✓ 显示「装什么 + 失效影响 + 依赖规则」 |
| 层内无应用 | ✓ 显示「（这一层暂时没有应用）」 |
| **依赖违例检测** | ✓ 造 `bad-core`（core 层依赖 app 层 research）→ `depViolations: ["基础层不应依赖应用层（app）"]`，UI 红字显示 |
| 未知层名 | ✓ 归入 app 层并给黄色警告 |

### 三项新能力（2026-10-26 追加）
| 检查 | 结果 |
|---|---|
| 转正 API | ✓ `POST /apps/scratchpad/layer {layer:"app"}` → `{from:"lab",to:"app"}`，卡片立刻移到应用层 |
| 转正 UI | ✓ 实验层卡片有「⬆ 转正」按钮，带确认弹窗 |
| 降级：应用崩溃 | ✓ 写 `throw new Error("我在加载时就崩了")` → `/api/broken/*` 返回结构化错误，**首页仍 200** |
| 降级：健康探测 | ✓ `GET /apps/health` 准确报 `6/7 · 坏:1 · "我在加载时就崩了"`，其余 6 个应用正常 |
| 降级：UI 提示 | ✓ 崩溃应用红边框 + `✗ 后端异常：我在加载时就崩了`，顶部计数「7 个 · 1 个异常」 |
| 依赖图渲染 | ✓ SVG 四列分层，7 条边，层标题按层着色 |
| 依赖图悬停 | ✓ 悬停「模式」→ 高亮 外壳（上游）+ 研究/学习/草稿台（下游），设计系统变暗 |
| 影响链计算 | ✓ `shell → 全部5个` / `mode → scratchpad,learn,research` / `design-system → learn,research` |
| 依赖违规检测 | ✓ 造 `bad-core`（core 依赖 app）→ `["基础层不应依赖应用层（app）"]`，图上红色虚线 |

> 修掉的 bug：`new Function()` 做语法检查不认 `import.meta`，把 research/learn/scratchpad
> 全部误报为「后端语法错误」。改为运行时探测后才准确。

### 模式（专家 / 小白）
| 检查 | 结果 |
|---|---|
| `GET /api/_platform/mode` | ✓ `{mode:"novice",perApp:{}}` |
| 点外壳「小白」按钮 | ✓ 变「专家」，写入 `data/mode.json`，持久化 |
| `GET /mode/preview?sample=lambda` | ✓ 返回小白/专家两套 blocks，术语带解释 vs 完整堆栈 |
| 模式穿透到 research 应用 | ✓ 专家模式下显示 `GET arXiv/OpenAlex/Crossref · 相关性过滤(A≥0.4)`，小白模式换成通俗解释 |
| 模式穿透到 learn 应用 | ✓ 评分的四个档位在小白模式下带「12 小时后再来」等提示 |
| 刷新后保持 | ✓ 读 `data/mode.json` |

### 10 款设计
| 检查 | 结果 |
|---|---|
| `/designs` 页面 | ✓ 200，10 张卡片全部渲染 |
| 预览是否真实排版 | ✓ 每款按自己的 layout 排版（Linear 窄图标栏 / Notion 白底文字栏 / Raycast 居中命令面板 / Grafana 双列仪表盘 / Vercel 零圆角） |
| 应用 Linear | ✓ 深色低对比 + 紫主色 + 8px 圆角，标题变「bench · Linear 风」 |
| 应用 Notion | ✓ 白底 + 蓝主色 + 4px 圆角 |
| token 走 `--d-*` | ✓ 换设计不改任何前端代码，只写 CSS 变量 |

### 浅色模式
| 检查 | 结果 |
|---|---|
| 外壳切换 dark → light | ✓ 立即生效，按钮图标变化 |
| 刷新后保持 | ✓ 写入 `data/theme.json` |
| research 应用跟随 | ✓ 整页（含原本硬编码的顶栏）变浅 |
| learn 应用跟随 | ✓ 整页变浅，含代码区与画布 |
| 独立打开应用（无平台） | ✓ 兜底深色，不报错 |

### 修掉的 4 个 bug
1. **中文路径被 URI 编码** → 应用被创建到 `C:\work\newmax\%E7%A0%94...`。
   原因：用了 `new URL(import.meta.url).pathname` 手工替换，未用 `fileURLToPath`。
2. **路由缓存命中时返回类型不一致** → `cached.routes` vs `{routes, dynamic}`，导致所有路由 404。
3. **模板里漏了 `fileURLToPath` 的 import** → 新建应用的 API 报 `fileURLToPath is not defined`。
4. **模板缺少主题变量定义** → 新应用在浅色模式下按钮变白不可见。

---

## 15. 已知限制

1. **无鉴权** —— 默认只监听 `127.0.0.1`，不要暴露公网。
2. **单进程** —— 所有应用共享一个 Node 进程，某个应用的死循环会拖慢整体（learn 的 JS 沙箱已有 2 秒超时保护）。
3. **应用崩溃隔离有限** —— `server.mjs` 加载失败会在 `/api/<id>` 返回 500，但不影响其他应用。
4. **主题只支持 dark/light 两套** —— 没有自定义配色。
5. **应用顺序靠 `app.json` 的 `order`** —— 暂不支持拖拽排序。
6. **`apps/` 下的目录名必须与 `app.json` 的 `id` 一致**（否则 `rm` 会删错目录）；平台会以目录名优先扫描。
