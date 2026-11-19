import { expect, test, type Page } from "./fixtures";

const LINUX_APPIMAGE =
  /\/getpaseo\/paseo\/releases\/download\/v[^/]+\/Paseo-(?:[^/]+-)?x86_64\.AppImage$/;

async function openDownloadPage(page: Page) {
  // Serve a stand-in file so the test never downloads a real release.
  await page.route(LINUX_APPIMAGE, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=Paseo.AppImage",
      },
      body: "AppImage",
    }),
  );
  await page.goto("/download");
}

async function clickAppImage(page: Page) {
  await page.getByRole("link", { name: "AppImage", exact: true }).click();
}

test("a download button opens the thanks page and requests the file", async ({ page }) => {
  await openDownloadPage(page);

  const fileRequest = page.waitForRequest(LINUX_APPIMAGE);
  await clickAppImage(page);

  await fileRequest;
  await expect(page).toHaveURL(/\/download\/thanks\?file=/);
  await expect(page.getByRole("heading", { name: "Thanks for downloading Paseo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
    "href",
    LINUX_APPIMAGE,
  );
});

test("the thanks page starts a browser download", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "WebKit reports no download event for a stubbed response");
  await openDownloadPage(page);

  const download = page.waitForEvent("download");
  await clickAppImage(page);

  expect((await download).url()).toMatch(LINUX_APPIMAGE);
});

test("the download page offers Linux packages without unsupported distributions", async ({
  page,
}) => {
  await openDownloadPage(page);
  for (const name of ["AppImage", "DEB", "RPM"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.locator(
      'a[href*=".dmg"], a[href*=".exe"], a[href*=".apk"], a[href*="apps.apple.com"], a[href*="play.google.com"], a[href*="testflight.apple.com"]',
    ),
  ).toHaveCount(0);
});

test("the homepage offers Linux rather than mobile store downloads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Download for Linux", exact: true })).toBeVisible();
  await expect(
    page.locator(
      'a[href*="apps.apple.com"], a[href*="play.google.com"], a[href*="testflight.apple.com"]',
    ),
  ).toHaveCount(0);
});
