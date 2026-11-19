import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import { createRelayRuntime } from "./relay-runtime.js";

describe("RelayRuntime", () => {
  test.each([false, true])(
    "never starts a transport with configured enabled=%s",
    async (enabled) => {
      const startTransport = vi.fn(() => ({ stop: async () => undefined }));
      const runtime = createRelayRuntime({
        config: {
          enabled,
          endpoint: "relay.example.test:443",
          publicEndpoint: "relay.example.test:443",
          useTls: true,
          publicUseTls: true,
        },
        logger: pino({ level: "silent" }),
        attachSocket: async () => undefined,
        serverId: "relay-runtime-test",
        startTransport,
      });
      expect(runtime.getConfig().enabled).toBe(false);
      expect(() => runtime.setEnabled(true)).toThrow("Relay connections are not supported");
      runtime.setEnabled(false);
      await runtime.stop();
      expect(runtime.getConfig().enabled).toBe(false);
      expect(startTransport).not.toHaveBeenCalled();
    },
  );
});
