import { expect, type Page } from "@playwright/test";
import { gotoAppShell, openSettings } from "./app";
import { wsRoutePatternForPort } from "./daemon-port";
import { goToSetupStep, showSetupAgainFromSettings } from "./onboarding";
import { openSettingsHostSection, seedSavedSettingsHosts } from "./settings";

type DevicesHost = { serverId: string } & ({ port: number } | { endpoint: string });

export async function openHostDevices(page: Page, daemon: DevicesHost): Promise<void> {
  await openAppWithHost(page, daemon);
  await openSettings(page);
  await openSettingsHostSection(page, daemon.serverId, "devices");
}

/** Loads the app afresh with `daemon` as its first host, then opens setup's Devices step. */
export async function openSetupDevicesStep(page: Page, daemon: DevicesHost): Promise<void> {
  await openAppWithHost(page, daemon);
  await showSetupAgainFromSettings(page);
  await goToSetupStep(page, "Devices");
}

async function openAppWithHost(page: Page, daemon: DevicesHost): Promise<void> {
  await seedSavedSettingsHosts(page, [
    {
      serverId: daemon.serverId,
      label: "Local host",
      endpoint: "port" in daemon ? `127.0.0.1:${daemon.port}` : daemon.endpoint,
    },
  ]);
  await gotoAppShell(page);
}

export async function enableTailscale(page: Page): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Tailscale", exact: true });
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
}

export async function expectTailscaleAddress(page: Page, address: string): Promise<void> {
  const row = tailscaleAddressRow(page, address);
  await expect(row).toBeVisible();
  await expect(
    row.getByText("On another device connected to Tailscale, add a host at this address"),
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  const response = await fetch(`http://${address}/api/health`);
  expect(response.ok).toBe(true);
}

/** The switch shows off as soon as it is tapped; the host stops listening when its answer lands. */
async function expectHostUnreachableAt(address: string): Promise<void> {
  await expect
    .poll(() =>
      fetch(`http://${address}/api/health`).then(
        () => "reachable",
        () => "unreachable",
      ),
    )
    .toBe("unreachable");
}

function tailscaleAddressRow(page: Page, address: string) {
  return page.getByTestId("devices-tailscale-address").filter({ hasText: address });
}

export async function disableTailscale(page: Page, address: string): Promise<void> {
  const toggle = page.getByRole("switch", { name: "Tailscale", exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  await expect(tailscaleAddressRow(page, address)).toHaveCount(0);
  await expectHostUnreachableAt(address);
}

/** Reopens the host over its Tailscale address, as another device on the tailnet would reach it. */
export async function connectThroughTailscale(
  page: Page,
  daemon: { serverId: string; tailscaleAddress: string },
): Promise<void> {
  await openHostDevices(page, { serverId: daemon.serverId, endpoint: daemon.tailscaleAddress });
  await expectTailscaleAddress(page, daemon.tailscaleAddress);
}

const TURN_OFF_QUESTION =
  "Turn off Tailscale?\n\nThis device is connected through Tailscale and will lose its connection to the host.";

/**
 * Taps the switch off over the Tailscale connection and cancels the question. Every state the row
 * commits from the tap to after Cancel must still show Tailscale on with its address: nothing
 * changes until the user confirms.
 */
export async function cancelTailscaleTurnOff(page: Page, address: string): Promise<void> {
  const row = await recordTailscaleRow(page);
  const question = answerNextDialog(page, "dismiss");
  await page.getByRole("switch", { name: "Tailscale", exact: true }).click();
  expect(await question).toBe(TURN_OFF_QUESTION);
  await page.waitForTimeout(500);
  expect(new Set((await row()).map((state) => `${state.value} ${state.address}`))).toEqual(
    new Set(["on true"]),
  );
  await expect(page.getByRole("switch", { name: "Tailscale", exact: true })).toBeChecked();
  await expect(tailscaleAddressRow(page, address)).toBeVisible();
  expect((await fetch(`http://${address}/api/health`)).ok).toBe(true);
}

/**
 * Confirms turning Tailscale off over the Tailscale connection, which cuts this app off the host.
 * Without the host the row shows no value at all, on or off.
 */
export async function confirmTailscaleTurnOff(page: Page, address: string): Promise<void> {
  const question = answerNextDialog(page, "accept");
  await page.getByRole("switch", { name: "Tailscale", exact: true }).click();
  expect(await question).toBe(TURN_OFF_QUESTION);
  await expect(page.getByText("Host is not connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Tailscale", exact: true })).toHaveCount(0);
  await expectHostUnreachableAt(address);
}

function answerNextDialog(page: Page, answer: "accept" | "dismiss"): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await (answer === "accept" ? dialog.accept() : dialog.dismiss());
    });
  });
}

interface TailscaleRowState {
  /** `none` while the row shows no value yet. */
  value: "on" | "off" | "none";
  address: boolean;
  hint: string;
  labelTop: number;
  hintTop: number;
}

/**
 * Records every state the Tailscale row commits, painted or not: from now on in this page, and
 * from the first paint of every page load after it. Recording again starts a new record.
 */
async function recordTailscaleRow(page: Page): Promise<() => Promise<TailscaleRowState[]>> {
  const record = () => {
    const host = window as unknown as {
      tailscaleRow?: { states: unknown[]; last: string; sample(): void };
    };
    if (host.tailscaleRow) {
      host.tailscaleRow.states = [];
      host.tailscaleRow.last = "";
      host.tailscaleRow.sample();
      return;
    }
    const isVisibleText = (element: Element, text?: string) =>
      element.childElementCount === 0 &&
      (text === undefined
        ? (element.textContent ?? "").trim() !== ""
        : element.textContent === text) &&
      element.getBoundingClientRect().height > 0;
    const readValue = (toggle: Element | null) => {
      if (!toggle) return "none";
      return toggle.getAttribute("aria-checked") === "true" ? "on" : "off";
    };
    const read = () => {
      const label = [...document.querySelectorAll("div, span")].find((element) =>
        isVisibleText(element, "Tailscale"),
      );
      if (!label) return null;
      let row: Element = label;
      while (row.parentElement && !(row as HTMLElement).innerText.includes("\n")) {
        row = row.parentElement;
      }
      const hint = [...row.querySelectorAll("div, span")].find(
        (element) => element !== label && isVisibleText(element),
      );
      const toggle = document.querySelector('[role="switch"][aria-label="Tailscale"]');
      return {
        value: readValue(toggle),
        address: document.querySelector('[data-testid="devices-tailscale-address"]') !== null,
        hint: hint?.textContent ?? "",
        labelTop: Math.round(label.getBoundingClientRect().top),
        hintTop: Math.round(hint?.getBoundingClientRect().top ?? -1),
      };
    };
    const recorder = {
      states: [] as unknown[],
      last: "",
      sample() {
        const state = read();
        const key = JSON.stringify(state);
        if (state && key !== recorder.last) recorder.states.push(state);
        recorder.last = key;
      },
    };
    host.tailscaleRow = recorder;
    new MutationObserver(() => recorder.sample()).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  };
  await page.addInitScript(record);
  await page.evaluate(record);
  return () =>
    page.evaluate(
      () =>
        (window as unknown as { tailscaleRow: { states: TailscaleRowState[] } }).tailscaleRow
          .states,
    );
}

/**
 * Runs `open`, which first shows the Tailscale row of a host with Tailscale on, and checks the row
 * from its first state to its last: it starts with no value, never shows Tailscale off, and its
 * label and hint keep their text and place until it settles on, with the address below.
 */
export async function expectTailscaleRowLoadsOn(
  page: Page,
  address: string,
  open: () => Promise<void>,
): Promise<void> {
  const row = await recordTailscaleRow(page);
  await open();
  await expect(page.getByRole("switch", { name: "Tailscale", exact: true })).toBeChecked();
  await expect(tailscaleAddressRow(page, address)).toBeVisible();
  const states = await row();
  expect(states[0]?.value).toBe("none");
  expect(states.filter((state) => state.value === "off")).toEqual([]);
  expect(
    new Set(states.map(({ hint, labelTop, hintTop }) => `${hint} ${labelTop} ${hintTop}`)).size,
  ).toBe(1);
  expect(states.at(-1)).toMatchObject({ value: "on", address: true });
}

/**
 * Holds every message between the app and the host on `port` for `ms` in each direction, as on a
 * slow network. The returned function brings the connection back to full speed and flushes any
 * queued messages.
 */
export async function slowConnectionToHost(
  page: Page,
  port: number,
  ms: number,
): Promise<() => void> {
  let delay = ms;
  const flushers = new Set<() => void>();
  await page.routeWebSocket(wsRoutePatternForPort(String(port)), (app) => {
    const host = app.connectToServer();
    const appToHost = deliverInOrderAfter(
      () => delay,
      (message) => host.send(message),
    );
    const hostToApp = deliverInOrderAfter(
      () => delay,
      (message) => app.send(message),
    );
    flushers.add(appToHost.flushNow);
    flushers.add(hostToApp.flushNow);
    app.onMessage(appToHost.enqueue);
    host.onMessage(hostToApp.enqueue);
  });
  return () => {
    delay = 0;
    for (const flushNow of flushers) flushNow();
  };
}

function deliverInOrderAfter(delay: () => number, deliver: (message: string | Buffer) => void) {
  const queue: { at: number; message: string | Buffer }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    while (queue[0] && queue[0].at <= Date.now()) deliver(queue.shift()!.message);
    if (queue[0]) timer = setTimeout(flush, queue[0].at - Date.now());
  };
  return {
    enqueue: (message: string | Buffer) => {
      queue.push({ at: Math.max(Date.now() + delay(), queue.at(-1)?.at ?? 0), message });
      if (!timer) flush();
    },
    flushNow: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      while (queue[0]) {
        const next = queue.shift()!;
        try {
          deliver(next.message);
        } catch {
          queue.length = 0;
          break;
        }
      }
    },
  };
}

export async function expectTailscaleUpdateRequired(page: Page): Promise<void> {
  await expect(page.getByRole("switch", { name: "Tailscale", exact: true })).toBeDisabled();
  await expect(page.getByText("Update this host to use Tailscale", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "How to update", exact: true })).toBeVisible();
}

export async function expectTailscaleUnavailable(page: Page): Promise<void> {
  await expect(page.getByRole("switch", { name: "Tailscale", exact: true })).toBeDisabled();
  await expect(
    page.getByText("Tailscale is not running on this host", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Get Tailscale", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
}

export async function refreshTailscaleAvailability(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
}

export async function expectTailscaleAvailable(
  page: Page,
  options?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0, options);
  const toggle = page.getByRole("switch", { name: "Tailscale", exact: true });
  await expect(toggle).toBeEnabled(options);
  await expect(toggle).not.toBeChecked(options);
  await expect(
    page.getByText("Direct over your tailnet, enter an address", { exact: true }),
  ).toBeVisible(options);
}

/**
 * Tracks `daemon.get_status` frames on the host socket so Refresh tests can align right after a
 * 2-second poll and verify the button click itself sent a fresh status request.
 */
export function observeDaemonStatusPolling(page: Page, port: number) {
  let lastResponseAt = 0;
  let waitingForResponse: (() => void) | null = null;
  let waitingForRequest: (() => void) | null = null;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(`:${port}`)) return;
    socket.on("framesent", ({ payload }) => {
      const message = typeof payload === "string" ? payload : payload.toString();
      if (message.includes('"type":"daemon.get_status.request"')) {
        waitingForRequest?.();
        waitingForRequest = null;
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const message = typeof payload === "string" ? payload : payload.toString();
      if (message.includes('"type":"daemon.get_status.response"')) {
        lastResponseAt = Date.now();
        waitingForResponse?.();
        waitingForResponse = null;
      }
    });
  });

  return {
    async waitForFreshPollWindow(): Promise<void> {
      if (Date.now() - lastResponseAt < 250) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waitingForResponse = null;
          reject(new Error("Timed out waiting for daemon status poll"));
        }, 5_000);
        waitingForResponse = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    },
    waitForStatusRequest(timeoutMs = 1_000): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waitingForRequest = null;
          reject(new Error("Refresh did not send daemon.get_status.request"));
        }, timeoutMs);
        waitingForRequest = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    },
  };
}
