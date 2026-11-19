import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import { generateLocalPairingOffer } from "@getpaseo/server/pairing";

test("offline pairing cannot create a relay offer even when explicitly enabled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-offline-pair-"));
  const home = path.join(root, "home");
  try {
    expect(await generateLocalPairingOffer({ paseoHome: home, relayEnabled: true })).toEqual({
      relayEnabled: false,
      url: null,
      qr: null,
    });
    expect(existsSync(home)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
