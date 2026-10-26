/**
 * 10 款外壳设计方案。
 *
 * 每款都明确标注借鉴的商业产品，以及「借鉴什么、不借鉴什么」。
 * 前端 shell 读这里的 token + layout 来渲染，所以切换设计不需要改前端代码。
 *
 * 字段说明：
 *   id         唯一 id
 *   name       中文名
 *   ref        借鉴的商业产品（诚实标注）
 *   borrow     借鉴的具体点
 *   avoid      刻意不借鉴的点（说明取舍）
 *   tagline    一句话定位
 *   layout     布局结构：sidebar-left | sidebar-narrow | top-tabs | command | split | centered | dashboard | rail
 *   density    信息密度：low | mid | high
 *   tokens     该设计的颜色/圆角/字体/间距
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "data", "design.json");

export const DESIGNS = [
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "linear",
    name: "Linear 风",
    ref: "Linear",
    borrow: "极窄图标侧栏 + 键盘优先 + 深色低对比 + 命令面板（⌘K）",
    avoid: "不借鉴它的 issue 状态流转表（这里没有工单概念）",
    tagline: "为高频操作者设计：一切都能用键盘完成",
    layout: "sidebar-narrow",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#08090a",
      panel: "#0f1011",
      elev: "#16181a",
      line: "#1f2225",
      line2: "#2c3035",
      fg: "#f7f8f8",
      fg2: "#8a8f98",
      fg3: "#5c6169",
      ac: "#5e6ad2",
      ac2: "#1c1f3a",
      ok: "#4cb782",
      warn: "#f2c94c",
      err: "#eb5757",
      radius: "8px",
      radiusLg: "10px",
      font: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "44px",
      gap: "8px",
      shadow: "0 1px 2px rgba(0,0,0,.5)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "notion",
    name: "Notion 风",
    ref: "Notion",
    borrow: "左侧可折叠树 + 白底大留白 + 悬浮块工具条 + 无边框感",
    avoid: "不借鉴它的 emoji 泛滥（只保留应用图标）",
    tagline: "文档优先：内容比界面重要",
    layout: "sidebar-left",
    density: "low",
    tokens: {
      theme: "light",
      bg: "#ffffff",
      panel: "#fbfbfa",
      elev: "#f1f1ef",
      line: "#e9e9e7",
      line2: "#d9d9d6",
      fg: "#37352f",
      fg2: "#787774",
      fg3: "#9b9a97",
      ac: "#2383e2",
      ac2: "#e7f0fb",
      ok: "#0f7b6c",
      warn: "#cb912f",
      err: "#d44c47",
      radius: "4px",
      radiusLg: "8px",
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "48px",
      gap: "6px",
      shadow: "0 1px 3px rgba(15,15,15,.06)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "vercel",
    name: "Vercel 风",
    ref: "Vercel Dashboard",
    borrow: "极致黑白对比 + 明显网格线 + 大写小标签 + 几何切割感",
    avoid: "不借鉴它的大面积插画（会挤压工具空间）",
    tagline: "极简到近乎冷酷：只有结构，没有装饰",
    layout: "top-tabs",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#000000",
      panel: "#0a0a0a",
      elev: "#111111",
      line: "#1f1f1f",
      line2: "#333333",
      fg: "#ededed",
      fg2: "#a1a1a1",
      fg3: "#666666",
      ac: "#ffffff",
      ac2: "#1a1a1a",
      ok: "#3ecf8e",
      warn: "#f5a623",
      err: "#ff5b5b",
      radius: "0px",
      radiusLg: "0px",
      font: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Menlo, monospace',
      headerH: "56px",
      gap: "0px",
      shadow: "none",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "raycast",
    name: "Raycast 风",
    ref: "Raycast",
    borrow: "居中浮层面板 + 背景虚化 + 结果列表 + 右侧快捷键徽章",
    avoid: "不借鉴它「启动即弹窗」的强侵入（这里是常驻工作台）",
    tagline: "一切皆命令：输入框里解决 80% 操作",
    layout: "command",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#1a1a1e",
      panel: "#25252b",
      elev: "#2e2e36",
      line: "#35353d",
      line2: "#46464f",
      fg: "#f2f2f4",
      fg2: "#a7a7b3",
      fg3: "#75757f",
      ac: "#ff6363",
      ac2: "#3a2226",
      ok: "#57c785",
      warn: "#ffbd44",
      err: "#ff5c5c",
      radius: "10px",
      radiusLg: "14px",
      font: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "40px",
      gap: "6px",
      shadow: "0 16px 48px rgba(0,0,0,.55)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "perplexity",
    name: "Perplexity 风",
    ref: "Perplexity",
    borrow: "单列居中窄栏 + 引用上标 + 来源卡片条 + 大留白",
    avoid: "不借鉴它的营销首页（这里是工具，不是落地页）",
    tagline: "答案优先：界面退到内容后面",
    layout: "centered",
    density: "low",
    tokens: {
      theme: "light",
      bg: "#fcfcf9",
      panel: "#ffffff",
      elev: "#f5f5f0",
      line: "#e8e8e3",
      line2: "#d5d5ce",
      fg: "#13343b",
      fg2: "#5c7178",
      fg3: "#8fa0a6",
      ac: "#20808d",
      ac2: "#e0f0f2",
      ok: "#1a8a5a",
      warn: "#b8860b",
      err: "#c0392b",
      radius: "12px",
      radiusLg: "18px",
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "52px",
      gap: "10px",
      shadow: "0 1px 2px rgba(19,52,59,.05)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "grafana",
    name: "Grafana 风",
    ref: "Grafana / Datadog",
    borrow: "高密度卡片网格 + 顶部时间范围与筛选条 + 深色仪表盘底 + 指标优先",
    avoid: "不借鉴它的图表依赖（这里是功能面板，不是监控大屏）",
    tagline: "信息密度优先：一屏看到全部状态",
    layout: "dashboard",
    density: "high",
    tokens: {
      theme: "dark",
      bg: "#111217",
      panel: "#181b1f",
      elev: "#22252b",
      line: "#2a2d34",
      line2: "#3d4149",
      fg: "#d8d9da",
      fg2: "#9fa2a8",
      fg3: "#6e7178",
      ac: "#ff9830",
      ac2: "#3d2a18",
      ok: "#73bf69",
      warn: "#f2cc0c",
      err: "#f2495c",
      radius: "2px",
      radiusLg: "4px",
      font: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
      fontMono: '"Roboto Mono", ui-monospace, Consolas, monospace',
      headerH: "40px",
      gap: "6px",
      shadow: "none",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "obsidian",
    name: "Obsidian 风",
    ref: "Obsidian",
    borrow: "左右双栏（导航 + 编辑区）+ 深色紫调 + 标签页堆叠 + 本地优先质感",
    avoid: "不借鉴它的图插件复杂结构（这里只留一个关系图入口）",
    tagline: "为长期积累设计：文件就是数据",
    layout: "split",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#1e1e2e",
      panel: "#252537",
      elev: "#2e2e42",
      line: "#33334a",
      line2: "#45456a",
      fg: "#dcddde",
      fg2: "#a2a3ad",
      fg3: "#72737d",
      ac: "#a88bfa",
      ac2: "#33295c",
      ok: "#6ac96a",
      warn: "#e0b341",
      err: "#e5707b",
      radius: "6px",
      radiusLg: "10px",
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "42px",
      gap: "7px",
      shadow: "0 2px 8px rgba(0,0,0,.35)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "warp",
    name: "Warp 风",
    ref: "Warp Terminal",
    borrow: "块状输出（block）+ 行内提示条 + 命令即卡片的纵向流",
    avoid: "不借鉴它的 AI 建议浮层（容易挡住内容）",
    tagline: "每次操作是一个块：可回看、可重跑",
    layout: "rail",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#0f1116",
      panel: "#15171e",
      elev: "#1d2029",
      line: "#262a34",
      line2: "#373d4a",
      fg: "#e6e6e6",
      fg2: "#9ca0ab",
      fg3: "#6a6f7c",
      ac: "#01c7a4",
      ac2: "#0d3733",
      ok: "#01c7a4",
      warn: "#ffc857",
      err: "#ff6b6b",
      radius: "6px",
      radiusLg: "10px",
      font: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "46px",
      gap: "8px",
      shadow: "0 2px 10px rgba(0,0,0,.4)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "superhuman",
    name: "Superhuman 风",
    ref: "Superhuman",
    borrow: "左右分栏（列表 + 详情）+ 超快响应感 + 快捷键浮标 + 深蓝渐变",
    avoid: "不借鉴它的邮件优先级算法（这里没有收件箱）",
    tagline: "速度即体验：任何操作都在 100ms 内响应",
    layout: "split",
    density: "mid",
    tokens: {
      theme: "dark",
      bg: "#0c1027",
      panel: "#141a33",
      elev: "#1c2342",
      line: "#252d4d",
      line2: "#38416a",
      fg: "#eef1ff",
      fg2: "#9aa3c7",
      fg3: "#68729b",
      ac: "#7b8cff",
      ac2: "#232b52",
      ok: "#3ddc97",
      warn: "#ffb800",
      err: "#ff5c7c",
      radius: "8px",
      radiusLg: "12px",
      font: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "44px",
      gap: "7px",
      shadow: "0 4px 16px rgba(12,16,39,.6)",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  {
    id: "stripe",
    name: "Stripe 风",
    ref: "Stripe Dashboard",
    borrow: "精致渐变 + 大圆角 + 舒适排版 + 分层阴影 + 蓝色主调",
    avoid: "不借鉴它的插画与动效（会拖慢工具响应）",
    tagline: "好看也是一种效率：降低长时间使用的疲劳",
    layout: "sidebar-left",
    density: "mid",
    tokens: {
      theme: "light",
      bg: "#f6f9fc",
      panel: "#ffffff",
      elev: "#f2f5f9",
      line: "#e3e8ee",
      line2: "#cfd7df",
      fg: "#1a1f36",
      fg2: "#697386",
      fg3: "#8f9bb3",
      ac: "#635bff",
      ac2: "#ecebff",
      ok: "#0e9f6e",
      warn: "#c47f17",
      err: "#df1b41",
      radius: "10px",
      radiusLg: "16px",
      font: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      fontMono: '"SF Mono", ui-monospace, Consolas, monospace',
      headerH: "56px",
      gap: "10px",
      shadow: "0 2px 5px rgba(50,50,93,.08), 0 1px 3px rgba(0,0,0,.04)",
    },
  },
  // ───────────────────────────────────────────────────────────────────────
  {
    id: "evidence",
    name: "证据台",
    ref: "学术期刊排版 + 工业仪表盘",
    borrow: "衬线标题的权威感 + 证据等级色带 + 密集数据表的可读性",
    avoid: "不抄任何 SaaS 产品（Linear/Notion/Vercel 那套是别人的语言）",
    tagline: "让「这条结论有多可信」成为视觉主角",
    layout: "top-tabs",
    density: "high",
    tokens: {
      theme: "dark",
      bg: "#0d0e0c",
      panel: "#141614",
      elev: "#1c1f1b",
      line: "#2a2e28",
      line2: "#3d443a",
      fg: "#eeeae0",
      fg2: "#a8a598",
      fg3: "#6e6d64",
      ac: "#c9a227",
      ac2: "#2e2716",
      ok: "#6fa870",
      warn: "#d4933a",
      err: "#c25a4a",
      radius: "3px",
      radiusLg: "5px",
      // 编辑排版的分工：
      //   font     = 衬线，只用于标题/结论正文（权威感）
      //   fontUi   = 无衬线，用于界面控件与数据（可读性）
      // 中文衬线优先本机思源宋体；拉丁用 Georgia（字重/对比度最接近）
      font: 'Georgia, "Noto Serif SC", "Source Han Serif SC", "Songti SC", SimSun, serif',
      fontUi: '"Segoe UI", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontMono: '"Cascadia Code", "SF Mono", Consolas, monospace',
      headerH: "48px",
      gap: "8px",
      shadow: "0 1px 3px rgba(0,0,0,.6)",
    },
  },
];


export function list() {
  return DESIGNS.map(({ tokens, ...meta }) => ({
    ...meta,
    tokens,
  }));
}

export function get(id) {
  return DESIGNS.find((d) => d.id === id) ?? null;
}

export function readCurrent() {
  try {
    const d = JSON.parse(readFileSync(FILE, "utf8"));
    return get(d.id) ? d.id : DESIGNS[0].id;
  } catch {
    return DESIGNS[0].id;
  }
}

export function writeCurrent(id) {
  if (!get(id)) throw new Error(`未知设计 ${id}`);
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ id, at: new Date().toISOString() }, null, 2), "utf8");
  } catch { /* 写不了不阻塞 */ }
  return { id };
}
