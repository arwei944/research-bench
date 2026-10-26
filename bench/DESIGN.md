# 前端设计重做 · 交付与验收

> 日期：2026-10-27
> 设计方向：**Evidence Desk（证据台）** —— 技术编辑风
> 验收结果：**24/24 通过**（自动化脚本 `bench/tools/accept-ui.mjs`）

---

## 一、为什么重做

### 原状

11 款外壳设计，全部是**模仿现成 SaaS**：Linear 风 / Notion 风 / Vercel 风 / Stripe 风 / Raycast 风 / Grafana 风 / Obsidian 风 / Warp 风 / Superhuman 风 / Perplexity 风。

问题不只是「像别人」，而是：

1. **设计当装饰** —— 换配色不改结构，与这个系统的本质无关
2. **没有视觉主张** —— 说不出「为什么长这样」
3. **与产品灵魂脱节** —— 这个工作台的核心是「这条结论有多可信」，但可信度在界面上毫无存在感

### 判断

按 `frontend-design` skill 的标准，这正是它明确禁止的 generic 审美：
> NEVER use generic AI-generated aesthetics... predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

---

## 二、设计方向：Evidence Desk

### 概念

**这个工作台不是「好看的工具」，是一份「可核验的证据档案」。**

所以视觉语言取**学术期刊排版 + 工业仪表盘**，不是 SaaS 落地页。

### 三个核心决策

**① 证据等级成为视觉主角**

全系统只有一条语义色带：

| 等级 | 含义 | 颜色 |
|---|---|---|
| A | 可执行验证 | 苔绿 `#6fa870` |
| B | 多源交叉 | 雾蓝 `#7f9ec4` |
| C | 单一来源 | 赭黄 `#d4933a` |
| D | 个人推断 | 石灰 `#8a8a80` |

实现为**左侧竖色条**，扫一眼就知道这条结论硬不硬。

**② 字体分工（编辑排版的核心规则）**

| 用途 | 字体 | 理由 |
|---|---|---|
| 标题 / 结论正文 | Georgia + **Noto Serif SC**（思源宋体） | 「读」的内容，需要权威感 |
| 界面控件 / 数据 | Segoe UI / PingFang SC | 「操作」的界面，需要读得快 |
| 数字 / ID | Cascadia Code | 等宽对齐 |

不是「全站换衬线」—— 那会让按钮变丑。**分工才是专业做法。**

**③ 去掉一切「工具感」装饰**

- 圆角 8-12px → **2-3px**（接近直角）
- 卡片阴影 → **无**
- 渐变柱图 → **实色**
- 依赖图 → **方格纸 + 直角节点**（工程图纸）
- 背景 → 极淡噪点纹理（纸张感，不干扰阅读）

### 配色

```
深色：#0d0e0c（墨绿黑）· 强调 #c9a227（赭金）
浅色：#f2f3f1（暖纸白）· 强调 #8a6d1a（深赭）
```

刻意避开：紫色渐变、纯黑纯白、蓝色 SaaS 主调。

---

## 三、实现

### 新增文件

| 文件 | 作用 |
|---|---|
| `lib/designs.mjs` +1 设计 | `evidence` token（深色） |
| `lib/theme-derive.mjs` | 程序派生反向主题（深↔浅），避免手写 11×2 套 |
| `public/theme-derive.js` | 浏览器版派生算法 |
| `public/kit.js` +`kit.design` | 设计感知模块，注入适配样式到 iframe |
| `bench/tools/accept-ui.mjs` | **自动化验收脚本** |

### 关键机制：设计穿透到 iframe

原来的问题：外壳换了设计，iframe 里的应用还是老样子（视觉断裂）。

现在的链路：

```
shell 选中设计
  → applyDesign() 写入 --d-* 变量 + body[data-design]
  → pushTheme() postMessage 推送 design id
  → iframe 内 kit.theme.sync() 收到
  → kit.design.set(id) 写 <html data-design> + 注入适配 CSS
  → 应用的卡片/按钮/表格自动跟随设计语言
```

**应用零改动**。只要用了标准元素或 kit 类名，就自动适配。

### 修掉的 6 个真实 bug

1. **`body` 的 font-family 硬编码** —— `--font` 变量设了但没用上
2. **5 个应用不接收设计** —— shell/mode/design-system/scratchpad 完全没引 kit；research 的 `sync()` 写在 `</script>` 外面（裸文本不执行）
3. **应用强调色各不同** —— learn 紫、labset 粉，与证据台冲突。kit 统一收敛到 `--bench-ac`
4. **渐变柱图** —— 编辑风格不该用渐变
5. **依赖图节点圆角写死在 SVG** —— `rx="6"` 是属性，CSS 覆盖不了，改成按设计动态设置
6. **shell 应用原有语法错误** —— `Chrome\\/[\\d.]+` 双重转义，从未被执行检查发现

---

## 四、验收

### 自动化脚本

```bash
cd C:/work/newmax/研究智能体/bench
node tools/accept-ui.mjs
```

用 Chrome DevTools Protocol 真实驱动浏览器，检查 6 组共 24 项：

| 组 | 检查项 |
|---|---|
| 外壳 | 设计标识、三个 Tab、应用卡片、标题衬线、正文无衬线 |
| 主题 | 切浅色生效、切回深色一致 |
| **设计穿透** | **7 个应用 iframe 全部继承设计** |
| 知识层 | 结论、证据等级色带、知识库、技能、变更记录 |
| 体检 | 横幅、闭环链条、KPI、路由表 |
| 运行时 | 无 JS 异常 |

### 结果

```
========================================================
验收结果：24/24 通过
========================================================
```

```
[1] 外壳
  ✓ 设计标识生效  — evidence
  ✓ 三个首页 Tab  — 应用/体检/知识层
  ✓ 应用卡片渲染  — 7 个
  ✓ 标题用衬线  — Georgia, "Noto Serif SC"
  ✓ 正文用无衬线  — "Segoe UI", -apple-system

[2] 主题切换
  ✓ 切到浅色  — rgb(242, 243, 241)
  ✓ 切回深色  — rgb(13, 14, 12)

[3] 应用 iframe（设计穿透）
  ✓ shell  ✓ mode  ✓ design-system  ✓ labset
  ✓ research  ✓ learn  ✓ scratchpad

[4] 知识层 Tab
  ✓ 结论渲染  — 13 条
  ✓ 证据等级色带  — tC,tD,tA
  ✓ 知识库列表  — 9 篇
  ✓ 技能列表  — 5 个
  ✓ 变更记录  — 20 条

[5] 体检 Tab
  ✓ 健康横幅  ✓ 闭环链条 5 节点  ✓ KPI 15 个  ✓ 路由表 8 行

[6] 运行时错误
  ✓ 无 JS 异常
```

### 页面可达性

```
/                   200      /app/labset/       200
/designs            200      /app/research/     200
/app/shell/         200      /app/learn/        200
/app/mode/          200      /app/scratchpad/   200
/app/design-system/ 200
```

---

## 五、如何切换

**保留全部 11 款设计**（旧设计仍可用），默认切到 `evidence`：

- 顶栏 `◧` 按钮 → 设计选择器
- 点「证据台」= 新的编辑风
- 点其它 = 回到原来的 SaaS 风（仍然可用）

**没有删旧设计**，因为：
1. 有些人确实偏好 Linear 那种风格
2. 它们证明了「设计可插拔」这个架构是对的
3. 删掉会丢失对比参照

但 `evidence` 现在是默认，因为它是唯一**有设计主张**的那一款。

---

## 六、诚实记录

### 做得不够的地方

1. **只用了一款新设计**，其它 10 款还是旧的。真正彻底的重做应该是每款都重想，但那是 10 倍工作量，且用户可能只需要一款好的。
2. **浅色模式的对比度未做 WCAG 实测**。视觉上看是协调的，但没跑自动化对比度检查。
3. **动效只做了 hover**，没有 page load 的编排入场。skill 建议「一次编排好的页面加载」比零散微交互更有效，这个没做。
4. **噪点纹理在低 DPI 屏幕上可能几乎看不见** —— 这是刻意的（不干扰阅读），但也就没起到「氛围」作用。

### 一个判断失误

中途我以为「全站用衬线」就是编辑风，结果按钮和表格都变难看了。改成「标题衬线 + 正文无衬线 + 数据等宽」才对。**专业排版的分工感，不是单一字体的堆砌。**

---

## 七、一句话

> 原来的 11 款设计是「像某个 SaaS」。
> 现在的默认设计是「像一个证据档案」——
> 你能一眼看出哪条结论有 A 级证据，哪条只是我个人的推断。

---

## 八、图标系统（第二批）

> 日期：2026-10-27
> 文件：`lib/icons.mjs`（定义）+ `/static/icons.svg`（sprite）

### 问题

原图标全是 emoji 和 Unicode 符号混搭：

```
◈ shell   ◉ mode   ◆ design-system   ⚗ labset
🔬 research   🎓 learn   ◇ scratchpad
```

三个问题：
1. **emoji 跨平台渲染不一致** —— 同一个 🎓 在 Windows/Mac/Android 上是三种画风
2. **风格混乱** —— 几何符号（◈◉◆◇）与 emoji（⚗🎓🔬）混用
3. **与「证据台」冲突** —— 编辑排版的语言里塞彩色 emoji，像报纸里贴贴纸

### 设计规范

| 维度 | 规范 |
|---|---|
| 网格 | 24×24 |
| 描边 | 1.5px，`stroke-linecap: round` |
| 填充 | 无（线稿） |
| 圆角 | 0.5-1px（几乎直角，呼应外壳的 2-3px） |
| 颜色 | `currentColor`（跟随设计主色） |
| 最小尺寸 | 13px（低于这个尺寸细节会糊） |

### 关键约束：16px 下最多 3-4 个视觉元素

第一版有几个图标在 16px 实际尺寸下完全糊掉：

| 图标 | 问题 | 修法 |
|---|---|---|
| `layer-core` | 8 个辐射小点缩成一团 | 改成两个同心圆 |
| `manage` | 齿轮 12 条线 | 改成三条滑杆 + 旋钮 |
| `shell` | 空方框，无法表达「平台」 | 加标签页横线 |
| `design` | 铅笔（这里是「换外观」不是「编辑」） | 改成实线块 + 虚线块对比 |
| `layer-platform` | 柱状图，像「统计」 | 改成基座（横线 + 两支柱） |

### 语义原则：表达动作，不是名词

| 应用 | 图标含义 |
|---|---|
| 研究 | 扫描收敛（放大镜 + 十字） |
| 学习 | 逐层堆叠（三层菱形） |
| 实验器 | 两个对照样本 + 中间判分虚线 |
| 草稿台 | 未成形的散点文档 |
| 外壳 | 带标签页的容器 |
| 模式 | 实心块 + 虚线块（两种认知粒度） |
| 设计系统 | 四宫格（组件矩阵） |
| 换设计 | 同内容的两种呈现（实线 vs 虚线） |
| 管理 | 三条滑杆（可调节） |

### 实现

- `lib/icons.mjs` 定义 20 个图标，`iconSprite()` 生成 sprite
- `/static/icons.svg` 路由返回 sprite，一次加载
- 页面用 `<svg><use href="/static/icons.svg#i-name"/></svg>` 引用
- `app.json` 的 `icon` 字段现在是图标名（`research`），不再是 emoji
- `lib/layers.mjs` 同理

### 验收

```
24/24 通过（含 7 个应用 iframe 设计穿透）
```

图标总览页（深色 + 浅色两版）确认 20 个图标全部清晰可辨。

---

## 九、布局重设计（第三批）

> 日期：2026-10-27
> 依据：`frontend-skill`（"App UI made of stacked cards instead of layout" 是要拒绝的失败模式）

### 问题诊断

原布局是**垂直堆叠的卡片列表**：

```
[section 标题]
  ┌─ panel 卡片 ─┐
  │  内容        │
  └──────────────┘
[section 标题]
  ┌─ panel 卡片 ─┐
  ...
```

这正是 skill 明确拒绝的：
> "No cards by default. If a panel can become plain layout without losing meaning, remove the card treatment."

而且**信息没有优先级** —— 低频的「应用管理」表单和主工作区（应用列表）占同样的视觉权重。

### 设计论纲（按 skill 的三步法）

**① Visual thesis**
这不是文档，是**操作台**。信息按「注意力优先级」分区，不按「逻辑分类」堆叠。

**② Content plan**（按使用频率重排）

| 区域 | 内容 | 频率 |
|---|---|---|
| 主工作区（左，932px） | 依赖图 + 分层应用列表 | 90% 时间 |
| 侧栏（右，292px） | 应用管理表单 + 已安装列表 + 约定说明 | 低频 |

**③ Interaction thesis**（3 个有目的的动效）

1. **入场**：切换 Tab 时内容淡入上移，层级块错开 40ms
2. **hover**：应用卡右侧滑出「进入 →」，把 affordance 说清楚
3. **过渡**：依赖图节点 hover 高亮（已有 JS 逻辑，只补 CSS 过渡）

全部尊重 `prefers-reduced-motion`。

### 具体改动

| 项 | 之前 | 之后 |
|---|---|---|
| 整体布局 | 单列，max-width 960px | **主从两栏 grid**，max-width 1320px |
| 应用卡 | 有边框 + 圆角 + 阴影 | **无边框无阴影无圆角**，只有左侧 2px 层级色条 |
| 层级分组 | 外层方框 + 大段说明文字 | 无外层框，标题一行 + 右侧计数，说明收进 title |
| 依赖图 | 撑满整行 | `width: fit-content`，4 列节点宽度 |
| 体检/知识层 panel | 每个 section 一个方框 | **全部去框**，用分隔线分区 |
| 管理表单 | 横向 4 字段挤一行 | 侧栏纵向排列，字段标签小型大写 |
| 已安装列表 | 5 列表格 | 2 列列表（名字+id / 删除），窄栏更省空间 |
| 创建按钮 | 普通尺寸 | 占满侧栏宽度，成为明确的主动作 |

### 修掉的一个真 bug

**`hidden` 属性失效** —— 点击「体检」Tab 内容不切换。

原因：`#h-apps` / `#h-health` / `#h-kernel` 是 `<div>`，而 CSS 里**从未定义 `[hidden] { display: none }`**。
浏览器默认样式本应处理，但 `.workbench { display: grid }` 优先级更高，把它覆盖了。

修法：
```css
[hidden] { display: none !important; }
```

这个 bug 之前就存在（只是当时用 `section[hidden]` 恰好没暴露）。

### 验收

验收脚本新增 8 项布局检查，共 **33/33 通过**：

```
✓ 主从两栏布局  — 2 列
✓ 主区宽 > 侧栏  — 932px vs 292px
✓ 侧栏 sticky  — sticky
✓ 应用卡无边框  — 0px
✓ 应用卡无阴影  — none
✓ 应用卡无圆角  — 0px
✓ 体检面板去卡片  — rgba(0, 0, 0, 0)
✓ hidden 真正隐藏  — true
```

### Litmus check（skill 的最后检查）

- 品牌/产品在第一屏可辨识？→ ✓ 左上角 bench + 主标题「工作台」
- 有一个强视觉锚点？→ ✓ 方格纸依赖图
- 只扫标题能理解页面？→ ✓ 平台/基础/应用/实验 + 各层应用数
- 每个 section 一个职责？→ ✓ 依赖图=结构，分层列表=入口，侧栏=管理
- 卡片真的必要吗？→ ✓ 已全部去掉
- 去掉所有装饰阴影还 premium 吗？→ ✓ 本来就无阴影

### 诚实记录

- **没做全屏 hero**：skill 的 landing page 规范不适用，这是操作台不是落地页。
  skill 自己也说「For app UI, default to utility copy over marketing copy」。
- **动效做得克制**：只有入场 + hover 两处，没做 scroll-linked 效果（页面不够长，没必要）。
- **侧栏在窄屏会堆到下方**：`@media (max-width: 1080px)` 改单列，此时「应用管理」出现在列表下面，
  比出现在上面更合理（先看内容再管理）。

---

## 十、布局系统修复（第四批）

> 日期：2026-10-27
> 问题：设计系统「点了没变化」

### 根因

`lib/designs.mjs` 里每款设计都声明了 `layout` 字段（9 种类型），但**前端从未使用它**：

```bash
$ grep -c "layout" public/shell.html
3
# 三处全是：注释里提一句 + 设计选择器里显示布局名字
```

结果：**换设计只换配色，排版结构完全不变**。

用户感受就是「点了没反应」—— 因为除了颜色，其它什么都没变。

### 9 种 layout 现在真的生效

| layout | 结构改变 | 使用它的设计 |
|---|---|---|
| `top-tabs` | 顶部标签栏（默认） | vercel, evidence |
| `sidebar-left` | **左侧 208px 固定侧栏**，主内容右移 | notion, stripe |
| `sidebar-narrow` | **左侧 58px 图标栏**，只显示图标 | linear |
| `rail` | **左侧 44px 极窄轨**，连 logo 都隐藏 | warp |
| `command` | 居中 860px + **命令输入框视觉锚点**，隐藏依赖图 | raycast |
| `centered` | 居中 760px 窄栏，侧栏变两列横排 | perplexity |
| `dashboard` | 全宽高密度，卡片网格 180px | grafana |
| `split` | **侧栏移到左侧**（`order:-1`），固定 258px | obsidian, superhuman |

### 实现

```js
// applyDesign 里加一行
document.body.dataset.layout = d.layout || "top-tabs";
```

```css
/* 每种 layout 至少改三件事：导航位置、内容分栏、密度 */
body[data-layout="sidebar-left"] header {
  flex-direction: column;
  position: fixed;
  width: 208px;
  height: 100vh;
}
body[data-layout="sidebar-left"] main { margin-left: 208px; }
```

### 实测验证

```
设计 → 布局（实测 DOM 结构）

linear        sidebar-narrow  header=column/fixed/58px   main.ml=58px
notion        sidebar-left    header=column/fixed/208px  main.ml=208px
vercel        top-tabs        header=row/relative/1424px main.ml=0px
raycast       command         cols=1  side=static
perplexity    centered        cols=1  side=static
grafana       dashboard       cols=1  side=static
obsidian      split           cols=2  side=sticky
warp          rail            header=column/fixed/44px   main.ml=44px
superhuman    split           cols=2  side=sticky
stripe        sidebar-left    header=column/fixed/208px  main.ml=208px
evidence      top-tabs        header=row/relative/1424px main.ml=0px
```

**7/11 款设计的结构非默认**，8 种布局各有独立结构。

### 验收

新增 6 项布局系统检查，共 **39/39 通过**：

```
✓ layout 属性全部生效  — 8 种布局有独立结构
✓ 布局真的改变结构  — 7/11 款设计结构非默认
✓ sidebar-narrow 生效  — 58px fixed
✓ sidebar-left 生效  — 208px fixed
✓ rail 生效  — 44px fixed
✓ 恢复 evidence
```

### 这个 bug 的教训

**「定义了但没用」比「没定义」更危险。**

`layout` 字段在设计选择器里显示出来（`sidebar-left · 8px`），看起来像已经生效了。
但实际只用了颜色 token。这种「半实现」比完全没做更容易误导 —— 因为界面上有迹象。

检查方法：对每个声明的字段问一句「谁在消费它？」。找不到消费者，就是死的。
