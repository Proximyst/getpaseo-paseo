# Release

All workspaces share one version and release together. This fork's release inventory is **Linux desktop artifacts and npm packages only**. Browser assets ship with the daemon/web build. Shared dependencies such as `@getpaseo/relay` remain published where required by the client/server dependency graph; this does not publish or enable a relay service.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (reversible — agent does this on the release branch):

- resolve the [release base](#release-base-and-source) and get the [release inventory](#release-inventory) approved when one applies
- classify the diff from the previous stable to the release source as patch or minor, then show the
  target version and rationale to the user
- draft `CHANGELOG.md` and `CHANGELOG.zh-CN.md`, show the draft to the user, and wait for review
- run the pre-release sanity check (stable only) and surface findings to the user
- commit the approved changelog and any requested ACP update, run format, lint, and typecheck, then
  run `npm run release:prep:<mode>` to create the `chore(release): cut <version>` commit without a tag
- push the `release/vX.Y.Z` or `release/vX.Y.Z-beta.N` branch and confirm its `CI` and
  `Desktop Packages` runs pass (never wait on `main` CI)

**Go-ahead** (user says "go ahead"):

- run `npm run release:ship` (stable) or `npm run release:ship:beta` (beta), which publishes npm
  with retry and registry visibility checks, advances the `beta` dist-tag on stable when newer, and
  pushes the tag on the already-verified commit
- create the release heartbeat immediately and babysit it to completion
- open the [reconcile `main`](#reconcile-main) PR right away so its CI runs in parallel with release
  builds, then delete the remote release branch once the PR merges

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to publish.
- An approval the user already gave covers what it names, such as an explicit PR selection or authorization to release autonomously. Do not ask for it again.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, publish, or run release commands until they explicitly authorize the release.

## Main stays open

Merge normal PRs into `main` at any time, including while a beta soaks or a release is being
finalized. Each release builds in a short-lived release workspace, and its published tag records
the shipped source.

## Choosing a path

The user decides when the changes on `main` warrant a release and how much risk it takes:

1. **Direct stable release** for a low-risk batch of polish and bug fixes. Stable Linux desktop updates
   already ramp over 36 hours (see [Staged rollout](#staged-rollout-stable-channel)).
2. **Beta flow**, the default for changes that need testing. Release candidates on the `beta`
   channel. Each beta folds into the series' single changelog entry, publishes npm only on the
   explicit `beta` dist-tag, and stays behind the Stable/Beta switch on `/download`.

A beta follows these defaults, which the user can explicitly override:

- Soak a beta at least 24 hours before promotion. Soak longer for risky or breaking changes, or
  while feedback is open. Changes added in a later beta get their own soak; earlier soak time does
  not count for them.
- A follow-up beta carries regressions, fixes, and polish for what that beta delivers. Unrelated
  work on `main` and pre-existing bugs wait for a later release unless the user explicitly selects
  them.
- Promotion ships the tested beta's product content unchanged and does not pull from `main`.
  Adding a product change needs the user's explicit selection and a new beta, which soaks again.
- During a soak, ship urgent stable regressions and compatibility or provider model updates as a
  [stable hotfix](#release-base-and-source) from the latest stable tag. The beta keeps its own
  pace.

npm dist-tags are independent pointers:

- A beta release publishes with `--tag beta` and moves only `beta`; `latest` remains on the
  newest stable.
- A stable release publishes to `latest`. Move `beta` to it as well when the stable version is
  newer than the version `beta` points to, which covers promotions and direct stable releases, so
  `@getpaseo/cli@beta` users never sit behind stable. A stable hotfix on an older line leaves
  `beta` on the active newer beta.

## Release base and source

The release base is the tag or commit a release workspace starts from. The release source is the
base plus any approved cherry-picks, and every source, diff, and CI check uses it.

| Release                                                  | Base                                                         | Changes on top               |
| -------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Starting release: first beta of a line, or direct stable | `fork/main`, captured once                                   | None                         |
| Follow-up beta                                           | The selected published beta tag, normally the series' latest | Approved commits from `main` |
| Promotion                                                | The beta tag being promoted                                  | None by default              |
| Stable hotfix                                            | The latest appropriate stable tag                            | Approved commits from `main` |

Release from `Proximyst/getpaseo-paseo`, not upstream. Verify that `fork` points there before fetching or pushing. `origin` points at `getpaseo/paseo` and is only an upstream merge source. An explicit user instruction can select another base.

1. Fetch `fork` with tags and resolve the base to one commit.
2. Create the release workspace through Paseo MCP on a new branch from the base, named
   `release/vX.Y.Z` or `release/vX.Y.Z-beta.N` for the version being cut. `release:push` refuses
   `main` and any branch outside `release/*`.
3. Cherry-pick the approved commits in their `main` order with `git cherry-pick -x`, so each
   commit records the `main` commit it came from. Include the prerequisites the inventory listed.
   Resolve conflicts within the approved changes and report how. A resolution that needs new
   behavior is a scope addition: surface it for selection.
4. Commit the approved `CHANGELOG.md`, `CHANGELOG.zh-CN.md`, and any explicitly requested ACP
   catalog update on the release branch. Run `npm run format`, `npm run lint`, and
   `npm run typecheck`, then run `npm run release:prep:<mode>`. This checks the packages, bumps
   all workspace versions, updates `package-lock.json`, and creates `chore(release): cut <version>`
   without a tag.
5. Push the release branch (`git push -u fork HEAD`). Every `release/**` push triggers `CI`
   and `Desktop Packages` (Linux artifact smoke checks) independently of `main`. Wait for both
   runs on the release branch commit to pass. Pushing the branch without a tag does not publish.
6. After go-ahead, run `npm run release:ship` (stable) or `npm run release:ship:beta` (beta).
   This publishes to npm and pushes the `v*` tag to `fork` on the already-verified commit.
7. Start [Reconcile `main`](#reconcile-main) immediately so its PR checks overlap with the Linux
   desktop release build.

When branching from a tag older than the split preparation and shipping commands,
cherry-pick the release-tooling changes to the release branch without changing product code,
so the release branch push runs both preflight workflows.

A stable hotfix can take the version a patch beta line would promote to, such as `0.13.3`
shipping while `0.13.3-beta.2` soaks. Never republish or reuse a shipped version. Continue the line
as the next unused patch beta, `0.13.4-beta.1`, from the tested beta tag. No `version:all:*` mode
computes that from a prerelease, so run `npm run release:check`, bump with
`npm version 0.13.4-beta.1 --include-workspace-root --no-git-tag-version && git commit -m "chore(release): cut 0.13.4-beta.1"`,
push the release branch for `CI` and `Desktop Packages`, then ship with `npm run release:ship:beta`.
Record the tested beta tag as its source so its soak still counts for the unchanged content.

## Release inventory

When the user asks for a follow-up beta or a promotion, list what `main` has that the base does
not, then get the batch approved. There is no release label or queue.

1. Find the commits on `fork/main` whose patches are not in the base tag:

   ```bash
   git log --cherry-pick --right-only --no-merges --format='%h %s' <base-tag>...fork/main
   ```

   Patch equivalence recognizes commits already cherry-picked into the tag, so trust the tag
   content over PR state or branch names.

2. Present a short include/defer list. Link each PR and give one plain reason. List separately the
   prerequisites an included PR depends on and anything that adds scope beyond what the beta
   delivers. For each fix that shipped in a stable hotfix after the beta's base, confirm the beta
   preserves its behavior, directly or through a superseding change. List the missing ones for
   explicit selection; adding one to a promotion needs a new beta.
3. Wait for the user to approve the batch, unless an explicit selection or autonomous
   authorization they already gave covers it.

For a promotion, every item defaults to defer.

## Reconcile main

Right after the tag push, open a PR into `main` from a fresh branch off `fork/main` named
`reconcile/vX.Y.Z` or `reconcile/vX.Y.Z-beta.N`:

```bash
git fetch fork --tags
git checkout -b reconcile/vX.Y.Z fork/main
npm run release:reconcile -- --tag vX.Y.Z
```

`scripts/reconcile-release.mjs` updates the working tree without cherry-picking stale lockfile
hunks from the release base:

- Copies the tagged `CHANGELOG.md` and `CHANGELOG.zh-CN.md` entries verbatim. A beta or promotion
  entry replaces the series beta entry on `main`. A stable hotfix on an older line is placed below
  any newer entries.
- Updates every `package.json` version and regenerates `package-lock.json` on top of current `main`
  only when the shipped version is newer than `main`'s version, or repairs an out-of-date
  lockfile when the versions already match.
- Leaves unshipped work on `main` untouched and makes no claims about unshipped work in the
  changelog entry.

Commit, open the PR into `main`, and merge once its checks pass. After the reconcile PR merges and
the release completes, delete the remote release branch (`git push fork --delete release/vX.Y.Z`
or `release/vX.Y.Z-beta.N`). The tag is the record of shipped source; Paseo maintains no release
track besides `main`.

## ACP catalog updates

ACP catalog work enters a release through an explicit user request:

- **Check ACP drift** — run `npm run acp:version-drift:check`. When drift exists,
  run `npm run acp:version-drift:update`, verify the catalog, and include the
  update in the local release-preparation commits.
- **Update ACP** — run `npm run acp:version-drift:update`, verify the catalog, and
  include the update in the local release-preparation commits.

The release authorization covers the requested ACP commit. It ships in the same
tag as the changelog and version commit.

## Release version decision

Every fresh release starts by classifying the full diff from the previous
stable to the resolved release source. The highest-impact change determines the
version:

- **Minor** — a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch** — fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

The release agent selects patch or minor during preparation and presents the
target version with the changelog for approval. Agents never select a major
version autonomously. A major release requires an explicit user instruction and
approval; Paseo remains on major version zero until that deliberate decision.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (stable)

Before preparing a stable release on `release/vX.Y.Z`:

- Commit the approved `CHANGELOG.md`, `CHANGELOG.zh-CN.md`, and any requested ACP update.
- Run `npm run format`, `npm run lint`, and `npm run typecheck`, commit any resulting changes, and
  confirm the working tree is clean.
- Do not use a release command as a substitute for checking whether the current commit is ready.

```bash
# 1. Preparation (reversible): run checks and commit the version bump without tagging.
npm run release:prep:patch
# or:
npm run release:prep:minor

# 2. Push the release branch and wait for CI + Desktop Packages on this commit.
git push -u fork HEAD

# 3. After go-ahead and green release-branch checks: publish npm and push the tag.
npm run release:ship
```

`release:ship` runs `scripts/publish-release-packages.mjs` and `scripts/push-current-release-tag.mjs`:

- Publishes all seven `@getpaseo/*` packages in dependency order, skips versions already on npm,
  retries transient 429/5xx/network errors, and waits until each version is visible on npm before
  continuing.
- Checks `npm view @getpaseo/cli dist-tags` and moves npm's `beta` dist-tag to the new stable
  version across all seven packages whenever the stable version is newer than `beta` (leaving
  `beta` untouched during a stable hotfix on an older line).
- Before publishing, checks that `HEAD` matches the pushed `release/*` branch on `fork` and that
  no local or remote tag for this version points elsewhere. After publishing, pushes `vX.Y.Z`
  without changing the branch.

The tag push triggers `Desktop Release` and `Release Notes Sync` on GitHub Actions. The
GitHub Release is created as a draft and published after the Linux artifacts and updater
manifest are ready.

Verify `npm view @getpaseo/cli dist-tags` shows `latest` at the shipped version, and `beta` at the shipped version or an active newer beta, before considering the stable release complete.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
# Run exactly one approved version command (commits without tagging):
npm run version:all:patch
npm run version:all:minor
git push -u fork HEAD        # Trigger CI + Desktop Packages on release/vX.Y.Z
# Wait for CI and Desktop Packages on this branch to pass, then after go-ahead:
node scripts/push-current-release-tag.mjs --check
npm run release:publish      # Publish to npm (idempotent, with propagation + beta dist-tag sync)
npm run release:push         # Create tag vX.Y.Z on HEAD and push (triggers release workflows)
```

## Beta flow

```bash
# 1. Preparation (reversible) on release/vX.Y.Z-beta.N:
npm run release:prep:beta:patch  # Start the next patch beta line
# or:
npm run release:prep:beta:minor  # Start the next minor beta line
# or for follow-up betas:
npm run release:prep:beta:next   # Cut X.Y.Z-beta.2, beta.3, ...

# 2. Push the release branch and wait for CI + Desktop Packages to pass:
git push -u fork HEAD

# 3. After go-ahead:
npm run release:ship:beta

# Later, after soak, promote on release/vX.Y.Z:
npm run release:prep:promote
git push -u fork HEAD
# Wait for CI + Desktop Packages to pass, then after go-ahead:
npm run release:ship
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish npm packages with `--tag beta`, so `npm install @getpaseo/cli@beta` opts in while plain `npm install @getpaseo/cli` stays on `latest`
- The user-facing Linux desktop and npm beta instructions live in `public-docs/updates.md`.
- Betas publish Linux desktop assets and npm packages for testing.
- `release:prep:promote` and `release:ship` create a fresh stable tag like `v0.1.41`; the final
  release never reuses the beta tag.
- Desktop assets now come from the Electron package at `packages/desktop`
- Require the Linux artifact CI checks with both restricted and usable user namespaces to pass before publication; see [packaged desktop smoke](testing.md#packaged-desktop-smoke). Keep the installed-package and AppImage checks together.
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- **A beta series has one changelog entry.** Each beta folds into it and renames its heading to the new `## X.Y.Z-beta.N`, which `Release Notes Sync` mirrors into that prerelease body. Promotion renames it to the stable heading. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely — beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field stamped into the Linux GitHub Release manifest (`latest-linux.yml` for stable, `beta-linux.yml` for beta) by the `finalize-rollout` job in `desktop-release.yml`.

Desktop release builds now publish in two phases:

- The GitHub Release stays a draft while Linux build jobs upload installers/packages (`.AppImage`, `.deb`, `.rpm`, and archives).
- The final job stamps the Linux channel manifest with the final `releaseDate` and `rolloutHours`, then publishes the GitHub Release.

Drafts do not appear in GitHub's releases feed. Updater clients continue to see the previous complete release until the Linux manifest is available. If a build or manifest upload fails, the new release stays a draft.

### Default behavior

`npm run release:prep:patch` or `npm run release:prep:minor` → push release branch → green checks → `npm run release:ship` → tag push → 36h ramp. No extra action needed.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** — tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0)

Tag-push runs from `npm run release:ship` always stamp 36 hours. To admit everyone immediately (hotfix, doc-only change, a release you want out fast), ship the release normally, wait for it to publish, then flip the manifests:

```bash
# 1. Ship the verified release branch (36h ramp from tag push).
npm run release:ship

# 2. Wait for Desktop Release to publish the GitHub Release.
gh run watch <desktop-release-run-id> --repo Proximyst/getpaseo-paseo --exit-status

# 3. Flip the published manifests to instant admit.
gh workflow run desktop-rollout.yml --repo Proximyst/getpaseo-paseo \
  -f tag=v0.1.64 \
  -f rollout_hours=0
```

Dispatch only after `finalize-rollout` has published the release. Until then the release is a draft, and a draft has no tag: `desktop-rollout.yml` looks the release up by tag and fails with `release not found`. The concurrency group `desktop-rollout-<tag>` that the two workflows share orders them only once both are queued; it does not hold an early dispatch until the draft is published.

The first public manifests carry `rolloutHours=36` for the minutes between publish and the flip. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

### Adjusting an already-published release

To change the rollout duration on a release that's already shipped — e.g. flip a hotfix to instant admit, or slow a release down — use the dedicated `desktop-rollout.yml` workflow. It edits the manifests in place on the GitHub release without rebuilding anything. It only rewrites `rolloutHours`; `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

**Hotfix (instant admit) on an already-shipped release:**

```bash
gh workflow run desktop-rollout.yml --repo Proximyst/getpaseo-paseo \
  -f tag=v0.1.42 \
  -f rollout_hours=0
```

`rollout_hours=0` admits 100% of stable users on their next update check (within ~30 min for active clients).

**Slow a rollout down** (e.g. extend total duration to 72h since the original release):

```bash
gh workflow run desktop-rollout.yml --repo Proximyst/getpaseo-paseo \
  -f tag=v0.1.42 \
  -f rollout_hours=72
```

`rollout_hours` is **total duration since the original release date**, not "extend by N more hours from now." If `v0.1.42` was published 2h ago and you set `rollout_hours=72`, the ramp finishes 70h from now.

The dispatch is idempotent and shares the `desktop-rollout-<tag>` concurrency group with `desktop-release.yml`'s `finalize-rollout` job, so it serializes safely against an in-flight tag-push pipeline targeting the same release.

### Custom ramp on a manually-dispatched build

`desktop-release.yml` accepts `rollout_hours` only on `workflow_dispatch`, which is the path used to **rebuild an existing tag** (retry a failed release, force a rebuild on a different ref). When you go that route, you can stamp a non-default ramp directly:

```bash
gh workflow run desktop-release.yml --repo Proximyst/getpaseo-paseo \
  -f tag=v0.1.43 \
  -f checkout_ref=v0.1.43 \
  -f rollout_hours=6
```

This does **not** apply to fresh releases shipped via `npm run release:ship` — tag-push runs always stamp 36. For a fresh release with a custom ramp, ship normally and then dispatch `desktop-rollout.yml` (same pattern as the instant-admit flow above, with your chosen `rollout_hours`).

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends — the newer manifest supersedes it. Rollout-aware clients revalidate the manifest for up to five seconds before installing a downloaded update on quit. If N+1 has replaced N but the client is not admitted to N+1 yet, it skips the downloaded N and waits rather than installing two updates in succession. If revalidation times out, the app exits without installing the cached update.

If N+1 is a hotfix for a bug in N, dispatch `desktop-rollout.yml -f tag=v0.1.<N+1> -f rollout_hours=0` after N+1 publishes so the users who already got N reach the fix fast.

### Limitations

- **No pause / kill switch.** To stop new admissions, ship a superseding release. Clients revalidate on quit and will not install the superseded download, but a client that already completed installation cannot be recalled; ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable Linux build, npm publication, asset, and
manifest passes the completion checklist.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, `CI` and `Desktop Packages` for the release branch,
`Desktop Release` and `Release Notes Sync` for the tag, npm dist-tags, the GitHub Release body and
Linux desktop assets, the Linux updater manifest (`latest-linux.yml` for stable or
`beta-linux.yml` for beta), and the reconcile PR. Once the PR merges and the release checks pass,
delete the remote release branch, delete the heartbeat, and report the release as shipped.

Pattern:

```jsonc
// mcp__paseo__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check npm tags; CI and Desktop Packages on release/vX.Y.Z; Desktop Release and Release Notes Sync for the tag; the GitHub Release body, expected Linux assets, and Linux updater manifest; and the reconcile PR into main. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. Once the reconcile PR merges and the release checks pass, delete release/vX.Y.Z from fork, delete THIS heartbeat, report shipped, and stop.",
}
```

Run an immediate status check after creating the heartbeat. The heartbeat handles
later transitions and stops itself when the release is complete.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually — keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Website behavior

- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- The download page offers Linux desktop and npm installation. The browser UI is served by the daemon or built from the supported web target; it is not a separate native release.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main` — that's intended, it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: the beta entry is renamed on each beta and on promotion, so the minor group remains the durable target. A version with no entry in the bundled changelog — a tag whose changelog commit hasn't redeployed the site yet — links the plain `/changelog` instead of a dead anchor.
- The website itself is deployed by `Deploy Website` (Cloudflare Workers), which redeploys on the `release: published` event emitted when a stable draft is published and on pushes to `main` that touch `CHANGELOG.md` or `packages/website/**`. Its job condition excludes beta prereleases.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

On `workflow_dispatch`, `tag` sets the release metadata, not the source checkout.
Set `checkout_ref` explicitly to the tag to rebuild the original source, or to an approved
fix commit to rebuild with that change. If omitted, the build uses the workflow's dispatch ref.

To retry a failed release workflow, push a retry tag on the approved commit
you want to build. Reusing the same retry tag name is expected; confirm the
intended source and obtain authorization before moving any already-published
release tag.

A failed desktop build leaves the GitHub Release as a draft. A successful retry
uploads the Linux channel manifest with its release date and publishes the draft.
A `workflow_dispatch` rebuild with publishing enabled follows the same path
against the existing draft. Prefer a Linux desktop retry tag for asset rebuilds.

The retry tag patterns below still work and remain the supported way to rebuild specific release targets:

```bash
# Linux desktop
git tag -f desktop-linux-v0.1.28 HEAD && git push fork desktop-linux-v0.1.28 --force

# Desktop release alias (Linux only)
git tag -f desktop-v0.1.28 HEAD && git push fork desktop-v0.1.28 --force
```

This ensures the checkout ref matches the approved code you want built, with the fix included. Both patterns rebuild Linux desktop assets only; npm publication is a separate release step.

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo Proximyst/getpaseo-paseo --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --repo Proximyst/getpaseo-paseo --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --repo Proximyst/getpaseo-paseo --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo Proximyst/getpaseo-paseo --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --repo Proximyst/getpaseo-paseo --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root, syncs workspace versions and `@getpaseo/*` dependency versions, and
  commits `chore(release): cut <version>` without creating a tag.
- `release:push` requires a clean worktree at the pushed `release/*` branch's commit. It pushes
  the tag to `fork`, not the branch.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types.
- `npm run dev:desktop` and `npm run build:desktop` target the Linux Electron desktop package in
  `packages/desktop`.
- If publication fails partway through, re-run the same shipping command. It skips already
  published package versions, retries transient registry errors, and waits for each version
  to become visible on npm before continuing.
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the pushed tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

`CHANGELOG.md` on `main` is also what the app's **What's new** sheet fetches and renders, so the file is a shipped product surface, not just a release input. `##` starts a release and `###` starts a section; the app reads section titles from the document, so renaming or adding one needs no app change. Content between the release heading and the first `###` is the release's [highlights](#changelog-highlights). The What's new sheet, the website changelog and the GitHub release body show the highlights and keep the sections collapsed behind one control: Show all changes in the app and on the website, and an All changes `<details>` block that `Release Notes Sync` writes into the release body, so the file itself never needs HTML. A release with nothing before its first `###` shows its sections. Older entries that open with summary paragraphs are treated as highlights. The app, the website and the release scripts each parse the file with their own code, and installed apps keep the parser they shipped with, so those two heading rules are fixed: new kinds of content go inside the highlights or a section as Markdown, never behind a new heading level or marker. `scripts/test-support/changelog-structure.json` holds the cases all three parsers are tested against; change a structure rule there first. Everything under a section is rendered as Markdown: prose, lists, links, inline code, fenced code, block quotes, tables, and images. Raw HTML does not render — the shared Markdown parser runs with `html: false`, so a `<video>`, `<iframe>` or `<embed>` tag reaches the reader as visible markup. Keep media out of the changelog, or link to it. A GitHub callout renders as a block quote with its `[!NOTE]` marker still in the text. A release entry is what a user reads on a phone the moment they are offered the update — write it for them.

## Changelog policy

- `CHANGELOG.md` holds stable releases and at most one entry for the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta rewrites that entry in place: the heading becomes the new beta number and date, and the body describes the full change from the previous stable release to this beta. Never add a second beta entry.
- The entry announces changes and leaves setup steps, click paths, migration notes, configuration keys, hedges and edge cases to product docs. The headline change is the first highlight. [Changelog conciseness](#changelog-conciseness) and [Changelog ordering](#changelog-ordering) hold the rules.
- The entry is a list of changes, not of PRs. When a later beta reverts, reworks, or follows up on something an earlier beta added, rewrite the bullet to the current behavior or delete it. A stable user never saw the earlier beta behavior, so fixes to it are not "Fixed" bullets.
- Anything that already shipped to stable through a patch release on an older line stays out of the beta entry.
- Stable promotion renames the entry to `## 0.1.60 - YYYY-MM-DD` after a final review.

Older prerelease bodies on GitHub keep the notes they were synced with; `Release Notes Sync` only writes the release whose tag matches the top entry.

## Changelog translations

`CHANGELOG.zh-CN.md` holds the Chinese notes for `paseo.sh/zh-CN/changelog`. Only the website reads it; the app's **What's new** sheet and GitHub release bodies read `CHANGELOG.md`.

- The release agent writes the Chinese entry in the changelog commit, after the English entry is approved. Every beta that rewrites the English entry rewrites the Chinese one too, and promotion renames both. `packages/website/e2e/i18n.spec.ts` fails CI on the release commit when any entry has no current translation.
- A translated entry uses the English heading unchanged: `## X.Y.Z - YYYY-MM-DD`. The website uses it only while the version and date both match the English entry. Otherwise it shows that release whole in English under a notice. Delete Chinese entries whose English entry was renamed.
- Keep the English highlights, sections, bullets and links one to one. Section titles: Added 新增, Improved 改进, Changed 变更, Fixed 修复, Security 安全, Breaking 破坏性变更, Plugins 插件, Notes 说明. Wording follows [website-i18n.md](website-i18n.md#chinese-style).

## Changelog ownership

- **The agent running the release writes the changelog entry — beta or stable.** The release context and final wording stay with that agent.
- **Commit history is only an index of the changes. Never draft the changelog from commit subjects or diffs alone.** For every PR in the release range, read the full PR description and every issue it links to before deciding what changed, why users care, or how changes should be grouped. Use the implementation only to verify the resulting understanding.
- Every entry, beta or stable, is drafted from the previous stable release to the release source. For a later beta, read the PRs since the previous beta tag, then rework the existing entry so each bullet still describes current behavior. Review the result against the changelog policy below, show it to the user, and wait for approval before committing it.

## Changelog wording

The changelog is shown on the Paseo homepage. Each bullet is a compact factual record of
product behavior that changed.

- **Name the exact change.** Prefer `Added <capability>`, `Removed <behavior>`,
  `Changed <behavior>`, or `Fixed <failure> when <condition>`.
- **Keep the scope exact.** A conditional bug is not a general reliability problem. Do not
  broaden one failure into claims that Paseo is now faster, smoother, responsive, or reliable.
- **Use concrete product and runtime terms.** Git polling, persisted cache, provider catalog,
  and WebSocket reconnects can identify the affected behavior. Component names, internal
  modules, code symbols, and implementation techniques cannot: omit `WorkingIndicator`,
  `reconcileAndEmitWorkspaceUpdates`, remounts, memoization, and controlled inputs.
- **State the consequence only when the change itself is unclear.** Keep the condition that
  makes the consequence true. Do not replace a precise change with a broad benefit claim.
- **Do not invent context.** Mention an upgrade, platform, workload, or user action only when
  the PR or linked issue establishes that scope.

| Avoid                                                        | Write                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| Paseo stays responsive with many idle Git workspaces         | Removed periodic Git polling for idle workspaces      |
| Incompatible saved app data no longer crashes after upgrades | Fixed crash when persisted cache was incompatible     |
| Splitting layouts no longer remounts the active agent        | Fixed scroll position resetting when splitting a pane |
| Mobile model selector is faster and more straightforward     | Added search to the mobile model selector             |

Test each bullet against the source PR and issue: can a reviewer point to the exact behavior
that changed, the failure that was fixed, or the capability that was added? If the bullet only
claims a general improvement, rewrite it with the concrete change.

- **Use the entry's release scope.** Include changes within the matching range in **Changelog scope**.
- **Collapse internal iterations within that scope.** Present a feature added and fixed in one range as working.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

An entry announces what changed. Product docs own setup, navigation, migration and edge cases, and the PR link leads to the rest. These rules apply to highlights and section bullets.

- **No instructions.** Cut setup steps, click paths, configuration keys, flags and migration notes. "Open a provider's settings from Settings, setup, or the model picker" is a click path. "Existing goose settings and sessions carry over to the bundled plugin" is a migration note.
- **One warning for a breaking requirement.** When the update stops something working until the user acts, state the requirement in one short sentence after the announcement, and link the product doc that has the steps: "Requires [Antigravity CLI 1.5.0 or later](https://paseo.sh/docs/supported-providers/antigravity)." Nothing else earns a second sentence.
- **No hedges or exception clauses.** Cut "when needed", "for eligible models", "on hosts where…", "except…", "with a hint shown when…" and "across common install shapes". Keep the condition that triggers a fixed failure, as in `Fixed <failure> when <condition>`.
- **The shorter bullet is still true.** When a change reaches only some providers, platforms or file types, name what it covers in the sentence's own words: "update supported CLIs" where one provider has no update command, "Markdown previews and source views" where HTML previews on iOS are left out, "by default" where an explicit interrupt still replaces the turn. Do not widen the claim to remove a clause.
- **State the outcome and stop.** Say what the user gets. Leave out queues, snapshots, caches, timeouts, LAN/WAN topology, TLS handshakes and IPC.

Each row is from the first draft of 0.17.1:

| Avoid                                                                                                                                                                                                                                                     | Write                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Open a provider's settings from Settings, setup, or the model picker to update supported CLIs and watch their output                                                                                                                                      | Update supported CLIs from the app                                                                |
| Use Antigravity CLI 1.5.0 or later on the daemon host, and include `acp` if you override its command                                                                                                                                                      | Requires Antigravity CLI 1.5.0 or later                                                           |
| Reports and notifications from other agents arrive in order when the current turn ends instead of interrupting it. An interrupt or your own prompt carries earlier queued messages in the same turn, and Stop holds queued messages until the next prompt | By default, messages from other agents wait for the current turn to end                           |
| Changed worktree teardown to keep the worktree when the command exceeds one minute or the `worktree.teardownTimeoutMs` limit in `paseo.json`                                                                                                              | Changed worktree teardown to keep the worktree when the command times out                         |
| Fixed file views losing their scroll position when switching Preview and Source, except HTML previews on iOS                                                                                                                                              | Fixed Markdown previews and source views losing their scroll position when switching between them |

Section bullets also follow these limits:

- **One sentence per bullet, max.** A second sentence is documentation. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets — even when they share a theme or author. One bullet = one user-facing change.
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog highlights

Every release entry leads with highlights: the changes a user would name first when asked what is
new. They are a list above the first `###` section, ranked as
[Changelog ordering](#changelog-ordering) describes. The sections below are the full record; a
reader who stops after the highlights should have missed nothing they would ask about.

```markdown
## 0.16.0 - 2026-11-20

- **Undo workspace archive:** Restore an archived workspace with Undo or Cmd/Ctrl+Z. ([#8904](https://github.com/getpaseo/paseo/pull/8904))

### Added
```

- **The lead-in names what is new in four words at most.** Bold it, colon inside the bold. A reader
  who sees only the bold words should know what this release added or changed. A category lead-in
  such as `**Polish:**` gathers several related changes.
- **The lead-in is not a place or something Paseo already had.** A device, screen or area names
  where the change landed. A feature name that was true of the last release hides the news: Paseo
  already had keyboard shortcuts, so the lead-in says they now work on mobile.
- **One short sentence says the plain thing.** Write what a user would tell a friend: Paseo now
  shows the background tasks an agent is running. Leave out the conditions and mechanics that make
  it true. A second sentence is only for a
  [breaking requirement](#changelog-conciseness).
- **Describe the new behavior, not the old one.** Say what is faster or better now, and do not
  dwell on how slow or broken it was before. A number is welcome as a short aside after the new
  behavior is stated: seconds, a percentage, a multiple.
- **Do not list what a sentence already covers.** After "the same shortcuts as desktop", naming
  five of them adds nothing. Keep a list only when it sets the scope, such as the providers a
  feature works with.
- **Sentences end with periods, and the attribution follows the last one.**
  [Changelog wording](#changelog-wording) and [Changelog conciseness](#changelog-conciseness)
  apply.
- **A highlight replaces the section bullets it covers.** A PR appears once in an entry, so its
  attribution moves to the highlight.
- **A highlight is something a user would name.** Everything else stays a section bullet. A patch
  release still has one: the change it ships for.
- **Fixes are routine and stay in `### Fixed`.** Do not add a summary of fixes. A fix, or a group
  of related fixes, becomes a highlight only when it passes the same test as a feature, and then
  it is written as what works now: `**Fewer reconnects on return:**`.

| Avoid                                                                                      | Write                                                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `**iPad and touch screens:**`                                                              | `**Touch-sized tablet controls:**`                                                  |
| `**Hardware keyboard shortcuts:**`                                                         | `**Keyboard shortcuts on mobile:**`                                                 |
| When an agent ends its turn while shells it started are still running, a pill lists them   | Paseo now shows the background tasks an agent is running                            |
| A diff no longer waits 4 to 40 seconds behind worktree scans                               | Opening Changes shows the file tree right away, and diffs load about 6 times sooner |
| The same shortcuts as desktop: command center, file picker, new workspace, workspace jumps | The same shortcuts as desktop, including your custom bindings                       |

Before showing a draft, read only the bold lead-ins top to bottom. Each one must answer "what is
new?" without its description, and each must outrank the one below it.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line — a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/getpaseo/paseo/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/getpaseo/paseo/pull/210), [#215](https://github.com/getpaseo/paseo/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/getpaseo/paseo/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions — core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener — using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --cherry-pick --right-only --no-merges --format='%H %s' v<previous>...<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects and skips commits the previous stable already shipped as cherry-picks.

## Changelog ordering

Rank highlights by how much of a user's day the change touches: how many users get it, and how
often they meet it. Put every highlight in one of four groups, then order each group by the same
question.

1. **New capabilities.** Something a user could not see or do in the last release:
   `Background tasks`, `Plugin sidebar views`.
2. **Everyday things that got better.** Speed, steadiness and polish in what users already do
   every session: `Faster diff loading`, `Polish`.
3. **Changes for part of the audience.** They need a particular device, provider or setup:
   `Keyboard shortcuts on mobile`, `Touch-sized tablet controls`.
4. **Small conveniences and highlighted fixes.** A user is glad to find them and would not update
   for them: `Undo workspace archive`, `Fewer reconnects on return`. Fixes are routine, so one
   that earned a highlight still follows everything new or improved.

- **The headline change goes first, whatever its group.** It is the change the release is announced
  with. 0.17.1 leads with `Antigravity approvals and history`, which needs one provider. The groups
  rank everything after it.
- **Reach decides before kind.** A new capability that needs a hardware keyboard is in group 3.
- **Rank the whole list in one pass.** The order you collected the pull requests in, the alphabet
  and the order of the sections below are not rankings.
- **Show the groups with the draft.** List each highlight under its group when you ask for
  approval, so the maintainer corrects the test and not one position.
- **A maintainer's note that a change is big moves that change up.** It does not rank the changes
  it names against each other, and it does not lower the ones it leaves out.
- **A correction to one highlight is a correction to the test.** Work out which group or question
  you got wrong, rank every highlight again, and then edit the file. Moving only the named item
  leaves the same mistake in the others.

Bullets within each section (Added, Changed, Fixed) follow this order:

1. **User-facing features and changes first** — things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** — polish, performance, smoother interactions.
3. **Internal/infra changes last** — only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas — the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** — especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** — the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** — anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

Changelog scope follows the release being described:

Every entry covers `previous stable release → release source`: first beta, later beta, direct stable release, and promotion alike. The beta entry always reads as the stable entry would if the beta were promoted today.

## Completion checklist

### Beta release

- [ ] The release base and changes match the [release base table](#release-base-and-source) and any approved [inventory](#release-inventory)
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Fold this beta into the series' single `CHANGELOG.md` entry (heading `## X.Y.Z-beta.N - YYYY-MM-DD`, previous stable → release source), review it against the changelog policy, get approval, and commit it with its [`CHANGELOG.zh-CN.md` translation](#changelog-translations) before running `release:prep:*`
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] `npm run release:prep:beta:patch`, `release:prep:beta:minor`, or `release:prep:beta:next` created the version commit on `release/vX.Y.Z-beta.N` without a tag, and the pushed branch passed `CI` and `Desktop Packages` before shipping (never relying on `main` CI)
- [ ] After go-ahead, `npm run release:ship:beta` published npm and pushed the `vX.Y.Z-beta.N` tag without triggering a second CI run
- [ ] npm shows the version under the `beta` dist-tag, not `latest`
- [ ] The GitHub prerelease was published only after `beta-linux.yml` was uploaded, and it has the changelog body and every expected Linux desktop asset
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body
- [ ] The [reconcile PR](#reconcile-main) brought the shipped changelog entries and version into `main` without downgrading it, and `release/vX.Y.Z-beta.N` was deleted from `fork`
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] The release base and changes match the [release base table](#release-base-and-source) and any approved [inventory](#release-inventory)
- [ ] A promotion ships the tested beta's product content after its soak, unless the user explicitly overrode either default
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes — not refactors). Promotion renames the series' `## X.Y.Z-beta.N` entry to `## X.Y.Z - YYYY-MM-DD` and re-checks it covers the full release. Commit the matching [`CHANGELOG.zh-CN.md` entry](#changelog-translations) with it
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] Ensure local format, lint, and typecheck pass and the working tree is clean before running `release:prep:*`
- [ ] `npm run release:prep:patch`, `release:prep:minor`, or `release:prep:promote` created the version commit on `release/vX.Y.Z` without a tag, and the pushed branch passed `CI` and `Desktop Packages` before shipping (never relying on `main` CI)
- [ ] After go-ahead, `npm run release:ship` published npm, updated dist-tags, and pushed the `vX.Y.Z` tag without triggering a second CI run
- [ ] `latest` resolves to the new stable, and `beta` resolves to it too unless an active newer beta holds `beta`
- [ ] The GitHub Release was published only after `latest-linux.yml` was uploaded, and it has the changelog body and every expected Linux desktop asset
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] The [reconcile PR](#reconcile-main) brought the shipped changelog entries and version into `main` without downgrading it, and `release/vX.Y.Z` was deleted from `fork`
- [ ] The release heartbeat was created after the tag push and deleted only after every item above passed
