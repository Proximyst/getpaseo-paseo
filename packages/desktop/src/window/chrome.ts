export type DesktopWindowChromeMode = "native-mac" | "custom-windows" | "custom-linux";

const WINDOW_CHROME_MODE_ARGUMENT_PREFIX = "--paseo-window-chrome-mode=";

function systemWindowChromeMode(platform: NodeJS.Platform): DesktopWindowChromeMode {
  if (platform === "darwin") return "native-mac";
  if (platform === "win32") return "custom-windows";
  if (platform === "linux") return "custom-linux";
  throw new Error(`Unsupported desktop window chrome platform: ${platform}`);
}

export function resolveDesktopWindowChromeMode(input: {
  platform: NodeJS.Platform;
  override: string | undefined;
  isPackaged: boolean;
}): DesktopWindowChromeMode {
  if (input.platform !== "linux") {
    throw new Error(`Paseo desktop is only supported on Linux (received ${input.platform}).`);
  }
  const override = input.override?.trim().toLowerCase();
  if (!override) return systemWindowChromeMode(input.platform);
  if (input.isPackaged) {
    throw new Error("PASEO_DESKTOP_WINDOW_CONTROLS is only available in development builds");
  }
  if (override === "linux") return "custom-linux";
  throw new Error(`Unsupported PASEO_DESKTOP_WINDOW_CONTROLS value: ${input.override}. Use linux.`);
}

export function windowChromeModeArgument(mode: DesktopWindowChromeMode): string {
  return `${WINDOW_CHROME_MODE_ARGUMENT_PREFIX}${mode}`;
}
