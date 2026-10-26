/**
 * bench 前端公共套件（kit.js）
 *
 * 每个应用都要重复实现的东西，抽到这里一次：
 *   - 主题同步（接收平台注入的 CSS 变量与 data-theme）
 *   - 模式同步（专家/小白，写到 data-mode）
 *   - API 调用（带应用前缀 + 统一错误处理）
 *   - Markdown 渲染（含表格）
 *   - 常用小工具（esc / pct / debounce）
 *
 * 用法（在应用的 index.html 里）：
 *   <script src="/static/kit.js"></script>
 *   <script>
 *     const api = Bench.api("myapp");   // 自动拼 /api/myapp/xxx
 *     Bench.kit.theme.sync();           // 接收平台主题
 *     el.innerHTML = Bench.kit.md(text); // 渲染 Markdown
 *   </script>
 *
 * 设计原则：
 *   1. **不依赖框架**，纯 ES5+ 语法，任何应用都能用
 *   2. **可降级**：没有平台注入时用各应用自己的兜底色值
 *   3. **不侵入**：只提供函数，不改 DOM 结构
 */
(function () {
  "use strict";

  // =========================================================================
  // 基础工具
  // =========================================================================

  var kit = {};

  kit.esc = function (s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  kit.pct = function (x, digits) {
    var n = Number(x);
    if (!isFinite(n)) return "—";
    return (n * 100).toFixed(digits == null ? 1 : digits) + "%";
  };

  kit.ms = function (x) {
    var n = Number(x);
    if (!isFinite(n)) return "—";
    return n >= 1000 ? (n / 1000).toFixed(1) + "s" : Math.round(n) + "ms";
  };

  kit.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  };

  kit.$ = function (id) { return document.getElementById(id); };
  kit.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // =========================================================================
  // 主题 / 模式同步
  // =========================================================================

  var THEME_VARS = {
    "--bench-bg": "--bg",
    "--bench-panel": "--panel",
    "--bench-elev": "--elev",
    "--bench-line": "--line",
    "--bench-line2": "--line2",
    "--bench-fg": "--fg",
    "--bench-fg2": "--fg2",
    "--bench-fg3": "--fg3",
    "--bench-ac": "--ac",
    "--bench-ok": "--ok",
    "--bench-warn": "--warn",
    "--bench-err": "--err",
  };

  kit.theme = {
    /** 应用平台下发的主题变量（写到 :root，供 CSS 里的 var(--bench-xxx) 使用）。 */
    apply: function (vars) {
      if (!vars) return;
      var root = document.documentElement;
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          root.style.setProperty(k, vars[k]);
        }
      }
    },

    /** 切换 light/dark。 */
    setMode: function (mode) {
      document.documentElement.dataset.theme = mode === "light" ? "light" : "dark";
    },

    /**
     * 挂上监听，接收平台推送并主动上报就绪。
     * 在应用启动时调用一次即可。
     */
    sync: function (onUpdate) {
      window.addEventListener("message", function (e) {
        var d = e.data;
        if (!d || d.type !== "bench:theme") return;
        if (d.mode) kit.theme.setMode(d.mode);
        if (d.vars) kit.theme.apply(d.vars);
        if (d.appMode) kit.mode.set(d.appMode);
        if (d.design) {
          kit.theme._design = d.design;
          kit.design.set(d.design);
        }
        if (typeof onUpdate === "function") onUpdate(d);
      });

      // 主动拉一次平台的当前状态（防止 iframe 加载早于平台初始化）
      try {
        fetch("/api/_platform/theme").then(function (r) { return r.json(); }).then(function (t) {
          if (t && t.mode) kit.theme.setMode(t.mode);
        }).catch(function () {});
        fetch("/api/_platform/mode").then(function (r) { return r.json(); }).then(function (m) {
          if (m && m.mode) kit.mode.set(m.mode);
        }).catch(function () {});
        fetch("/api/_platform/designs").then(function (r) { return r.json(); }).then(function (dd) {
          if (dd && dd.current) kit.design.set(dd.current);
        }).catch(function () {});
      } catch (e) {}

      try { if (window.parent !== window) window.parent.postMessage({ type: "bench:ready" }, "*"); } catch (e) {}
    },
  };

  // =========================================================================
  // 模式（专家 / 小白）
  // =========================================================================

  kit.mode = {
    current: "novice",

    set: function (mode) {
      var m = mode === "expert" ? "expert" : "novice";
      kit.mode.current = m;
      document.documentElement.dataset.mode = m;
      window.__benchMode = m;

      // 换文案：<span data-novice="..." data-expert="...">
      kit.$$("[data-novice]").forEach(function (el) {
        if (!el.dataset._expertText) el.dataset._expertText = el.textContent;
        el.textContent = m === "expert" ? el.dataset._expertText : el.dataset.novice;
      });
      kit.$$("[data-expert]").forEach(function (el) {
        if (!el.dataset._noviceText) el.dataset._noviceText = el.textContent;
        el.textContent = m === "novice" ? el.dataset._noviceText : el.dataset.expert;
      });
    },

    isExpert: function () { return kit.mode.current === "expert"; },
  };

  // =========================================================================
  // 设计感知（design）
  //
  // 平台有 11 款外壳设计，每款有自己的排版语言。应用如果完全不感知设计，
  // 就会「外壳变了、里面还是老样子」，视觉断裂。
  //
  // 这里做两件事：
  //   1. 把 design id 写到 <html data-design="...">
  //   2. 注入一套「设计适配层」样式，让应用的关键元素跟随设计语言
  //      （圆角、字体分工、卡片处理、证据色带）
  //
  // 应用不需要改代码 —— 只要用了 kit 的类名或标准元素，就会自动适配。
  // =========================================================================

  kit.design = {
    current: "linear",

    set: function (id) {
      var d = id || "linear";
      kit.design.current = d;
      document.documentElement.dataset.design = d;
      kit.design._inject();
    },

    is: function (id) { return kit.design.current === id; },

    /** 注入设计适配样式（只注入一次）。 */
    _inject: function () {
      if (document.getElementById("kit-design-styles")) return;

      var css = [
        /* ---- 证据台：编辑排版语言 ---- */
        /* 标题用衬线，正文与控件用无衬线 */
        '[data-design="evidence"] h1, [data-design="evidence"] h2, [data-design="evidence"] h3 {',
        '  font-family: Georgia, "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif !important;',
        '  font-weight: 400 !important;',
        '  letter-spacing: -.01em;',
        '}',
        /* 卡片：去圆角、去阴影、细边框 */
        '[data-design="evidence"] .card,',
        '[data-design="evidence"] .q-card,',
        '[data-design="evidence"] .item,',
        '[data-design="evidence"] .layer {',
        '  border-radius: 0 !important;',
        '  box-shadow: none !important;',
        '}',
        /* 按钮：直角、无渐变 */
        '[data-design="evidence"] .btn,',
        '[data-design="evidence"] button {',
        '  border-radius: 2px !important;',
        '}',
        /* 证据等级色带（如果应用用了 chain-tier 类） */
        '[data-design="evidence"] .chain-item {',
        '  border-left: 2px solid var(--line2); padding-left: 9px; margin-left: -11px;',
        '}',
        '[data-design="evidence"] .chain-item.tA { border-left-color: #6fa870; }',
        '[data-design="evidence"] .chain-item.tB { border-left-color: #7f9ec4; }',
        '[data-design="evidence"] .chain-item.tC { border-left-color: #d4933a; }',
        '[data-design="evidence"] .chain-item.tD { border-left-color: #8a8a80; }',
        '[data-design="evidence"] .chain-tier { background: none !important; border: none !important; font-weight: 700; }',
        '[data-design="evidence"] .chain-item.tA .chain-tier { color: #6fa870; }',
        '[data-design="evidence"] .chain-item.tB .chain-tier { color: #7f9ec4; }',
        '[data-design="evidence"] .chain-item.tC .chain-tier { color: #d4933a; }',
        '[data-design="evidence"] .chain-item.tD .chain-tier { color: #8a8a80; }',
        /* 徽章：去底色，纯文字 + 字距 */
        '[data-design="evidence"] .badge,',
        '[data-design="evidence"] .macro,',
        '[data-design="evidence"] .chip {',
        '  background: none !important; border-radius: 0 !important;',
        '  letter-spacing: .06em;',
        '}',
        /* KPI：细体大字 + 竖分隔 */
        '[data-design="evidence"] .kpi {',
        '  background: none !important; border: none !important;',
        '  border-left: 1px solid var(--line2) !important; border-radius: 0 !important;',
        '  padding: 2px 0 2px 13px !important;',
        '}',
        '[data-design="evidence"] .kpi .v {',
        '  font-family: Georgia, "Noto Serif SC", serif !important;',
        '  font-weight: 400 !important; font-size: 25px !important; letter-spacing: -.03em;',
        '}',
        '[data-design="evidence"] .kpi .k { font-size: 9px !important; letter-spacing: .12em; text-transform: uppercase; }',
        /* 表格：编辑式，无竖线 */
        '[data-design="evidence"] table { border-collapse: collapse; }',
        '[data-design="evidence"] th {',
        '  font-size: 9.5px !important; letter-spacing: .1em; text-transform: uppercase;',
        '  border-bottom: 1px solid var(--line2) !important;',
        '}',
        '[data-design="evidence"] td { border-bottom: 1px solid var(--line) !important; }',
        /* 输入框：直角、细边框 */
        '[data-design="evidence"] input[type="text"],',
        '[data-design="evidence"] textarea,',
        '[data-design="evidence"] select { border-radius: 2px !important; }',
        /* 压制应用里硬编码的装饰色（紫/粉/蓝强调）——
           让「证据台」的金色成为唯一强调色，视觉才统一 */
        '[data-design="evidence"] {',
        '  /* 应用里的强调色一律收敛到平台主色（金），否则每个应用一套色 */',
        '  /* 应用的 --ac 也收敛（否则按钮还是各应用自己的色） */',
        '  --ac: var(--bench-ac) !important;',
        '  --violet: var(--bench-ac);',
        '  --pink: var(--bench-ac);',
        '  --accent: var(--bench-ac);',
        '  --ac2: color-mix(in srgb, var(--bench-ac) 14%, transparent) !important;',
        '  --accent-soft: color-mix(in srgb, var(--bench-ac) 14%, transparent) !important;',
        '  --header-bg: var(--bench-bg) !important;',
        '  --code-bg: var(--bench-bg) !important;',
        '  --graph-bg: var(--bench-bg) !important;',
        '}',
        /* 渐变柱图/进度条：改成实色，编辑风格不用渐变 */
        '[data-design="evidence"] [class*="bar-fill"],',
        '[data-design="evidence"] [class*="bar"] > i {',
        '  background-image: none !important;',
        '}',
        /* 圆角一律压平（应用里写死的 12px/8px 等） */
        '[data-design="evidence"] [class*="card"],',
        '[data-design="evidence"] [class*="btn"],',
        '[data-design="evidence"] [class*="chip"],',
        '[data-design="evidence"] [class*="badge"],',
        '[data-design="evidence"] [class*="tag"],',
        '[data-design="evidence"] [class*="pill"],',
        '[data-design="evidence"] textarea,',
        '[data-design="evidence"] input,',
        '[data-design="evidence"] select {',
        '  border-radius: 2px !important;',
        '}',
        /* 代码：保持等宽，但用设计的 mono */
        '[data-design="evidence"] code, [data-design="evidence"] pre { letter-spacing: 0; }',
      ].join(String.fromCharCode(10));

      var st = document.createElement("style");
      st.id = "kit-design-styles";
      st.textContent = css;
      document.head.appendChild(st);
    },
  };

  // =========================================================================
  // API（自动加应用前缀）
  // =========================================================================

  /**
   * 创建 API 客户端。
   * @param {string} appId 应用 id，自动拼成 /api/<appId>/<path>
   */
  kit.api = function (appId) {
    var base = "/api/" + appId;
    return function (path, opts) {
      var o = opts || {};
      var init = {
        method: o.method || "GET",
        headers: { "Content-Type": "application/json" },
      };
      if (o.body !== undefined) {
        init.body = typeof o.body === "string" ? o.body : JSON.stringify(o.body);
      }
      return fetch(base + path, init).then(function (r) {
        var ct = r.headers.get("content-type") || "";
        var parse = ct.indexOf("json") >= 0 ? r.json() : r.text();
        return parse.then(function (d) {
          if (!r.ok) {
            var msg = (d && d.error) || ("HTTP " + r.status);
            var err = new Error(msg);
            err.status = r.status;
            err.data = d;
            throw err;
          }
          return d;
        });
      });
    };
  };

  // =========================================================================
  // Markdown 渲染（含表格、代码块、列表）
  // =========================================================================

  kit.md = function (src) {
    if (!src) return "";
    var lines = String(src).replace(/\r\n/g, "\n").split("\n");
    var out = [];
    var inCode = false;
    var buf = [];
    var lt = null;

    function closeList() {
      if (lt) { out.push("</" + lt + ">"); lt = null; }
    }

    function inline(t) {
      return kit.esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        // 裸 URL 也要变成链接（报告里经常直接贴 URL）
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];

      if (/^```/.test(raw)) {
        if (inCode) { out.push("<pre><code>" + kit.esc(buf.join("\n")) + "</code></pre>"); buf = []; inCode = false; }
        else { closeList(); inCode = true; }
        continue;
      }
      if (inCode) { buf.push(raw); continue; }
      if (/^\s*$/.test(raw)) { closeList(); continue; }

      var m;
      if ((m = raw.match(/^(#{1,4})\s+(.*)$/))) {
        closeList();
        out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">");
        continue;
      }
      if (/^\s*>\s?/.test(raw)) {
        closeList();
        out.push("<blockquote>" + inline(raw.replace(/^\s*>\s?/, "")) + "</blockquote>");
        continue;
      }

      // 表格
      if (/^\s*\|.*\|\s*$/.test(raw)) {
        closeList();
        var rows = [raw];
        var j = i + 1;
        while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { rows.push(lines[j]); j++; }
        i = j - 1;

        var split = function (l) {
          return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
        };
        var isSep = function (l) { return /^\s*\|[\s:-]*-[\s:|-]*\|?\s*$/.test(l); };
        var hasSep = rows.length >= 2 && isSep(rows[1]);
        var head = hasSep ? split(rows[0]) : null;
        var body = (hasSep ? rows.slice(2) : rows).map(split);

        var h = "<table>";
        if (head) {
          h += "<thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead>";
        }
        h += "<tbody>";
        for (var r = 0; r < body.length; r++) {
          h += "<tr>" + body[r].map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
        }
        h += "</tbody></table>";
        out.push(h);
        continue;
      }

      if ((m = raw.match(/^\s*[-*+]\s+(.*)$/))) {
        if (lt !== "ul") { closeList(); out.push("<ul>"); lt = "ul"; }
        out.push("<li>" + inline(m[1]) + "</li>");
        continue;
      }
      if ((m = raw.match(/^\s*\d+\.\s+(.*)$/))) {
        if (lt !== "ol") { closeList(); out.push("<ol>"); lt = "ol"; }
        out.push("<li>" + inline(m[1]) + "</li>");
        continue;
      }

      closeList();
      out.push("<p>" + inline(raw) + "</p>");
    }

    closeList();
    if (inCode) out.push("<pre><code>" + kit.esc(buf.join("\n")) + "</code></pre>");
    return out.join("\n");
  };

  // =========================================================================
  // 通用 UI 片段
  // =========================================================================

  /** 状态提示条。 */
  kit.flash = function (el, kind, text) {
    if (!el) return;
    el.innerHTML = text
      ? '<div class="kit-flash kit-' + kind + '">' + kit.esc(text) + "</div>"
      : "";
  };

  /** 按钮忙碌态。 */
  kit.busy = function (btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset._old = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="kit-spin"></span> ' + kit.esc(label || "处理中…");
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset._old || btn.textContent;
    }
  };

  /** 注入 kit 需要的样式（只注入一次）。 */
  kit.injectStyles = function () {
    if (document.getElementById("kit-styles")) return;
    var css = [
      ".kit-flash{font-size:12px;padding:9px 12px;border-radius:8px;margin:10px 0;white-space:pre-wrap}",
      ".kit-ok{background:color-mix(in srgb,var(--ok,#3ddc97) 13%,transparent);color:var(--ok,#3ddc97);border:1px solid color-mix(in srgb,var(--ok,#3ddc97) 32%,transparent)}",
      ".kit-err{background:color-mix(in srgb,var(--err,#fb7185) 13%,transparent);color:var(--err,#fb7185);border:1px solid color-mix(in srgb,var(--err,#fb7185) 32%,transparent)}",
      ".kit-info{background:color-mix(in srgb,var(--ac,#5b93f8) 13%,transparent);color:var(--ac,#5b93f8);border:1px solid color-mix(in srgb,var(--ac,#5b93f8) 32%,transparent)}",
      ".kit-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--line2,#333c4d);border-top-color:var(--ac,#5b93f8);border-radius:50%;animation:kit-sp .65s linear infinite;vertical-align:-2px}",
      "@keyframes kit-sp{to{transform:rotate(360deg)}}",
      "[data-mode=\"expert\"] .novice-only{display:none!important}",
      "[data-mode=\"novice\"] .expert-only{display:none!important}",
    ].join("\n");
    var st = document.createElement("style");
    st.id = "kit-styles";
    st.textContent = css;
    document.head.appendChild(st);
  };

  // 自动注入样式
  if (document.head) kit.injectStyles();
  else document.addEventListener("DOMContentLoaded", kit.injectStyles);

  // =========================================================================
  // 导出
  // =========================================================================

  window.Bench = window.Bench || {};
  window.Bench.kit = kit;
  window.Bench.api = kit.api;
  window.BenchTheme = kit.theme;
  window.BenchMode = kit.mode;
})();
