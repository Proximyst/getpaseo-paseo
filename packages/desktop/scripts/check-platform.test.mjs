import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { default: beforePack } = require("./check-platform.js");

function packageOnHost(hostPlatform, targetPlatform) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: hostPlatform, configurable: true });
  try {
    return beforePack({ electronPlatformName: targetPlatform });
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

describe("desktop packaging platform support", () => {
  it.each(["darwin", "win32"])("rejects packaging on %s", (platform) => {
    expect(() => packageOnHost(platform, "linux")).toThrow();
  });

  it.each(["darwin", "win32"])("rejects cross-packaging for %s", (platform) => {
    expect(() => packageOnHost("linux", platform)).toThrow();
  });
});
