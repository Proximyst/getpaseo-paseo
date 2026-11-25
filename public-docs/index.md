---
title: Getting started
description: Install Paseo and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

This fork of Paseo is an agentic development environment for running coding agents, editing files, reviewing changes, and testing your work. Agents run on your Linux machines; Linux desktop, browser/web UI, and CLI clients connect directly or over SSH. Docker, native mobile apps, relay, Windows, and macOS are not supported.

## Linux desktop app (recommended) {#desktop-app-recommended}

Install a Linux desktop package from this fork's releases, or build it from source using the repository's development guide. Upstream downloads at paseo.sh and getpaseo/paseo are not fork builds.

The desktop app bundles its own daemon and starts it automatically; no separate daemon install is required.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

```bash
npm install -g @getpaseo/cli
paseo
```

Paseo starts the daemon locally. Use the desktop app or CLI on the same machine, connect directly over a trusted LAN/VPN, or use SSH from the desktop app or CLI. Relay pairing is unavailable.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `PASEO_HOME` (defaults to `~/.paseo`).

## Where next

- [Run parallel tasks](/docs/parallel-development), use separate worktrees, review diffs, and test changes in the desktop app.
- [Connectivity](/docs/connectivity), connect directly, through SSH, or over Tailscale.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Paseo is built around.
- [Providers](/docs/providers), what a provider is and how Paseo wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [Plugins](/docs/plugins), add trusted local surfaces, sidebar actions, daemon behavior, and composer attachments.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/getpaseo/paseo)
- [Report an issue](https://github.com/getpaseo/paseo/issues)

## Prerequisites

Paseo manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Paseo uses it for PR-aware worktrees and a few orchestration features.
