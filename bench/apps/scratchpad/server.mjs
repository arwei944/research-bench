/** 草稿台 —— 带持久化的示例。数据落在 apps/scratchpad/data/items.json */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.dirname(fileURLToPath(import.meta.url)) + "/data";
const FILE = path.join(DATA, "items.json");

function load() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; }
}
function save(v) {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  writeFileSync(FILE, JSON.stringify(v, null, 2), "utf8");
}

export const routes = {
  "GET /items": async () => ({ items: load() }),

  "POST /items": async (_ctx, body) => {
    const items = load();
    items.push({ text: String(body.text ?? ""), at: new Date().toISOString() });
    save(items);
    return { ok: true, count: items.length };
  },

  "DELETE /items": async () => {
    save([]);
    return { ok: true };
  },
};
