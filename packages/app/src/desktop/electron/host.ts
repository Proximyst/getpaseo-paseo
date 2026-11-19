import type { DesktopHostBridge } from "@/desktop/host";

export function getElectronHost(): DesktopHostBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const host = window.paseoDesktop;
  if (!host || typeof host !== "object" || host.platform !== "linux") {
    return null;
  }
  return host;
}
