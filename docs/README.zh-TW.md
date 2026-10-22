<div align="center">
 <img src="../public/logo.svg" alt="CloudCLI UI" width="64" height="64">
 <h1>Cloud CLI（又名 Claude Code UI）</h1>
 <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>、<a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>、<a href="https://developers.openai.com/codex">Codex</a> 的桌面和行動裝置 UI。可在本機或遠端使用，從任何地方查看您的專案與工作階段。</p>
</div>

<p align="center">
 <a href="https://cloudcli.ai/docs">文件</a> · <a href="https://github.com/fph9116f-code/claudecodeui-codex/issues">Bug 回報</a> · <a href="../CONTRIBUTING.md">貢獻指南</a>
</p>

<div align="right"><i><a href="../README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">简体中文</a> · <b>繁體中文</b> · <a href="./README.ja.md">日本語</a> · <a href="./README.tr.md">Türkçe</a> · <a href="./README.id.md">Bahasa Indonesia</a></i></div>

---

> **本倉庫定製說明：** 本倉庫是上游 CloudCLI UI 的個人定製版。已移除登入功能（本機單一使用者）、預設連接埠固定為 `3002`、移除 Discord 社群入口，所有倉庫連結均指向本倉庫。詳見 [README](../README.md)。

## 截圖

<div align="center">

<table>
<tr>
<td align="center">
<h3>桌面檢視</h3>
<img src="../public/screenshots/desktop-main.png" alt="桌面介面" width="400">
<br>
<em>顯示專案總覽和聊天的主介面</em>
</td>
<td align="center">
<h3>行動裝置體驗</h3>
<img src="../public/screenshots/mobile-chat.png" alt="行動裝置介面" width="250">
<br>
<em>具有觸控導覽的響應式行動裝置設計</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 選擇</h3>
<img src="../public/screenshots/cli-selection.png" alt="CLI 選擇" width="400">
<br>
<em>在 Claude Code、Cursor CLI 與 Codex 之間進行選擇</em>
</td>
</tr>
</table>

</div>

## 功能

- **響應式設計** — 在桌面、平板和行動裝置上無縫運作，讓您隨時隨地使用 Agents
- **互動聊天介面** — 內建聊天 UI，輕鬆與 Agents 交流
- **整合 Shell 終端機** — 透過內建 shell 功能直接存取 Agents CLI
- **檔案瀏覽器** — 互動式檔案樹，支援語法醒目提示與即時編輯
- **Git 瀏覽器** — 檢視、暫存並提交變更，還可切換分支
- **工作階段管理** — 恢復對話、管理多個工作階段並追蹤歷史紀錄
- **外掛系統** — 透過自訂分頁、後端服務與整合來擴充 CloudCLI。[開始建構 →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 整合** *(選用)* — 結合 AI 任務規劃、PRD 分析與工作流程自動化，實現進階專案管理
- **模型相容性** — 支援 Claude、GPT 模型家族（完整支援列表可透過 `GET /api/providers/:provider/models` 介面取得）

## 快速開始

### 從原始碼執行（建議）

需要 **Node.js** v22+：

```bash
git clone https://github.com/fph9116f-code/claudecodeui-codex.git
cd claudecodeui-codex
npm install
npm run dev
```

- 前端開發伺服器：`http://localhost:5174`
- 後端：`http://localhost:3002`

生產模式：

```bash
npm run build
npm start
```

開啟 `http://localhost:3002` — 本機既有的工作階段會自動被發現。

> 本倉庫已移除登入功能，僅在本機以單一使用者模式執行，請勿直接暴露到公網。

### 桌面端

桌面端為選用元件，可直接從原始碼建置：

```bash
npm run desktop:dev       # dev
npm run desktop:dist:mac  # macOS
```

---

## 安全與工具設定

**🔒 重要提示**：所有 Claude Code 工具預設**停用**，可防止潛在的有害操作自動執行。

### 啟用工具

1. **開啟工具設定** — 點擊側邊欄齒輪圖示
2. **選擇性啟用** — 僅啟用所需工具
3. **套用設定** — 偏好設定儲存在本機

<div align="center">

![工具設定彈出視窗](../public/screenshots/tools-modal.png)
*工具設定介面 — 只啟用你需要的內容*

</div>

**建議做法**：先啟用基礎工具，再根據需要新增其他工具。隨時可以調整。

---

## 外掛

CloudCLI 配備外掛系統，允許你新增帶有自訂前端 UI 和選用 Node.js 後端的分頁。在 Settings > Plugins 中直接從 Git 儲存庫安裝外掛，或自行開發。

### 可用外掛

| 外掛 | 描述 |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 展示目前專案的檔案數、程式碼行數、檔案類型分佈、最大檔案以及最近修改的檔案 |
| **[Web Terminal](https://github.com/cloudcli-ai/cloudcli-plugin-terminal)** | 支援多分頁的完整 xterm.js 終端機 |
| **[CloudCLI Scheduler](https://github.com/grostim/cloudcli-cron)** | 建立工作區範圍的排程提示詞，並透過 Codex、Claude Code 等本機 CLI 執行 |
| **[PRISM CloudCLI](https://github.com/jakeefr/cloudcli-plugin-prism)** | 在 CloudCLI 中提供 Claude Code 工作階段智慧分析，包括 token 消耗可視化 |
| **[Sessions](https://github.com/strykereye2/cloudcli-plugin-session-manager)** | 檢視、管理並終止作用中的 Claude Code 工作階段 |
| **[Token Cost Calculator](https://github.com/NightmareAway/cloudcli-plugin-token-cost-calculator)** | 根據模型價格與 token 用量計算 API 成本，並支援模型價格預設 |
| **[Task Queue](https://github.com/TadMSTR/cloudcli-plugin-task-queue)** | 用於檢視、篩選和啟動代理任務的任務佇列儀表板 |
| **[GitHub Issues Board](https://github.com/szmidtpiotr/claude-github-issue)** | 用於 GitHub Issues 的看板，支援 TaskMaster 雙向同步和 /github-task CLI 技能自動安裝 |

### 自行建構

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — Fork 該儲存庫以建構自己的外掛。範例包括前端渲染、即時上下文更新和 RPC 通訊。

**[外掛文件 →](https://cloudcli.ai/docs/plugin-overview)** — 提供外掛 API、清單格式、安全模型等完整指南。

---

## 常見問題

<details>
<summary>與 Claude Code Remote Control 有何不同？</summary>

Claude Code Remote Control 讓你傳送訊息到本機終端機中已經執行的工作階段。該方式要求你的機器保持開機，終端機保持開啟，中斷網路後約 10 分鐘工作階段會逾時。

CloudCLI UI 與 CloudCLI Cloud 是對 Claude Code 的擴充，而非旁觀 — MCP 伺服器、權限、設定、工作階段與 Claude Code 完全一致。

- **涵蓋全部工作階段** — CloudCLI UI 會自動掃描 `~/.claude` 資料夾中的每個工作階段。Remote Control 只暴露目前活動的工作階段。
- **設定統一** — 在 CloudCLI UI 中修改的 MCP、工具權限等設定會立即寫入 Claude Code。
- **支援更多 Agents** — Claude Code、Cursor CLI、Codex。
- **完整 UI** — 除了聊天介面，還包括檔案瀏覽器、Git 整合、MCP 管理和 Shell 終端機。
- **CloudCLI Cloud 持續運作於雲端** — 關閉本機裝置也不會中斷代理執行，無需監控終端機。

</details>

<details>
<summary>需要額外購買 AI 訂閱嗎？</summary>

需要。CloudCLI 只提供環境。你仍需自行取得 Claude、Cursor 或 Codex 訂閱。CloudCLI Cloud 從 €7/月起提供託管環境。

</details>

<details>
<summary>能在手機上使用 CloudCLI UI 嗎？</summary>

可以。自架時，在你的裝置上執行伺服器，然後在網路中的任意瀏覽器開啟 `[yourip]:port`。CloudCLI Cloud 可從任意裝置存取，內建原生應用程式也在開發中。

</details>

<details>
<summary>UI 中的變更會影響本機 Claude Code 設定嗎？</summary>

會的。自架模式下，CloudCLI UI 讀取並寫入 Claude Code 使用的 `~/.claude` 設定。透過 UI 新增的 MCP 伺服器會立即在 Claude Code 中可見。

</details>

---

## 社群與支援

- **[文件](https://cloudcli.ai/docs)** — 安裝、設定、功能與疑難排解指南
- **[GitHub Issues](https://github.com/fph9116f-code/claudecodeui-codex/issues)** — 回報 Bug 與建議功能
- **[貢獻指南](../CONTRIBUTING.md)** — 如何參與專案貢獻

## 授權條款

GNU Affero 通用公共授權條款 v3.0 或更高版本 (AGPL-3.0-or-later) — 詳見 [LICENSE](../LICENSE) 檔案。

該專案為開源軟體，在 GNU Affero 通用公共授權條款 v3.0 或更高版本 (AGPL-3.0-or-later) 下可自由使用、修改與散布。

## 致謝

### 使用技術
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — Anthropic 官方 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** — Cursor 官方 CLI
- **[Codex](https://developers.openai.com/codex)** — OpenAI Codex
- **[React](https://react.dev/)** — 使用者介面函式庫
- **[Vite](https://vitejs.dev/)** — 快速建構工具與開發伺服器
- **[Tailwind CSS](https://tailwindcss.com/)** — 實用優先 CSS 框架
- **[CodeMirror](https://codemirror.net/)** — 進階程式碼編輯器
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(選用)* — AI 驅動的專案管理與任務規劃

---

<div align="center">
 <strong>為 Claude Code、Cursor 和 Codex 社群精心打造。</strong>
</div>
