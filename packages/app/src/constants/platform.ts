import { Platform } from "react-native";
import { isElectronRuntime } from "@/desktop/host";

// ---------------------------------------------------------------------------
// Runtime environment constants
//
// These are the ONLY platform gates in the app. See CLAUDE.md for the
// decision matrix on when to use each one.
//
// Default is cross-platform. Gate only when you must:
//   isWeb      → DOM APIs (document, window, <div>, addEventListener)
//   isNative   → Native-only APIs (Haptics, StatusBar, push tokens, camera)
//   isDev      → Development-only diagnostics and instrumentation
//   isElectron → Desktop wrapper features (file dialogs, titlebar, updates)
//
// For layout decisions, use useIsCompactFormFactor() from constants/layout.ts.
// For hover-tracking, see docs/hover.md — the short answer is `onPointerEnter`/
// `onPointerLeave` on a plain `View`, with any press behavior on a separate
// inner `Pressable`. No platform gate needed.
// ---------------------------------------------------------------------------

/** Browser or Electron — the JS runtime has access to the DOM. */
export const isWeb = Platform.OS === "web";

/** Native app targets are disabled; retain this gate for shared code. */
export const isNative = false;

/** Development build/runtime — true in Metro dev bundles, false in production. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

// ---------------------------------------------------------------------------
// Electron detection (cached — only caches `true`, keeps checking if false
// because the desktop bridge may load after initial module evaluation)
// ---------------------------------------------------------------------------

let _isElectronCached: boolean | null = null;

/** Running inside the supported Linux Electron desktop wrapper. */
export function getIsElectron(): boolean {
  if (_isElectronCached === true) return true;
  if (!isWeb) return false;
  const result = isElectronRuntime();
  if (result) _isElectronCached = true;
  return result;
}

/** macOS desktop support is disabled; retain the shared platform API. */
export function getIsElectronMac(): boolean {
  return false;
}
