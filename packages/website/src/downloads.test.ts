import { describe, expect, it } from "vitest";
import { downloadUrls, getDesktopDownload, parseReleaseAssetUrl } from "./downloads";

describe("parseReleaseAssetUrl", () => {
  it("accepts a Paseo release file", () => {
    const url =
      "https://github.com/getpaseo/paseo/releases/download/v0.10.3/Paseo-0.10.3-arm64.dmg";
    expect(parseReleaseAssetUrl(url)).toBe(url);
  });

  it("rejects a path that climbs into another repository's releases", () => {
    expect(
      parseReleaseAssetUrl(
        "https://github.com/getpaseo/paseo/releases/download/v1/../../../../evil/repo/releases/download/v1/app.dmg",
      ),
    ).toBeNull();
    expect(
      parseReleaseAssetUrl(
        "https://github.com/getpaseo/paseo/releases/download/v1/%2e%2e/%2e%2e/%2e%2e/%2e%2e/evil/repo/app.dmg",
      ),
    ).toBeNull();
  });

  it("rejects other hosts and malformed values", () => {
    expect(
      parseReleaseAssetUrl(
        "https://github.com.evil.test/getpaseo/paseo/releases/download/v1/a.dmg",
      ),
    ).toBeNull();
    expect(
      parseReleaseAssetUrl("http://github.com/getpaseo/paseo/releases/download/v1/a.dmg"),
    ).toBeNull();
    expect(parseReleaseAssetUrl("not a url")).toBeNull();
    expect(parseReleaseAssetUrl(undefined)).toBeNull();
  });
});

describe("Linux downloads", () => {
  const release = { version: "0.16.1", linuxAppImageAsset: "Paseo-x86_64.AppImage" };

  it("offers the shipped Linux packages", () => {
    expect(downloadUrls(release)).toEqual({
      linuxAppImage:
        "https://github.com/getpaseo/paseo/releases/download/v0.16.1/Paseo-x86_64.AppImage",
      linuxDeb:
        "https://github.com/getpaseo/paseo/releases/download/v0.16.1/Paseo-0.16.1-amd64.deb",
      linuxRpm:
        "https://github.com/getpaseo/paseo/releases/download/v0.16.1/Paseo-0.16.1-x86_64.rpm",
    });
  });

  it("routes the primary Linux download through the localized thanks page", () => {
    const download = getDesktopDownload(release, "zh-CN");
    const url = new URL(download.href, "https://paseo.sh");
    expect(download.label).toBe("Linux");
    expect(url.pathname).toBe("/zh-CN/download/thanks");
    expect(url.searchParams.get("file")).toBe(downloadUrls(release).linuxAppImage);
  });
});
