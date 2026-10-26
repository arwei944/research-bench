/**
 * 主题派生 —— 从一套设计 token 生成明暗相反的版本。
 *
 * 背景（为什么需要这个）：
 *   10 款设计每款只定义了一套 token（7 深 3 浅）。切换主题按钮想把深色变浅色，
 *   但设计 token 是内联写到 :root 的，优先级高于 [data-theme="light"] 规则，
 *   所以按钮点了没反应。
 *
 *   手写 10×2 套 token 不现实（200 多个色值要人工调）。这里用**程序派生**：
 *   把明度轴反相，色相与饱和度尽量保留，得到视觉上协调的反向主题。
 *
 * 算法：
 *   1. 把颜色转 HSL
 *   2. 明度 L 按 L' = 1 - L 反相
 *   3. 饱和度高、明度低/高的强调色做补偿（否则蓝色会变成刺眼的浅蓝）
 *   4. 结构性颜色（bg/panel/elev/line/fg）严格反相，强调色（ac/ok/warn/err）微调
 */

// ---------------------------------------------------------------------------
// 颜色转换
// ---------------------------------------------------------------------------

function parseHex(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    const [r, g, b] = m[1].split("").map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = s.match(/^#([0-9a-f]{8})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >>> 24) & 255, g: (n >> 16) & 255, b: (n >> 8) & 255, a: (n & 255) / 255 };
  }
  return null;
}

function toHex({ r, g, b, a }) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return a != null && a < 1 ? `#${h(r)}${h(g)}${h(b)}${h(a * 255)}` : `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsl({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
    else if (max === G) h = ((B - R) / d + 2) / 6;
    else h = ((R - G) / d + 4) / 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v, a: 1 };
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
    a: 1,
  };
}

// ---------------------------------------------------------------------------
// 派生
// ---------------------------------------------------------------------------

/**
 * 结构性颜色：严格反相明度。
 * 这些决定「底色 vs 文字」的关系，反相后对比度基本保持。
 */
const STRUCTURAL = new Set(["bg", "panel", "elev", "line", "line2", "fg", "fg2", "fg3"]);

/**
 * 强调色：反相时压低饱和度、微调明度，避免浅色主题里出现刺眼的荧光色。
 */
const ACCENT = new Set(["ac", "ac2", "ok", "warn", "err"]);

/** 把单个颜色反相到目标主题。 */
function flipColor(hex, target, key) {
  const rgb = parseHex(hex);
  if (!rgb) return hex; // 非 hex（如 rgba()）原样返回
  const hsl = rgbToHsl(rgb);

  if (STRUCTURAL.has(key)) {
    // 结构色：明度反相，但**不取纯黑/纯白**（否则浅色主题会刺眼、深色主题会死黑）
    const flipped = 1 - hsl.l;
    hsl.l = Math.max(0.04, Math.min(0.97, flipped));
    // 反相后底色容易变得过饱和（深蓝底→浅蓝底），压到低饱和
    if (key === "bg" || key === "panel" || key === "elev") {
      hsl.s = Math.min(hsl.s, 0.08);
    } else if (key === "line" || key === "line2") {
      hsl.s = Math.min(hsl.s, 0.14);
    } else {
      // 文字色：保留一点色相（纯灰显得死板）
      hsl.s = Math.min(hsl.s, 0.12);
    }
  } else if (ACCENT.has(key)) {
    // 强调色：只调明度到目标主题的合理区间，保留色相
    if (target === "light") {
      // 浅色底上强调色要更深一些才看得清
      hsl.l = Math.min(hsl.l, 0.55);
      hsl.s = Math.min(1, hsl.s * 1.05);
    } else {
      // 深色底上强调色要更亮一些
      hsl.l = Math.max(hsl.l, 0.55);
      hsl.s = Math.min(1, hsl.s * 1.05);
    }
  } else {
    hsl.l = 1 - hsl.l;
  }

  const out = hslToRgb(hsl);
  out.a = rgb.a;
  return toHex(out);
}

/**
 * 从一套 token 派生目标主题的 token。
 * @param {object} tokens        原始 token
 * @param {"dark"|"light"} target 目标主题
 * @returns {object} 派生后的 token（非颜色字段原样保留）
 */
export function deriveTokens(tokens, target) {
  if (!tokens) return tokens;
  const out = { ...tokens };
  out.theme = target;

  for (const key of Object.keys(tokens)) {
    const v = tokens[key];
    if (typeof v !== "string") continue;
    if (!/^#[0-9a-f]{3,8}$/i.test(v)) continue; // 只处理 hex 颜色
    out[key] = flipColor(v, target, key);
  }

  // 阴影：浅色主题用轻阴影，深色用重阴影
  if (typeof tokens.shadow === "string") {
    out.shadow = target === "light"
      ? "0 1px 2px rgba(16,24,40,.08)"
      : tokens.shadow.includes("rgba") ? tokens.shadow : "0 1px 2px rgba(0,0,0,.5)";
  }

  return out;
}

/** 该 token 是否已经是目标主题。 */
export function isTheme(tokens, target) {
  return (tokens?.theme ?? "dark") === target;
}
