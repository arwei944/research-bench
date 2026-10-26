/**
 * 实验器 · 配置矩阵
 *
 * 一次实验 = 任务集 × 配置集。配置就是"同一模型下，什么被改变了"。
 *
 * 每个配置有多个**因子（factor）**，因子就是可独立开关的操控项。
 * 这是整个实验器的核心设计：**只改一个因子，才能归因**。
 *
 * 当前实现的因子（对应研究里已确认的杠杆）：
 *   scaffold     脚手架：是否给"分步思考"的指令
 *   selfcheck    自检：是否要求模型输出前自查一遍
 *   graderNudge  判分器提示：是否提示"注意格式，只输出答案"
 *   temperature  温度：采样随机性
 *   decompose    任务分解：是否把任务拆成两步问
 *
 * 默认配置集是为"消融实验"设计的：基线 + 逐个加一个因子。
 */

export const FACTORS = {
  scaffold: {
    name: "分步思考",
    desc: "要求模型先给出推理步骤，再给答案",
    apply: (prompt) =>
      `${prompt}\n\n请先分步写出推理过程，最后单独一行写"答案：<你的最终答案>"。`,
    onAnswer: (raw) => {
      // 从"答案："之后取
      const m = String(raw).match(/答案\s*[:：]\s*([\s\S]*)$/);
      return m ? m[1].trim() : raw;
    },
  },

  selfcheck: {
    name: "自检",
    desc: "要求模型在给答案前自查一遍",
    apply: (prompt) =>
      `${prompt}\n\n注意：给出答案前，请先自查一遍计算/推理是否正确，再给最终答案。`,
    onAnswer: null,
  },

  formatNudge: {
    name: "格式约束",
    desc: "强调只输出答案本身，不要解释",
    // 格式类：每轮都加
    everyTurn: true,
    apply: (prompt) =>
      `${prompt}\n\n严格要求：最终回复只包含答案本身，不要任何解释、标点或单位。`,
    onAnswer: null,
  },

  decompose: {
    name: "任务分解",
    desc: "先问一个更小的中间问题，再问原问题（两轮）",
    // 这是唯一需要两次调用的因子，runner 会特殊处理
    twoPhase: true,
    apply: (prompt) => prompt,
    onAnswer: null,
  },

  calibration: {
    name: "置信度校准",
    desc: "要求模型同时给出答案与自评置信度，用于算 ECE（知道自己不知道吗）",
    // 格式类因子：必须作用于**每一轮**，否则末轮输出不带置信度、也无法解析
    everyTurn: true,
    // 这个因子不改变任务本身，只改变**输出格式**，且要额外解析置信度
    apply: (prompt) =>
      `${prompt}\n\n请在最后一行严格按以下格式给出答案与置信度（置信度是 0-100 的整数，表示你认为这个答案正确的把握）：\n答案：<你的最终答案> | 置信度：<0-100>`,
    onAnswer: (raw) => {
      // 去掉置信度尾巴，只留答案部分给验证器
      const t = String(raw);
      const m = t.match(/答案\s*[:：]\s*([\s\S]*?)(?:\||置信度|$)/);
      return m ? m[1].trim() : t;
    },
    parseConfidence: true,
  },
};

/** 一组预设配置（消融实验设计）。 */
export const CONFIGS = [
  {
    id: "baseline",
    name: "基线",
    desc: "原始 prompt，什么都不加",
    factors: {},
    temperature: 0.0,
  },
  {
    id: "scaffold",
    name: "+分步思考",
    desc: "在基线上只加分步思考",
    factors: { scaffold: true },
    temperature: 0.0,
  },
  {
    id: "selfcheck",
    name: "+自检",
    desc: "在基线上只加自检要求",
    factors: { selfcheck: true },
    temperature: 0.0,
  },
  {
    id: "format",
    name: "+格式约束",
    desc: "在基线上只加强制格式",
    factors: { formatNudge: true },
    temperature: 0.0,
  },
  {
    id: "scaffold+check",
    name: "+分步+自检",
    desc: "两个因子叠加，看是否互补",
    factors: { scaffold: true, selfcheck: true },
    temperature: 0.0,
  },
  {
    id: "all",
    name: "+全部因子",
    desc: "分步 + 自检 + 格式约束（三个一起）",
    factors: { scaffold: true, selfcheck: true, formatNudge: true },
    temperature: 0.0,
  },
  {
    id: "calibration",
    name: "+置信度校准",
    desc: "基线上只加「同时给出置信度」，用于算 ECE（不改变任务本身）",
    factors: { calibration: true },
    temperature: 0.0,
  },
];

/**
 * 从模型输出里抽置信度（0-1）。
 * 支持「置信度：85」「confidence: 0.85」「85%」等写法；抽不到返回 null。
 */
export function parseConfidence(raw) {
  const t = String(raw ?? "");
  const m =
    t.match(/置信度\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?/) ||
    t.match(/confidence\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!isFinite(n)) return null;
  if (n > 1) n = n / 100;              // 85 → 0.85；也兼容直接给 0.85
  return Math.max(0, Math.min(1, n));
}

/**
 * 把配置作用到 prompt 上，返回实际发给模型的内容。
 *
 * 两个层次的区分很重要：
 *   - 结构类因子（scaffold / selfcheck）在多轮任务里**只作用于首轮**，
 *     否则「只改一个因子」的归因会被多轮放大成不可解释的复合变量。
 *   - 格式类因子（formatNudge / calibration）必须**每一轮**都加，
 *     否则末轮输出不带可解析的格式，判分会直接失效。
 *
 * @param {string} basePrompt
 * @param {object} config
 * @param {{ everyTurn?: boolean }} [opts] 为 true 时只应用标了 everyTurn 的因子
 * @returns {{prompt: string, postprocess: ((raw:string)=>string)|null, parseConfidence: boolean}}
 */
export function buildPrompt(basePrompt, config, opts = {}) {
  let p = basePrompt;
  let postprocess = null;
  let parseConfidence = false;

  // 顺序固定：先 scaffold（结构），再 selfcheck（指令），最后 formatNudge / calibration（收尾）
  for (const key of ["scaffold", "selfcheck", "formatNudge", "calibration"]) {
    if (!config.factors?.[key]) continue;
    const f = FACTORS[key];
    if (opts.everyTurn && !f.everyTurn) continue;
    p = f.apply(p);
    if (f.onAnswer) postprocess = f.onAnswer;
    if (f.parseConfidence) parseConfidence = true;
  }
  return { prompt: p, postprocess, parseConfidence };
}

export const configById = (id) => CONFIGS.find((c) => c.id === id);
