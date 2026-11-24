import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../app/e2e/support/fixtures";
import { gotoWorkspace } from "../../app/e2e/support/helpers/launcher";

function explorerSidebar(page: Page) {
  return page.getByTestId("workspace-explorer-sidebar").filter({ visible: true });
}

async function installLinuxDesktopHost(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, {
      paseoDesktop: {
        platform: "linux",
        windowChromeMode: "custom-linux",
        invoke: async () => null,
        events: { on: async () => () => undefined },
        getPendingOpenProject: async () => null,
        window: {
          getCurrentWindow: () => ({
            isFullscreen: async () => false,
            onResized: async () => () => undefined,
          }),
        },
      },
    });
  });
}

function explorerToggle(page: Page, expanded: boolean) {
  return page.getByRole("button", {
    name: expanded ? "Close Explorer sidebar" : "Open Explorer sidebar",
    exact: true,
    expanded,
  });
}

async function expectClearOfWindowControls(page: Page, action: Locator) {
  const minimize = page.getByRole("button", { name: "Minimize window", exact: true });
  await expect(minimize).toBeVisible();
  await expect(action).toBeVisible();
  const controlBounds = await minimize.boundingBox();
  const actionBounds = await action.boundingBox();
  expect(actionBounds!.x + actionBounds!.width).toBeLessThanOrEqual(controlBounds!.x);
}

test("keeps the Explorer actions clear of Linux window controls", async ({
  page,
  withWorkspace,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installLinuxDesktopHost(page);

  const { workspaceId } = await withWorkspace();
  await gotoWorkspace(page, workspaceId);
  const open = explorerToggle(page, false);
  await expectClearOfWindowControls(page, open);
  await open.click();

  const close = explorerToggle(page, true);
  const newExplorerTab = explorerSidebar(page).getByRole("button", {
    name: "New tab",
    exact: true,
  });
  await expectClearOfWindowControls(page, close);
  await expectClearOfWindowControls(page, newExplorerTab);
  await close.click();
  await expect(open).toBeVisible();
});
