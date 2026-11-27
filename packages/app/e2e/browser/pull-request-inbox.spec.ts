import type { GithubInboxPullRequest } from "@getpaseo/protocol/messages";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { composerLocator, expectComposerEditable } from "../support/helpers/composer";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";

const FIRST = {
  number: 12,
  title: "Add first feature",
  url: "https://github.com/example/app/pull/12",
  repository: "example/app",
  author: "developer",
  updatedAt: "2026-11-19T18:00:00.000Z",
  state: "OPEN",
  isDraft: false,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  headRef: "first-feature",
  baseRef: "main",
  body: "Adds the first feature.",
  additions: 42,
  deletions: 0,
  reviewDecision: "APPROVED",
  mergeStateStatus: "BLOCKED",
  checks: { passed: 2, failed: 1, pending: 0, other: 0 },
  approvals: 1,
  comments: 0,
  unresolvedThreads: null,
} satisfies GithubInboxPullRequest;
const SECOND: GithubInboxPullRequest = {
  ...FIRST,
  number: 24,
  title: "Add second feature",
  url: "https://github.com/example/other/pull/24",
  repository: "example/other",
};
const DIRECT = {
  ...FIRST,
  title: "Only reachable by direct link",
  number: 36,
  repository: "example/direct",
  url: "https://github.com/example/direct/pull/36",
};

const mine = "is:pr is:open author:@me";
const review = "is:pr is:open review-requested:@me";
const raw = 'repo:example/app label:"release notes"';

function searchPayload(
  query: string,
  cursor: string | undefined,
  reviewError: boolean,
  first: GithubInboxPullRequest,
) {
  const error = query === review && reviewError ? "GitHub credentials have expired." : null;
  let items: GithubInboxPullRequest[] = [];
  if (query === mine) items = cursor ? [SECOND] : [first];
  else if (query === raw) items = [FIRST];
  return { items, nextCursor: query === mine && !cursor ? "next-page" : null, error };
}

function detailPayload(pullRequest: GithubInboxPullRequest | undefined) {
  return {
    pullRequest,
    headSha: pullRequest?.headSha ?? null,
    baseSha: pullRequest?.baseSha ?? null,
    activity: [],
    files: [],
    checks: [],
    complete: !!pullRequest,
    error: pullRequest ? null : "Pull request not found.",
  };
}

async function installInboxFixture(
  page: Page,
  supported: boolean,
  useLocalCheckout = false,
  holdCheckoutResponse?: (release: () => void) => void,
  cloneFixtureProject?: { projectId: string },
) {
  const requests: { query: string; cursor?: string }[] = [];
  const checkouts: Record<string, unknown>[] = [];
  const agentLaunches: unknown[] = [];
  const clones: Record<string, unknown>[] = [];
  let reviewError = true;
  let first: GithubInboxPullRequest = FIRST;
  let direct: GithubInboxPullRequest = DIRECT;
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    function handleFixtureClone(request: Record<string, unknown> | null) {
      if (!cloneFixtureProject || request?.type !== "project.github.clone.request") return false;
      clones.push(request);
      browser.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "project.github.clone.response",
            payload: {
              requestId: request.requestId,
              repo: request.repo,
              checkoutPath: "/fixture-clone/example/app",
              project: cloneFixtureProject,
              error: null,
            },
          },
        }),
      );
      return true;
    }
    browser.onMessage((packet) => {
      if (typeof packet === "string") {
        const envelope = JSON.parse(packet);
        const request = envelope.type === "session" ? envelope.message : null;
        if (handleFixtureClone(request)) return;
        const hideProjects = !useLocalCheckout || !!cloneFixtureProject;
        if (hideProjects && request?.type === "project.list.request") {
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "project.list.response",
                payload: { requestId: request.requestId, projects: [] },
              },
            }),
          );
          return;
        }
        if (request?.type === "create_agent_request") agentLaunches.push(request);
        if (useLocalCheckout && request?.type === "create_paseo_worktree_request") {
          checkouts.push(request);
          // Keep the workspace and routing real without contacting GitHub. The
          // daemon's PR fetch and worktree-manager handoff are covered separately.
          server.send(
            JSON.stringify({
              ...envelope,
              message: {
                type: request.type,
                cwd: request.cwd,
                projectId: request.projectId,
                requestId: request.requestId,
                action: "branch-off",
                baseBranch: "main",
                worktreeSlug: "inbox-pr-draft",
              },
            }),
          );
          return;
        }
        if (request?.type === "forge.github.search_pull_requests.request") {
          const { query, cursor, requestId } = request;
          requests.push({ query, cursor });
          const payload = searchPayload(query, cursor, reviewError, first);
          if (payload.error) reviewError = false;
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "forge.github.search_pull_requests.response",
                payload: { ...payload, requestId },
              },
            }),
          );
          return;
        }
        if (request?.type === "forge.github.get_pull_request.request") {
          browser.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "forge.github.get_pull_request.response",
                payload: {
                  ...detailPayload(
                    [first, SECOND, direct].find(
                      (item) =>
                        item.repository === request.repository && item.number === request.number,
                    ),
                  ),
                  requestId: request.requestId,
                },
              },
            }),
          );
          return;
        }
      }
      server.send(packet);
    });
    server.onMessage((packet) => {
      if (typeof packet === "string") {
        const envelope = JSON.parse(packet);
        const message = envelope.type === "session" ? envelope.message : envelope;
        if (holdCheckoutResponse && message?.type === "create_paseo_worktree_response") {
          holdCheckoutResponse(() => browser.send(packet));
          return;
        }
        if (message?.type === "status" && message.payload?.status === "server_info") {
          message.payload.features ??= {};
          message.payload.features.githubPullRequestInbox = supported;
          message.payload.features.githubPullRequestInboxOpen = supported;
          message.payload.features.githubPullRequestInboxAutoClone = supported;
          browser.send(JSON.stringify(envelope));
          return;
        }
      }
      browser.send(packet);
    });
  });
  return {
    requests,
    checkouts,
    agentLaunches,
    clones,
    advanceFirst: (revision: GithubInboxPullRequest) => {
      first = revision;
    },
    advanceDirect: (revision: GithubInboxPullRequest) => {
      direct = revision;
    },
  };
}

test("keeps separate inbox tabs and supports GitHub query syntax", async ({ page }) => {
  const { requests } = await installInboxFixture(page, true);
  await gotoAppShell(page);
  await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
  await expect(page).toHaveURL(`/h/${encodeURIComponent(getServerId())}/pull-requests`);
  const inbox = page.getByTestId("pr-inbox-screen");
  const mineResults = inbox.getByTestId("pr-inbox-mine-results");
  const firstRow = mineResults.getByTestId("pr-inbox-result").filter({ hasText: FIRST.title });
  await expect(firstRow).toBeVisible();
  await expect(firstRow).toContainText(FIRST.body);
  await expect(firstRow).toContainText("+42");
  await expect(firstRow).toContainText(/[-−]0/);
  expect(requests).toContainEqual({ query: mine, cursor: undefined });
  await expect(firstRow).toContainText("Review: Approved");
  await expect(firstRow).toContainText("Merge: Blocked");
  await expect(firstRow).toContainText("CI: 1 failed · 2 passed");
  await expect(firstRow).toContainText("Comments: 0");
  await expect(firstRow).toContainText("Unresolved threads: unknown");

  await inbox.getByTestId("pr-inbox-load-more").click();
  await expect(
    mineResults.getByTestId("pr-inbox-result").filter({ hasText: SECOND.title }),
  ).toBeVisible();
  expect(requests).toContainEqual({ query: mine, cursor: "next-page" });
  await firstRow.click();
  const detail = inbox.getByTestId("pr-inbox-detail");
  await expect(detail.getByRole("heading", { name: FIRST.title })).toBeVisible();
  await expect(detail.getByText(FIRST.body)).toBeVisible();
  await expect(detail.getByTestId("pr-inbox-open-github")).toHaveAccessibleName("Open on GitHub");
  const detailTab = inbox.getByTestId("pr-inbox-detail-tab");
  await expect(detailTab).toBeVisible();
  await inbox.getByTestId("pr-inbox-mine-tab").click();
  await expect(firstRow).toBeVisible();
  await expect(
    mineResults.getByTestId("pr-inbox-result").filter({ hasText: SECOND.title }),
  ).toBeVisible();
  await detailTab.click();
  await expect(detail.getByRole("heading", { name: FIRST.title })).toBeVisible();
  await inbox.getByTestId("pr-inbox-close-detail-tab").click();
  await expect(detailTab).toHaveCount(0);
  await expect(firstRow).toBeVisible();

  await inbox.getByTestId("pr-inbox-review-tab").click();
  const reviewResults = inbox.getByTestId("pr-inbox-review-results");
  await expect(reviewResults.getByTestId("pr-inbox-error")).toContainText(
    "GitHub credentials have expired.",
  );
  expect(requests).toContainEqual({ query: review, cursor: undefined });
  await reviewResults.getByRole("button", { name: "Try again" }).click();
  await expect(reviewResults.getByTestId("pr-inbox-empty")).toBeVisible();

  await inbox.getByTestId("pr-inbox-open-tab").click();
  await inbox.getByTestId("pr-inbox-query").fill(raw);
  await inbox.getByTestId("pr-inbox-search").click();
  await expect(
    inbox.getByTestId("pr-inbox-open-results").getByTestId("pr-inbox-result").filter({
      hasText: FIRST.title,
    }),
  ).toBeVisible();
  expect(requests).toContainEqual({ query: raw, cursor: undefined });
});

test("refreshes a direct-open PR's summary and editor tab after a push", async ({ page }) => {
  const { advanceDirect } = await installInboxFixture(page, true);
  await gotoAppShell(page);
  await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
  const inbox = page.getByTestId("pr-inbox-screen");
  await inbox.getByTestId("pr-inbox-open-tab").click();
  const detail = inbox.getByTestId("pr-inbox-detail");
  const reference = inbox.getByTestId("pr-inbox-pr-reference");
  await reference.fill(DIRECT.url);
  await inbox.getByTestId("pr-inbox-open-pr").click();
  await expect(detail.getByRole("heading", { name: DIRECT.title })).toBeVisible();
  await expect(detail.getByTestId("pr-inbox-open-github")).toHaveAccessibleName("Open on GitHub");
  const next = {
    ...DIRECT,
    title: "Updated after a push",
    headSha: "c".repeat(40),
    updatedAt: "2026-11-20T18:00:00.000Z",
  };
  advanceDirect(next);
  await detail.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(detail.getByRole("heading", { name: next.title })).toBeVisible();
  await expect(detail.getByText(next.headSha.slice(0, 12), { exact: false })).toBeVisible();
  await expect(inbox.getByTestId("pr-inbox-detail-tab")).toContainText(next.title);
  await expect(detail.getByText("The pull request moved.", { exact: false })).toHaveCount(0);
  await detail.getByTestId("pr-inbox-detail-checkout").click();
  await expect(inbox.getByTestId("pr-inbox-checkout-error")).toContainText(
    "Add example/direct as a Project",
  );
});

test("opening a refreshed list row does not reuse details from its previous revision", async ({
  page,
}) => {
  const { advanceFirst } = await installInboxFixture(page, true);
  await gotoAppShell(page);
  await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
  const inbox = page.getByTestId("pr-inbox-screen");
  const detail = inbox.getByTestId("pr-inbox-detail");
  const row = inbox.getByTestId("pr-inbox-mine-results").getByTestId("pr-inbox-result");
  await row.filter({ hasText: FIRST.title }).click();
  await expect(detail.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await inbox.getByTestId("pr-inbox-mine-tab").click();
  const next = { ...FIRST, title: "New revision", headSha: "c".repeat(40) };
  advanceFirst(next);
  await inbox.getByTestId("pr-inbox-refresh").click();
  await row.filter({ hasText: next.title }).click();
  await expect(detail.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(detail.getByRole("heading", { name: next.title })).toBeVisible();
  await expect(detail.getByText(next.headSha.slice(0, 12), { exact: false })).toBeVisible();
});

test("a checkout with no matching project stays in the editor and reports the repository", async ({
  page,
}) => {
  await installInboxFixture(page, true);
  await gotoAppShell(page);
  await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
  const inbox = page.getByTestId("pr-inbox-screen");
  const row = inbox.getByTestId("pr-inbox-mine-results").getByTestId("pr-inbox-result-row").filter({
    hasText: FIRST.title,
  });
  await row.getByRole("button", { name: "Check out PR", exact: true }).click();
  await expect(inbox.getByTestId("pr-inbox-checkout-error")).toContainText(
    "Add example/app as a Project",
  );
  await expect(inbox.getByTestId("pr-inbox-detail-tab")).toHaveCount(0);
  await expect(page).toHaveURL(`/h/${encodeURIComponent(getServerId())}/pull-requests`);
});

test("Projects only hides other repositories without blocking direct PR opening", async ({
  page,
}) => {
  const project = await seedWorkspace({
    repoPrefix: "inbox-project-filter-",
    repo: { originUrl: `https://github.com/${FIRST.repository}.git` },
  });
  try {
    const { requests } = await installInboxFixture(page, true, true);
    await gotoAppShell(page);
    await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
    const inbox = page.getByTestId("pr-inbox-screen");
    const results = inbox.getByTestId("pr-inbox-mine-results");
    const matching = results.getByTestId("pr-inbox-result").filter({ hasText: FIRST.title });
    const unrelated = results.getByTestId("pr-inbox-result").filter({ hasText: SECOND.title });
    const options = inbox.getByTestId("pr-inbox-options");
    await expect(matching).toBeVisible();
    await options.click();
    await page.getByTestId("pr-inbox-projects-only").click();
    await page.keyboard.press("Escape");
    await results.getByTestId("pr-inbox-load-more").click();
    await expect.poll(() => requests.some((entry) => entry.cursor === "next-page")).toBe(true);
    await expect(results.getByTestId("pr-inbox-load-more")).toHaveCount(0);
    await expect(matching).toBeVisible();
    await expect(unrelated).toHaveCount(0);

    await inbox.getByTestId("pr-inbox-open-tab").click();
    await inbox.getByTestId("pr-inbox-pr-reference").fill(SECOND.url);
    await inbox.getByTestId("pr-inbox-open-pr").click();
    await expect(
      inbox.getByTestId("pr-inbox-detail").getByRole("heading", {
        name: SECOND.title,
      }),
    ).toBeVisible();
  } finally {
    await project.cleanup();
  }
});

test("an explicit checkout uses the saved clone parent when no Project matches", async ({
  page,
}) => {
  const project = await seedWorkspace({
    repoPrefix: "inbox-auto-clone-",
    repo: { originUrl: `https://github.com/${FIRST.repository}.git` },
  });
  try {
    const { projects } = await project.client.listProjects();
    const descriptor = projects.find((item) => item.projectId === project.projectId);
    if (!descriptor) throw new Error("Fixture project is missing");
    const { clones, checkouts, agentLaunches } = await installInboxFixture(
      page,
      true,
      true,
      undefined,
      descriptor,
    );
    await gotoAppShell(page);
    await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
    const inbox = page.getByTestId("pr-inbox-screen");
    await inbox.getByTestId("pr-inbox-options").click();
    await page.getByTestId("pr-inbox-clone-directory").click();
    await page.getByTestId("pr-inbox-clone-directory-input").fill("~/work");
    await page.getByTestId("pr-inbox-clone-directory-save").click();
    await expect(page.getByTestId("pr-inbox-clone-directory-input")).toHaveCount(0);
    await page.reload();
    const row = inbox
      .getByTestId("pr-inbox-mine-results")
      .getByTestId("pr-inbox-result-row")
      .filter({ hasText: FIRST.title });
    await expect(row).toBeVisible();
    expect(clones).toEqual([]);
    await row.getByTestId("pr-inbox-checkout").click();
    await expectComposerEditable(page);
    await expect(composerLocator(page)).toHaveValue(/Review example\/app#12/);
    expect(clones).toEqual([
      expect.objectContaining({
        repo: FIRST.repository,
        targetDirectory: "~/work/example",
        reuseMatchingCheckout: true,
      }),
    ]);
    expect(checkouts).toEqual([
      expect.objectContaining({
        projectId: project.projectId,
        action: "checkout",
      }),
    ]);
    expect(agentLaunches).toEqual([]);
  } finally {
    await project.cleanup();
  }
});

test("checking out a PR opens an editable draft in a normal workspace without starting an agent", async ({
  page,
}) => {
  const project = await seedWorkspace({
    repoPrefix: "inbox-pr-draft-",
    repo: { originUrl: `https://github.com/${FIRST.repository}.git` },
  });
  try {
    const { checkouts, agentLaunches } = await installInboxFixture(page, true, true);
    await gotoAppShell(page);
    await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
    const row = page
      .getByTestId("pr-inbox-mine-results")
      .getByTestId("pr-inbox-result-row")
      .filter({
        hasText: FIRST.title,
      });
    await row.getByRole("button", { name: "Check out PR", exact: true }).click();
    await expect(page).toHaveURL(/\/workspace\/[^/?]+/);
    await expectComposerEditable(page);
    const composer = composerLocator(page);
    await expect(composer).toHaveValue(/Review example\/app#12 .* in this workspace\./);
    await composer.fill("Try this change without requesting a review.");
    await expect(composer).toHaveValue("Try this change without requesting a review.");
    expect(checkouts).toEqual([
      expect.objectContaining({
        projectId: project.projectId,
        action: "checkout",
        checkoutSource: {
          kind: "change_request",
          forge: "github",
          number: FIRST.number,
          projectPath: FIRST.repository,
        },
      }),
    ]);
    expect(agentLaunches).toEqual([]);
  } finally {
    await project.cleanup();
  }
});

test("a pending checkout does not pull the user away from Schedules", async ({ page }) => {
  const project = await seedWorkspace({
    repoPrefix: "inbox-pr-background-",
    repo: { originUrl: `https://github.com/${FIRST.repository}.git` },
  });
  try {
    const held = Promise.withResolvers<() => void>();
    await installInboxFixture(page, true, true, held.resolve);
    await gotoAppShell(page);
    const sidebarInbox = page.locator('[data-testid="sidebar-pull-requests"]:visible').first();
    await sidebarInbox.click();
    const checkout = page.getByTestId("pr-inbox-mine-results").getByTestId("pr-inbox-checkout");
    await checkout.click();
    const release = await held.promise;
    await page.locator('[data-testid="sidebar-schedules"]:visible').first().click();
    await expect(page).toHaveURL(/\/schedules(?:[/?]|$)/);
    // Return to the original route, not a new inbox pushed by the sidebar.
    await page.goBack();
    await expect(page).toHaveURL(`/h/${encodeURIComponent(getServerId())}/pull-requests`);
    await expect(checkout).toBeDisabled();
    release();
    await expect(checkout).toBeEnabled();
    await expect(page).toHaveURL(`/h/${encodeURIComponent(getServerId())}/pull-requests`);
  } finally {
    await project.cleanup();
  }
});

test("keeps the inbox accessible on an older daemon without sending a search", async ({ page }) => {
  const { requests } = await installInboxFixture(page, false);
  await gotoAppShell(page);
  await page.locator('[data-testid="sidebar-pull-requests"]:visible').first().click();
  await expect(page.getByTestId("pr-inbox-update-required")).toBeVisible();
  expect(requests).toEqual([]);
});
