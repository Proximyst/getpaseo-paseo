import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import {
  addDirectHostFromSettings,
  openSettingsHost,
  openSettingsHostSection,
  seedSavedSettingsHosts,
  selectSettingsHost,
} from "../support/helpers/settings";
import {
  cancelTailscaleTurnOff,
  confirmTailscaleTurnOff,
  connectThroughTailscale,
  disableTailscale,
  enableTailscale,
  expectTailscaleAddress,
  expectTailscaleAvailable,
  expectTailscaleRowLoadsOn,
  expectTailscaleUnavailable,
  expectTailscaleUpdateRequired,
  observeDaemonStatusPolling,
  openHostDevices,
  openSetupDevicesStep,
  refreshTailscaleAvailability,
  slowConnectionToHost,
} from "../support/helpers/tailscale";
import { startTailscaleTestDaemon } from "../support/helpers/tailscale-daemon";

test("home and host settings do not offer relay pairing", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("pair-device-unavailable");
  try {
    await seedSavedSettingsHosts(page, [
      { serverId: daemon.serverId, label: "Local host", endpoint: `127.0.0.1:${daemon.port}` },
    ]);
    await gotoAppShell(page);
    await expect(page.getByTestId("open-project-pair-device")).toHaveCount(0);
    await openSettings(page);
    await openSettingsHost(page, daemon.serverId);
    await expect(page.getByRole("button", { name: "Pair a device" })).toHaveCount(0);
    await expect(page.getByTestId("host-page-pair-device-row")).toHaveCount(0);
    await openSettingsHostSection(page, daemon.serverId, "devices");
    await expect(page.getByText("Tailscale", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Relay", exact: true })).toHaveCount(0);
  } finally {
    await daemon.close();
  }
});

test("asks for a host update when Tailscale controls are unavailable", async ({ page }) => {
  const daemon = await startIsolatedHostDaemon("devices-browser-old-host", {
    publishedVersion: "0.13.0-beta.2",
  });
  try {
    await gotoAppShell(page);
    await openSettings(page);
    await addDirectHostFromSettings(page, { host: "127.0.0.1", port: daemon.port });
    await selectSettingsHost(page, daemon.serverId);
    await openSettingsHostSection(page, daemon.serverId, "devices");
    await expectTailscaleUpdateRequired(page);
  } finally {
    await daemon.close();
  }
});

test("turns Tailscale on and off from Devices, asking first over Tailscale", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(process.platform !== "linux", "Uses a second IPv4 loopback address");
  // The journey opens Devices or the setup six times, two of them over a slowed connection.
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Expected the app base URL");
  const daemon = await startTailscaleTestDaemon(baseURL);
  try {
    await openHostDevices(page, daemon);
    await enableTailscale(page);
    await expectTailscaleAddress(page, daemon.tailscaleAddress);
    await page.screenshot({ path: testInfo.outputPath("devices.png") });

    await test.step("While its status loads, the row never shows Tailscale off", async () => {
      const address = daemon.tailscaleAddress;
      await expectTailscaleRowLoadsOn(page, address, () => openHostDevices(page, daemon));
      await expectTailscaleRowLoadsOn(page, address, () => openSetupDevicesStep(page, daemon));
      const restoreSpeed = await slowConnectionToHost(page, daemon.port, 300);
      await expectTailscaleRowLoadsOn(page, address, () => openSetupDevicesStep(page, daemon));
      await expectTailscaleRowLoadsOn(page, address, () => openHostDevices(page, daemon));
      restoreSpeed();
    });

    await disableTailscale(page, daemon.tailscaleAddress);

    await test.step("Over Tailscale, turning it off asks first and Cancel changes nothing", async () => {
      await enableTailscale(page);
      await connectThroughTailscale(page, daemon);
      await cancelTailscaleTurnOff(page, daemon.tailscaleAddress);
    });
    await test.step("Confirming turns it off and cuts this connection", async () => {
      await confirmTailscaleTurnOff(page, daemon.tailscaleAddress);
    });
  } finally {
    await daemon.close();
  }
});

test("refreshes Tailscale availability in place after Tailscale starts", async ({
  page,
  baseURL,
}) => {
  test.skip(process.platform !== "linux", "Uses a second IPv4 loopback address");
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Expected the app base URL");
  const daemon = await startTailscaleTestDaemon(baseURL, { initialAvailable: false });
  const statusPolling = observeDaemonStatusPolling(page, daemon.port);
  try {
    await openHostDevices(page, daemon);
    await expectTailscaleUnavailable(page);

    await test.step("Refreshing while still unavailable shows progress and stays unavailable", async () => {
      const restoreSpeed = await slowConnectionToHost(page, daemon.port, 250);
      await openHostDevices(page, daemon);
      await expectTailscaleUnavailable(page);
      await refreshTailscaleAvailability(page);
      await page.getByRole("button", { name: "Refreshing...", exact: true }).waitFor();
      await expectTailscaleUnavailable(page);
      restoreSpeed();
    });

    await test.step("Refreshing after Tailscale starts enables the switch in place", async () => {
      await statusPolling.waitForFreshPollWindow();
      await daemon.setTailscaleAvailable(true);
      const refreshRequest = statusPolling.waitForStatusRequest(1_000);
      await refreshTailscaleAvailability(page);
      await refreshRequest;
      await expectTailscaleAvailable(page, { timeout: 1_000 });
      await enableTailscale(page);
      await expectTailscaleAddress(page, daemon.tailscaleAddress);
      await disableTailscale(page, daemon.tailscaleAddress);
    });

    await test.step("Setup's Devices step also refreshes Tailscale availability in place", async () => {
      await daemon.setTailscaleAvailable(false);
      await openSetupDevicesStep(page, daemon);
      await expectTailscaleUnavailable(page);
      await statusPolling.waitForFreshPollWindow();
      await daemon.setTailscaleAvailable(true);
      const refreshRequest = statusPolling.waitForStatusRequest(1_000);
      await refreshTailscaleAvailability(page);
      await refreshRequest;
      await expectTailscaleAvailable(page, { timeout: 1_000 });
    });
  } finally {
    await daemon.close();
  }
});
