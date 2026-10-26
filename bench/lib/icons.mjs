/**
 * bench 图标系统 —— 等线几何标记
 *
 * 设计原则（对应「证据台」的视觉语言）：
 *   1. 24×24 网格，1.5px 描边，无填充 —— 像技术图纸的线稿
 *   2. 圆角只用 0.5px（几乎直角），与外壳的 2-3px 呼应
 *   3. 单色：stroke="currentColor"，跟随设计主色
 *   4. 每个图标表达「动作」而非「名词」——
 *      研究 = 扫描收敛，学习 = 逐层堆叠，实验 = 变量对照
 *   5. 不用 emoji、不用 Unicode 符号 —— 跨平台渲染一致
 *
 * 用法：
 *   <svg class="ico"><use href="/static/icons.svg#i-research"/></svg>
 *   或 JS：Bench.icon("research")
 */

// ---------------------------------------------------------------------------
// 图标定义：每个是 <svg> 内的子元素字符串（viewBox 0 0 24 24）
// ---------------------------------------------------------------------------

const P = {
  // ---- 平台层 ----
  shell: `
    <rect x="3" y="4" width="18" height="16" rx="1"/>
    <path d="M3 9h18"/>
    <path d="M6 6.5h4"/>`,

  // ---- 基础层 ----
  mode: `
    <rect x="3" y="5" width="8" height="14" rx="1"/>
    <path d="M8 9h3M8 12h3M8 15h3"/>
    <rect x="14" y="5" width="7" height="14" rx="1" stroke-dasharray="2 2"/>`,

  "design-system": `
    <rect x="3" y="3" width="7" height="7" rx="0.5"/>
    <rect x="14" y="3" width="7" height="7" rx="0.5"/>
    <rect x="3" y="14" width="7" height="7" rx="0.5"/>
    <path d="M17.5 14v7M14 17.5h7"/>`,

  // ---- 应用层 ----
  // 实验器：两组变量对照，中间是判分线
  labset: `
    <rect x="3" y="6" width="7" height="12" rx="1"/>
    <rect x="14" y="6" width="7" height="12" rx="1"/>
    <path d="M12 4v16" stroke-dasharray="2 2"/>`,

  // 研究：从散点到收敛的扫描
  research: `
    <circle cx="10" cy="10" r="6"/>
    <path d="M14.5 14.5L20 20"/>
    <path d="M7 10h6M10 7v6"/>`,

  // 学习：逐层堆叠的知识
  learn: `
    <path d="M12 3L3 8l9 5 9-5-9-5z"/>
    <path d="M3 12l9 5 9-5"/>
    <path d="M3 16l9 5 9-5"/>`,

  // 草稿台：未成形的散点
  scratchpad: `
    <path d="M4 4h9l7 7v9H4z"/>
    <path d="M13 4v7h7"/>
    <path d="M8 15h6M8 18h4"/>`,

  // ---- 层级标记（比应用图标更抽象）----
  // 平台：基座
  "layer-platform": `
    <path d="M3 19h18"/>
    <path d="M7 19v-5M17 19v-5"/>
    <path d="M5 14h14"/>`,

  // 基础：承托
  "layer-core": `
    <circle cx="12" cy="12" r="4"/>
    <circle cx="12" cy="12" r="8.5" stroke-dasharray="2 3"/>`,

  // 应用：完整方块
  "layer-app": `
    <rect x="4" y="4" width="16" height="16" rx="1"/>
    <path d="M4 9h16"/>
    <circle cx="7" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>`,

  // 实验：虚线框
  "layer-lab": `
    <rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2 2.5"/>
    <path d="M9 12h6M12 9v6"/>`,

  // ---- 功能图标 ----
  theme: `
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 4v16" />
    <path d="M12 4a8 8 0 0 1 0 16" fill="currentColor" stroke="none" opacity="0.25"/>`,

  // 换设计 = 同一内容的不同呈现（实线块 vs 虚线块）
  design: `
    <rect x="3" y="4" width="18" height="6" rx="1"/>
    <rect x="3" y="14" width="18" height="6" rx="1" stroke-dasharray="2.5 2.5"/>
    <path d="M17 4v6M17 14v6" opacity="0.35"/>`,

  home: `
    <path d="M4 11l8-7 8 7"/>
    <path d="M6 10v10h12V10"/>`,

  // 管理 = 三条滑杆 + 旋钮（不用齿轮：12 条线在 16px 下糊成一团）
  manage: `
    <path d="M4 7h5M13 7h7M4 12h9M17 12h3M4 17h4M12 17h8"/>
    <circle cx="11" cy="7" r="2.2"/>
    <circle cx="15" cy="12" r="2.2"/>
    <circle cx="10" cy="17" r="2.2"/>`,

  reload: `
    <path d="M20 12a8 8 0 1 1-2.5-5.8"/>
    <path d="M20 4v5h-5"/>`,

  // 证据等级标记
  "tier-a": `
    <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7l7-4z"/>
    <path d="M9 12l2 2 4-4"/>`,

  "tier-b": `
    <circle cx="12" cy="12" r="8"/>
    <path d="M8 12l3 3 5-6"/>`,

  "tier-c": `
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 8v4M12 15h.01"/>`,

  "tier-d": `
    <circle cx="12" cy="12" r="8" stroke-dasharray="2 2.5"/>
    <path d="M12 9v5M12 16h.01"/>`,
};

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

/** 生成一个完整 <svg> 字符串。 */
export function iconSvg(name, { size = 16, cls = "ico", strokeWidth = 1.5 } = {}) {
  const body = P[name];
  if (!body) return "";
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ` +
    `aria-hidden="true">${body.trim()}</svg>`;
}

/** 全部图标名。 */
export function iconNames() {
  return Object.keys(P);
}

/** 生成 sprite 表（一次加载，多处 <use> 引用）。 */
export function iconSprite() {
  const symbols = Object.entries(P).map(([name, body]) =>
    `  <symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body.trim()}</symbol>`
  ).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n${symbols}\n</svg>`;
}

/**
 * 应用 id → 图标名。
 * 有些应用 id 与图标名一致，有些需要映射。
 */
export const APP_ICON = {
  shell: "shell",
  mode: "mode",
  "design-system": "design-system",
  labset: "labset",
  research: "research",
  learn: "learn",
  scratchpad: "scratchpad",
};

/** 层级 id → 图标名。 */
export const LAYER_ICON = {
  platform: "layer-platform",
  core: "layer-core",
  app: "layer-app",
  lab: "layer-lab",
};

export function appIcon(appId) {
  return APP_ICON[appId] ?? "layer-app";
}

export function layerIcon(layerId) {
  return LAYER_ICON[layerId] ?? "layer-app";
}
