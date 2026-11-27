#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { WebSocket, WebSocketServer } from "ws";
import { hideDeveloperToasts } from "../../app/e2e/support/developer-ui.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(desktopDir, "../..");
const devRunner = path.join(desktopDir, "scripts", "dev-runner.mjs");
const timeoutMs = 90_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) return reject(error);
        if (!address || typeof address === "string") {
          return reject(new Error("Failed to reserve a local port"));
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForPort(port, label, processInfo) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      processInfo &&
      (processInfo.child.exitCode !== null || processInfo.child.signalCode !== null)
    ) {
      throw new Error(
        `${label} process exited before opening its port; see ${processInfo.logPath}`,
      );
    }
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(500);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label} on port ${port}`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedPaseoHome({ paseoHome, listen, workspaceRoot, workspaceId, workspaceTitle }) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const cwd = path.join(workspaceRoot, workspaceId);
  fs.mkdirSync(cwd, { recursive: true });
  const projects = [
    {
      projectId: `project-${workspaceId}`,
      rootPath: cwd,
      kind: "non_git",
      displayName: workspaceTitle,
      customName: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    },
  ];
  const workspaces = [
    {
      workspaceId,
      projectId: projects[0].projectId,
      cwd,
      kind: "directory",
      displayName: workspaceTitle,
      title: workspaceTitle,
      branch: null,
      baseBranch: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
      pinnedAt: null,
    },
  ];

  writeJson(path.join(paseoHome, "config.json"), {
    version: 1,
    daemon: {
      listen,
      relay: { enabled: false },
      mcp: { enabled: false, injectIntoAgents: false },
      browserTools: { enabled: true },
      cors: { allowedOrigins: ["*"] },
    },
  });
  writeJson(path.join(paseoHome, "projects", "projects.json"), projects);
  writeJson(path.join(paseoHome, "projects", "workspaces.json"), workspaces);
}

function spawnLogged(name, command, args, options, logDir) {
  const logPath = path.join(logDir, `${name}.log`);
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let openStreams = 2;
  const closeLogStream = () => {
    openStreams -= 1;
    if (openStreams === 0) log.end();
  };
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.stdout.once("end", closeLogStream);
  child.stderr.once("end", closeLogStream);
  return { child, logPath };
}

function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // ignore
  }
}

async function startTargetHttpAndWsServer() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
      <html>
        <head><title>Proxy E2E Target</title></head>
        <body>
          <h1 id="heading">Proxied HTTP OK</h1>
          <div id="ws-result">connecting</div>
          <script>
            const ws = new WebSocket("ws://" + location.host + "/ws");
            ws.addEventListener("open", () => ws.send("hello-tunnel"));
            ws.addEventListener("message", (ev) => {
              document.getElementById("ws-result").textContent = "WS_OK:" + ev.data;
            });
            ws.addEventListener("error", () => {
              document.getElementById("ws-result").textContent = "WS_ERROR";
            });
          </script>
        </body>
      </html>`);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      ws.send(`ack:${data.toString()}`);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "Target server did not bind TCP port");
  return {
    port: address.port,
    close: async () => {
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function stripNetworkTunnelFeature(text) {
  try {
    const parsed = JSON.parse(text);
    if (
      parsed?.type === "session" &&
      parsed?.message?.type === "status" &&
      parsed?.message?.payload?.status === "server_info" &&
      parsed?.message?.payload?.features
    ) {
      delete parsed.message.payload.features.networkTunnel;
      return JSON.stringify(parsed);
    }
  } catch {
    // pass through
  }
  return text;
}

async function startLegacyDaemonBridge(upstreamDaemonPort) {
  const server = createServer();
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (client) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${upstreamDaemonPort}/ws`);
    const pending = [];
    upstream.once("open", () => {
      for (const [data, binary] of pending) upstream.send(data, { binary });
      pending.length = 0;
    });
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push([data, binary]);
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(binary ? data : stripNetworkTunnelFeature(data.toString()), { binary });
      }
    });
    client.on("close", () => upstream.terminate());
    client.on("error", () => upstream.terminate());
    upstream.on("close", () => client.terminate());
    upstream.on("error", () => client.terminate());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitForAppPage(browser, expoPort) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes(`localhost:${expoPort}`)) return page;
      }
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for Electron app renderer");
}

async function waitForDesktopStatus(page) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await page.evaluate(async () => {
        if (typeof window.paseoDesktop?.invoke !== "function") return null;
        return await window.paseoDesktop.invoke("desktop_daemon_status");
      });
      if (typeof status?.serverId === "string") return status;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for Electron desktop bridge");
}

async function readGuestState(page, filter) {
  return await page.evaluate(async (criteria) => {
    const webviews = [...document.querySelectorAll("webview")];
    const matching = webviews.find((wv) => {
      const part = wv.getAttribute("partition") ?? "";
      if (criteria.exactPartition) return part === criteria.exactPartition;
      if (criteria.partitionPrefix) return part.startsWith(criteria.partitionPrefix);
      return true;
    });
    if (!matching) {
      return {
        found: false,
        count: webviews.length,
        partitions: webviews.map((w) => w.getAttribute("partition")),
      };
    }
    try {
      const state = await matching.executeJavaScript(`(() => ({
        href: location.href,
        heading: document.getElementById("heading")?.textContent ?? null,
        wsResult: document.getElementById("ws-result")?.textContent ?? null,
        marker: localStorage.getItem("partition_marker"),
      }))()`);
      return {
        found: true,
        partition: matching.getAttribute("partition"),
        ...state,
      };
    } catch (error) {
      return {
        found: true,
        partition: matching.getAttribute("partition"),
        evalError: String(error),
      };
    }
  }, filter);
}

async function openNewBrowserTabAndNavigate(page, url) {
  // Click the visible workspace "+" new-tab button inside the active workspace pane
  const newTabBtn = page
    .getByRole("button", { name: "New tab", exact: true })
    .and(page.locator(":visible"))
    .first();
  await expect(newTabBtn).toBeVisible({ timeout: 30_000 });
  await newTabBtn.click();

  const browserOption = page
    .getByRole("button", { name: /^Browser/i })
    .and(page.locator(":visible"))
    .first();
  await expect(browserOption).toBeVisible({ timeout: 15_000 });
  await browserOption.click();

  const urlInput = page.getByLabel("Browser URL").and(page.locator(":visible")).first();
  await expect(urlInput).toBeVisible({ timeout: 30_000 });
  await urlInput.click();
  await urlInput.fill(url);
  await urlInput.press("Enter");
}

async function main() {
  const artifactDir =
    process.env.PASEO_DESKTOP_BROWSER_PROXY_E2E_ARTIFACT_DIR ??
    fs.mkdtempSync(path.join(os.tmpdir(), "paseo-browser-proxy-e2e-artifacts-"));
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-browser-proxy-e2e-"));
  fs.mkdirSync(artifactDir, { recursive: true });

  const localHome = path.join(runtimeDir, "local-home");
  const remoteHome = path.join(runtimeDir, "remote-home");
  const oldHome = path.join(runtimeDir, "old-home");
  const userData = path.join(runtimeDir, "electron-user-data");
  const workspaceRoot = path.join(runtimeDir, "workspaces");

  // Present the IPv4 listener as a remote target to the classifier while keeping
  // fixture daemons reachable only over loopback.
  const remoteHost = "[::ffff:127.0.0.1]";

  const [localDaemonPort, remoteDaemonPort, oldDaemonPort, expoPort, cdpPort] = await Promise.all([
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
    reservePort(),
  ]);

  const targetServer = await startTargetHttpAndWsServer();
  const legacyBridge = await startLegacyDaemonBridge(oldDaemonPort);
  const children = [];
  let browser = null;

  try {
    seedPaseoHome({
      paseoHome: localHome,
      listen: `127.0.0.1:${localDaemonPort}`,
      workspaceRoot,
      workspaceId: "wks-local-proxy",
      workspaceTitle: "Local Workspace",
    });
    seedPaseoHome({
      paseoHome: remoteHome,
      listen: `127.0.0.1:${remoteDaemonPort}`,
      workspaceRoot,
      workspaceId: "wks-remote-proxy",
      workspaceTitle: "Remote Proxy Workspace",
    });
    seedPaseoHome({
      paseoHome: oldHome,
      listen: `127.0.0.1:${oldDaemonPort}`,
      workspaceRoot,
      workspaceId: "wks-old-proxy",
      workspaceTitle: "Old Legacy Workspace",
    });

    const baseEnv = {
      ...process.env,
      PASEO_CORS_ORIGINS: "*",
      PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
      PASEO_DICTATION_ENABLED: "0",
      PASEO_VOICE_MODE_ENABLED: "0",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      PASEO_NODE_ENV: "development",
    };

    const localDaemon = spawnLogged(
      "local-daemon",
      process.execPath,
      ["--import", "tsx", path.join(rootDir, "packages/server/scripts/dev-runner.ts")],
      {
        cwd: rootDir,
        env: {
          ...baseEnv,
          PASEO_HOME: localHome,
          PASEO_LISTEN: `127.0.0.1:${localDaemonPort}`,
          PASEO_SERVER_ID: "e2e-local-host",
        },
      },
      artifactDir,
    );
    children.push(localDaemon.child);

    const remoteDaemon = spawnLogged(
      "remote-daemon",
      process.execPath,
      ["--import", "tsx", path.join(rootDir, "packages/server/scripts/dev-runner.ts")],
      {
        cwd: rootDir,
        env: {
          ...baseEnv,
          PASEO_HOME: remoteHome,
          PASEO_LISTEN: `127.0.0.1:${remoteDaemonPort}`,
          PASEO_SERVER_ID: "e2e-remote-host",
        },
      },
      artifactDir,
    );
    children.push(remoteDaemon.child);

    const oldDaemon = spawnLogged(
      "old-daemon",
      process.execPath,
      ["--import", "tsx", path.join(rootDir, "packages/server/scripts/dev-runner.ts")],
      {
        cwd: rootDir,
        env: {
          ...baseEnv,
          PASEO_HOME: oldHome,
          PASEO_LISTEN: `127.0.0.1:${oldDaemonPort}`,
          PASEO_SERVER_ID: "e2e-old-host",
        },
      },
      artifactDir,
    );
    children.push(oldDaemon.child);

    await Promise.all([
      waitForPort(localDaemonPort, "local daemon", localDaemon),
      waitForPort(remoteDaemonPort, "remote daemon", remoteDaemon),
      waitForPort(oldDaemonPort, "old daemon", oldDaemon),
    ]);

    const desktopArgs = [
      process.execPath,
      devRunner,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ];
    const desktopCommand = process.platform === "linux" ? "xvfb-run" : desktopArgs.shift();
    const desktopCommandArgs =
      process.platform === "linux"
        ? ["-a", "--server-args=-screen 0 1280x800x24", ...desktopArgs]
        : desktopArgs;

    const desktop = spawnLogged(
      "desktop",
      desktopCommand,
      desktopCommandArgs,
      {
        cwd: rootDir,
        env: {
          ...baseEnv,
          PASEO_HOME: localHome,
          PASEO_LISTEN: `127.0.0.1:${localDaemonPort}`,
          PASEO_DAEMON_ENDPOINT: `localhost:${localDaemonPort}`,
          EXPO_UNSTABLE_HEADLESS: "1",
          EXPO_PORT: String(expoPort),
          EXPO_DEV_URL: `http://localhost:${expoPort}`,
          PASEO_ELECTRON_REMOTE_DEBUGGING_PORT: String(cdpPort),
          PASEO_ELECTRON_USER_DATA_DIR: userData,
          PASEO_ELECTRON_FLAGS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
        },
      },
      artifactDir,
    );
    children.push(desktop.child);
    await waitForPort(cdpPort, "Electron CDP", desktop);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    const page = await waitForAppPage(browser, expoPort);
    await hideDeveloperToasts(page);
    await waitForDesktopStatus(page);

    await expect(page.getByRole("button", { name: "Local Workspace", exact: true })).toBeVisible({
      timeout: timeoutMs,
    });
    const connectionPrompt = page.getByTestId("add-host-method-modal");
    if (await connectionPrompt.isVisible()) {
      await connectionPrompt.getByRole("button", { name: "Close", exact: true }).click();
    }

    const relayRejection = await page.evaluate(async () => {
      const browserBridge = window.paseoDesktop.browser;
      const input = {
        serverId: "disabled-relay",
        target: {
          type: "relay",
          serverId: "disabled-relay",
          relayEndpoint: "127.0.0.1:1",
          daemonPublicKeyB64: "AAAA",
        },
      };
      const results = await Promise.allSettled([
        browserBridge.ensureHostProxy(input),
        browserBridge.updateHostProxyTarget(input),
      ]);
      return {
        errors: results.map((result) =>
          result.status === "rejected" ? String(result.reason) : null,
        ),
        status: await browserBridge.getHostProxyStatus(input.serverId),
      };
    });
    expect(relayRejection.status).toBeNull();
    expect(relayRejection.errors).toEqual([
      expect.stringContaining("Relay browser proxy is not supported in this build"),
      expect.stringContaining("Relay browser proxy is not supported in this build"),
    ]);

    // Register both remote hosts using direct TCP connections.
    await page.evaluate(
      ({ remoteEndpoint, oldEndpoint }) => {
        const key = "@paseo:daemon-registry";
        const registry = JSON.parse(localStorage.getItem(key) ?? "[]");
        const now = new Date().toISOString();
        const remoteConn = {
          id: `direct:${remoteEndpoint}`,
          type: "directTcp",
          endpoint: remoteEndpoint,
        };
        const oldConn = {
          id: `direct:${oldEndpoint}`,
          type: "directTcp",
          endpoint: oldEndpoint,
        };
        registry.push(
          {
            serverId: "e2e-remote-host",
            label: "Remote Proxy Host",
            connections: [remoteConn],
            preferredConnectionId: remoteConn.id,
            createdAt: now,
            updatedAt: now,
          },
          {
            serverId: "e2e-old-host",
            label: "Old Legacy Host",
            connections: [oldConn],
            preferredConnectionId: oldConn.id,
            createdAt: now,
            updatedAt: now,
          },
        );
        localStorage.setItem(key, JSON.stringify(registry));
      },
      {
        remoteEndpoint: `${remoteHost}:${remoteDaemonPort}`,
        oldEndpoint: `${remoteHost}:${legacyBridge.port}`,
      },
    );

    await page.reload();
    await hideDeveloperToasts(page);

    const targetUrl = `http://localhost:${targetServer.port}/`;

    // -------------------------------------------------------------------------
    // 1. Proxied <webview> loads HTTP + WebSocket through real daemon tunnel
    // -------------------------------------------------------------------------
    const remoteWsButton = page
      .getByRole("button", {
        name: /^Remote Proxy Workspace(?:,|$)/,
      })
      .first();
    await expect(remoteWsButton).toBeVisible({ timeout: timeoutMs });
    await remoteWsButton.click();

    await openNewBrowserTabAndNavigate(page, targetUrl);

    const routingPill = page
      .getByTestId("browser-routing-pill")
      .and(page.locator(":visible"))
      .first();
    await expect(routingPill).toBeVisible({ timeout: 30_000 });
    await expect(routingPill).toHaveAttribute(
      "aria-label",
      "Switch browser routing from Remote Proxy Host to Local",
    );

    await expect
      .poll(
        async () => await readGuestState(page, { partitionPrefix: "persist:paseo-browser-host-" }),
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toMatchObject({
        found: true,
        heading: "Proxied HTTP OK",
        wsResult: "WS_OK:ack:hello-tunnel",
      });

    const hostGuest = await readGuestState(page, {
      partitionPrefix: "persist:paseo-browser-host-",
    });
    assert(
      /^persist:paseo-browser-host-[0-9a-f]{16}$/.test(hostGuest.partition),
      `Expected deterministic host proxy partition, got ${hostGuest.partition}`,
    );

    // Write storage marker in host proxy partition to verify isolation on toggle
    await page.evaluate(async () => {
      const wv = [...document.querySelectorAll("webview")].find((el) =>
        (el.getAttribute("partition") ?? "").startsWith("persist:paseo-browser-host-"),
      );
      await wv.executeJavaScript('localStorage.setItem("partition_marker", "from-host-partition")');
    });

    await page.screenshot({ path: path.join(artifactDir, "01-proxied-host-loaded.png") });

    // -------------------------------------------------------------------------
    // 2. Toggling <host> <-> Local switches partition cleanly with isolation
    // -------------------------------------------------------------------------
    await routingPill.click();
    await expect(routingPill).toHaveAttribute(
      "aria-label",
      "Switch browser routing from Local to Remote Proxy Host",
      { timeout: 15_000 },
    );

    await expect
      .poll(async () => await readGuestState(page, { exactPartition: "persist:paseo-browser" }), {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toMatchObject({
        found: true,
        partition: "persist:paseo-browser",
        heading: "Proxied HTTP OK",
        wsResult: "WS_OK:ack:hello-tunnel",
        marker: null,
      });

    await page.screenshot({ path: path.join(artifactDir, "02-toggled-local.png") });

    // Toggle back to <host>
    await routingPill.click();
    await expect(routingPill).toHaveAttribute(
      "aria-label",
      "Switch browser routing from Remote Proxy Host to Local",
      { timeout: 15_000 },
    );

    await expect
      .poll(async () => await readGuestState(page, { exactPartition: hostGuest.partition }), {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toMatchObject({
        found: true,
        partition: hostGuest.partition,
        heading: "Proxied HTTP OK",
        wsResult: "WS_OK:ack:hello-tunnel",
        marker: "from-host-partition",
      });

    // -------------------------------------------------------------------------
    // 3. Old daemon without features.networkTunnel fails closed + Browse locally
    // -------------------------------------------------------------------------
    const oldWsButton = page
      .getByRole("button", {
        name: /^Old Legacy Workspace(?:,|$)/,
      })
      .first();
    await expect(oldWsButton).toBeVisible({ timeout: timeoutMs });
    await oldWsButton.click();

    await openNewBrowserTabAndNavigate(page, targetUrl);

    const statusPanel = page
      .getByTestId("browser-proxy-status")
      .and(page.locator(":visible"))
      .first();
    await expect(statusPanel).toBeVisible({ timeout: 20_000 });
    await expect(statusPanel).toContainText("Update Old Legacy Host");

    // Verify NO webview was created for the old daemon tab while failing closed!
    const oldTabWebviewCount = await page.evaluate(() => {
      const statusEl = document.querySelector('[data-testid="browser-proxy-status"]');
      const clip = statusEl?.closest('[data-testid^="browser-webview-clip-"]');
      const browserId = clip?.getAttribute("data-testid")?.replace("browser-webview-clip-", "");
      if (!browserId) return -1;
      return document.querySelectorAll(`webview[data-paseo-browser-id="${browserId}"]`).length;
    });
    assert(
      oldTabWebviewCount === 0,
      `Expected 0 mounted webviews while failing closed on old daemon, got ${oldTabWebviewCount}`,
    );

    await page.screenshot({ path: path.join(artifactDir, "03-old-daemon-fail-closed.png") });

    // Click Browse locally -> switches cleanly to Local partition and loads page
    await page
      .getByTestId("browser-proxy-browse-locally")
      .and(page.locator(":visible"))
      .first()
      .click();
    await expect(statusPanel).toBeHidden({ timeout: 15_000 });
    const oldRoutingPill = page
      .getByTestId("browser-routing-pill")
      .and(page.locator(":visible"))
      .first();
    await expect(oldRoutingPill).toHaveAttribute(
      "aria-label",
      /Switch browser routing from Local to /,
      { timeout: 15_000 },
    );
    await expect
      .poll(async () => await readGuestState(page, { exactPartition: "persist:paseo-browser" }), {
        timeout: 30_000,
        intervals: [250, 500, 1000],
      })
      .toMatchObject({
        found: true,
        partition: "persist:paseo-browser",
        heading: "Proxied HTTP OK",
      });

    await page.screenshot({ path: path.join(artifactDir, "04-old-daemon-browse-locally.png") });

    console.log(
      JSON.stringify(
        {
          status: "PASS",
          hostPartition: hostGuest.partition,
          relayIpcRejection: "passed",
          togglePartitionIsolation: "passed",
          oldDaemonFailClosedAndBrowseLocally: "passed",
          artifactDir,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.toReversed()) stopProcess(child);
    await legacyBridge.close().catch(() => undefined);
    await targetServer.close().catch(() => undefined);
    await delay(500);
    try {
      fs.rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore
    }
  }
}

await main();
