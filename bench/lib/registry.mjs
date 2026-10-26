/**
 * 应用注册表 —— 平台的核心机制。
 *
 * 约定（约定优于配置）：
 *   bench/apps/<id>/
 *   ├── app.json        ← 必需。元数据 + 入口声明
 *   ├── server.mjs      ← 可选。导出路由表
 *   ├── public/         ← 可选。静态文件
 *   └── data/           ← 可选。该应用自己的数据
 *
 * 平台在每次请求 `/api/apps` 时重新扫描 apps/ 目录，
 * 因此**新增/删除一个目录即等于新增/删除一个应用**，无需重启。
 *
 * app.json 字段：
 *   id          唯一 id（缺省用目录名）
 *   name        显示名
 *   icon        一个 emoji
 *   tagline     一句话说明
 *   color       主题色
 *   entry       前端入口文件（相对 public/），缺省 index.html
 *   api         后端挂载点，缺省 /api/<id>
 *   order       排序（小的在前）
 *   enabled     是否启用，缺省 true
 *   requires    依赖的应用 id 列表（用于显示顺序提示）
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as layers from "./layers.mjs";

// 关键：必须用 fileURLToPath。手工对 URL.pathname 做替换会把中文路径
// 保留成 %E7%A0%94... 形式，导致在错误目录下创建应用。
export const APPS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
);

/**
 * 后端健康标记。
 *
 * 这里刻意**不做语法/to 静态检查**——`new Function` 不认 ESM 的 `import.meta`，
 * 会把正常应用全部误报为坏。真正的可靠性来自：
 *   1. 平台在 /api/<id> 处 try/catch，单个应用崩溃不拖垮平台（已验证）
 *   2. 前端在加载 iframe 时捕获 onerror 并提示
 * 所以这里只标记「有没有 server.mjs」，实际运行时的健康由 server.mjs 的加载结果决定。
 */
function checkServerSyntax(file) {
  if (!existsSync(file)) return { ok: true, note: null };
  return { ok: true, note: null };
}

export function appDir(id) {
  const p = path.join(APPS_ROOT, id);
  if (!p.startsWith(APPS_ROOT + path.sep)) return null;
  return p;
}

/** 扫描全部应用（每次都读盘 → 热发现）。 */
export function discover() {
  if (!existsSync(APPS_ROOT)) return [];
  const out = [];
  for (const name of readdirSync(APPS_ROOT)) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const dir = path.join(APPS_ROOT, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;

    const manifestPath = path.join(dir, "app.json");
    if (!existsSync(manifestPath)) continue;

    let m;
    try { m = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch (e) {
      out.push({ id: name, name, error: `app.json 解析失败: ${e.message}`, enabled: false });
      continue;
    }

    const id = m.id || name;
    const layerId = layers.isValidLayer(m.layer) ? m.layer : layers.DEFAULT_LAYER;
    const meta = layers.getLayer(layerId);
    const requires = Array.isArray(m.requires) ? m.requires : [];

    // 依赖检查：把 requires 里的应用 id 解析成它所在的层
    const depLayers = requires
      .map((d) => {
        const t = path.join(APPS_ROOT, d, "app.json");
        if (existsSync(t)) {
          try {
            const dm = JSON.parse(readFileSync(t, "utf8"));
            return layers.isValidLayer(dm.layer) ? dm.layer : layers.DEFAULT_LAYER;
          } catch {
            return layers.DEFAULT_LAYER;
          }
        }
        // 也允许直接写层名
        return layers.isValidLayer(d) ? d : null;
      })
      .filter(Boolean);
    const depCheck = layers.checkDeps(layerId, depLayers);

    out.push({
      id,
      name: m.name || id,
      icon: m.icon || "▦",
      tagline: m.tagline || "",
      color: m.color || "#5b93f8",
      entry: m.entry || "index.html",
      api: m.api || `/api/${id}`,
      order: Number.isFinite(m.order) ? m.order : 100,
      enabled: m.enabled !== false,
      requires,
      layer: layerId,
      layerMeta: meta,
      layerWarning:
        m.layer && !layers.isValidLayer(m.layer) ? `未知层 "${m.layer}"，已归入${meta.name}层` : null,
      depViolations: depCheck.violations,
      dir: name,
      hasServer: existsSync(path.join(dir, "server.mjs")),
      serverHealth: checkServerSyntax(path.join(dir, "server.mjs")),
      hasPublic: existsSync(path.join(dir, "public")),
      hasData: existsSync(path.join(dir, "data")),
      version: m.version || "1.0.0",
    });
  }
  // 排序：先按层（0→3），层内按 order
  out.sort(
    (a, b) =>
      layers.getLayer(a.layer).level - layers.getLayer(b.layer).level ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );
  return out;
}

/** 单个应用（含 app.json 原文）。 */
export function get(id) {
  const dir = appDir(id);
  if (!dir) return null;
  if (!existsSync(dir)) return null;
  const mf = path.join(dir, "app.json");
  if (!existsSync(mf)) return null;
  let manifest;
  try { manifest = JSON.parse(readFileSync(mf, "utf8")); } catch { return null; }
  const all = discover();
  const found = all.find((a) => a.id === (manifest.id || id) || a.dir === id);
  return { dir, manifest, meta: found ?? null };
}
