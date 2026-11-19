import { expect, type Page } from "@playwright/test";

export interface LinkedHost {
  serverId: string;
  relayEndpoint: string;
  daemonPublicKeyB64: string;
}

/**
 * A pairing link that opens on the settings page. `/` redirects to
 * `/open-project` on its own, so starting in settings leaves the pairing link
 * as the only thing that can move the app to `/open-project`.
 */
export function buildPairingLink(host: LinkedHost): string {
  const offer = {
    v: 2,
    serverId: host.serverId,
    daemonPublicKeyB64: host.daemonPublicKeyB64,
    relay: { endpoint: host.relayEndpoint, useTls: false },
  };
  const encoded = Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
  return `/settings/general#offer=${encoded}`;
}

/** Loads the app from a pairing link, the way opening the link in a browser does. */
export async function openPairingLink(page: Page, link: string): Promise<void> {
  // Leave the link's page first so the link always loads the app from scratch.
  await page.goto("/");
  await page.goto(link);
}

/** Checks the host picker on the settings page the app is already showing. */
export async function expectHostInHostPicker(
  page: Page,
  serverId: string,
  expected: "listed" | "not listed",
): Promise<void> {
  await page.getByTestId("settings-host-picker").click();
  await expect(page.getByTestId(`settings-host-picker-item-${serverId}`)).toHaveCount(
    expected === "listed" ? 1 : 0,
  );
  await page.keyboard.press("Escape");
}
