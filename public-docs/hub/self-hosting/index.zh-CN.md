---
title: 自托管 Hub
description: 使用内嵌数据库在本地运行 Hub，或配合 PostgreSQL 部署。
nav: 自托管
---

# 自托管 Hub {#self-hosting-hub}

最快的方式只需一条命令：

```sh
npx @getpaseo/hub
```

打开 <http://localhost:3000>。全新的 Hub 会创建内嵌数据库和认证密钥，然后引导你创建管理员账号，以及你需要的 GitHub、Slack 或 Discord 应用。

按照[快速开始](/docs/hub/quickstart)，通过 Socket Mode 连接 Slack，无需公开服务器即可运行第一个 workflow。

## 本地数据 {#local-data}

如果没有设置 `DATABASE_URL`，Hub 会把内嵌的 PGlite 数据库及其生成的认证密钥保存在 `$XDG_DATA_HOME/paseo-hub` 下。如果 `XDG_DATA_HOME` 没有设置为绝对路径，Hub 会使用 `~/.local/share/paseo-hub`。两者在重启后都会保留。

用以下方式显式指定其他位置：

```sh
PASEO_HUB_DATA_DIR=/path/to/paseo-hub-data npx @getpaseo/hub
```

内嵌模式下，每个数据目录只支持一个 Hub 进程，适用于个人或单进程的 Hub。升级或迁移之前，请备份整个数据目录。

## 公开地址 {#public-addresses}

Hub 默认使用 `http://localhost:3000`。对于它的控制台、daemon、Slack Socket Mode 以及由 Hub 主动连接出去的 Provider，这已经足够。

GitHub 事件触发器使用 webhook，需要一个公开的 HTTPS 地址。没有 webhook 时，仓库访问仍然可以工作。Slack 可选的 Webhooks 传输方式也需要公开 HTTPS；Socket Mode 则不需要。

当 Hub 有一个稳定的公开地址时，请在启动前设置它：

```sh
PASEO_HUB_APP_URL=https://hub.example.com npx @getpaseo/hub
```

修改公开地址后，需要更新 Provider 应用中的回调和 webhook 设置。**Apps** 页面会为 Hub 当前使用的地址生成这些 URL。

## PostgreSQL {#postgresql}

设置 `DATABASE_URL`，即可使用 PostgreSQL 代替内嵌数据库：

```sh
DATABASE_URL=postgres://paseo:password@localhost:5432/paseo_hub \
  npx @getpaseo/hub
```

对于持久的服务器部署、多个 Hub 进程，或已有的数据库备份和运维体系，请使用 PostgreSQL。迁移会在启动时自动运行。迁移失败时，Hub 不会开始监听。

数据库同样保存 Hub 生成的认证密钥。只有当部署必须从平台的密钥存储中提供该密钥时，才设置 `PASEO_HUB_AUTH_SECRET`。设置此覆盖期间，Hub 会使用它，但不会替换已保存的密钥。更改实际生效的密钥会让所有人退出控制台；已签发的执行凭据在其执行结束前仍然有效。

## 应用配置 {#app-configuration}

管理员在 **Apps** 下配置 GitHub、Slack 和 Discord。Hub 会先验证凭据，再保存到数据库中，并启动与通过环境变量配置的部署相同的 Provider 运行时。

对于在 Hub 之外管理密钥的部署，环境变量仍然可用。完整的环境变量配置优先于已保存的应用，并在控制台中显示为 **Managed by environment**。

```sh
# GitHub
GITHUB_APP_SLUG=
GITHUB_APP_ID=
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY=          # or GITHUB_APP_PRIVATE_KEY_PATH
GITHUB_WEBHOOK_SECRET=

# Slack Socket Mode
SLACK_TRANSPORT=socket
SLACK_APP_ID=
SLACK_APP_TOKEN=

# Slack Webhooks instead of Socket Mode
SLACK_TRANSPORT=webhook
SLACK_APP_ID=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_SIGNING_SECRET=

# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
```

各 Provider 的行为和连接步骤见 [GitHub](/docs/hub/self-hosting/github-app)、[Slack](/docs/hub/self-hosting/slack-app) 和 [Discord](/docs/hub/self-hosting/discord-app)。

## 通过环境变量初始化 {#bootstrap-from-environment}

对于全新的数据库，默认通过浏览器完成设置。无人值守的部署可以改用环境变量创建第一个管理员：

```dotenv
PASEO_BOOTSTRAP_ORGANIZATION=My organization
PASEO_BOOTSTRAP_OWNER_EMAIL=me@example.com
PASEO_BOOTSTRAP_OWNER_PASSWORD=replace-with-a-temporary-password
```

密码至少需要 12 个字符。登录一次，在控制台中替换密码，然后移除 `PASEO_BOOTSTRAP_OWNER_PASSWORD`。Hub 会保留该账号和组织。

## 使用 Caddy 提供 HTTPS {#https-with-caddy}

本 fork 不提供 Docker 或基于 Dockerfile 的部署方式。在 Linux 主机上通过 npm 运行 Hub，并使用 Caddy 终止 TLS：

```caddyfile
hub.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

把 `hub.example.com` 指向该主机，并开放 80 和 443 端口。Caddy 会[自动获取并续期证书](https://caddyserver.com/docs/automatic-https)。

在 Hub 服务的环境变量中设置公开地址和可信代理请求头：

```dotenv
PASEO_HUB_APP_URL=https://hub.example.com
PASEO_HUB_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
```

使用主机防火墙限制 Hub 的 HTTP 端口，仅公开反向代理。请用 Linux 服务管理器保持 Hub 进程运行；进程停止期间会错过事件。

## 升级 {#upgrades}

更新 npm 包或源码并重启服务。迁移只能向前。请先备份内嵌数据目录或 PostgreSQL 数据库；其中包含账号、应用凭据、配置版本、连接和执行历史。
