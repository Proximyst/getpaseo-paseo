import { afterEach, describe, expect, it, vi } from "vitest";
import { getElectronHost } from "./host";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getElectronHost", () => {
  it("returns the Linux desktop bridge without changing its connection capabilities", () => {
    const host = { platform: "linux", invoke: vi.fn() };
    vi.stubGlobal("window", { paseoDesktop: host });

    expect(getElectronHost()).toBe(host);
  });

  it.each(["darwin", "win32", "freebsd", undefined])(
    "does not expose desktop capabilities for platform %s",
    (platform) => {
      vi.stubGlobal("window", { paseoDesktop: { platform, invoke: vi.fn() } });

      expect(getElectronHost()).toBeNull();
    },
  );

  it("keeps ordinary browser sessions independent of desktop support", () => {
    vi.stubGlobal("window", {});

    expect(getElectronHost()).toBeNull();
  });
});
