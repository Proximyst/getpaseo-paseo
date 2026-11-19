---
title: Connectivity
description: Connect Linux desktop, browser, and CLI clients directly, through SSH, or over a VPN.
nav: Connectivity
order: 4
category: Getting started
---

# Connectivity

Your Paseo client connects to a daemon running on a Linux computer or server. Linux desktop and CLI can tunnel through SSH; browser clients use direct HTTP/WebSocket connections. Relay connections and native mobile apps are not supported in this fork.

This is client-to-daemon transport. If you are looking for the service that starts agents from GitHub, Slack, and Discord events, that is [Hub](/docs/hub).

- [SSH](#ssh)
- [Direct connections](#direct-connections)
- [Tailscale](#tailscale)

## SSH

SSH transport connects to an existing daemon through your local OpenSSH client. It does not install, start, or configure Paseo on the remote host.

Before connecting:

1. Start the Paseo daemon on the remote host.
2. Confirm `ssh user@host` works with a key or SSH agent. Paseo uses non-interactive SSH and follows your OpenSSH config.

The CLI accepts an SSH URI as its host:

```bash
paseo --host ssh://user@host ls -a
```

The daemon is expected at `127.0.0.1:6767` on the remote host. The port in the SSH URL is the SSH server port:

```bash
paseo --host ssh://user@host:2222 ls -a
```

Set a different remote daemon port with `daemonPort`:

```bash
paseo --host 'ssh://user@host?daemonPort=7777' ls -a
```

Put `--host` before the command. `paseo daemon status` observes the default local home; use `paseo --host ssh://user@host daemon status` to query a remote daemon. `paseo --host ssh://user@host run --cwd /path/on/remote ...` requires a working directory that exists on the remote host.

In Paseo Desktop, open **Settings → Add host → Remote SSH** and enter the same `ssh://` destination, including `:port` or `?daemonPort=` when those differ from the defaults.

If the remote daemon has a password, enter it in **Daemon password**; it is stored with the host and sent on every connection, the same as a direct connection's password. SSH login itself stays key-based — Paseo never prompts for an SSH password.

## Direct connections

On the daemon machine, bind `daemon.listen` to a trusted LAN or VPN address and set a daemon password before exposing it beyond localhost. See [Security](/docs/security) and [Configuration](/docs/configuration#password-authentication).

In the desktop or browser app, open **Settings → Add host → Direct connection**, enter the host, port, and password, then connect. Enable **Use SSL** only when a TLS reverse proxy serves that address. For the CLI:

```bash
paseo --host 192.168.1.10:6767 ls
```

The browser cannot invoke the local SSH client. To access a loopback-only remote daemon from a browser, forward it yourself:

```bash
ssh -N -L 6769:127.0.0.1:6767 user@host
```

Then use `127.0.0.1:6769` locally. If the remote daemon serves the web UI, open `http://127.0.0.1:6769/`.

## Tailscale

Install [Tailscale](https://tailscale.com/download) on the daemon machine and your client machine. Sign in to the same tailnet on both devices.

### 1. Find the daemon machine's Tailscale IP

Run this on the daemon machine:

```bash
tailscale ip -4
```

Copy the address it prints. The example below uses `100.101.102.103`.

### 2. Configure the daemon

Open `~/.paseo/config.json` and set `daemon.listen` to the Tailscale IP:

```json
{
  "$schema": "https://paseo.sh/schemas/paseo.config.v1.json",
  "version": 1,
  "daemon": {
    "listen": "100.101.102.103:6767"
  }
}
```

Keep the other settings already in the file. If it has a `daemon` object, add `listen` inside that object.

Before binding beyond localhost, configure [Password authentication](/docs/configuration#password-authentication).

Restart the daemon:

```bash
paseo daemon restart
```

If Paseo Desktop manages the daemon, use **Settings → your host → Overview → Restart daemon**.

### 3. Connect the client

1. Connect Tailscale on your client machine.
2. Open Paseo and go to **Settings → Add host → Direct connection**.
3. Enter the Tailscale IP in **Host**, `6767` in **Port**, and the daemon password.
4. Leave **Use SSL** off for this direct VPN address and select **Connect**.

For the CLI, use `paseo --host 100.101.102.103:6767 ls`. For the browser, you can also enable the daemon's [bundled web UI](/docs/web-ui).

## Troubleshooting

- **SSH authentication failed:** Run `ssh user@host` in a terminal and fix the key, agent, host key, or `~/.ssh/config` entry there. Paseo does not prompt for SSH passwords.
- **SSH connects but Paseo is refused:** Run `paseo daemon status` on the remote host. SSH transport does not start the daemon.
- **SSH connects but Paseo reports "Password required":** The remote daemon is password-protected. Remove the SSH connection from the host and add it again, this time entering the daemon password in **Daemon password**.
- **Connection timed out:** Check that Tailscale is connected on both devices and that you used the daemon machine's Tailscale IP.
- **Connection refused:** Run `paseo daemon status` and confirm the daemon is running on the configured IP and port.
- **Config change has no effect:** Run `paseo reload`. `daemon.listen` is a startup setting, so restart when the command reports it.
