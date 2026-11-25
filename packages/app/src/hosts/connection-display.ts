import type { ActiveConnection } from "@/runtime/host-runtime";
import type { HostConnection, HostProfile } from "@/types/host-connection";

export type HostConnectionKind = "local" | "tailscale" | "ssh" | "direct" | "routed";

export interface HostConnectionDisplay {
  kind: HostConnectionKind;
  /** Address shown beside the connection kind. Omitted for local transports. */
  endpoint?: string;
}

// Standard secure/plain web ports carry no information in the host display, so
// "host.example.com:443" reads as "host.example.com" while "127.0.0.1:6767" is kept.
export function formatConnectionEndpoint(endpoint: string): string {
  return endpoint.replace(/:(?:443|80)$/, "");
}

function extractEndpointHost(endpoint: string): string {
  const trimmed = endpoint.trim().toLowerCase();
  if (!trimmed) return "";

  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const authority = withoutScheme.split("/")[0] ?? "";
  const hostPort = authority.includes("@")
    ? authority.slice(authority.lastIndexOf("@") + 1)
    : authority;

  if (hostPort.startsWith("[")) {
    const closeBracket = hostPort.indexOf("]");
    return closeBracket > 1 ? hostPort.slice(1, closeBracket) : hostPort;
  }

  const firstColon = hostPort.indexOf(":");
  const lastColon = hostPort.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon) {
    return hostPort.slice(0, firstColon);
  }
  return hostPort;
}

function isTailscaleIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  // Tailscale assigns addresses from the RFC 6598 CGNAT range 100.64.0.0/10.
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function isTailscaleIpv6(host: string): boolean {
  return host.startsWith("fd7a:115c:a1e0:");
}

export function isTailscaleEndpoint(endpoint: string): boolean {
  const host = extractEndpointHost(endpoint);
  if (!host) return false;
  if (host.endsWith(".ts.net") && host.length > ".ts.net".length) {
    return true;
  }
  return isTailscaleIpv4(host) || isTailscaleIpv6(host);
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  const host = extractEndpointHost(endpoint);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function describeHostConnection(
  connection: ActiveConnection | HostConnection,
  options?: { isLocalHost?: boolean },
): HostConnectionDisplay | null {
  switch (connection.type) {
    case "directSocket":
      return { kind: "local" };
    case "directPipe":
    case "relay":
      // Legacy records may remain saved, but these transports are unavailable in the fork.
      return null;
    case "remoteSsh":
      return {
        kind: "ssh",
        endpoint: "endpoint" in connection ? connection.endpoint : connection.host,
      };
    case "routed":
      return {
        kind: "routed",
        endpoint: "endpoint" in connection ? connection.endpoint : connection.originServerId,
      };
    case "directTcp": {
      if (options?.isLocalHost && isLoopbackEndpoint(connection.endpoint)) {
        return { kind: "local" };
      }
      if (isTailscaleEndpoint(connection.endpoint)) {
        return { kind: "tailscale", endpoint: formatConnectionEndpoint(connection.endpoint) };
      }
      return { kind: "direct", endpoint: formatConnectionEndpoint(connection.endpoint) };
    }
  }
}

export function describeHostConnectionLine(
  active: ActiveConnection | null,
  host: Pick<HostProfile, "connections" | "preferredConnectionId"> | undefined,
  options?: { isLocalHost?: boolean },
): HostConnectionDisplay | null {
  if (active) {
    const described = describeHostConnection(active, options);
    if (described) return described;
  }
  if (!host) return null;

  const preferred = host.connections.find(
    (connection) => connection.id === host.preferredConnectionId,
  );
  if (preferred) {
    const described = describeHostConnection(preferred, options);
    if (described) return described;
  }
  for (const connection of host.connections) {
    if (connection === preferred) continue;
    const described = describeHostConnection(connection, options);
    if (described) return described;
  }
  return null;
}
