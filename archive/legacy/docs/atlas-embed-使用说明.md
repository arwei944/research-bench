# atlas-embed —— 将 Atlas 研究智能体内置到任意项目

> 一条命令，把 Atlas 研究智能体变成**任意项目的完全独立服务**：独立端口、独立数据目录、独立进程，互不干扰，不碰全局 `~/.atlas`。

## 快速开始

```bash
# 在任意项目目录（或指定路径）后台启动独立服务
node C:\work\newmax\研究智能体\scripts\atlas-embed.mjs start <项目路径> --no-open

# 浏览器访问
node C:\work\newmax\研究智能体\scripts\atlas-embed.mjs open <项目路径>
```

或在任意项目目录内直接：

```bash
cd <你的项目>
node C:\work\newmax\研究智能体\scripts\atlas-embed.mjs start . --no-open
```

启动后浏览器打开输出的地址（形如 `http://127.0.0.1:3xxxx/?cwd=C%3A...`），即为绑定该项目的**研究智能体工作台**。

## 命令参考

| 命令 | 作用 |
|---|---|
| `atlas-embed install [project]` | 在项目内初始化 `.atlas/`（数据目录 + 配置 + .gitignore），不启动 |
| `atlas-embed serve [project]` | **前台**运行独立服务（默认自动打开浏览器） |
| `atlas-embed start [project]` | **后台**运行独立服务（守护进程，日志写 `.atlas/web.log`） |
| `atlas-embed stop [project]` | 停止后台服务 |
| `atlas-embed status [project]` | 查看服务状态（端口/数据目录/进程/地址） |
| `atlas-embed open [project]` | 打开浏览器访问项目服务 |

### 选项

- `-p, --port N`：指定端口（缺省自动分配**空闲端口**）
- `-H, --host HOST`：监听地址（默认 `127.0.0.1`）
- `-w, --web-dir DIR`：指定 atlas-web 安装目录（默认自动探测工作区）
- `-b, --build`：缺构建产物时自动 `npm run build`
- `--no-open`：不自动打开浏览器
- `-h, --help`：帮助

## 完全独立（每项目一份）

| 维度 | 行为 | 证据（实测） |
|---|---|---|
| **数据目录** | `<project>/.atlas/agent/`（会话/模型/凭据全在项目内） | 项目服务 `/api/sessions` 返回 **0** 个会话；全局 `~/.atlas/agent/sessions` 有 **8** 个 → 数据真正隔离 |
| **端口** | 自动分配空闲端口，可 `-p` 固定 | 两个项目并发运行于 `31095` / `31096`，互不干扰 |
| **进程** | 独立 PID + 日志（`.atlas/web.pid` / `.atlas/web.log`） | `start` 后父命令退出服务仍存活；`stop` 精确杀该进程树 |
| **git 隔离** | `.atlas/` 自动写入 `.gitignore` | 服务数据不会误入版本库 |

## 全局使用（可选）

把 `scripts` 目录加入 PATH，即可在任何地方直接使用 `atlas-embed`：

```bash
# Windows PowerShell（持久化）
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\work\newmax\研究智能体\scripts", "User")

# 或复制命令包装到已有 PATH 目录
copy C:\work\newmax\研究智能体\scripts\atlas-embed.cmd C:\Users\<你>\bin\
```

之后 `atlas-embed start <任意项目>` 即可全局调用。

## 工作原理

1. 自动探测 atlas-web 安装（环境变量 `ATLAS_WEB_DIR` / 工作区 `atlas-web/` / `-w` 指定）
2. 在目标项目创建 `.atlas/`：数据目录 `agent/`、配置 `atlas.config.json`、`.gitignore`
3. 以 `ATLAS_CODING_AGENT_DIR=<project>/.atlas/agent` 环境变量启动 `next start`
   —— 内核 `getAgentDir()` 优先读该环境变量（回落才是全局 `~/.atlas`）
4. 注入 `NODE_OPTIONS=--unhandled-rejections=warn`（见下）
5. 就绪探测 `/api/sessions` 后输出访问地址，后台模式写入 PID

## ⚠️ 上游已知问题与缓解

Next.js 16 的 server chunk 存在上游 bug：对 `node:fs/os/path` 等**内置模块**的动态 require 失败，抛出 `unhandledRejection`（`Cannot find module 'node:fs'`）。Node 默认策略会因此**终止服务进程**。

- 表现：服务启动后运行一段时间突然退出（正常请求均返回 200，属后台异步加载失败）
- 缓解：`atlas-embed` 已自动注入 `--unhandled-rejections=warn`，将其降级为警告，**服务稳定运行**
- 根治建议：升级 Next.js / `@atlas/*` 内核版本，待上游修复后本工具无需改动
- 若你自行用 `npm run start` 直启，请加上：`NODE_OPTIONS=--unhandled-rejections=warn npm run start`

## 文件

```
scripts/
├── atlas-embed.mjs    # 主工具（Node CLI，零依赖，跨平台）
└── atlas-embed.cmd    # Windows 命令包装（加入 PATH 后全局可用）
```
