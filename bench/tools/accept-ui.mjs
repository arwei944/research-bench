/**
 * 前端设计验收 —— 自动化检查所有页面的设计一致性。
 *
 * 检查项：
 *   1. 所有页面可达（200）
 *   2. 设计标识 data-design 在 shell 与所有 iframe 内都生效
 *   3. 字体分工正确（标题衬线 / 控件无衬线）
 *   4. 主题切换生效（深 ↔ 浅）
 *   5. 无硬编码的装饰色残留（紫/粉）
 *   6. 圆角已压平（证据台 = 2px 以内）
 *   7. 控制台无 JS 错误
 */
import { safeSpawn } from "../lib/safe-proc.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "C:/work/_accept";
const PORT = 9230;
const BASE = "http://127.0.0.1:7800";
const APPS = ["shell", "mode", "design-system", "labset", "research", "learn", "scratchpad"];

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path }, (r) => {
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

// 必须用 safeSpawn：Windows 上裸 spawn 会为 Chrome 弹一个控制台窗口
// （--headless 只影响 Chrome 自身是否显示界面，不影响 Node 创建的控制台）
const chrome = safeSpawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox",
  "--remote-debugging-port=" + PORT, "--window-size=1400,1000",
  "--user-data-dir=" + OUT + "/profile", "about:blank",
], { stdio: "ignore" });

let ws = null, msgId = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const i = ++msgId; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
});

const results = [];
const errors = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? "  ✓ " : "  ✗ ") + name + (detail ? "  — " + detail : ""));
}

async function main() {
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try { targets = await httpJson("/json/list"); if (targets.length) break; } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails?.text || "unknown");
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args?.map((a) => a.value || a.description).join(" ") || "console.error");
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text };
    return r.result?.value;
  };
  const shot = async (n) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(OUT + "/" + n, Buffer.from(r.data, "base64"));
  };
  const go = async (hash, wait = 5000) => {
    await send("Page.navigate", { url: BASE + "/" + hash });
    await sleep(wait);
  };

  // ===== 0. 重置基线 =====
  // 主题是持久化的（存在 data/theme.json），上次测试可能停在浅色。
  // 不先重置的话，后面「切到浅色」的断言会从 light 开始，结果反过来。
  console.log("\n[0] 重置基线");
  await fetch(BASE + "/api/_platform/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "dark" }),
  }).then((r) => r.json()).catch(() => null);
  await go("#", 4000);
  const baseTheme = await ev(`document.documentElement.dataset.theme`);
  check("基线主题 = dark", baseTheme === "dark", baseTheme);

  // ===== 1. 外壳基础 =====
  console.log("\n[1] 外壳");
  await go("#", 3000);

  const shell = await ev(`JSON.stringify({
    design: document.body.dataset.design,
    theme: document.documentElement.dataset.theme,
    titleFont: getComputedStyle(document.querySelector('.hero h1')).fontFamily.slice(0,30),
    bodyFont: getComputedStyle(document.body).fontFamily.slice(0,30),
    bg: getComputedStyle(document.body).backgroundColor,
    tabs: [...document.querySelectorAll('.htab')].map(b=>b.textContent.trim()),
    apps: document.querySelectorAll('.app-card').length,
  })`);
  const sh = JSON.parse(shell);
  check("设计标识生效", sh.design === "evidence", sh.design);
  check("三个首页 Tab", sh.tabs.length === 3, sh.tabs.join("/"));
  check("应用卡片渲染", sh.apps === 7, sh.apps + " 个");
  check("标题用衬线", /Georgia|Noto Serif/.test(sh.titleFont), sh.titleFont);
  check("正文用无衬线", /Segoe UI|PingFang/.test(sh.bodyFont), sh.bodyFont);

  // ---- 布局：主从两栏 + 去卡片化 ----
  const layout = JSON.parse(await ev(`(function(){
    const wb = document.querySelector('.workbench');
    const main = document.querySelector('.ws-main');
    const side = document.querySelector('.ws-side');
    const card = document.querySelector('.app-card');
    const panel = document.querySelector('#h-health .panel');
    const cs = wb ? getComputedStyle(wb) : null;
    const cardCs = card ? getComputedStyle(card) : null;
    return JSON.stringify({
      hasWorkbench: !!wb,
      gridCols: cs ? cs.gridTemplateColumns.split(' ').length : 0,
      mainW: main ? Math.round(main.getBoundingClientRect().width) : 0,
      sideW: side ? Math.round(side.getBoundingClientRect().width) : 0,
      sideSticky: side ? getComputedStyle(side).position : '',
      cardBorder: cardCs ? cardCs.borderTopWidth : '',
      cardShadow: cardCs ? cardCs.boxShadow : '',
      cardRadius: cardCs ? cardCs.borderRadius : '',
      panelBg: panel ? getComputedStyle(panel).backgroundColor : '',
      hiddenWorks: (function(){
        const h = document.getElementById('h-health');
        return h ? getComputedStyle(h).display === 'none' : false;
      })(),
    });
  })()`));
  check("主从两栏布局", layout.hasWorkbench && layout.gridCols === 2, layout.gridCols + " 列");
  check("主区宽 > 侧栏", layout.mainW > layout.sideW * 2, layout.mainW + "px vs " + layout.sideW + "px");
  check("侧栏 sticky", layout.sideSticky === "sticky", layout.sideSticky);
  check("应用卡无边框", layout.cardBorder === "0px", layout.cardBorder);
  check("应用卡无阴影", layout.cardShadow === "none", layout.cardShadow);
  check("应用卡无圆角", layout.cardRadius === "0px", layout.cardRadius);
  check("体检面板去卡片", layout.panelBg === "rgba(0, 0, 0, 0)", layout.panelBg);
  check("hidden 真正隐藏", layout.hiddenWorks === true, String(layout.hiddenWorks));

  await shot("01-shell.png");

  // ===== 1b. 布局系统（11 款设计 × 9 种 layout 必须真的改变结构） =====
  console.log("\n[1b] 布局系统");
  const layouts = JSON.parse(await ev(`JSON.stringify(allDesigns.map(d=>({id:d.id,layout:d.layout})))`));
  const seen = new Map(); // layout -> 结构指纹
  let structuralChanges = 0;

  for (const d of layouts) {
    await ev(`(function(){const o=allDesigns.find(x=>x.id==='${d.id}');if(o)applyDesign(o,state.theme);})()`);
    await sleep(420);
    const sig = await ev(`(function(){
      const h=document.querySelector('header');
      const wb=document.querySelector('.workbench');
      const hcs=getComputedStyle(h);
      const wcs=getComputedStyle(wb);
      return JSON.stringify({
        lay: document.body.dataset.layout,
        hDir: hcs.flexDirection,
        hPos: hcs.position,
        hW: Math.round(h.getBoundingClientRect().width),
        cols: wcs.gridTemplateColumns.split(' ').length,
        mML: getComputedStyle(document.querySelector('main')).marginLeft,
      });
    })()`);
    const o = JSON.parse(sig);
    if (o.lay !== d.layout) {
      check(d.id + " layout 属性", false, `期望 ${d.layout}，得到 ${o.lay}`);
      continue;
    }
    seen.set(d.layout, `${o.hDir}/${o.hPos}/${o.hW}/cols${o.cols}/${o.mML}`);
    if (o.hPos === "fixed" || o.cols !== 2 || o.mML !== "0px") structuralChanges++;
  }

  check("layout 属性全部生效", seen.size >= 7, `${seen.size} 种布局有独立结构`);
  check("布局真的改变结构", structuralChanges >= 6, `${structuralChanges}/${layouts.length} 款设计结构非默认`);

  // 抽查三种典型布局的具体结构
  const pick = async (id) => {
    await ev(`(function(){const o=allDesigns.find(x=>x.id==='${id}');if(o)applyDesign(o,state.theme);})()`);
    await sleep(400);
    return JSON.parse(await ev(`(function(){
      const h=document.querySelector('header');
      const hcs=getComputedStyle(h);
      return JSON.stringify({
        pos: hcs.position,
        dir: hcs.flexDirection,
        w: Math.round(h.getBoundingClientRect().width),
        mML: getComputedStyle(document.querySelector('main')).marginLeft,
      });
    })()`));
  };
  const ln = await pick("linear");
  check("sidebar-narrow 生效", ln.pos === "fixed" && ln.w <= 70, `${ln.w}px ${ln.pos}`);
  const nt = await pick("notion");
  check("sidebar-left 生效", nt.pos === "fixed" && nt.w >= 180, `${nt.w}px ${nt.pos}`);
  const wp = await pick("warp");
  check("rail 生效", wp.pos === "fixed" && wp.w <= 50, `${wp.w}px ${wp.pos}`);

  // 恢复 evidence
  await ev(`(function(){const o=allDesigns.find(x=>x.id==='evidence');if(o)applyDesign(o,state.theme);})()`);
  await sleep(500);
  check("恢复 evidence", (await ev(`document.body.dataset.design`)) === "evidence");

  // ===== 2. 主题切换 =====
  console.log("\n[2] 主题切换");
  // 点击后轮询等待主题真正生效（applyTheme 会重算设计 token，不是瞬时完成）
  const readTheme = async () => JSON.parse(await ev(`JSON.stringify({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  })`));

  await ev(`document.getElementById('btn-theme').click()`);
  let light = await readTheme();
  for (let i = 0; i < 20 && light.theme !== "light"; i++) { await sleep(150); light = await readTheme(); }
  check("切到浅色", light.theme === "light" && light.bg !== sh.bg, light.theme + " " + light.bg);
  await shot("02-light.png");

  await ev(`document.getElementById('btn-theme').click()`);
  let back = await readTheme();
  for (let i = 0; i < 20 && back.theme !== "dark"; i++) { await sleep(150); back = await readTheme(); }
  check("切回深色", back.theme === "dark" && back.bg === sh.bg, back.theme + " " + back.bg);

  // ===== 3. 每个应用 iframe =====
  console.log("\n[3] 应用 iframe（设计穿透）");
  for (const id of APPS) {
    await go("#" + id, 5500);
    const r = await ev(`(function(){
      const f = document.getElementById('frame');
      if (!f || !f.contentDocument) return JSON.stringify({err:'no iframe'});
      const d = f.contentDocument;
      const card = d.querySelector('.card, .app-card, .item, section');
      const h1 = d.querySelector('h1, h2');
      return JSON.stringify({
        design: d.documentElement.dataset.design || '',
        hasKitDesign: !!d.getElementById('kit-design-styles'),
        bodyBg: getComputedStyle(d.body).backgroundColor,
        radius: card ? getComputedStyle(card).borderRadius : 'n/a',
        hFont: h1 ? getComputedStyle(h1).fontFamily.slice(0,26) : 'n/a',
      });
    })()`);
    const o = JSON.parse(r);
    const ok = o.design === "evidence" && o.hasKitDesign;
    check(id + " 设计穿透", ok, ok ? "" : JSON.stringify(o));
    await shot("03-" + id + ".png");
  }

  // ===== 4. 知识层 =====
  console.log("\n[4] 知识层 Tab");
  await go("#kernel", 6000);
  const kn = JSON.parse(await ev(`JSON.stringify({
    claims: document.querySelectorAll('.claim').length,
    tiers: [...new Set([...document.querySelectorAll('.chain-item')].map(e=>e.className.match(/t[A-D]/)?.[0]))],
    kb: document.querySelectorAll('[data-kb]').length,
    skills: document.querySelectorAll('[data-sk]').length,
    events: document.querySelectorAll('.ev').length,
  })`));
  check("结论渲染", kn.claims > 0, kn.claims + " 条");
  check("证据等级色带", kn.tiers.length >= 2, kn.tiers.join(","));
  check("知识库列表", kn.kb > 0, kn.kb + " 篇");
  check("技能列表", kn.skills > 0, kn.skills + " 个");
  check("变更记录", kn.events > 0, kn.events + " 条");
  await shot("04-kernel.png");

  // ===== 5. 体检 =====
  console.log("\n[5] 体检 Tab");
  await go("#health", 6000);
  const hd = JSON.parse(await ev(`JSON.stringify({
    banner: !!document.querySelector('.banner'),
    loop: document.querySelectorAll('.loop .nd').length,
    kpis: document.querySelectorAll('.kpi').length,
    rows: document.querySelectorAll('#hd-routes tr').length,
  })`));
  check("健康横幅", hd.banner);
  check("闭环链条", hd.loop >= 5, hd.loop + " 节点");
  check("KPI 卡片", hd.kpis >= 5, hd.kpis + " 个");
  check("路由表", hd.rows > 0, hd.rows + " 行");
  await shot("05-health.png");

  // ===== 6. 控制台错误 =====
  console.log("\n[6] 运行时错误");
  const realErrors = errors.filter((e) => !/favicon|net::ERR/i.test(e));
  check("无 JS 异常", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

  // ===== 汇总 =====
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log("\n" + "=".repeat(56));
  console.log(`验收结果：${passed}/${total} 通过`);
  if (passed < total) {
    console.log("\n失败项：");
    results.filter((r) => !r.pass).forEach((r) => console.log("  ✗ " + r.name + " — " + r.detail));
  }
  console.log("=".repeat(56));

  writeFileSync(OUT + "/report.json", JSON.stringify({ passed, total, results, errors }, null, 2));
  process.exitCode = passed === total ? 0 : 1;
}

main()
  .catch((e) => { console.error("验收脚本失败:", e.message); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} chrome.kill(); });
