# 基于 Pi Agent 的个人全能研究智能体 · 搭建方案

> 版本:v1.0 ｜ 日期:2026-09-09 ｜ 目标:**个人自用、全能通用、尽量零成本**
> 场景:学科/学术研究 ｜ 金融研究 ｜ 知识学习(三者均衡)

---

## 1. 为什么选 Pi Agent 作底座

**Pi (pi-mono)** 是一个开源的本地个人 AI 智能体框架(官方站 pi.dev,MIT 许可),与 Claude Code 同类,但**以个人自用、可自扩展为设计核心**,正好契合你的需求:

| 你的需求 | Pi 的对应能力 |
|---|---|
| 个人自用、独立智能体 | 本地 CLI 智能体,数据与对话归你所有 |
| 尽量零成本 | 内置 **llama.cpp 本地模型路由**(`/llama`)+ 支持 **Ollama / LM Studio / vLLM** 等本地服务(base URL 自定义)+ 多家免费额度云端 API |
| 全能研究(学科/金融/学习) | **Skills 体系**(SKILL.md,复用 Anthropic 标准格式)+ **Extensions 扩展**(Web 检索/浏览器/转录)+ **MCP 接入** + 统一多厂商 LLM API(20+ provider) |
| 知识沉淀 | 本地会话树 + 文件知识库(markdown),天然适合"第二大脑" |

**核心事实(均已核实)**:
- 官方文档:pi.dev/docs/latest;Skills 格式为 `SKILL.md`(frontmatter: `name`/`description` 必填),项目级放 `.pi/skills/`,全局放 `~/.pi/agent/skills/`
- 官方技能仓库:`badlogic/pi-skills`(搜索、浏览器自动化、Google API、转录);兼容 Anthropic Skills
- 模型 provider:内置订阅(OAuth:ChatGPT Plus / Claude Pro / GitHub Copilot 等)+ 30+ API Key 厂商 + 本地/自定义(OpenAI-compatible base URL)
- 中文参考书:《Pi 的设计艺术》(github.com/ZhangHanDong/pi-book)

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│  你(提问)                                                │
└──────────────┬──────────────────────────────────────────┘
               ▼
┌─────────────────────────────────────────────────────────┐
│  Pi Agent 内核 (pi-coding-agent)                         │
│  · Agent Loop  · 会话树  · 上下文压缩  · 工具调用          │
│  · AGENTS.md(研究智能体角色设定)                          │
└───────┬──────────────────────┬──────────────────────────┘
        │                      │
        ▼                      ▼
┌───────────────┐   ┌─────────────────────────────┐
│  Skills 层     │   │  模型层(零成本优先)          │
│ · research-    │   │  A. llama.cpp 本地模型      │
│   protocol     │   │  B. Ollama/LM Studio       │
│ · academic-    │   │     (OpenAI-compatible)    │
│   research     │   │  C. 免费额度云端(可选增强)    │
│ · finance-     │   └─────────────────────────────┘
│   research     │
│ · learning-    │   ┌─────────────────────────────┐
│   coach        │   │  外部能力(按需)              │
└───────┬───────┘   │ · Web 检索(pi-web-access)    │
        │           │ · 浏览器(pi-agent-browser)   │
        ▼           │ · MCP 学术/数据源(pi-mcp)     │
┌─────────────────────────────┐                     │
│  知识库 knowledge-base/      │  · 文件/PDF 处理      │
│  academic / finance /       └─────────────────────┘
│  learning / projects         │
│  + workflows/ 工作流模板     │
└─────────────────────────────┘
```

**设计原则**:
1. **零成本优先**:默认走本地模型(llama.cpp / Ollama),质量不足时按需切换免费额度云端模型。
2. **Skills 驱动**:把三大场景做成可复用技能,`description` 触发自动加载。
3. **协议先于工具**:通用研究协议(research-protocol)定义检索→交叉验证→引用核验→成稿的统一流程,保证质量稳定。
4. **知识库沉淀**:所有研究产出按规范落盘 `knowledge-base/`,跨会话复用。

---

## 3. 零成本模型路线(关键)

Pi 支持三类模型来源,按"零成本 + 够用"排序:

### 路线 A —— 本地模型(首选,零成本、私密)
- **llama.cpp**:`/login llama.cpp` 配置 → `/llama` 管理模型 → `/model` 选择。推荐 8B–32B 量级模型(如 Qwen2.5-14B/32B-Instruct、Llama-3.1-8B),需 16GB+ 内存。
- **Ollama**:`models.json` 自定义 provider,声明 `http://localhost:11434/v1`(OpenAI-compatible)。参考 `config/models.example.json`。
- 优点:完全免费、数据不出本机;缺点:深度推理能力弱于顶级云端模型,研究任务建议搭配"本地做筛选/检索,云端做综合"。

### 路线 B —— 已有订阅直接复用(零增量成本)
如果你已有以下任一订阅,在 Pi 里 `/login` 选择即可免额外成本使用:
- **Claude Pro / Max**(/login → Claude)、**ChatGPT Plus/Pro**(/login → Codex)、**GitHub Copilot**
- 注意:Claude 订阅经第三方 harness 调用按 token 计费(不计订阅额度),实际成本需实测;ChatGPT/GitHub Copilot 属订阅内。

### 路线 C —— 免费额度云端 API(增强)
- **Google Gemini**(`GEMINI_API_KEY`,免费层),**Groq**(`GROQ_API_KEY`,免费层,极快),**Hugging Face**(`HF_TOKEN`),**Cloudflare Workers AI**(`CLOUDFLARE_API_KEY`,免费额度),**Mistral/Cerebras** 等。
- 用 `auth.json`(0600 权限)或环境变量配置。

> **推荐策略**:本地模型(A)兜底日常 → 需要高质量综合/长推理时临时切到免费额度云端(C) → 若后续愿付费再升级订阅(B)。Pi 支持会话内 `/model` 随时切换。

---

## 4. Skills 体系(本方案核心)

在 `.pi/skills/` 下预置 4 个研究技能(本工作区即 Pi 项目目录,进入后自动发现):

| Skill | 作用域 | 触发描述 |
|---|---|---|
| **research-protocol** | 全场景 | 通用研究协议:检索→证据分级→交叉验证→引用核验→报告模板→质量门禁 |
| **academic-research** | 学科研究 | 学术文献检索(arXiv/PubMed/Crossref)、论文精读、综述写作、引用核验 |
| **finance-research** | 金融研究 | 行情/财报数据获取、投研分析框架、数据时效标注、不确定性披露 |
| **learning-coach** | 知识学习 | 新领域入门、费曼讲解、测验生成、间隔复习计划 |

**使用方式**:提问时 Pi 根据 `description` 自动加载;也可 `/skill:academic-research` 强制触发。例如:
```
# 自动:帮我调研一下图神经网络在推荐系统里的最新进展
# 强制:/skill:academic-research 我要写一篇关于 diffusion model 的综述
```

**安装扩展(可选,零成本增强)**:
- Web 检索:`nicobailon/pi-web-access`(网络搜索 + 内容提取)
- 浏览器自动化:`fitchmultz/pi-agent-browser-native`(可浏览需要登录/动态加载的页面)
- MCP 接入:`nicobailon/pi-mcp-adapter`(可挂学术库/数据源 MCP servers)
- 多智能体:`tmustier/pi-agent-teams` / `ruizrica/agent-pi`(检索员/分析员/审稿人分工)

---

## 5. 三大工作流概览

详见 `workflows/` 下模板,一句话摘要:

1. **学科研究**:提问 → 检索学术库(多源)→ 精读关键论文 → 交叉验证结论 → 引用核验(逐条)→ 输出综述/知识卡片 → 沉淀 `knowledge-base/academic/`
2. **金融研究**:提问 → 获取行情/财报/公告数据(标注数据源与时效)→ 按框架分析(公司/行业/估值)→ 输出报告+图表 → 沉淀 `knowledge-base/finance/`
3. **知识学习**:选定主题 → 生成入门路线 → 分章节讲解(费曼式)→ 随堂测验 → 生成复习卡片 → 沉淀 `knowledge-base/learning/`

---

## 6. 质量控制(研究智能体的生命线)

基于前期调研的核心结论(幻觉/虚构引用是最大风险),本方案内置质量门禁:

1. **引用核验**:凡给出引用/数据,必须标注来源;学术引用调用 Crossref/PubMed 校验真实性,输出"已核验/未找到/存疑"。
2. **置信度标注**:每个关键结论标注置信度与已知反方观点。
3. **来源分级**:一手数据(论文/财报/官方) > 权威二手 > 自媒体,低级别来源降权或标注。
4. **知识库版本**:研究产出记录日期与依据,方便回溯。

---

## 7. 落地步骤

```bash
# 1. 安装 Pi(任选其一)
curl -fsSL https://pi.dev/install.sh | sh        # Linux/macOS
npm install -g @earendil-works/pi-coding-agent --ignore-scripts   # 或 npm 全局
# Windows 用户见 pi.dev/docs/latest 的 Windows 安装说明

# 2. 配置模型(零成本路线,任选)
pi                    # 进入交互
/login llama.cpp      # 本地 llama.cpp;或按 models.example.json 配 Ollama
# 有免费云端 Key 时:/login 选择 Gemini / Groq 等

# 3. 在本工作区启动
cd C:\work\newmax\研究智能体   # 已含 .pi/skills、AGENTS.md、workflows、knowledge-base
pi                            # 自动加载研究智能体角色与技能

# 4. 开始使用
# 「帮我调研因果推断在经济学中的最新方法」
# 「/skill:finance-research 分析一下宁德时代的财报」
# 「/skill:learning-coach 帮我入门线性代数,今天先讲向量空间」
```

> 已提供一键初始化脚本 `scripts/init-pi-research-agent.sh`,可自动完成环境检查与引导。

---

## 8. 升级路径(未来可选)

- **愿付费**:订阅 Claude Pro / ChatGPT Plus,`/login` 直连,研究质量显著提升。
- **多智能体**:安装 pi-agent-teams,把"检索→分析→审稿"拆成子代理并行,深度研究更快。
- **云端同步**:知识库可同步到 GitHub/坚果云,多设备共享。

---

*附:前期《研究智能体方向调研报告》中的幻觉数据、GAIA 基准、市场数据,对本方案的质量门禁设计仍有直接指导意义,可参考同目录下该报告。*
