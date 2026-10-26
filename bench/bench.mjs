#!/usr/bin/env node
/**
 * bench 命令行 —— 应用增删查
 *
 *   node bench/bench.mjs list
 *   node bench/bench.mjs new  <id> [--name "名称"] [--icon "🔬"] [--template blank|api|data]
 *   node bench/bench.mjs rm   <id> [--force]
 *   node bench/bench.mjs start|stop|status|restart|logs [--port 7800] [--open]
 *
 * 也可以只用 Web UI 的「应用管理」面板，两者效果完全相同。
 */

import { safeSpawn, safeSpawnSync, safeExecSync, openUrl } from "./lib/safe-proc.mjs";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

import * as scaffold from "./lib/scaffold.mjs";
import * as registry from "./lib/registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "data");
const PID = path.join(DATA, "bench.pid");
const LOG = path.join(DATA, "bench.log");
const DEF_PORT = 7800;

function ensure() { if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true }); }
/** 查某个端口实际是哪个 PID 在监听（Windows netstat / 类 Unix lsof）。 */
async function listeningPid(port) {
  try {
    if (process.platform === "win32") {
      const out = safeExecSync("netstat", ["-ano"]);
      const line = out.split("\n").find((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
      if (!line) return null;
      const parts = line.trim().split(/\s+/);
      return Number(parts[parts.length - 1]) || null;
    }
    const out = safeExecSync("lsof", ["-ti", `tcp:${port}`]);
    return Number(out.trim().split("\n")[0]) || null;
  } catch {
    return null;
  }
}

function readPid() {
  if (!existsSync(PID)) return null;
  const n = Number(readFileSync(PID, "utf8").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function freePort(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once("error", () => res(freePort(p + 1)));
    s.once("listening", () => s.close(() => res(p)));
    s.listen(p, "127.0.0.1");
  });
}
async function waitReady(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url + "/api/_platform/ping", { signal: AbortSignal.timeout(2500) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "list";
const flag = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

async function start() {
  ensure();
  const pid = readPid();
  if (alive(pid)) { console.log(`已在运行 (PID ${pid})`); return status(); }
  const port = Number(flag("--port", DEF_PORT));
  // 固定端口优先：如果 7800 被占，先提示，再自动让位（并明确打印实际端口）
  const realPort = await freePort(port);
  if (realPort !== port) {
    console.log(`⚠ 端口 ${port} 被占用，改用 ${realPort}`);
  }
  const out = openSync(LOG, "a");
  const c = safeSpawn(process.execPath, [path.join(HERE, "server.mjs"), "--port", String(realPort)], {
    cwd: HERE,
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      // Node 的 fetch 只在进程启动时读这个开关；在这里注入，避免服务端自我重启
      ...(process.env.HTTPS_PROXY || process.env.HTTP_PROXY ? { NODE_USE_ENV_PROXY: "1" } : {}),
    },
  });
  c.unref();
  writeFileSync(PID, String(c.pid), "utf8");
  const url = `http://127.0.0.1:${realPort}`;
  process.stdout.write(`启动中 (PID ${c.pid}, 端口 ${realPort}) …`);
  const ok = await waitReady(url);
  console.log(ok ? " 就绪" : " 超时（看 data/bench.log）");

  // 校验：pid 文件记的进程是否真的活着并监听
  if (ok) {
    const real = await listeningPid(realPort);
    if (real && real !== c.pid) {
      console.log(`  ⚠ 实际监听 PID 为 ${real}（与记录 ${c.pid} 不同），已校正`);
      writeFileSync(PID, String(real), "utf8");
    }
  }
  console.log(`\n  访问: ${url}`);
  console.log(`  应用: ${registry.APPS_ROOT}`);
  console.log(`  日志: ${LOG}`);
  if (ok && has("--open")) {
    // 不用 cmd /c start —— 那会闪一个命令窗口（见 lib/safe-proc.mjs 的说明）
    if (!openUrl(url)) console.log("  （无法自动打开浏览器，请手动访问上面的地址）");
  }
  if (!ok) process.exitCode = 1;
}

async function stop() {
  const port = Number(flag("--port", DEF_PORT));
  const fromPid = readPid();
  const fromPort = await listeningPid(port);
  const targets = [...new Set([fromPid, fromPort].filter((x) => x && alive(x)))];

  if (!targets.length) {
    console.log("未在运行");
    if (existsSync(PID)) unlinkSync(PID);
    return;
  }
  for (const pid of targets) {
    try { process.kill(pid, "SIGTERM"); } catch {}
    if (process.platform === "win32") safeSpawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
  }
  if (existsSync(PID)) unlinkSync(PID);

  // 确认端口真的释放
  await new Promise((r) => setTimeout(r, 800));
  const still = await listeningPid(port);
  if (still) {
    console.log(`⚠ 端口 ${port} 仍被 PID ${still} 占用`);
  } else {
    console.log(`已停止 (PID ${targets.join(", ")})`);
  }
}

function status() {
  const pid = readPid();
  const a = alive(pid);
  console.log(`状态: ${a ? `运行中 (PID ${pid})` : "未运行"}`);
  if (a) console.log(`地址: http://127.0.0.1:${Number(flag("--port", DEF_PORT))}`);
  console.log(`应用目录: ${registry.APPS_ROOT}`);
}

function logs() {
  if (!existsSync(LOG)) return console.log("暂无日志");
  console.log(readFileSync(LOG, "utf8").trim().split("\n").slice(-50).join("\n"));
}

// 铁律守卫：启动前检查没有裸子进程调用（否则会弹命令窗口）
async function guardPopup() {
  try {
    const out = safeExecSync(process.execPath, [path.join(HERE, "tools", "lint-popup.mjs")]);
    if (/没有裸子进程调用/.test(out)) return true;
  } catch (e) {
    console.error("\n⚠ 铁律检查未通过（子进程可能弹窗）：");
    console.error(String(e.stdout || e.message).split("\n").slice(0, 14).join("\n"));
    console.error("");
    return false;
  }
  return true;
}

switch (cmd) {
  case "list": {
    const apps = registry.discover();
    if (!apps.length) { console.log("还没有应用。用 `node bench/bench.mjs new <id>` 建一个。"); break; }
    console.log(`共 ${apps.length} 个应用：\n`);
    for (const a of apps) {
      const caps = [a.hasServer ? "API" : "", a.hasPublic ? "页面" : "", a.hasData ? "data" : ""].filter(Boolean).join("+");
      console.log(`  ${a.icon}  ${a.id.padEnd(18)} ${a.name.padEnd(16)} ${caps}`);
      if (a.tagline) console.log(`      ${a.tagline}`);
      if (a.error) console.log(`      ⚠ ${a.error}`);
    }
    break;
  }
  case "new": {
    const id = argv[1];
    if (!id || id.startsWith("-")) { console.error("用法: node bench/bench.mjs new <id> [--name N] [--icon I] [--template T]"); process.exitCode = 1; break; }
    try {
      const r = scaffold.create(id, {
        name: flag("--name", id),
        icon: flag("--icon", "▦"),
        template: flag("--template", "api"),
      });
      console.log(`✔ 已创建 ${r.id}（模板 ${r.template}）`);
      console.log(`  目录: ${r.dir}`);
      console.log(`  文件: ${r.files.join(", ")}`);
      console.log(`\n下一步: 打开 http://127.0.0.1:${Number(flag("--port", DEF_PORT))}/#${r.id}`);
    } catch (e) {
      console.error("✘ " + e.message);
      process.exitCode = 1;
    }
    break;
  }
  case "rm": {
    const id = argv[1];
    if (!id || id.startsWith("-")) { console.error("用法: node bench/bench.mjs rm <id> [--force]"); process.exitCode = 1; break; }
    try {
      const r = scaffold.remove(id, { force: has("--force") });
      console.log(`✔ 已删除 ${r.id}`);
    } catch (e) {
      console.error("✘ " + e.message);
      process.exitCode = 1;
    }
    break;
  }
  case "start":
    await guardPopup();
    await start();
    break;
  case "stop": await stop(); break;
  case "restart": await stop(); await new Promise((r) => setTimeout(r, 500)); await start(); break;
  case "status": status(); break;
  case "logs": logs(); break;
  case "templates":
    for (const t of scaffold.templateList) console.log(`  ${t.id.padEnd(10)} ${t.label} — ${t.desc}`);
    break;
  default:
    console.log(`bench 命令行

  list                              列出全部应用
  new  <id> [--name N] [--icon I] [--template blank|api|data]   新建应用
  rm   <id> [--force]               删除应用
  templates                         列出模板
  start [--port 7800] [--open]      启动平台
  stop | restart | status | logs    进程管理`);
    process.exitCode = 1;
}
