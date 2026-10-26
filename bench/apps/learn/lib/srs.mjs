/**
 * 间隔复习 —— SM-2 变体。
 *
 * 状态字段：
 *   ef      难度因子 easyness factor，初始 2.5，范围 [1.3, 2.8]
 *   interval 当前间隔（天）
 *   reps    连续答对次数
 *   due     下次到期时间（ms 时间戳）
 *   lapses  遗忘次数（答 grade<2）
 *   last    上次复习时间
 *
 * 评分 grade：
 *   0 完全不会
 *   1 想起来了但有困难
 *   2 正确但费力
 *   3 秒答
 *
 * 与标准 SM-2 的差别：
 *   - 加入 lapses 统计，用于「难卡」识别
 *   - 间隔上限 365 天，避免长期任务里卡片消失
 *   - 新卡首次答对直接给 1 天，而不是 1 天后又 6 天
 */

const DAY = 86400000;
const MAX_INTERVAL = 365;
const MIN_EF = 1.3;
const MAX_EF = 2.8;

export function initState(now = Date.now()) {
  return { ef: 2.5, interval: 0, reps: 0, due: now, lapses: 0, last: null };
}

export function review(state, grade, now = Date.now()) {
  const s = { ...initState(now), ...(state || {}) };

  // EF 更新（SM-2 原式）
  const delta = 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02);
  s.ef = Math.min(MAX_EF, Math.max(MIN_EF, s.ef + delta));

  if (grade < 2) {
    // 失败：重置
    s.reps = 0;
    s.interval = 0.5; // 12 小时后再来
    s.lapses = (s.lapses || 0) + 1;
  } else {
    s.reps = (s.reps || 0) + 1;
    if (s.reps === 1) s.interval = 1;
    else if (s.reps === 2) s.interval = 3;
    else s.interval = Math.round((s.interval || 1) * s.ef);
    s.interval = Math.min(MAX_INTERVAL, Math.max(1, s.interval));
  }

  s.due = now + s.interval * DAY;
  s.last = now;
  return s;
}

/** 到期队列：先按「到期时间升序」，再补未学过的卡。 */
export function dueQueue(cards, progress, limit = 12, now = Date.now()) {
  const nowTs = now;
  const items = cards.map((c) => {
    const st = progress[c.id];
    return { card: c, state: st || null, dueAt: st?.due ?? 0 };
  });

  const overdue = items
    .filter((x) => x.state && x.state.due <= nowTs)
    .sort((a, b) => a.state.due - b.state.due);

  const fresh = items.filter((x) => !x.state);

  const future = items
    .filter((x) => x.state && x.state.due > nowTs)
    .sort((a, b) => a.state.due - b.state.due);

  const out = [...overdue, ...fresh, ...future].slice(0, limit);
  return out.map((x) => ({
    id: x.card.id,
    question: x.card.question,
    answer: x.card.answer,
    tags: x.card.tags ?? [],
    node: x.card.node ?? null,
    // 课程来源（多课程合并后需要知道这张卡属于哪门课）
    course: x.card._course ?? null,
    state: x.state,
    isNew: !x.state,
    overdueDays: x.state ? Math.max(0, Math.floor((nowTs - x.state.due) / DAY)) : 0,
  }));
}

export function stats(cards, progress, now = Date.now()) {
  let due = 0, fresh = 0, learning = 0, mature = 0, lapsed = 0;
  let efSum = 0, efCount = 0;

  for (const c of cards) {
    const s = progress[c.id];
    if (!s) { fresh++; continue; }
    if (s.due <= now) due++;
    if ((s.interval || 0) >= 21) mature++;
    else learning++;
    if ((s.lapses || 0) > 0) lapsed++;
    efSum += s.ef; efCount++;
  }

  return {
    total: cards.length,
    due,
    fresh,
    learning,
    mature,
    lapsed,
    avgEf: efCount ? +(efSum / efCount).toFixed(2) : null,
    at: new Date(now).toISOString(),
  };
}
