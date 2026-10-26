# 弹窗事故：定位 · 复现 · 根治

> 日期：2026-10-27
> 现象：跑测试时屏幕上闪出大量命令行窗口，然后自动关闭
> 结论：**已根治**，并加了自动化守卫防止复发

---

## 一、定位

### 症状

每次跑 `node bench/tools/accept-ui.mjs`（UI 验收测试），会连续弹出多个黑色命令窗口，
每个存活 1-3 秒后自动关闭。肉眼可见的「闪屏」。

### 排查过程

```bash
# 1. 先找所有子进程调用点
grep -rn "child_process\|spawn\|execFile" --include=*.mjs bench/ tools/
```

找到 6 处：

| 文件 | 调用 | 用途 |
|---|---|---|
| `bench/bench.mjs:34` | `execFileSync("netstat")` | 查端口占用 |
| `bench/bench.mjs:40` | `execFileSync("lsof")` | 同上（类 Unix） |
| `bench/bench.mjs:95` | `spawn(node, server.mjs)` | 启动服务 |
| `bench/bench.mjs:125` | `spawnSync("cmd", ["/c","start",url])` | 打开浏览器 |
| `bench/bench.mjs:145` | `spawnSync("taskkill")` | 停止服务 |
| `bench/lib/capabilities/search.mjs:31` | `execFile("curl")` | 14 通道检索 |
| `bench/tools/accept-ui.mjs:35` | `spawn(chrome)` | UI 验收 |

**关键发现**：全部 6 处都没有 `windowsHide: true`。

### 根因

**Windows 上 Node 创建子进程时，如果父进程没有控制台，默认使用 `CREATE_NEW_CONSOLE`。**

也就是说：
- 不只是 `cmd /c start` 会弹窗
- **每一次 `spawn()` / `execFile()` 都会弹一个**
- 即使子进程是 GUI 程序（Chrome headless）或静默 CLI（curl）

这解释了为什么「跑一次验收测试会弹一堆窗口」——
验收脚本自己启 Chrome（1 个），加上它触发的每个 API 调用里 research 通道的 curl（N 个），
再加 netstat/taskkill 等（M 个），全部各弹一个。

### 为什么之前没发现

- `node --check` 只查语法，查不出运行时的窗口行为
- HTTP 200 检查只看服务是否响应，与子进程窗口无关
- 我自己在测试时用的是 `curl` 命令（bash 里跑），不是 Node 的 `execFile`，
  所以本地手动测没触发；只有跑完整验收脚本才暴露

---

## 二、复现

写了 `bench/tools/repro-popup.mjs` 做对照实验。

### 第一版测量方法（失败）

数 `conhost.exe` 进程数 —— **不可靠**：
- Windows 会复用已有的控制台宿主
- 后台服务进程本身也占 conhost
- 结果噪声极大，甚至出现「对照组 0、修复组 +2」的反转假象

### 第二版测量方法（有效）

用 PowerShell 枚举**有可见窗口的进程**：

```powershell
(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }).Count
```

只数真正有窗口的，这是用户眼睛能看到的东西。

### 对照实验设计

用 `cmd.exe` 做对照组（它是控制台程序，弹窗行为最明显）：

```js
const CMD = "C:/Windows/System32/cmd.exe";
const CMD_ARGS = ["/c", "timeout", "/t", "2", "/nobreak"];

// A) 裸 spawn —— 应该弹窗
spawn(CMD, CMD_ARGS, { stdio: "ignore" });

// B) safeSpawn —— 不应弹窗
safeSpawn(CMD, CMD_ARGS, { stdio: "ignore" });
```

### 复现结果

```
裸 spawn（旧代码，对照组）
  窗口数：启动前 19 → 运行中 20 → 关闭后 19   [delta +1]   ← 弹了 1 个

safeSpawn（新代码）
  窗口数：启动前 20 → 运行中 19 → 关闭后 19   [delta -1]   ← 没弹（-1 是系统回收噪声）
```

**复现成功，修复有效。**

---

## 三、根治

### 3.1 统一封装：`lib/safe-proc.mjs`

不靠「记得加参数」，而是让**忘记加参数这件事不可能发生**：

```js
function harden(opts = {}) {
  return {
    windowsHide: true,
    ...opts,
    windowsHide: true,   // 调用方写 false 也压回 true —— 铁律不给绕过的口子
  };
}

export function safeSpawn(cmd, args, opts) { return spawn(cmd, args, harden(opts)); }
export function safeExec(cmd, args, opts) { /* Promise 版 */ }
export function safeExecSync(cmd, args, opts) { /* 同步版 */ }
```

### 3.2 不再用 `cmd /c start` 打开浏览器

```js
// ❌ 旧：会闪一个 cmd 窗口
spawnSync("cmd", ["/c", "start", "", url]);

// ✅ 新：rundll32 直接调 URL 协议处理器，无窗口
safeSpawnSync("rundll32", ["url.dll,FileProtocolHandler", url]);
```

### 3.3 全部 6 处调用点替换

| 文件 | 改动 |
|---|---|
| `bench/bench.mjs` | 4 处 → `safeSpawn` / `safeExecSync` / `safeSpawnSync` / `openUrl` |
| `bench/lib/capabilities/search.mjs` | `execFile` → `safeExecFile` |
| `bench/tools/accept-ui.mjs` | `spawn` → `safeSpawn` |
| `tools/research/research-cli.mjs` | `spawnSync` → `safeSpawnSync` |

### 3.4 自动化守卫：`tools/lint-popup.mjs`

光改一次不够，下次有人写新代码还会犯。所以加了**静态检查**：

| 规则 | 检查什么 |
|---|---|
| `import-child_process` | 不允许直接 import `node:child_process` |
| `bare-spawn` | 不允许裸 `spawn` / `execFile` / `spawnSync` / `exec` |
| `cmd-start` | 不允许 `cmd /c start` |
| `shell-true` | 不允许 `shell: true`（会经由 cmd.exe） |

白名单（3 个）：
- `lib/safe-proc.mjs` —— 封装本身当然要用
- `tools/lint-popup.mjs` —— 守卫要写出被检测的字符串
- `tools/repro-popup.mjs` —— 复现测试故意用裸调用做对照

### 3.5 接进启动流程

`node bench/bench.mjs start` 会先跑守卫：

```js
case "start":
  await guardPopup();   // 不通过就打印违规清单
  await start();
  break;
```

---

## 四、验证

### 守卫

```bash
$ node bench/tools/lint-popup.mjs
扫描 44 个文件

✓ 通过：没有裸子进程调用
  铁律「不弹命令窗口」已由 lib/safe-proc.mjs 统一保证
```

### 复现测试

```bash
$ node bench/tools/repro-popup.mjs
  裸 spawn（旧代码，对照组）
    窗口数：启动前 19 → 运行中 20 → 关闭后 19   [delta +1]
  safeSpawn（新代码）
    窗口数：启动前 20 → 运行中 19 → 关闭后 19   [delta -1]

✓ 复现成功且已修复
```

### UI 验收（跑完整测试，全程无弹窗）

```bash
$ node bench/tools/accept-ui.mjs
========================================================
验收结果：25/25 通过
========================================================
```

### 功能未受影响

```
/                    200
/static/icons.svg    200
/app/learn/          200
arxiv 检索           1 条（curl 通道正常）
```

---

## 五、过程中的两个自我修正

### ① 守卫抓到了我自己

刚写完 `guardPopup()` 时，它内部用了裸 `execFileSync`。守卫立刻报错：

```
[bare-spawn]  1 处
  bench\bench.mjs:173  const out = execFileSync(process.execPath, [...]
  → 改用 safeSpawn / safeExec / safeExecSync
```

**这说明守卫是有效的** —— 它连作者都不放过。已改用 `safeExecSync`。

### ② 测量方法第一版是错的

数 `conhost.exe` 得到「对照组 0、修复组 +2」的**反转结论**。如果不深究，
会误判成「修复无效」甚至「修复反而更糟」。

换成枚举可见窗口后才是可信的。**测量方法错了，比没有测量更危险** ——
它会给你一个看起来很确定的错误答案。

---

## 六、铁律的落地

`AGENTS.md` 里的条款现在有了三重保障：

| 层次 | 机制 | 位置 |
|---|---|---|
| **规则** | 「任何情况下都不要弹出命令窗口」 | `AGENTS.md` 纪律首条 |
| **代码** | 所有子进程调用走 `safe-proc.mjs`，强制 `windowsHide: true` | `bench/lib/safe-proc.mjs` |
| **守卫** | 静态检查 + 启动前拦截 | `bench/tools/lint-popup.mjs` |

任何一层失守，另两层还在。

---

## 七、一句话

> 这不是「偶尔闪一下」，是**每一次 spawn 都会弹**。
> 修法不是「记得加参数」，而是让忘记加参数这件事不可能发生。
