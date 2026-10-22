<div align="center">
 <img src="../public/logo.svg" alt="CloudCLI UI" width="64" height="64">
 <h1>Cloud CLI（又名 Claude Code UI）</h1>
 <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>、<a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>、<a href="https://developers.openai.com/codex">Codex</a> 的桌面和移动端 UI。可在本地或远程使用，从任何地方查看激活的项目与会话。</p>
</div>

<p align="center">
 <a href="https://cloudcli.ai/docs">文档</a> · <a href="https://github.com/fph9116f-code/claudecodeui-codex/issues">Bug 报告</a> · <a href="../CONTRIBUTING.md">贡献指南</a>
</p>

<div align="right"><i><a href="../README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <b>简体中文</b> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a> · <a href="./README.id.md">Bahasa Indonesia</a></i></div>

---

## 本仓库定制说明

本仓库是基于上游 CloudCLI UI **v1.37.5** 的个人定制版，与上游的主要差异：

- **移除登录功能** — 不再需要账号密码，所有请求以本机隐式 `local` 用户运行，仅适合本机或可信内网使用。
- **默认端口固定为 3002** — 后端固定监听 `3002`；开发模式下前端 Vite 运行在 `5174`。
- **移除社区入口** — 侧栏（展开态与折叠态）和设置页中的 Discord「加入社区」入口已删除。
- **链接指向本仓库** — 报告问题、Star 徽章、版本检查、GitHub 链接、包元数据均指向本仓库。
- **修复侧栏白屏** — 移除 Discord 入口后残留的未定义变量引用已修复。

## 截图

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面视图</h3>
<img src="../public/screenshots/desktop-main.png" alt="桌面界面" width="400">
<br>
<em>显示项目概览和聊天的主界面</em>
</td>
<td align="center">
<h3>移动体验</h3>
<img src="../public/screenshots/mobile-chat.png" alt="移动界面" width="250">
<br>
<em>具有触控导航的响应式移动设计</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 选择</h3>
<img src="../public/screenshots/cli-selection.png" alt="CLI 选择" width="400">
<br>
<em>在 Claude Code、Cursor CLI 与 Codex 之间进行选择</em>
</td>
</tr>
</table>

</div>

## 功能

- **响应式设计** - 在桌面、平板和移动设备上无缝运行，让您随时随地使用 Agents
- **交互聊天界面** - 内置聊天 UI，轻松与 Agents 交流
- **集成 Shell 终端** - 通过内置 shell 功能直接访问 Agents CLI
- **文件浏览器** - 交互式文件树，支持语法高亮与实时编辑
- **Git 浏览器** - 查看、暂存并提交更改，还可切换分支
- **会话管理** - 恢复对话、管理多个会话并跟踪历史记录
- **插件系统** - 通过自定义选项卡、后端服务与集成扩展 CloudCLI。 [开始构建 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 集成** *(可选)* - 结合 AI 任务规划、PRD 分析与工作流自动化，实现高级项目管理
- **模型兼容性** - 支持 Claude、GPT 模型家族（完整支持列表可通过 `GET /api/providers/:provider/models` 接口获取）

## 快速开始

### 从源码运行（推荐）

需要 **Node.js** v22+：

```bash
git clone https://github.com/fph9116f-code/claudecodeui-codex.git
cd claudecodeui-codex
npm install
npm run dev
```

- 前端开发地址：`http://localhost:5174`
- 后端地址：`http://localhost:3002`

生产模式：

```bash
npm run build
npm start
```

打开 `http://localhost:3002` — 本地已有的会话会被自动发现。

> 本仓库已移除登录功能，仅在本机以单用户模式运行，请勿直接暴露到公网。

### 桌面端

桌面端为可选组件，可直接从源码构建：

```bash
npm run desktop:dev       # dev
npm run desktop:dist:mac  # macOS
```

---

## 安全与工具配置

**🔒 重要提示**: 所有 Claude Code 工具默认**禁用**，可防止潜在的有害操作自动运行。

### 启用工具

1. **打开工具设置** - 点击侧边栏齿轮图标
2. **选择性启用** - 仅启用所需工具
3. **应用设置** - 偏好设置保存在本地

<div align="center">

![工具设置弹窗](../public/screenshots/tools-modal.png)
*工具设置界面 - 只启用你需要的内容*

</div>

**推荐做法**: 先启用基础工具，再根据需要添加其他工具。随时可以调整。

---

## 插件

CloudCLI 配备插件系统，允许你添加带自定义前端 UI 和可选 Node.js 后端的选项卡。在 Settings > Plugins 中直接从 Git 仓库安装插件，或自行开发。

### 可用插件

| 插件 | 描述 |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 展示当前项目的文件数、代码行数、文件类型分布、最大文件以及最近修改的文件 |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | 支持多标签页的完整 xterm.js 终端 |
| **[CloudCLI Scheduler](https://github.com/grostim/cloudcli-cron)** | 创建工作区范围的定时提示词，并通过 Codex、Claude Code 等本地 CLI 执行 |
| **[PRISM CloudCLI](https://github.com/jakeefr/cloudcli-plugin-prism)** | 在 CloudCLI 中提供 Claude Code 会话智能分析，包括 token 消耗可视化 |
| **[Sessions](https://github.com/strykereye2/cloudcli-plugin-session-manager)** | 查看、管理并终止活动的 Claude Code 会话 |
| **[Token Cost Calculator](https://github.com/NightmareAway/cloudcli-plugin-token-cost-calculator)** | 根据模型价格和 token 用量计算 API 成本，并支持模型价格预设 |
| **[Task Queue](https://github.com/TadMSTR/cloudcli-plugin-task-queue)** | 用于查看、筛选和启动代理任务的任务队列仪表板 |
| **[GitHub Issues Board](https://github.com/szmidtpiotr/claude-github-issue)** | 用于 GitHub Issues 的看板，支持 TaskMaster 双向同步和 /github-task CLI 技能自动安装 |

### 自行构建

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — Fork 该仓库以构建自己的插件。示例包括前端渲染、实时上下文更新和 RPC 通信。

**[插件文档 →](https://cloudcli.ai/docs/plugin-overview)** — 提供插件 API、清单格式、安全模型等完整指南。

---

## 常见问题

<details>
<summary>与 Claude Code Remote Control 有何不同？</summary>

Claude Code Remote Control 让你发送消息到本地终端中已经运行的会话。该方式要求你的机器保持开机，终端保持开启，断开网络后约 10 分钟会话会超时。

CloudCLI UI 与 CloudCLI Cloud 是对 Claude Code 的扩展，而非旁观 — MCP 服务器、权限、设置、会话与 Claude Code 完全一致。

- **覆盖全部会话** — CloudCLI UI 会自动扫描 `~/.claude` 文件夹中的每个会话。Remote Control 只暴露当前活动的会话。
- **设置统一** — 在 CloudCLI UI 中修改的 MCP、工具权限等设置会立即写入 Claude Code。
- **支持更多 Agents** — Claude Code、Cursor CLI、Codex。
- **完整 UI** — 除了聊天界面，还包括文件浏览器、Git 集成、MCP 管理和 Shell 终端。
- **CloudCLI Cloud 保持运行于云端** — 关闭本地设备也不会中断代理运行，无需监控终端。

</details>

<details>
<summary>需要额外购买 AI 订阅吗？</summary>

需要。CloudCLI 只提供环境。你仍需自行获取 Claude、Cursor 或 Codex 订阅。CloudCLI Cloud 从 €7/月起提供托管环境。

</details>

<details>
<summary>能在手机上使用 CloudCLI UI 吗？</summary>

可以。自托管时，在你的设备上运行服务器，然后在网络中的任意浏览器打开 `[yourip]:port`。CloudCLI Cloud 可从任意设备访问，内置原生应用也在开发中。

</details>

<details>
<summary>UI 中的更改会影响本地 Claude Code 配置吗？</summary>

会的。自托管模式下，CloudCLI UI 读取并写入 Claude Code 使用的 `~/.claude` 配置。通过 UI 添加的 MCP 服务器会立即在 Claude Code 中可见。

</details>

---

## 社区与支持

- **[文档](https://cloudcli.ai/docs)** — 安装、配置、功能与故障排除指南
- **[GitHub Issues](https://github.com/fph9116f-code/claudecodeui-codex/issues)** — 报告 Bug 与建议功能
- **[贡献指南](../CONTRIBUTING.md)** — 如何参与项目贡献

## 许可证

GNU Affero 通用公共许可证 v3.0 或更高版本 (AGPL-3.0-or-later) - 详见 [LICENSE](../LICENSE) 文件。

该项目为开源软件，在 GNU Affero 通用公共许可证 v3.0 或更高版本 (AGPL-3.0-or-later) 下可自由使用、修改与分发。

## 致谢

### 使用技术
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic 官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor 官方 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - 用户界面库
- **[Vite](https://vitejs.dev/)** - 快速构建工具与开发服务器
- **[Tailwind CSS](https://tailwindcss.com/)** - 实用先行 CSS 框架
- **[CodeMirror](https://codemirror.net/)** - 高级代码编辑器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(可选)* - AI 驱动的项目管理与任务规划

---

<div align="center">
 <strong>为 Claude Code、Cursor 和 Codex 社区精心打造。</strong>
</div>
