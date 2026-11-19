import { Command } from "commander";
import type { DaemonTarget } from "../../utils/daemon-target.js";
import { addJsonAndDaemonHostOptions, withGlobalOptions } from "../../utils/command-options.js";

interface PairOptions {
  daemonTarget: DaemonTarget;
  home?: string;
  json?: boolean;
}

export function pairCommand(): Command {
  return addJsonAndDaemonHostOptions(
    new Command("pair").description("Show direct connection guidance"),
  ).action(withGlobalOptions((options: PairOptions) => runPairCommand(options)));
}

export function printDirectConnectionGuidance(): void {
  console.log(
    "Connect using the daemon's TCP address over your LAN, Tailscale, or another VPN, or use SSH from the desktop app or CLI.",
  );
  console.log("Learn more: https://paseo.sh/docs/connectivity");
}

export async function runPairCommand(options: PairOptions): Promise<void> {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ relayEnabled: false, url: null, qr: null })}\n`);
    return;
  }
  printDirectConnectionGuidance();
}
