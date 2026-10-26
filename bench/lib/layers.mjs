/**
 * 分层模型 —— 工作台不是平的，是有层次的。
 *
 * 为什么需要分层：
 *   如果所有应用平铺，用户面对的是「一堆卡片」，不知道哪个是基础设施、
 *   哪个是日常工具、哪个是试验品。分层给出**认知坐标**：
 *   我在哪一层？这一层的东西坏了会影响谁？
 *
 * 四层（自下而上）：
 *
 *   L0 平台  platform   外壳本身。没有它什么都跑不了。
 *                       例子：bench 外壳、设计系统、模式模块、应用注册表。
 *
 *   L1 基础  core       被多个应用共享的能力。坏了会连带多个应用。
 *                       例子：模式（专家/小白）、主题、通道层、LLM 接入。
 *
 *   L2 应用  app        面向具体任务的完整工具，用户日常在这里工作。
 *                       例子：research（研究）、learn（学习）、notes。
 *
 *   L3 实验  lab        探索性、可能随时被删或重写。允许不完善。
 *                       例子：临时脚本、新想法验证、demo。
 *
 * 依赖规则（强约束，平台会检查）：
 *   - L0 不依赖任何层
 *   - L1 只能依赖 L0
 *   - L2 只能依赖 L0 / L1
 *   - L3 可以依赖任何层（实验品允许乱来）
 *   反过来：上层坏了不影响下层；下层坏了，依赖它的上层全废。
 */

export const LAYERS = [
  {
    id: "platform",
    level: 0,
    name: "平台",
    icon: "layer-platform",
    color: "#8b95a8",
    desc: "外壳本身：设计系统、路由、注册表。没有它什么都跑不了。",
    rule: "不依赖任何层",
    failureImpact: "全部应用不可用",
  },
  {
    id: "core",
    level: 1,
    name: "基础",
    icon: "layer-core",
    color: "#5b93f8",
    desc: "被多个应用共享的能力：模式、主题、通道、LLM 接入。",
    rule: "只能依赖平台层",
    failureImpact: "依赖它的应用会降级或失效",
  },
  {
    id: "app",
    level: 2,
    name: "应用",
    icon: "layer-app",
    color: "#3ddc97",
    desc: "面向具体任务的完整工具。用户日常在这里工作。",
    rule: "只能依赖平台层 / 基础层",
    failureImpact: "只影响它自己",
  },
  {
    id: "lab",
    level: 3,
    name: "实验",
    icon: "layer-lab",
    color: "#fbbf24",
    desc: "探索性、可能随时被删掉重写。允许不完善。",
    rule: "可以依赖任何层",
    failureImpact: "无（实验品本就不保证）",
  },
];

export const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
export const DEFAULT_LAYER = "app";

export function getLayer(id) {
  return LAYER_MAP[id] ?? LAYER_MAP[DEFAULT_LAYER];
}

export function isValidLayer(id) {
  return Object.prototype.hasOwnProperty.call(LAYER_MAP, id);
}

/**
 * 依赖合法性检查。
 * @param {string} layer        该应用所在层
 * @param {string[]} requires   它依赖的应用所在层列表
 * @returns {{ok:boolean, violations:string[]}}
 */
export function checkDeps(layer, requires) {
  const self = getLayer(layer);
  const violations = [];
  for (const dep of requires ?? []) {
    const depLayer = typeof dep === "string" && LAYER_MAP[dep] ? LAYER_MAP[dep] : null;
    // 依赖写成应用 id 时，由调用方解析成层
    if (!depLayer) continue;
    if (self.id === "lab") continue; // 实验层不受限
    if (self.id === "core" && depLayer.id !== "platform") {
      violations.push(`基础层不应依赖${depLayer.name}层（${depLayer.id}）`);
    }
    if (self.id === "app" && depLayer.level > 1) {
      violations.push(`应用层不应依赖${depLayer.name}层（${depLayer.id}）`);
    }
    if (self.id === "platform" && depLayer.level > 0) {
      violations.push(`平台层不应依赖任何层，但它依赖了${depLayer.name}层`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/** 把应用按层分组，供 UI 渲染。 */
export function group(apps) {
  const out = LAYERS.map((l) => ({
    ...l,
    apps: apps.filter((a) => (a.layer ?? DEFAULT_LAYER) === l.id),
  }));
  // 未识别层的应用归到 app 层，避免丢失
  const known = new Set(LAYERS.map((l) => l.id));
  const orphans = apps.filter((a) => !known.has(a.layer ?? DEFAULT_LAYER));
  if (orphans.length) {
    const appLayer = out.find((l) => l.id === "app");
    appLayer.apps.push(...orphans.map((a) => ({ ...a, layer: "app", layerWarning: `未知层 "${a.layer}"，已归入应用层` })));
  }
  return out;
}

/** 层级的排版顺序（自下而上）。 */
export const LAYER_ORDER = LAYERS.map((l) => l.id);


/**
 * 计算影响链：如果某个应用挂了，谁会受连带影响？
 *
 * 反向追踪 requires：A requires B，则 A 在 B 的下游。
 * 返回 Map<appId, string[]>：appId 挂掉会影响到的应用列表（传递闭包）。
 */
export function impactChain(apps) {
  // 建反向索引：dep -> [依赖它的应用]
  const dependents = new Map();
  for (const a of apps) {
    for (const dep of a.requires ?? []) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(a.id);
    }
  }

  const result = new Map();
  for (const a of apps) {
    const direct = dependents.get(a.id) ?? [];
    // 传递闭包
    const seen = new Set();
    const stack = [...direct];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nx of dependents.get(cur) ?? []) stack.push(nx);
    }
    result.set(a.id, [...seen]);
  }
  return result;
}

/**
 * 按层统计依赖边的数量与是否有跨层违规。
 */
export function edgeSummary(apps) {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const edges = [];
  let crossLayer = 0;
  let violations = 0;
  for (const a of apps) {
    for (const dep of a.requires ?? []) {
      const t = byId.get(dep);
      if (!t) continue;
      const fromLevel = getLayer(a.layer).level;
      const toLevel = getLayer(t.layer).level;
      const cross = fromLevel !== toLevel;
      if (cross) crossLayer++;
      // 违规：依赖了比自己更高层（level 更大）的东西，且不是 lab
      const bad = a.layer !== "lab" && toLevel > fromLevel;
      if (bad) violations++;
      edges.push({ from: a.id, to: dep, cross, bad });
    }
  }
  return { edges, crossLayer, violations };
}
