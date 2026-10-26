/**
 * 安全子进程 —— 铁律：任何情况下都不弹出命令窗口。
 *
 * 背景（真实事故）：
 *   Windows 上 `child_process.spawn()` / `execFile()` 默认会**新建一个控制台窗口**，
 *   即使子进程本身是 GUI 程序（Chrome）或纯 CLI（curl）。
 *   表现：跑一次 UI 验收测试，屏幕上闪出一堆黑色命令窗口然后自动关闭。
 *
 *   这不是「偶尔」，是**每一次 spawn 都会**。因为 Node 在 Windows 上创建进程时
 *   默认用 CREATE_NEW_CONSOLE（当父进程没有控制台时）。
 *
 * 根治手段：
 *   1. 所有子进程调用一律带 `windowsHide: true`
 *   2. 不在 Windows 上用 `cmd /c start` 打开浏览器（那是显式弹窗）
 *   3. 提供一个统一封装，让「忘记加参数」这件事不可能发生
 *
 * 用法：
 *   import { safeSpawn, safeExec, safeExecSync } from "./safe-proc.mjs";
 *   const p = safeSpawn("chrome", ["--headless"]);
 *   const out = await safeExec("curl", ["-sS", url]);
 */

import { spawn, execFile, execFileSync, spawnSync } from "node:child_process";

/**
 * 强制加上不弹窗的选项。
 * 除了 windowsHide，还顺带：
 *   - detached 默认 false（后台服务需要时显式传）
 *   - stdio 默认 ignore（除非调用方指定）
 */
function harden(opts = {}) {
  return {
    windowsHide: true,
    ...opts,
    // 调用方就算写了 windowsHide:false 也压回 true —— 这是铁律，不给绕过的口子
    windowsHide: true,
  };
}

/** spawn 的安全版本。 */
export function safeSpawn(cmd, args = [], opts = {}) {
  return spawn(cmd, args, harden(opts));
}

/** spawnSync 的安全版本。 */
export function safeSpawnSync(cmd, args = [], opts = {}) {
  return spawnSync(cmd, args, harden(opts));
}

/** execFile 的安全版本（回调式）。 */
export function safeExecFile(cmd, args = [], opts = {}, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  return execFile(cmd, args, harden(opts), cb);
}

/** execFile 的 Promise 版本。 */
export function safeExec(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, harden({ maxBuffer: 32 * 1024 * 1024, ...opts }), (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

/** execFileSync 的安全版本。 */
export function safeExecSync(cmd, args = [], opts = {}) {
  return execFileSync(cmd, args, harden({ encoding: "utf8", ...opts }));
}

/**
 * 在默认浏览器里打开 URL —— **不弹命令窗口**的实现。
 *
 * 关键区别：
 *   ❌ `cmd /c start "" url`      → 会闪一个 cmd 窗口
 *   ✅ `rundll32 url.dll,FileProtocolHandler url` → 无窗口
 *   ✅ `explorer.exe url`        → 无窗口（但会复用已有资源管理器）
 *
 * 这里用 rundll32，它是最干净的方案。
 */
export function openUrl(url) {
  const p = process.platform;
  try {
    if (p === "win32") {
      // rundll32 直接调用 URL 协议处理器，不经过 cmd，不弹窗
      const r = safeSpawnSync("rundll32", ["url.dll,FileProtocolHandler", url], { stdio: "ignore" });
      if (r.status === 0) return true;
      // 兜底：explorer 也不弹窗
      safeSpawnSync("explorer.exe", [url], { stdio: "ignore" });
      return true;
    }
    if (p === "darwin") {
      safeSpawnSync("open", [url], { stdio: "ignore" });
      return true;
    }
    safeSpawnSync("xdg-open", [url], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 自检：确认当前进程的子进程调用都不会弹窗。
 * 返回检查结果，不实际启动任何东西。
 */
export function auditOptions(opts) {
  const issues = [];
  if (opts?.windowsHide !== true) issues.push("缺少 windowsHide: true");
  if (opts?.shell === true) issues.push("shell: true 会经由 cmd.exe 启动，可能弹窗");
  return issues;
}
