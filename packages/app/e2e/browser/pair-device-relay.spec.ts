import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsHost, seedSavedSettingsHosts } from "../support/helpers/settings";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";

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
  } finally {
    await daemon.close();
  }
});
