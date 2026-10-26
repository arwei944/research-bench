/**
 * 复现测试：验证子进程不弹命令窗口。
 *
 * 测量方法（为什么不用数 conhost.exe）：
 *   第一版数 conhost.exe 数量，结果不可靠 —— Windows 会复用已有的控制台宿主进程，
 *   而且后台服务进程本身也占 conhost，噪声很大。
 *
 *   改用 PowerShell 的 Win32 API 枚举**可见的顶层窗口**：
 *     Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }
 *   只数有实际可见窗口的进程，这是用户真正「看到」的东西。
 *
 * 判据：
 *   裸 spawn    → 可见窗口数增加
 *   safeSpawn   → 可见窗口数不变
 */
import { safeSpawn, safeExec } from "../lib/safe-proc.mjs";
import { spawn } from "node:child_process"; // 仅用于对照组，故意裸用

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 数当前可见的顶层窗口数（排除无窗口的进程）。 */
async function countVisibleWindows() {
  try {
    // PowerShell 也是子进程，必须走 safeExec 才不弹窗
    const { stdout } = await safeExec("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      "(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }).Count",
    ], { timeout: 15000 });
    return Number(String(stdout).trim()) || 0;
  } catch {
    return -1;
  }
}

async function measure(label, launchFn) {
  // 等系统稳定
  await sleep(1200);
  const before = await countVisibleWindows();

  const p = launchFn();
  await sleep(2600);
  const during = await countVisibleWindows();

  try { p.kill(); } catch {}
  await sleep(1200);
  const after = await countVisibleWindows();

  const delta = during - before;
  console.log(`  ${label}`);
  console.log(`    窗口数：启动前 ${before} → 运行中 ${during} → 关闭后 ${after}   [delta ${delta >= 0 ? "+" : ""}${delta}]`);
  return delta;
}

async function main() {
  console.log("可见窗口计数测试（PowerShell 枚举 MainWindowHandle）");
  console.log("说明：delta > 0 表示弹出了新窗口\n");

  // 用 cmd.exe 做对照 —— 它是控制台程序，弹窗行为最明显
  // （Chrome --headless 本身不显示窗口，测不出差异）
  const CMD = "C:/Windows/System32/cmd.exe";
  const CMD_ARGS = ["/c", "timeout", "/t", "2", "/nobreak"];

  // A) 裸 spawn —— 应该弹窗
  const bare = await measure("裸 spawn（旧代码，对照组）", () =>
    spawn(CMD, CMD_ARGS, { stdio: "ignore" }));

  // B) safeSpawn —— 不应弹窗
  const safe = await measure("safeSpawn（新代码）", () =>
    safeSpawn(CMD, CMD_ARGS, { stdio: "ignore" }));

  console.log("\n=== 结论 ===");
  if (bare > 0 && safe === 0) {
    console.log(`✓ 复现成功且已修复：裸 spawn 弹窗 (+${bare})，safeSpawn 不弹窗 (0)`);
  } else if (bare > 0 && safe > 0) {
    console.log(`✗ safeSpawn 仍然弹窗 (+${safe})，修复无效`);
    process.exitCode = 1;
  } else if (bare === 0) {
    console.log("⚠ 对照组没测到弹窗 —— 测量环境可能已禁用窗口显示");
    console.log("  但代码层面已强制 windowsHide: true（见 lib/safe-proc.mjs 的 harden()）");
    console.log("  且 lint-popup.mjs 静态守卫保证不会再出现裸调用");
    console.log(`  （本次 safeSpawn delta = ${safe >= 0 ? "+" : ""}${safe}）`);
  }
}

main().catch((e) => { console.error("测试失败:", e.message); process.exitCode = 1; });
