import { describe, expect, it } from "vitest";
import {
  describeHostConnection,
  describeHostConnectionLine,
  formatConnectionEndpoint,
  isTailscaleEndpoint,
} from "./connection-display";

describe("isTailscaleEndpoint", () => {
  it("recognizes MagicDNS .ts.net hostnames with or without ports", () => {
    expect(isTailscaleEndpoint("mac-mini.tail123.ts.net:6767")).toBe(true);
    expect(isTailscaleEndpoint("Mac-Mini.Tail123.TS.NET:443")).toBe(true);
    expect(isTailscaleEndpoint("devbox.tailnet.ts.net")).toBe(true);
    expect(isTailscaleEndpoint(".ts.net")).toBe(false);
  });

  it("recognizes Tailscale IPv4 CGNAT (100.64.0.0/10) and IPv6 ULA addresses", () => {
    expect(isTailscaleEndpoint("100.64.0.1:6767")).toBe(true);
    expect(isTailscaleEndpoint("100.100.42.9:6767")).toBe(true);
    expect(isTailscaleEndpoint("100.127.255.254:6767")).toBe(true);
    expect(isTailscaleEndpoint("100.63.255.255:6767")).toBe(false);
    expect(isTailscaleEndpoint("100.128.0.1:6767")).toBe(false);
    expect(isTailscaleEndpoint("[fd7a:115c:a1e0::1]:6767")).toBe(true);
  });

  it("does not misclassify LAN, localhost, or ordinary domains", () => {
    expect(isTailscaleEndpoint("localhost:6767")).toBe(false);
    expect(isTailscaleEndpoint("127.0.0.1:6767")).toBe(false);
    expect(isTailscaleEndpoint("192.168.1.25:6767")).toBe(false);
    expect(isTailscaleEndpoint("relay.paseo.sh:443")).toBe(false);
    expect(isTailscaleEndpoint("not-ts.net.example.com:6767")).toBe(false);
  });
});

describe("describeHostConnection", () => {
  it("describes a local Unix socket without exposing its path", () => {
    expect(
      describeHostConnection({
        type: "directSocket",
        endpoint: "/tmp/paseo.sock",
        display: "socket",
      }),
    ).toEqual({ kind: "local" });
  });

  it("does not describe relay or Windows named pipes", () => {
    expect(
      describeHostConnection({ type: "relay", endpoint: "relay.paseo.sh:443", display: "relay" }),
    ).toBeNull();
    expect(
      describeHostConnection({
        type: "directPipe",
        endpoint: "\\\\.\\pipe\\paseo",
        display: "pipe",
      }),
    ).toBeNull();
  });

  it("describes loopback TCP on the local host as local, and remote loopback as direct", () => {
    const loopback = {
      type: "directTcp",
      endpoint: "localhost:6767",
      display: "localhost:6767",
    } as const;
    expect(describeHostConnection(loopback, { isLocalHost: true })).toEqual({ kind: "local" });
    expect(describeHostConnection(loopback, { isLocalHost: false })).toEqual({
      kind: "direct",
      endpoint: "localhost:6767",
    });
  });

  it("strips standard web ports on Tailscale and direct connections", () => {
    expect(
      describeHostConnection({
        type: "directTcp",
        endpoint: "mac-mini.tail123.ts.net:6767",
        display: "mac-mini.tail123.ts.net:6767",
      }),
    ).toEqual({ kind: "tailscale", endpoint: "mac-mini.tail123.ts.net:6767" });
    expect(
      describeHostConnection({
        type: "directTcp",
        endpoint: "devbox.example.com:443",
        display: "devbox.example.com:443",
      }),
    ).toEqual({ kind: "direct", endpoint: "devbox.example.com" });
  });

  it("preserves SSH and routed targets", () => {
    expect(
      describeHostConnection({
        type: "remoteSsh",
        endpoint: "mo@workstation",
        display: "mo@workstation",
      }),
    ).toEqual({ kind: "ssh", endpoint: "mo@workstation" });
    expect(
      describeHostConnection({
        type: "routed",
        endpoint: "srv_origin",
        display: "via srv_origin",
      }),
    ).toEqual({ kind: "routed", endpoint: "srv_origin" });
  });

  it("strips default HTTP/HTTPS ports only", () => {
    expect(formatConnectionEndpoint("devbox.example.com:443")).toBe("devbox.example.com");
    expect(formatConnectionEndpoint("example.com:80")).toBe("example.com");
    expect(formatConnectionEndpoint("127.0.0.1:6767")).toBe("127.0.0.1:6767");
  });

  it("describes configured host connections before an active connection is online", () => {
    expect(
      describeHostConnection({
        id: "direct:mac-mini.tail123.ts.net:6767",
        type: "directTcp",
        endpoint: "mac-mini.tail123.ts.net:6767",
      }),
    ).toEqual({ kind: "tailscale", endpoint: "mac-mini.tail123.ts.net:6767" });
    expect(
      describeHostConnection({
        id: "ssh:mo%40workstation::",
        type: "remoteSsh",
        host: "mo@workstation",
      }),
    ).toEqual({ kind: "ssh", endpoint: "mo@workstation" });
  });
});

describe("describeHostConnectionLine", () => {
  const relay = {
    id: "relay:wss:relay.paseo.sh:443",
    type: "relay",
    relayEndpoint: "relay.paseo.sh:443",
    useTls: true,
    daemonPublicKeyB64: "key",
  } as const;
  const directPipe = {
    id: "pipe:\\\\.\\pipe\\paseo",
    type: "directPipe",
    path: "\\\\.\\pipe\\paseo",
  } as const;
  const direct = {
    id: "direct:devbox.example.com:443",
    type: "directTcp",
    endpoint: "devbox.example.com:443",
  } as const;

  it("falls back to a supported saved connection when the preferred one is disabled", () => {
    expect(
      describeHostConnectionLine(null, {
        connections: [directPipe, relay, direct],
        preferredConnectionId: relay.id,
      }),
    ).toEqual({ kind: "direct", endpoint: "devbox.example.com" });
  });

  it("omits the connection line for a host with only disabled connections", () => {
    expect(
      describeHostConnectionLine(null, {
        connections: [directPipe, relay],
        preferredConnectionId: relay.id,
      }),
    ).toBeNull();
  });

  it("displays a supported active transport before any saved connection", () => {
    expect(
      describeHostConnectionLine(
        { type: "routed", endpoint: "srv_origin", display: "via srv_origin" },
        { connections: [relay, direct], preferredConnectionId: direct.id },
      ),
    ).toEqual({ kind: "routed", endpoint: "srv_origin" });
  });
});
