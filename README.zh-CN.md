<p align="center">
  <img src="packages/website/public/logo.svg" width="64" height="64" alt="Paseo logo">
</p>

<h1 align="center">Paseo</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/getpaseo/paseo/stargazers">
    <img src="https://img.shields.io/github/stars/getpaseo/paseo?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/getpaseo/paseo/releases">
    <img src="https://img.shields.io/github/v/release/getpaseo/paseo?style=flat&logo=github" alt="GitHub release">
  </a>
  <a href="https://x.com/moboudra">
    <img src="https://img.shields.io/badge/%40moboudra-555?logo=x" alt="X">
  </a>
  <a href="https://discord.gg/jz8T2uahpH">
    <img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord">
  </a>
  <a href="https://www.reddit.com/r/PaseoAI/">
    <img src="https://img.shields.io/badge/Reddit-555?logo=reddit" alt="Reddit">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode 和 Pi agents 的统一界面。</p>

<p align="center">
  <img src="https://paseo.sh/hero-mockup.png" alt="Paseo app screenshot" width="100%">
</p>

Paseo 的这个 fork 是面向 **Linux 桌面端、网页版和 CLI** 的开源开发环境。你可以在自己的机器上并行运行 Agent，为每个 Agent 使用独立的工作树，也可以通过直连或 SSH 访问其他 Linux 主机。

- **自托管：** Agents 在你的机器上运行，使用完整的本地开发环境、工具、配置和技能。
- **多提供商：** 通过同一个界面使用 Claude Code、Codex、Copilot、OpenCode 和 Pi。为每个任务选择合适的模型。
- **语音控制：** 在语音模式下口述任务或讨论问题。需要免手操作时很方便。
- **多种客户端：** 使用 Linux 桌面应用、浏览器或 CLI 连接本地和远程 daemon。
- **隐私优先：** 无遥测、无追踪，客户端连接 daemon 无需 Paseo 账号。参见[安全指南](public-docs/security.zh-CN.md)。

## 赞助商

<!-- Sponsors: one cell per sponsor in the order of packages/website/src/data/sponsors.ts, then "become a sponsor" cells up to three. -->
<table>
  <tr>
    <td align="center" width="33%"><a href="https://hoplite.sh/?utm_source=paseo&utm_medium=readme&utm_campaign=sponsor"><picture><source media="(prefers-color-scheme: dark)" srcset="packages/website/public/sponsors/hoplite-on-dark.svg"><img src="packages/website/public/sponsors/hoplite-on-light.svg" alt="Hoplite" height="40"></picture></a><br><sub>Cloud coding agents</sub></td>
    <td align="center" width="33%"><a href="https://paseo.sh/zh-CN/sponsor">成为 Paseo 赞助商</a></td>
    <td align="center" width="33%"><a href="https://paseo.sh/zh-CN/sponsor">成为 Paseo 赞助商</a></td>
  </tr>
</table>

## 快速开始

Paseo 会运行一个名为 daemon 的本地服务，用来管理你的编程 Agent。Linux 桌面应用、网页版和 CLI 都可以连接到它。

### 前置条件

你至少需要安装一个 agent CLI，并用你的凭据完成配置：

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Linux 桌面应用（推荐）

从[本 fork 的发布页面](https://github.com/Proximyst/getpaseo-paseo/releases)获取 Linux 软件包，或[自行构建桌面应用](docs/development.md)。打开应用后，daemon 会自动启动。上游下载链接以及日文和韩文 README 介绍的是上游发布版本，不代表本 fork 支持的目标。

在 Arch Linux 上，可以[使用仓库根目录的 `PKGBUILD` 构建并安装](docs/development.md#arch-linux-package)。

### 服务器

在服务器、虚拟机或其他未安装桌面应用的机器上，安装 CLI 并启动 daemon：

```bash
npm install -g @getpaseo/cli
paseo
```

Paseo 会启动本地 daemon。远程客户端可以通过可信的局域网或 VPN 直接连接，Linux 桌面应用和 CLI 也可以使用 SSH。本 fork 不支持中继传输或原生移动应用。

完整安装和配置见：

- [快速开始](public-docs/index.zh-CN.md)
- [连接指南](public-docs/connectivity.zh-CN.md)
- [配置参考](public-docs/configuration.zh-CN.md)

## CLI

你能在 app 中完成的事情，也都可以在终端中完成。

```bash
paseo run --provider claude/opus-4.6 "implement user authentication"
paseo run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

paseo ls                           # 列出正在运行的 agents
paseo attach abc123                # 实时流式查看输出
paseo send abc123 "also add tests" # 发送后续任务

# 在远程 daemon 上运行
paseo --host workstation.local:6767 run "run the full test suite"
```

更多内容见[完整 CLI 参考](public-docs/cli.zh-CN.md)。

## Skills

Skills 会教你的 agent 使用 Paseo 来编排其他 agents。

```bash
npx skills add getpaseo/paseo
```

然后在任意 agent 对话中使用：

- `/paseo-handoff` — 在 agents 之间交接工作。我会用它先和 Claude 规划，再交给 Codex 实现。
- `/paseo-advisor` — 启动单个 agent 作为 advisor，提供第二意见，但不把工作委托出去。
- `/paseo-committee` — 组建两个风格互补的 agents，让它们后退一步做根因分析并产出计划。

## 开发

Monorepo 包结构速览：

- `packages/server`：Paseo daemon（agent 进程编排、WebSocket API、MCP server）
- `packages/app`：Expo 网页客户端和共享桌面界面（保留上游原生代码，但未启用）
- `packages/cli`：用于 daemon 和 agent 工作流的 `paseo` CLI
- `packages/desktop`：Linux Electron 桌面应用
- `packages/relay`：保留的上游传输和加密依赖；中继连接已禁用
- `packages/website`：营销站点和文档（`paseo.sh`）

常用命令：

```bash
# 运行所有本地开发服务
npm run dev

# 单独运行某个界面
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# 构建 server stack
npm run build:server

# 全仓库检查
npm run typecheck
```

### 保留的上游代码

为减少合并上游时的冲突，仓库保留了共享 React Native 组件、平台特定代码和中继协议实现。这些代码并不代表本 fork 支持相应的产品。本 fork 发布 Linux 桌面应用和 npm 包，支持网页版和 CLI，以及 WebSocket 直连、SSH 和本地 Unix 套接字。不支持 Docker、iOS/Android、应用商店或 F-Droid、Windows、macOS、Nix 和中继部署。合并可能重新启用这些功能的改动前，请参见[上游合并指南](.agents/skills/merge-upstream/SKILL.md)。

## 支持 Paseo

Paseo 由一个人开发，靠使用它的人来资助。你可以通过 [GitHub Sponsors](https://github.com/sponsors/boudra) 支持这项工作。公司也可以按月[赞助 Paseo](https://paseo.sh/zh-CN/sponsor#spot)，logo 会展示在本 README 顶部，以及 paseo.sh 的首页和文档中。

## 相关项目

- [paseo-vscode](https://marketplace.visualstudio.com/items?itemName=hinnes.paseo-vscode) — VS Code 扩展

## License

Apache-2.0
