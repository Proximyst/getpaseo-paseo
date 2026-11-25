# Security

Paseo follows a client-server architecture. The daemon runs on your Linux machine and manages your coding agents. Linux desktop, CLI, and browser clients connect to monitor and control those agents.

Paseo is local-first: agents run on your own machine, and clients connect to your development environment without a Paseo account or telemetry. Connected clients can receive workspace data, and agent providers and optional integrations handle data according to their own policies.

## Architecture

The supported daemon runs on a Linux workstation or server. Clients use direct WebSocket connections, optionally secured by a VPN or TLS reverse proxy. Linux desktop and CLI also support SSH tunneling to an already-running daemon and direct access over a local Unix socket.

This fork does not support Docker deployment, native iOS/Android apps or their stores (including F-Droid), relay connections, pairing or deployment, Windows, macOS, or Nix. Shared upstream cryptography and platform branches remain where required by common dependencies and upstream merging; their presence does not enable those products. See [Connectivity](public-docs/connectivity.md) and the [upstream merge skill](.agents/skills/merge-upstream/SKILL.md).

## Retained upstream relay threat model

The shared [relay endpoint security notes](docs/relay-endpoint-security.md) document the retained upstream protocol, including Noise `NK` and the legacy NaCl mode. They are reference material, not an available transport or a security guarantee for direct connections. This fork does not enable relay connections or issue relay pairing offers.

## Local daemon trust boundary

By default, the daemon binds to `127.0.0.1`. With no password configured, anything that can reach the daemon socket can control the daemon. Loopback is reachable by other users on the machine and by some forwarding tools.

The daemon supports an optional shared-secret password (set via `auth.password` in `config.json` or the `PASEO_PASSWORD` env var; stored bcrypt-hashed). WebSocket clients send the password in `hello`; the daemon sends no session data before admission. Direct connections still accept bearer headers and WebSocket bearer subprotocols for older clients. HTTP stays bearer-header based. Health (`GET /api/health`) and CORS preflight (`OPTIONS`) are exempt; `/api/files/download` and `/mcp/agents` use their own capability tokens.

The daemon writes a new `$PASEO_HOME/local-credential` on every run with mode `0600` and removes it on shutdown. The CLI and desktop main process read it only for the daemon whose PID lock `listen` matches their connection target. A same-user process can read this credential, so the password protects against network clients and other OS users, not processes running as the daemon user. Protect `$PASEO_HOME` accordingly.

Connected clients are trusted operators of the daemon user. File previews follow that authority: a preview request may read any regular file the daemon process can read, while keeping path normalization and symlink checks in the daemon file service. Workspace-relative paths remain a UI convenience, not a security boundary.

When Paseo checks out a change request from a different repository, it does not run that workspace's `paseo.json` setup, automatic terminals, named scripts, or teardown until you explicitly run setup for that workspace. The decision lasts for the workspace and does not re-prompt after new commits. Same-repository changes, ordinary branches, local workspaces, agent launches, terminals, explicit shell commands, and metadata-generation instructions are outside this gate.

If you expose the daemon beyond loopback, such as by binding to `0.0.0.0` or forwarding it through a tunnel or reverse proxy, you are responsible for restricting and securing that access. Set a daemon password before exposing it.

For remote access, use SSH, a trusted VPN, or HTTPS/WSS through a TLS reverse proxy. Direct password authentication does not encrypt traffic.

Host header validation and CORS origin checks are defense-in-depth controls for localhost exposure. They help block DNS rebinding and browser-based attacks, but they do not replace network isolation.

## DNS rebinding protection

CORS is not a complete security boundary. It controls which browser origins can make requests, but does not prevent a malicious website from resolving its domain to your local machine (DNS rebinding).

Paseo validates the `Host` header on every HTTP request and every WebSocket upgrade against an allowlist (Vite-style semantics). By default, only `localhost`, `*.localhost`, and any literal IP address (IPv4 or IPv6) are accepted. Additional hostnames can be configured via `hostnames` in `config.json` or the `PASEO_HOSTNAMES` env var (comma-separated; entries beginning with `.` match a domain and its subdomains; the value `true` disables the allowlist entirely). Requests with unrecognized hosts are rejected with `403 Host not allowed`.

## HTML file preview

Previewing an `.html` file in the file pane renders it as a page, so markup an agent wrote — or markup that arrived with a repo you cloned — executes when you open it. The preview is built to contain that, not to trust it.

The document loads with an opaque origin and a policy that permits inline script and style and refuses everything else: no remote script, font, image, or media; no `fetch`, XHR, WebSocket, or beacon; no form posts; no plugins; no nested frames. It has no access to Paseo's DOM, and storage and cookie APIs throw inside it rather than returning anything. It cannot navigate the top window, and it cannot open popups. It cannot read any file but itself.

One gap remains on web and desktop: a sandboxed document may navigate _itself_, and no CSP directive in current browsers prevents that. `navigate-to` was dropped from CSP Level 3 and is not enforced, and `<meta http-equiv="refresh">` needs no script at all. A hostile page can therefore reach a server by navigating away, carrying data available inside the preview, such as its own contents, browser and device properties, user input inside the page, and your IP address. It cannot read Paseo, another file, storage, or cookies.

Retained upstream native builds narrow this gap rather than closing it outright. They are not supported targets in this fork. Their WebView refuses navigation after the initial document, but Android's asynchronous decision can time out and permit navigation; this is design context, not a mitigation available to supported browser/desktop clients.

If you don't trust a page, read it in `Source`, which executes nothing. Source is available as an editable view on supported web hosts and a read-only view everywhere else.

## Agent authentication

Paseo wraps agent CLIs (Claude Code, Codex, OpenCode) but does not manage their authentication. Each agent provider handles its own credentials. Paseo never stores or transmits provider API keys. Agents run in your user context with your existing credentials.

## Forge host trust

Paseo only talks to a forge host that is either a known cloud host or one the forge CLI is already authenticated to. It never probes or routes credentials to an unauthenticated, remote-derived host.

## Reporting vulnerabilities

If you discover a security vulnerability, please report it privately by emailing hello@moboudra.com. Do not open a public issue.
