import type {
  GithubInboxPullRequest,
  GithubInboxPullRequestActivity,
  GithubInboxPullRequestFile,
  GithubPullRequestInboxDetailResponse,
  GithubPullRequestInboxSearchResponse,
} from "@getpaseo/protocol/messages";
import { z } from "zod";

const summaryFields = `
  number title url updatedAt state isDraft headRefOid baseRefOid baseRefName headRefName body
  additions deletions
  reviewDecision mergeStateStatus totalCommentsCount
  repository { nameWithOwner }
  author { login }
  latestOpinionatedReviews(first: 30) { pageInfo { hasNextPage } nodes { state } }
`;
const checkCountFields = `
  totalCount
  checkRunCountsByState { state count }
  statusContextCountsByState { state count }
`;

const SEARCH_DOCUMENT = `query Inbox($search: String!, $cursor: String) {
  search(type: ISSUE_ADVANCED, query: $search, first: 20, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        ${summaryFields}
        reviewThreads(first: 50) { pageInfo { hasNextPage } nodes { isResolved } }
        statusCheckRollup {
          contexts(first: 1) {
            ${checkCountFields}
          }
        }
      }
    }
  }
}`;

const activityFields = `id body url createdAt author { login ... on Node { id } }`;
const detailDocument = `query InboxPullRequest($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${summaryFields}
      changedFiles
      summaryThreads: reviewThreads(first: 50) { pageInfo { hasNextPage } nodes { isResolved } }
      comments(last: 30) { pageInfo { hasPreviousPage } nodes { ${activityFields} } }
      reviews(last: 30, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
        pageInfo { hasPreviousPage }
        nodes { ${activityFields} submittedAt commit { oid } }
      }
      reviewThreads(last: 30) {
        pageInfo { hasPreviousPage }
        nodes {
          path line originalLine isResolved isOutdated
          comments(first: 5) {
            pageInfo { hasNextPage }
            nodes { ${activityFields} commit { oid } originalCommit { oid } publishedAt }
          }
        }
      }
      statusCheckRollup {
        contexts(first: 100) {
          ${checkCountFields}
          pageInfo { hasNextPage }
          nodes {
            __typename
            ... on CheckRun { id name conclusion status detailsUrl url }
            ... on StatusContext { id context state targetUrl }
          }
        }
      }
    }
  }
}`;
const REVISION_DOCUMENT = `query InboxPullRequestRevision($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { headRefOid baseRefOid changedFiles }
  }
}`;

const countSchema = z.number().int().nonnegative();
const statusCountsSchema = z.array(z.object({ state: z.string(), count: countSchema })).nullable();
const nextPageSchema = z.object({ hasNextPage: z.boolean() });
const previousPageSchema = z.object({ hasPreviousPage: z.boolean() });
const searchNodeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  updatedAt: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  headRefOid: z.string(),
  baseRefOid: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  body: z.string(),
  additions: countSchema.nullish(),
  deletions: countSchema.nullish(),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
  mergeStateStatus: z.string().nullable(),
  totalCommentsCount: countSchema.nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  author: z.object({ login: z.string() }).nullable(),
  latestOpinionatedReviews: z
    .object({
      pageInfo: nextPageSchema,
      nodes: z.array(z.object({ state: z.string() }).nullable()).nullable(),
    })
    .nullable(),
  reviewThreads: z.object({
    pageInfo: nextPageSchema,
    nodes: z.array(z.object({ isResolved: z.boolean() }).nullable()).nullable(),
  }),
  statusCheckRollup: z
    .object({
      contexts: z.object({
        totalCount: countSchema,
        checkRunCountsByState: statusCountsSchema,
        statusContextCountsByState: statusCountsSchema,
      }),
    })
    .nullable(),
});
const searchDataSchema = z.object({
  search: z.object({
    pageInfo: nextPageSchema.extend({ endCursor: z.string().nullable() }),
    nodes: z.array(z.unknown()).nullable(),
  }),
});

const revisionSchema = z.object({
  headRefOid: z.string(),
  baseRefOid: z.string(),
  changedFiles: countSchema,
});
const activitySchema = z.object({
  id: z.string(),
  body: z.string(),
  url: z.string(),
  createdAt: z.string(),
  author: z.object({ login: z.string(), id: z.string().optional() }).nullable(),
});
const oidSchema = z.object({ oid: z.string() }).nullable();
const reviewSchema = activitySchema.extend({
  submittedAt: z.string().nullable(),
  commit: oidSchema,
});
const threadCommentSchema = activitySchema.extend({
  commit: oidSchema,
  originalCommit: oidSchema,
  publishedAt: z.string().nullable(),
});
const threadSchema = z.object({
  path: z.string(),
  line: z.number().int().nullable(),
  originalLine: z.number().int().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  comments: z.object({
    pageInfo: nextPageSchema,
    nodes: z.array(threadCommentSchema.nullable()).nullable(),
  }),
});
const checkSchema = z.discriminatedUnion("__typename", [
  z.object({
    __typename: z.literal("CheckRun"),
    id: z.string(),
    name: z.string(),
    conclusion: z.string().nullable(),
    status: z.string(),
    detailsUrl: z.string().nullable(),
    url: z.string(),
  }),
  z.object({
    __typename: z.literal("StatusContext"),
    id: z.string(),
    context: z.string(),
    state: z.string(),
    targetUrl: z.string().nullable(),
  }),
]);
const detailSchema = searchNodeSchema
  .omit({ reviewThreads: true, statusCheckRollup: true })
  .extend({
    changedFiles: countSchema,
    summaryThreads: searchNodeSchema.shape.reviewThreads,
    comments: z.object({
      pageInfo: previousPageSchema,
      nodes: z.array(activitySchema.nullable()).nullable(),
    }),
    reviews: z
      .object({
        pageInfo: previousPageSchema,
        nodes: z.array(reviewSchema.nullable()).nullable(),
      })
      .nullable(),
    reviewThreads: z.object({
      pageInfo: previousPageSchema,
      nodes: z.array(threadSchema.nullable()).nullable(),
    }),
    statusCheckRollup: z
      .object({
        contexts: z.object({
          ...searchNodeSchema.shape.statusCheckRollup.unwrap().shape.contexts.shape,
          pageInfo: nextPageSchema,
          nodes: z.array(checkSchema.nullable()).nullable(),
        }),
      })
      .nullable(),
  });
const fileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  additions: countSchema,
  deletions: countSchema,
  patch: z.string().nullish(),
});

const graphqlResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        type: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional(),
});

const detailDataSchema = z.object({
  repository: z.object({ pullRequest: detailSchema.nullable() }).nullable(),
});
const revisionDataSchema = z.object({
  repository: z.object({ pullRequest: revisionSchema.nullable() }).nullable(),
});
const filesResponseSchema = z.array(fileSchema);

type InboxApi = (args: string[]) => Promise<string | { stdout: string; error: Error }>;
type SearchNode = z.infer<typeof searchNodeSchema>;
type Detail = z.infer<typeof detailSchema>;

type SearchResult = Omit<GithubPullRequestInboxSearchResponse["payload"], "requestId" | "error">;
type DetailResult = Omit<GithubPullRequestInboxDetailResponse["payload"], "requestId" | "error">;

export interface GitHubInboxService {
  searchInboxPullRequests(input: { query: string; cursor?: string }): Promise<SearchResult>;
  getInboxPullRequest(input: { repository: string; number: number }): Promise<DetailResult>;
}

function readJson<T>(stdout: string, schema: z.ZodType<T>, commandError?: Error): T {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw commandError ?? new Error("GitHub did not return valid JSON for the pull request inbox.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw (
      commandError ??
      new Error("GitHub returned an unexpected response for the pull request inbox.")
    );
  }
  return parsed.data;
}

async function graphql<T>(run: InboxApi, document: string, fields: string[], schema: z.ZodType<T>) {
  const result = await run(["graphql", "-f", `query=${document}`, ...fields]);
  const commandError = typeof result === "string" ? undefined : result.error;
  const response = readJson(
    typeof result === "string" ? result : result.stdout,
    graphqlResponseSchema,
    commandError,
  );
  if (commandError && (!response.data || !response.errors?.length)) throw commandError;
  let checksUnavailable = false;
  for (const error of response.errors ?? []) {
    // A fine-grained token may read PRs but not their checks. Keep those PRs,
    // without pretending the token saw a clean build or an empty check list.
    if (error.type === "FORBIDDEN" && error.path?.includes("statusCheckRollup")) {
      checksUnavailable = true;
    } else {
      throw new Error(error.message);
    }
  }
  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    throw new Error("GitHub returned an incomplete response for the pull request inbox.");
  }
  return { data: parsed.data, checksUnavailable };
}

function countMatching<T>(
  connection: { pageInfo: { hasNextPage: boolean }; nodes: Array<T | null> | null } | null,
  predicate: (node: T) => boolean,
): number | null {
  if (!connection?.nodes || connection.pageInfo.hasNextPage) return null;
  let count = 0;
  for (const node of connection.nodes) {
    if (node === null) return null;
    if (predicate(node)) count++;
  }
  return count;
}

function summarizeChecks(
  rollup: SearchNode["statusCheckRollup"],
): GithubInboxPullRequest["checks"] {
  if (!rollup) return null;
  const { totalCount, checkRunCountsByState, statusContextCountsByState } = rollup.contexts;
  const counts = { passed: 0, failed: 0, pending: 0, other: 0 };
  for (const states of [checkRunCountsByState, statusContextCountsByState]) {
    for (const { state, count } of states ?? []) {
      switch (state) {
        case "SUCCESS":
          counts.passed += count;
          break;
        case "FAILURE":
        case "ERROR":
        case "ACTION_REQUIRED":
        case "TIMED_OUT":
        case "STARTUP_FAILURE":
          counts.failed += count;
          break;
        case "EXPECTED":
        case "IN_PROGRESS":
        case "PENDING":
        case "QUEUED":
        case "REQUESTED":
        case "WAITING":
          counts.pending += count;
          break;
        default:
          counts.other += count;
      }
    }
  }
  return counts.passed + counts.failed + counts.pending + counts.other === totalCount
    ? counts
    : null;
}

function normalizePullRequest(pr: SearchNode): GithubInboxPullRequest {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repository: pr.repository.nameWithOwner,
    author: pr.author?.login ?? null,
    updatedAt: pr.updatedAt,
    state: pr.state,
    isDraft: pr.isDraft,
    headSha: pr.headRefOid,
    baseSha: pr.baseRefOid,
    baseRef: pr.baseRefName,
    headRef: pr.headRefName,
    body: pr.body,
    ...(pr.additions != null ? { additions: pr.additions } : {}),
    ...(pr.deletions != null ? { deletions: pr.deletions } : {}),
    reviewDecision: pr.reviewDecision,
    mergeStateStatus: pr.mergeStateStatus,
    checks: summarizeChecks(pr.statusCheckRollup),
    approvals: countMatching(pr.latestOpinionatedReviews, (review) => review.state === "APPROVED"),
    comments: pr.totalCommentsCount,
    unresolvedThreads: countMatching(pr.reviewThreads, (thread) => !thread.isResolved),
  };
}

function activityItem(item: z.infer<typeof activitySchema>): GithubInboxPullRequestActivity {
  return {
    id: item.id,
    kind: "comment",
    author: item.author?.login ?? null,
    authorId: item.author?.id ?? null,
    body: item.body,
    url: item.url,
    createdAt: item.createdAt,
    headSha: null,
    path: null,
    line: null,
    resolved: null,
    outdated: null,
  };
}

function normalizeActivity(pr: Detail): GithubInboxPullRequestActivity[] {
  const activity: GithubInboxPullRequestActivity[] = [];
  for (const comment of pr.comments.nodes ?? []) {
    if (comment) activity.push(activityItem(comment));
  }
  for (const review of pr.reviews?.nodes ?? []) {
    if (!review) continue;
    const item = activityItem(review);
    item.kind = "review";
    item.createdAt = review.submittedAt ?? review.createdAt;
    item.headSha = review.commit?.oid ?? null;
    activity.push(item);
  }
  appendThreadActivity(pr.reviewThreads, activity);
  return activity.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function appendThreadActivity(
  threads: Detail["reviewThreads"],
  activity: GithubInboxPullRequestActivity[],
): void {
  for (const thread of threads.nodes ?? []) {
    if (!thread) continue;
    for (const comment of thread.comments.nodes ?? []) {
      if (!comment?.publishedAt) continue;
      const item = activityItem(comment);
      item.headSha = (thread.isOutdated ? comment.originalCommit : comment.commit)?.oid ?? null;
      item.path = thread.path;
      item.line = thread.isOutdated ? thread.originalLine : thread.line;
      item.resolved = thread.isResolved;
      item.outdated = thread.isOutdated;
      activity.push(item);
    }
  }
}

function allNodesPresent(nodes: unknown[] | null): boolean {
  return nodes !== null && nodes.every((node) => node !== null);
}

function isActivityComplete(pr: Detail): boolean {
  const { comments, reviews, reviewThreads } = pr;
  return (
    !comments.pageInfo.hasPreviousPage &&
    allNodesPresent(comments.nodes) &&
    !!reviews &&
    !reviews.pageInfo.hasPreviousPage &&
    allNodesPresent(reviews.nodes) &&
    !reviewThreads.pageInfo.hasPreviousPage &&
    (reviewThreads.nodes?.every(
      (thread) =>
        thread !== null &&
        !thread.comments.pageInfo.hasNextPage &&
        allNodesPresent(thread.comments.nodes),
    ) ??
      false)
  );
}

function hasFullPatch(file: GithubInboxPullRequestFile): boolean {
  let { additions, deletions } = file;
  const patch = file.patch ?? "";
  // REST omits or truncates patches for some large files. Count actual changed
  // lines so consumers never receive a truncated textual patch marked complete.
  for (let offset = 0; offset < patch.length; ) {
    if (patch[offset] === "+") additions--;
    else if (patch[offset] === "-") deletions--;
    const newline = patch.indexOf("\n", offset);
    if (newline === -1) break;
    offset = newline + 1;
  }
  return additions === 0 && deletions === 0;
}

function safeCheckUrl(url: string | null): string | null {
  if (url === null || !/^https?:\/\//i.test(url) || !URL.canParse(url)) return null;
  return url;
}

async function readRevisionFiles(
  run: InboxApi,
  path: string,
  fields: string[],
  pr: z.infer<typeof revisionSchema>,
): Promise<GithubInboxPullRequestFile[]> {
  if (pr.changedFiles === 0) return [];
  // GitHub's PR diff follows its own base and merge history, so fetch the
  // canonical patch rather than diffing live branch names or a local clone.
  const stdout = await run([path]);
  if (typeof stdout !== "string") throw stdout.error;
  const files = readJson(stdout, filesResponseSchema);
  const { data: current } = await graphql(run, REVISION_DOCUMENT, fields, revisionDataSchema);
  const revision = current.repository?.pullRequest;
  if (
    !revision ||
    revision.headRefOid !== pr.headRefOid ||
    revision.baseRefOid !== pr.baseRefOid ||
    revision.changedFiles !== pr.changedFiles
  ) {
    throw new Error(
      "The pull request revision changed while reading its diff. Refresh and try again.",
    );
  }
  return files.map((file) => ({
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch ?? null,
  }));
}

export function createGitHubInbox(run: InboxApi): GitHubInboxService {
  return {
    async searchInboxPullRequests(input) {
      // Keep the user's GitHub syntax intact inside the PR-only scope. Bind
      // both the raw search and cursor as data, never interpolated GraphQL.
      const fields = ["-f", `search=is:pr AND (${input.query})`];
      if (input.cursor !== undefined) fields.push("-f", `cursor=${input.cursor}`);
      const { data } = await graphql(run, SEARCH_DOCUMENT, fields, searchDataSchema);
      const { pageInfo, nodes } = data.search;
      if (!nodes || (pageInfo.hasNextPage && !pageInfo.endCursor)) {
        throw new Error("GitHub returned an incomplete pull request search page.");
      }
      const items: GithubInboxPullRequest[] = [];
      for (const node of nodes) {
        if (
          !node ||
          typeof node !== "object" ||
          !("__typename" in node) ||
          node.__typename !== "PullRequest"
        ) {
          continue;
        }
        const pr = searchNodeSchema.safeParse(node);
        if (!pr.success)
          throw new Error("GitHub returned an incomplete pull request search result.");
        items.push(normalizePullRequest(pr.data));
      }
      return { items, nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null };
    },

    async getInboxPullRequest(input) {
      const [owner, repo] = input.repository.split("/");
      const fields = ["-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `number=${input.number}`];
      const { data, checksUnavailable } = await graphql(
        run,
        detailDocument,
        fields,
        detailDataSchema,
      );
      const pr = data.repository?.pullRequest;
      if (!pr)
        throw new Error("Pull request not found or not visible to the host's GitHub account.");
      const context = pr.statusCheckRollup?.contexts;
      const checks: DetailResult["checks"] = [];
      for (const check of context?.nodes ?? []) {
        if (!check) continue;
        const url =
          check.__typename === "CheckRun"
            ? (safeCheckUrl(check.detailsUrl) ?? safeCheckUrl(check.url))
            : safeCheckUrl(check.targetUrl);
        checks.push(
          check.__typename === "CheckRun"
            ? { id: check.id, name: check.name, state: check.conclusion ?? check.status, url }
            : { id: check.id, name: check.context, state: check.state, url },
        );
      }

      const path = `repos/${input.repository}/pulls/${input.number}/files?per_page=100`;
      const files = await readRevisionFiles(run, path, fields, pr);

      return {
        pullRequest: normalizePullRequest({ ...pr, reviewThreads: pr.summaryThreads }),
        headSha: pr.headRefOid,
        baseSha: pr.baseRefOid,
        activity: normalizeActivity(pr),
        files,
        checks,
        complete:
          isActivityComplete(pr) &&
          !checksUnavailable &&
          (!context || (!context.pageInfo.hasNextPage && allNodesPresent(context.nodes))) &&
          files.length === pr.changedFiles &&
          files.every(hasFullPatch),
      };
    },
  };
}
