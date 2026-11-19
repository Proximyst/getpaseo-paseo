import { describe, expect, it } from "vitest";
import { resolveDesktopWindowChromeMode, windowChromeModeArgument } from "./chrome";

describe("desktop window chrome", () => {
  it("uses Linux desktop chrome", () => {
    expect(
      resolveDesktopWindowChromeMode({ platform: "linux", override: undefined, isPackaged: true }),
    ).toBe("custom-linux");
  });

  it.each(["darwin", "win32", "freebsd"] as const)(
    "rejects unsupported %s hosts even with a Linux controls override",
    (platform) => {
      expect(() =>
        resolveDesktopWindowChromeMode({ platform, override: undefined, isPackaged: true }),
      ).toThrow();
      expect(() =>
        resolveDesktopWindowChromeMode({ platform, override: "linux", isPackaged: false }),
      ).toThrow();
    },
  );

  it("rejects invalid and packaged overrides", () => {
    expect(() =>
      resolveDesktopWindowChromeMode({ platform: "linux", override: "windows", isPackaged: false }),
    ).toThrow();
    expect(() =>
      resolveDesktopWindowChromeMode({
        platform: "linux",
        override: "linux",
        isPackaged: true,
      }),
    ).toThrow();
  });

  it("serializes the validated mode for preload", () => {
    expect(windowChromeModeArgument("custom-windows")).toBe(
      "--paseo-window-chrome-mode=custom-windows",
    );
  });
});
