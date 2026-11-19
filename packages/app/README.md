# Paseo web and shared desktop UI

This package contains the Expo/React Native source for the browser app and Linux desktop renderer. Native iOS/Android modules and platform-specific components remain as upstream merge context, but native app builds, Expo Go, simulators, stores, and mobile deployment are not supported in this fork.

## Development

Install dependencies from the repository root, then run the daemon and browser UI in separate terminals:

```bash
npm ci
npm run dev:server
npm run dev:app
```

The browser development URL is `http://localhost:8081`. Use `npm run dev:desktop` from the root for the Linux Electron renderer.

See [development](../../docs/development.md), [architecture](../../docs/architecture.md), and [QA](../../docs/qa.md) for the supported workflows. Direct and SSH connections replace upstream relay pairing.

## Retained upstream code

Keep shared source where it makes upstream changes easier to merge, without re-enabling excluded targets. Follow the [upstream merge skill](../../.agents/skills/merge-upstream/SKILL.md).

## Dictation debugging

Set `EXPO_PUBLIC_ENABLE_AUDIO_DEBUG=1` before running `npm run dev:app` from the repository root to render the in-app audio debug card. Pair it with the server-side `STT_DEBUG_AUDIO_DIR` flag so every dictation includes a copyable path to the saved raw audio file.
