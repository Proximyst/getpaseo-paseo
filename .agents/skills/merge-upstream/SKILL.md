---
name: merge-upstream
description: Merge upstream Paseo into this Linux fork while preserving removed platforms, deployment targets, and relay restrictions. Use for upstream merges, upstream syncs, and resolving conflicts with getpaseo/paseo.
user-invocable: true
---

# Merge upstream

## Fork contract

This fork supports Linux desktop, the browser UI, and the CLI. Direct WebSocket, SSH, and local Unix-socket connections stay supported.

Do not restore:

- Docker images, Compose examples, container entrypoints, or image publication.
- iOS or Android application targets, native build/release commands, EAS workflows, Fastlane, store screenshots or store submission.
- F-Droid variants, metadata, changelog generation, Metro overrides, or release hooks.
- Relay deployment, relay connection choices, relay pairing offers, or an enabled relay runtime. Explicit config, environment variables, saved hosts, and live config changes must not bypass the restriction.
- Windows or macOS desktop/daemon support, development launchers, packaging, signing, CI runners, release jobs, artifacts, or updater manifests.
- Nix flakes, modules, packages, dependency-hash maintenance, or Nix CI jobs.

Keep common upstream code when deleting it would make future merges harder. Preserve protocol fields, shared encryption, platform implementations and native UI modules needed by shared imports. Disable unsupported behavior at its owning capability/configuration/startup boundary. A default of false is insufficient if an override can enable it. Do not replace retained implementations with fake successes or no-op operations.

The `@getpaseo/relay` workspace also contains shared cryptography. Its continued dependency/build presence does not authorize relay networking or deployment. Expo and React Native dependencies can remain necessary for the web UI.

## Before merging

1. Read the repository's current instructions and the supported-target sections of `docs/architecture.md`, `docs/development.md`, and `docs/release.md`.
2. Inspect the working tree, branch, and remotes. Preserve user changes. Never reset, clean, force-push, or overwrite unrelated work.
3. Resolve the requested upstream revision to a commit. In this checkout, `origin` is `https://github.com/getpaseo/paseo.git` and `fork` is `https://github.com/Proximyst/getpaseo-paseo.git`; verify them rather than assuming the names are unchanged. Fetch only the remote needed for the requested merge.
4. Record the pre-merge fork commit. Inspect upstream changes since the merge base, especially newly added workflows, scripts, app plugins, connection methods, config defaults, and platform entrypoints. A clean textual merge can still restore an excluded feature.

## Resolve and integrate

- Merge the requested upstream commit on the intended fork branch. Keep upstream fixes and features for retained targets.
- Resolve modify/delete conflicts on dedicated excluded-target files by keeping the deletion. Check new filenames and relocated wiring, not only old paths.
- Resolve shared-file conflicts by integrating upstream logic while retaining disabled fork policy. Do not choose all of `ours` or `theirs` for a shared file.
- Inspect root and workspace manifests, lockfile workspace entries, `.github/`, `scripts/`, desktop packaging, Expo config, relay configuration, pairing, client transport selection, and add-host UI.
- Keep Linux desktop, browser, CLI, direct, SSH, and Unix-socket entrypoints working. Do not confuse removing relay with removing all remote access.
- Preserve the fork's root `PKGBUILD` and `packaging/arch/` integration. Keep builds in the local checkout, including uncommitted changes, without cloning or fetching source; see [Arch packaging](../../../docs/development.md#arch-linux-package). Keep its bundled Electron version aligned with the desktop build, and its launcher/CLI resources and sandbox permissions intact. Arch packaging is supported; it does not restore Nix.
- Do not narrow or delete wire schemas to enforce product policy. Keep protocol compatibility and refuse unsupported operations at runtime boundaries.
- Refresh the npm lockfile through npm after manifest changes; do not hand-edit its dependency graph.
- Integrate documentation into the owning sections. Historical changelog entries and retained shared-source platform references are not active support promises.

## Verify before completing

1. Build the relevant workspace dependency stack before diagnosing generated-declaration errors (`npm run build:client` or `npm run build:server`).
2. Run the specific changed behavior tests with `npx vitest run <file> --bail=1` from the appropriate workspace. Never run the full suite locally. Exercise explicit relay enable attempts as well as the default-off case, and prove retained direct/SSH paths when their boundaries changed.
3. Check actual Expo config and desktop packaging output: web app target, Linux desktop artifacts, no removed platform jobs or manifest requirements. Do not launch GUI applications without the user's request.
4. Run `npm run typecheck` and `npm run lint`. Use npm formatting scripts; run `npm run format` before committing.
5. Inspect the merge delta for newly introduced excluded-target wiring. Search results in shared implementations are expected; active entrypoints, jobs, deployment scripts, and user-facing support promises are not.
6. Report the upstream commit, conflicts resolved, retained fork restrictions, and only verification actually exercised. Do not push or open a PR unless requested. PRs target `Proximyst/getpaseo-paseo`, never upstream.
