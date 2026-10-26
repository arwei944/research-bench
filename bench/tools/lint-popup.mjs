#!/usr/bin/env node
/**
 * 守卫：禁止裸子进程调用。
 *
 * 铁律「任何情况下都不要弹出命令窗口」的自动化执行者。
 *
 * 检查规则：
 *   1. 不允许直接 import node:child_process（除 safe-proc.mjs 自身）
 *   2. 不允许出现裸 spawn/execFile/spawnSync/execSync/exec
 *   3. 不允许 cmd /c start（会显式弹窗）
 *   4. 不允许 shell: true（会经由 cmd.exe）
 *
 * 用法：node bench/tools/lint-popup.mjs [--fix-hint]
 * 退出码：0 = 通过，1 = 有违规
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [
  path.resolve(HERE, ".."),              // bench/
  path.resolve(HERE, "..", "..", "tools"), // 根 tools/
];

const ALLOW = new Set([
  // 封装本身当然要用裸 child_process
  path.resolve(HERE, "..", "lib", "safe-proc.mjs"),
  // 守卫脚本自身：它要写出被检测的字符串
  path.resolve(HERE, "lint-popup.mjs"),
  // 复现测试：故意用裸 spawn 做对照组，这是它的职责
  path.resolve(HERE, "repro-popup.mjs"),
]);

const BARE = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/;
const BAD_IMPORT = /from\s+["']node:child_process["']|require\(\s*["']node:child_process["']\s*\)/;
const CMD_START = /["']cmd["']\s*,\s*\[\s*["']\/c["']\s*,\s*["']start["']/;
const SHELL_TRUE = /\bshell\s*:\s*true/;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { walk(p, out); continue; }
    if (!/\.(mjs|js|cjs)$/.test(name)) continue;
    out.push(p);
  }
}

function lint() {
  const files = [];
  for (const r of ROOTS) walk(r, files);

  const violations = [];
  for (const f of files) {
    if (ALLOW.has(f)) continue;
    const src = readFileSync(f, "utf8");
    const lines = src.split(/\r?\n/);

    lines.forEach((line, i) => {
      // 跳过注释行
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

      const rel = path.relative(path.resolve(HERE, "..", ".."), f);
      if (BAD_IMPORT.test(line)) {
        violations.push({ file: rel, line: i + 1, rule: "import-child_process", text: trimmed.slice(0, 90) });
      }
      if (BARE.test(line)) {
        violations.push({ file: rel, line: i + 1, rule: "bare-spawn", text: trimmed.slice(0, 90) });
      }
      if (CMD_START.test(line)) {
        violations.push({ file: rel, line: i + 1, rule: "cmd-start", text: trimmed.slice(0, 90) });
      }
      if (SHELL_TRUE.test(line)) {
        violations.push({ file: rel, line: i + 1, rule: "shell-true", text: trimmed.slice(0, 90) });
      }
    });
  }
  return { scanned: files.length, violations };
}

const { scanned, violations } = lint();

console.log(`扫描 ${scanned} 个文件`);

if (!violations.length) {
  console.log("\n✓ 通过：没有裸子进程调用");
  console.log("  铁律「不弹命令窗口」已由 lib/safe-proc.mjs 统一保证");
  process.exit(0);
}

console.log(`\n✗ 发现 ${violations.length} 处违规：\n`);
const byRule = {};
for (const v of violations) (byRule[v.rule] ??= []).push(v);

const HINT = {
  "import-child_process": "改用 import { safeSpawn, safeExec, ... } from 'lib/safe-proc.mjs'",
  "bare-spawn": "改用 safeSpawn / safeExec / safeExecSync（自动带 windowsHide: true）",
  "cmd-start": "改用 openUrl()（rundll32 实现，不弹窗）",
  "shell-true": "去掉 shell: true，直接传命令与参数数组",
};

for (const [rule, list] of Object.entries(byRule)) {
  console.log(`  [${rule}]  ${list.length} 处`);
  for (const v of list.slice(0, 8)) {
    console.log(`    ${v.file}:${v.line}  ${v.text}`);
  }
  if (list.length > 8) console.log(`    ... 还有 ${list.length - 8} 处`);
  console.log(`    → ${HINT[rule]}\n`);
}

process.exit(1);
