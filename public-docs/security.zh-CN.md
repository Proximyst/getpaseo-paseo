---
title: 安全
description: "Paseo 的安全模型：架构、连接方式和访问控制。"
nav: 安全
---

# 安全 {#security}

Paseo 使用客户端-服务器架构。Daemon 在 Linux 机器上运行并管理编程 Agent。Linux 桌面端、CLI 和浏览器连接到 daemon。

你的代码从不离开你的机器。Paseo 是一个本地优先的工具，直接连接到你的开发环境。

## 架构 {#architecture}

客户端通过 WebSocket 直接连接，可以使用 VPN 或 TLS 反向代理加密。Linux 桌面端和 CLI 也可以通过 SSH 隧道访问已运行的 daemon。浏览器可通过手动 SSH 端口转发或使用 daemon 的内置 Web UI。

本 fork 不支持中继连接、配对、原生移动应用或 Docker 部署。参见[连接方式](/docs/connectivity)。

## 直接连接 {#direct-connections}

Daemon 默认监听 `127.0.0.1:6767`，仅本机可访问。直接连接、SSH 和 Tailscale 的配置说明见[连接方式](/docs/connectivity)。

### Unix 套接字 {#socket-file-cli-only}

如需隔离本地连接，可让 daemon 监听 Unix 套接字文件而非 TCP 端口。CLI 和桌面端可使用本地套接字；浏览器需要 HTTP/WebSocket 网络连接。能打开套接字的本地进程仍可访问 daemon。

### 通过 VPN 访问 {#vpn-access}

当你需要在本地网络之外直接连接时，请使用 [Tailscale](https://tailscale.com) 之类的 VPN。VPN 会加密流量，并让 daemon 不暴露在公共互联网上。把 daemon 绑定到它的 VPN 地址，设置 Paseo 密码，然后在客户端中把该地址添加为直接连接。

### 绑定到 0.0.0.0 {#binding-to-0000}

> **警告**：绑定到 `0.0.0.0` 会让 daemon 在所有网络接口上都可被访问，包括公共 Wi-Fi 和本地网络。这可能让你的 daemon 遭到未经授权的访问。如果你必须绑定到所有接口，请确保配置了合适的防火墙规则，并检查你的 `hostnames` 配置。

## DNS 重绑定防护 {#dns-rebinding-protection}

**CORS 并不是完整的安全边界**。它控制哪些浏览器来源可以发起请求，但无法阻止恶意网站把它的域名解析到你的本地机器（DNS 重绑定）。

Paseo 使用主机白名单校验传入请求的 `Host` 请求头。主机无法识别的请求会被拒绝。

通过 `config.json` 中的 `daemon.hostnames` 配置：

- 默认（`[]`）：允许 `localhost`、`*.localhost` 以及所有 IP 地址
- `['.example.com']`：允许 `example.com` 及其任何子域名，外加默认值
- `true`：允许任何主机（不推荐）

## 密码验证 {#password-authentication}

默认情况下，任何能访问 daemon 监听地址的人都可以连接。在 localhost 上这没有问题，只有本地进程能访问。但如果你绑定到某个网络接口（例如你的局域网 IP 或 `0.0.0.0`），或者你不完全信任本地网络，可以要求提供密码。

配置密码后，HTTP API 请求需要 `Authorization: Bearer <password>` 请求头，WebSocket 客户端也需要在连接时验证身份。未通过验证的 HTTP 请求返回 `401 Unauthorized`。健康检查和协议专用端点遵循自己的访问规则；参见仓库的 `SECURITY.md`。

如果你启用了[内置的 Web UI](/docs/web-ui)，它的静态文件同样无需密码即可提供，以便显示登录界面。这是有意设计的：API 和 WebSocket 在返回任何 Agent 数据或执行任何命令之前仍然需要验证。在把 daemon 绑定到网络之前请设置密码，让页面背后的数据受到保护。

密码以 bcrypt 哈希的形式保存在 `config.json` 中，daemon 从不以明文保存它。设置说明见[配置](/docs/configuration#password-authentication)。

### 密码验证能做什么、不能做什么 {#what-password-auth-does-and-does-not-do}

- **能**：阻止未经授权的客户端控制你的 Agent，即使它们能通过网络访问 daemon。
- **不能**：加密流量。在不受信任的网络上使用 SSH、Tailscale 等 VPN，或通过 TLS 反向代理使用 HTTPS/WSS。

### 何时使用 {#when-to-use-it}

- 你想把 daemon 绑定到局域网或 Tailscale 地址，并限制谁可以连接。
- 你不完全信任本地网络（共享办公室、通过 VPN 使用的公共 Wi-Fi 等）。
- 你通过反向代理暴露 daemon，并且想要额外一层身份验证。

## Linux 桌面沙盒 {#linux-desktop-sandbox}

每次在 Linux 上启动桌面应用时，Paseo 都会检查 Chromium 沙盒是否可用。当用户命名空间可用，或已安装的沙盒辅助程序可用时，它会保持沙盒启用。`.deb` 和 `.rpm` 安装包会配置这个辅助程序。

当两者都不可用时，AppImage 和解压后的 tar 包会在禁用 Chromium 沙盒的情况下启动。如果你需要 Chromium 进程隔离，请使用 `.deb` 或 `.rpm` 软件包。显式传入 `--no-sandbox` 会禁用沙盒。

打开 **设置 → 诊断 → App diagnostic** 查看沙盒状态及原因。[桌面日志](/docs/troubleshooting#reading-the-logs)也会记录同样的决定。

## Agent 身份验证 {#agent-authentication}

Paseo 封装了 Agent CLI（Claude Code、Codex、OpenCode、Muse Code），但不管理它们的身份验证。每个 Agent Provider 自行处理凭据：

- **Claude Code**：通过 Anthropic 的 OAuth 流程验证，保存在 `~/.claude/` 中
- **Codex**：使用你的 OpenAI API 密钥或 OAuth 会话
- **OpenCode**：通过各 Provider 专用的 API 密钥配置

Paseo 从不保存或传输 Provider API 密钥。Agent 在你的用户上下文中运行，使用你现有的凭据。

## Hub 身份与凭据 {#hub-identities-and-credentials}

Hub CLI 登录和 daemon 注册是两个独立的身份。`paseo hub login [origin]` 会在 `PASEO_HOME` 下的一个私有文件中保存一个持久的、组织范围的个人凭据，以规范化后的 Hub 地址为键。保存的凭据从不会发送到其他地址。请把 `PASEO_HOME` 当作敏感的本地状态加以保护。

Hub CLI 凭据是 bearer 密钥。远程 Hub 地址必须使用 HTTPS；只有回环地址的开发环境（`localhost`、`127.0.0.1` 和 `[::1]`）才接受明文 HTTP。

`paseo hub connect [origin]` 只用这个凭据（或显式提供的 API 密钥）申请一个短期有效的一次性注册令牌。daemon 用这个令牌完成交换，并保留它自己独立生成的关系凭据。退出 CLI 登录不会悄悄移除 daemon 的权限。交互式退出会先完成已确认的同一地址 daemon 断开，再删除登录。在 JSON 和非交互使用中，`logout` 从不提示也不断开；只有当自动化打算同时移除两个身份时，才传入 `--disconnect-daemon`。

`--api-key` 和 `PASEO_HUB_API_KEY` 会覆盖已保存的登录，但不会被持久化。用于自动化时，优先通过环境变量或密钥管理器注入；当本地进程列表或 shell 历史对其他用户可见时，避免使用命令行参数。

## 建议 {#recommendations}

- **使用 SSH、VPN 或 TLS** 加密不受信任网络上的连接
- **设置密码**，如果你绑定到网络地址，它可以阻止未经授权的客户端控制你的 Agent
- **不要在没有密码的情况下绑定到 0.0.0.0**，否则你网络中的任何设备都可以连接
- **保持 daemon 为最新版本**，安全改进会定期发布
- **保护 Hub 配置分支**，对 `.paseo` 文件包的推送权限决定了该项目能访问什么，见 [Hub 的工作原理](/docs/hub/concepts)
