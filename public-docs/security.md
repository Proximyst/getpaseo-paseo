---
title: Security
description: "Security model for Linux desktop, browser, and CLI connections: direct access, SSH, passwords, and host allowlists."
nav: Security
order: 5
category: Getting started
---

# Security

Paseo follows a client-server architecture. The daemon runs on your Linux machine and manages your coding agents. Linux desktop, CLI, and browser clients connect to the daemon to monitor and control those agents.

Your code never leaves your machine. Paseo is a local-first tool that connects directly to your development environment.

## Architecture

The Paseo daemon runs on a Linux workstation or server. It listens for connections and manages agent lifecycles.

Clients connect directly over WebSocket, optionally secured by a VPN or TLS reverse proxy. Linux desktop and CLI also support SSH tunnels to an already-running daemon. Browser users can use SSH port forwarding or the daemon's bundled web UI.

Relay connections, relay pairing, native mobile apps, and Docker deployment are unsupported. Shared upstream encryption/protocol code remains for dependency and merge compatibility, not as an enabled connection path. See [Connectivity](/docs/connectivity).

## Direct connections

By default, the daemon listens on `127.0.0.1:6767` (localhost only). It is not reachable from other machines without forwarding or a different listen address. See [Connectivity](/docs/connectivity) for direct, SSH, and Tailscale setup.

### Socket file

For local isolation, configure the daemon to listen on a Unix socket instead of a TCP port. The CLI and desktop can use local sockets; browser clients require HTTP/WebSocket access. A socket still grants access to every local process permitted to open it.

### VPN access

Use a VPN such as [Tailscale](https://tailscale.com) when you want a direct connection outside your local network. The VPN encrypts the traffic and keeps the daemon off the public internet. Bind the daemon to its VPN address, set a Paseo password, then add that address as a direct connection in the client.

### Binding to 0.0.0.0

> **Warning:** Binding to `0.0.0.0` makes the daemon reachable on all network interfaces, including public Wi-Fi and local networks. This can expose your daemon to unauthorized access. If you must bind to all interfaces, ensure you have proper firewall rules and review your `hostnames` configuration.

## DNS rebinding protection

**CORS is not a complete security boundary.** It controls which browser origins can make requests, but does not prevent a malicious website from resolving its domain to your local machine (DNS rebinding).

Paseo uses a host allowlist to validate the `Host` header on incoming requests. Requests with unrecognized hosts are rejected.

Configure via `daemon.hostnames` in `config.json`:

- Default (`[]`): allow `localhost`, `*.localhost`, and all IP addresses
- `['.example.com']`: allow `example.com` and any subdomain, plus defaults
- `true`: allow any host (not recommended)

## Password authentication

By default, anyone who can reach the daemon's listening address can connect. On localhost this is fine, only local processes have access. But if you bind to a network interface (e.g. your LAN IP or `0.0.0.0`), or if you don't fully trust your local network, you can require a password.

When a password is configured, HTTP API requests require an `Authorization: Bearer <password>` header, and every WebSocket client must authenticate when it connects. Unauthenticated requests receive a `401 Unauthorized` response. Health and protocol-specific capability endpoints have their own admission rules; consult the repository's `SECURITY.md` for the full trust boundary.

If you enable the [bundled web UI](/docs/web-ui), its static files are also served without the password so the login screen can render. This is by design, the API and WebSocket still require authentication before any agent data is returned or any command runs. Set a password before binding the daemon to a network so the data behind the page stays protected.

The password is stored as a bcrypt hash in `config.json`, the daemon never stores it in plaintext. See [Configuration](/docs/configuration#password-authentication) for setup instructions.

### What password auth does and does not do

- **Does:** Prevents unauthorized clients from controlling your agents, even if they can reach the daemon over the network.
- **Does not:** Encrypt traffic. Use SSH, a VPN such as Tailscale, or HTTPS/WSS through a TLS reverse proxy on untrusted networks.

### When to use it

- You want to bind the daemon to a LAN or Tailscale address and restrict who can connect.
- You don't fully trust your local network (shared office, public Wi-Fi with a VPN, etc.).
- You're exposing the daemon via a reverse proxy and want an additional authentication layer.

## Linux desktop sandbox

Paseo checks Chromium sandbox availability each time the desktop app launches on Linux. It keeps sandboxing enabled when user namespaces work or an installed sandbox helper is usable. The `.deb` and `.rpm` installers configure that helper.

AppImage and extracted tar archives launch with Chromium's sandbox disabled when neither is available. Use the `.deb` or `.rpm` package if you require Chromium process isolation. Passing `--no-sandbox` explicitly disables it.

Open **Settings → Diagnostics → App Diagnostics** to check the sandbox state and reason. The [desktop log](/docs/troubleshooting#reading-the-logs) records the same decision.

## Agent authentication

Paseo wraps agent CLIs (Claude Code, Codex, OpenCode, Muse Code) but does not manage their authentication. Each agent provider handles its own credentials:

- **Claude Code**, authenticates via Anthropic's OAuth flow, stored in `~/.claude/`
- **Codex**, uses your OpenAI API key or OAuth session
- **OpenCode**, configured via provider-specific API keys

Paseo never stores or transmits provider API keys. Agents run in your user context with your existing credentials.

## Hub identities and credentials

Hub CLI login and daemon enrollment are separate identities. `paseo hub login [origin]` stores a durable organization-scoped human credential in a private file under `PASEO_HOME`, keyed by the normalized Hub origin. A stored credential is never sent to another origin. Protect `PASEO_HOME` as sensitive local state.

Hub CLI credentials are bearer secrets. Remote Hub origins must use HTTPS; cleartext HTTP is accepted only for loopback development origins (`localhost`, `127.0.0.1`, and `[::1]`).

`paseo hub connect [origin]` uses that credential, or an explicit API key, only to request a short-lived one-time enrollment token. The daemon exchanges the token and retains its own independently generated relationship credential. Logging out of the CLI does not silently remove daemon authority. Interactive logout completes any accepted same-origin daemon disconnection before deleting the login. In JSON and noninteractive use, `logout` never prompts or disconnects; pass `--disconnect-daemon` only when automation intends to remove both identities.

`--api-key` and `PASEO_HUB_API_KEY` override stored login without being persisted. Prefer environment or secret-manager injection for automation, and avoid command-line flags when local process listings or shell history are visible to other users.

## Recommendations

- **Use SSH, a VPN, or TLS** for remote connections across untrusted networks
- **Set a password** if you bind to a network address, it prevents unauthorized clients from controlling your agents
- **Never bind to 0.0.0.0 without a password**, without one, any device on your network can connect
- **Keep your daemon updated**, security improvements are released regularly
- **Protect the Hub configuration branch**, push access to the `.paseo` bundle controls what that project can reach, see [How Hub works](/docs/hub/concepts)
