/**
 * 主题派生（浏览器版）—— 从一套设计 token 生成明暗相反的版本。
 *
 * 与服务端 lib/theme-derive.mjs 是同一套算法，这里是浏览器可直接用的副本。
 * 为什么不做成共享模块：服务端是 ESM（import/export），浏览器 script 标签需要
 * 挂到 window 上；强行统一会增加构建步骤，而这段代码只有 100 行且不会常改。
 *
 * 用法：
 *   BenchThemeDerive.deriveTokens(tokens, "light")   // 深色 token → 浅色
 *   BenchThemeDerive.deriveTokens(tokens, "dark")    // 浅色 token → 深色
 */
(function () {
  "use strict";

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

  function toHex(c) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return c.a != null && c.a < 1 ? "#" + h(c.r) + h(c.g) + h(c.b) + h(c.a * 255) : "#" + h(c.r) + h(c.g) + h(c.b);
  }

  function rgbToHsl(c) {
    const R = c.r / 255, G = c.g / 255, B = c.b / 255;
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

  function hslToRgb(c) {
    if (c.s === 0) {
      const v = Math.round(c.l * 255);
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
    const q = c.l < 0.5 ? c.l * (1 + c.s) : c.l + c.s - c.l * c.s;
    const p = 2 * c.l - q;
    return {
      r: hue2rgb(p, q, c.h + 1 / 3) * 255,
      g: hue2rgb(p, q, c.h) * 255,
      b: hue2rgb(p, q, c.h - 1 / 3) * 255,
      a: 1,
    };
  }

  const STRUCTURAL = ["bg", "panel", "elev", "line", "line2", "fg", "fg2", "fg3"];
  const ACCENT = ["ac", "ac2", "ok", "warn", "err"];

  function flipColor(hex, target, key) {
    const rgb = parseHex(hex);
    if (!rgb) return hex;
    const hsl = rgbToHsl(rgb);

    if (STRUCTURAL.indexOf(key) >= 0) {
      const flipped = 1 - hsl.l;
      hsl.l = Math.max(0.04, Math.min(0.97, flipped));
      if (key === "bg" || key === "panel" || key === "elev") hsl.s = Math.min(hsl.s, 0.08);
      else if (key === "line" || key === "line2") hsl.s = Math.min(hsl.s, 0.14);
      else hsl.s = Math.min(hsl.s, 0.12);
    } else if (ACCENT.indexOf(key) >= 0) {
      if (target === "light") {
        hsl.l = Math.min(hsl.l, 0.55);
        hsl.s = Math.min(1, hsl.s * 1.05);
      } else {
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

  function deriveTokens(tokens, target) {
    if (!tokens) return tokens;
    const out = {};
    for (const k in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, k)) continue;
      out[k] = tokens[k];
    }
    out.theme = target;

    for (const key in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, key)) continue;
      const v = tokens[key];
      if (typeof v !== "string") continue;
      if (!/^#[0-9a-f]{3,8}$/i.test(v)) continue;
      out[key] = flipColor(v, target, key);
    }

    if (typeof tokens.shadow === "string") {
      out.shadow = target === "light"
        ? "0 1px 2px rgba(16,24,40,.08)"
        : (tokens.shadow.indexOf("rgba") >= 0 ? tokens.shadow : "0 1px 2px rgba(0,0,0,.5)");
    }
    return out;
  }

  window.BenchThemeDerive = { deriveTokens, isTheme: (t, x) => (t && t.theme ? t.theme : "dark") === x };
})();
