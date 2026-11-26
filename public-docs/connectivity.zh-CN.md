---
title: 连接
description: 通过直接连接、SSH 或 VPN 使用 Paseo 的 Linux 桌面端、网页版和 CLI。
nav: 连接
---

# 连接 {#connectivity}

你的 Paseo 客户端连接到 Linux 电脑或服务器上的 daemon。Linux 桌面端和 CLI 可以通过 SSH 隧道连接，浏览器使用直接 HTTP/WebSocket 连接。本 fork 不支持中继或原生移动应用。

这里说的是客户端到 daemon 的传输。如果你要找的是由 GitHub、Slack 和 Discord 事件启动 Agent 的服务，那是 [Hub](/docs/hub)。

- [SSH](#ssh)
- [直接连接](#direct-connections)
- [Tailscale](#tailscale)

## SSH {#ssh}

SSH 传输通过你本地的 OpenSSH 客户端连接到一个已有的 daemon。它不会在远程主机上安装、启动或配置 Paseo。

连接之前：

1. 在远程主机上启动 Paseo daemon。
2. 确认 `ssh user@host` 可以通过密钥或 SSH agent 登录。Paseo 使用非交互式 SSH，并遵循你的 OpenSSH 配置。

CLI 接受 SSH URI 作为主机：

```bash
paseo --host ssh://user@host ls -a
```

daemon 应位于远程主机的 `127.0.0.1:6767`。SSH URL 中的端口是 SSH 服务器的端口：

```bash
paseo --host ssh://user@host:2222 ls -a
```

用 `daemonPort` 设置不同的远程 daemon 端口：

```bash
paseo --host 'ssh://user@host?daemonPort=7777' ls -a
```

请把 `--host` 放在命令之前。`paseo daemon status` 查看的是默认的本地 home；要查询远程 daemon，请使用 `paseo --host ssh://user@host daemon status`。`paseo --host ssh://user@host run --cwd /path/on/remote ...` 需要一个在远程主机上存在的工作目录。

在 Paseo 桌面端中，打开 **设置 → 添加主机 → 远程 SSH**，输入同样的 `ssh://` 目标地址；如果端口与默认值不同，请带上 `:port` 或 `?daemonPort=`。

如果远程 daemon 设置了密码，请在 **守护进程密码** 中输入；它会随主机一起保存，并在每次连接时发送，与直连的密码一样。SSH 登录本身仍然基于密钥，Paseo 从不提示输入 SSH 密码。

## 直接连接 {#direct-connections}

在 daemon 所在机器上，将 `daemon.listen` 绑定到受信任的局域网或 VPN 地址，并在允许本机之外的连接前设置 daemon 密码。密码认证不会加密流量。参见[安全](/docs/security)和[密码认证](/docs/configuration#password-authentication)。

在桌面端或网页版中，打开 **设置 → 添加主机 → 直接连接**，输入主机、端口和密码，然后连接。仅当地址由 TLS 反向代理提供服务时启用 **使用 SSL**。CLI 示例：

```bash
paseo --host 192.168.1.10:6767 ls
```

浏览器无法启动本地 SSH 客户端。如需从浏览器访问只监听回环地址的远程 daemon，请先在终端转发端口：

```bash
ssh -N -L 6769:127.0.0.1:6767 user@host
```

然后在本地使用 `127.0.0.1:6769`。如果远程 daemon 提供 Web UI，可打开 `http://127.0.0.1:6769/`。

## Tailscale {#tailscale}

在 daemon 和客户端所在的机器上安装 [Tailscale](https://tailscale.com/download)，并登录同一个 tailnet。

### 为主机启用 Tailscale {#enable-tailscale-for-a-host}

开放监听地址之前，请先设置 [daemon 密码](/docs/configuration#password-authentication)。在已连接到主机的桌面端或网页版中，打开 **设置 → 你的主机 → 设备**，开启 **Tailscale** 并复制地址。

如果只使用 CLI，请在 daemon 所在机器上运行 `tailscale ip -4`。将该 IP 和 daemon 端口作为额外的 TCP 监听地址添加到 `daemon.listen`，例如 `127.0.0.1:6767,100.101.102.103:6767`。将现有的主 TCP 监听地址保留在首位，再运行 `paseo reload`。如果 daemon 监听的是 Unix 套接字，请先将主监听地址切换到 TCP 并重启。参见[监听地址](/docs/configuration#listen-addresses)。

### 连接客户端 {#connect-the-client}

1. 在客户端机器上连接 Tailscale。
2. 在桌面端或网页版中打开 **设置 → 添加主机 → 直接连接**。
3. 在 **Host** 中输入复制的 IP，在 **端口** 中输入端口号，并输入 daemon 密码。
4. 保持 **使用 SSL** 关闭，然后选择 **连接**。

如需通过 CLI 连接，请运行 `paseo --host 100.101.102.103:6767 ls`。通过 HTTPS 提供的浏览器应用需要 TLS 端点；如果要通过 Tailscale 直接使用 HTTP，请启用 daemon 的[内置 Web UI](/docs/web-ui)，然后在浏览器中打开复制的地址。

## 故障排查 {#troubleshooting}

- **SSH 认证失败**：在终端中运行 `ssh user@host`，在那里修复密钥、agent、主机密钥或 `~/.ssh/config` 条目。Paseo 不会提示输入 SSH 密码。
- **SSH 能连上但 Paseo 被拒绝**：在远程主机上运行 `paseo daemon status`。SSH 传输不会启动 daemon。
- **SSH 能连上但 Paseo 报告 “Password required”**：远程 daemon 受密码保护。从主机中移除这个 SSH 连接并重新添加，这次在 **守护进程密码** 中输入 daemon 密码。
- **连接超时**：检查两台设备上的 Tailscale 是否都已连接，以及你使用的是否是 daemon 机器的 Tailscale IP。
- **连接被拒绝**：运行 `paseo daemon status`，确认 daemon 正在配置的 IP 和端口上运行。
- **配置修改没有生效**：运行 `paseo reload`。如果命令报告主监听地址发生变化，请重启。
