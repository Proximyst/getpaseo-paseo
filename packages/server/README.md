# Paseo daemon

The Linux daemon manages coding-agent processes, workspaces, terminals, and the WebSocket API used by Linux desktop, browser/web UI, and CLI clients.

## Development

From the repository root:

```bash
npm ci
npm run dev:server
```

The development daemon uses the checkout's `.dev/paseo-home` and `127.0.0.1:6768`, keeping it separate from a packaged desktop daemon.

See [development](../../docs/development.md) for configuration and builds, [architecture](../../docs/architecture.md) for ownership boundaries, and [testing](../../docs/testing.md) for coverage.

## Deployment

Install and run the CLI on Linux, or use the Linux desktop app's managed daemon. The daemon can also [serve the browser web UI](../../public-docs/web-ui.md). Use [direct or SSH connections](../../public-docs/connectivity.md); Docker deployment and relay pairing are unsupported.

Configuration and state default to `~/.paseo` (`PASEO_HOME`). Treat this directory as sensitive. Before exposing a listener beyond localhost, configure authentication and encrypted network access as described in [Security](../../SECURITY.md).

Shared upstream crypto and platform-specific source remain for common dependencies and easier upstream merges, not as supported deployment targets. See the [upstream merge skill](../../.agents/skills/merge-upstream/SKILL.md).
