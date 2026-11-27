import { createRealpathAwarePathMatcher } from "../utils/path.js";
import {
  findPaseoWorktreeRootForCwd,
  readPaseoWorktreeMetadata,
  setPaseoWorktreeUntrustedSource,
  type WorktreeReview,
} from "../utils/worktree-metadata.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

export interface UntrustedWorkspaceSource {
  kind: "change_request";
  forge: string;
  number: number;
  headRepository: string;
  review?: true;
}

export function formatWorkspaceAutomationBlockedMessage(source: UntrustedWorkspaceSource): string {
  if (source.review) return `Setup and scripts are disabled for review of PR #${source.number}.`;
  const changeRequestNoun = source.forge === "gitlab" ? "MR" : "PR";
  return `Scripts are blocked for ${changeRequestNoun} #${source.number} from ${source.headRepository}. Run setup to allow them.`;
}

export class WorkspaceAutomationBlockedError extends Error {
  constructor(readonly source: UntrustedWorkspaceSource) {
    super(formatWorkspaceAutomationBlockedMessage(source));
    this.name = "WorkspaceAutomationBlockedError";
  }
}

export function assertWorkspaceAutomationAllowed(
  source: UntrustedWorkspaceSource | undefined,
): void {
  if (source) throw new WorkspaceAutomationBlockedError(source);
}

export async function readWorkspaceReviewSource(
  cwd: string,
): Promise<UntrustedWorkspaceSource | undefined> {
  const root = await findPaseoWorktreeRootForCwd(cwd);
  if (!root) return undefined;
  const metadata = await readPaseoWorktreeMetadata(root);
  return (
    workspaceReviewSource(metadata?.version === 2 ? metadata.review : undefined) ??
    (metadata?.untrustedSource?.review ? metadata.untrustedSource : undefined)
  );
}

export function workspaceReviewSource(
  review: WorktreeReview | undefined,
): UntrustedWorkspaceSource | undefined {
  if (!review) return undefined;
  return {
    kind: "change_request",
    forge: "github",
    number: review.number,
    headRepository: review.repository,
    review: true,
  };
}

export async function assertWorkspaceAutomationAllowedForWorkspace(
  registry: Pick<WorkspaceRegistry, "get">,
  workspaceId: string,
): Promise<void> {
  const workspace = await registry.get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  assertWorkspaceAutomationAllowed(
    workspace.untrustedSource ??
      (await readWorkspaceReviewSource(workspace.worktreeRoot ?? workspace.cwd)),
  );
}

export async function isCheckoutUntrusted(
  registry: Pick<WorkspaceRegistry, "listAll">,
  checkoutPath: string,
): Promise<boolean> {
  const matchesCheckout = createRealpathAwarePathMatcher(checkoutPath);
  const workspaces = await registry.listAll();
  return (
    workspaces.some(
      (workspace) =>
        Boolean(workspace.untrustedSource) &&
        matchesCheckout(workspace.worktreeRoot ?? workspace.cwd),
    ) || Boolean(await readWorkspaceReviewSource(checkoutPath))
  );
}

export async function clearWorkspaceAutomationBlock(
  registry: Pick<WorkspaceRegistry, "update" | "listAll">,
  workspaceId: string,
  options?: { checkoutPath?: string | null },
): Promise<boolean> {
  const allWorkspaces = await registry.listAll();
  const target = allWorkspaces.find((record) => record.workspaceId === workspaceId);
  if (!target) throw new Error(`Workspace not found: ${workspaceId}`);
  const targetPath = target.worktreeRoot ?? target.cwd;
  const checkoutPath = options?.checkoutPath ?? targetPath;
  const matchesCheckout = createRealpathAwarePathMatcher(checkoutPath);
  const blockedWorkspaces = allWorkspaces.filter(
    (record) =>
      record.untrustedSource &&
      (record.workspaceId === workspaceId || matchesCheckout(record.worktreeRoot ?? record.cwd)),
  );
  const reviewSetupError = "Setup is disabled for pull request review worktrees";
  if (
    blockedWorkspaces.some((record) => record.untrustedSource?.review) ||
    (await readWorkspaceReviewSource(checkoutPath)) ||
    (checkoutPath !== targetPath && (await readWorkspaceReviewSource(targetPath)))
  ) {
    throw new Error(reviewSetupError);
  }
  // Clear checkout metadata before mutating workspace records so a failed metadata
  // write surfaces an error and leaves workspace records intact to retry approval.
  let cleared = await setPaseoWorktreeUntrustedSource(checkoutPath, null);
  const timestamp = new Date().toISOString();
  for (const candidate of blockedWorkspaces) {
    await registry.update(candidate.workspaceId, (record) => {
      if (record.untrustedSource?.review) throw new Error(reviewSetupError);
      if (!record.untrustedSource) return record;
      cleared = true;
      const { untrustedSource: _removed, ...trusted } = record;
      return { ...trusted, updatedAt: timestamp };
    });
  }
  return cleared;
}
