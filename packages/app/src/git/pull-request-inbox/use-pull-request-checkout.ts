import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { GithubInboxPullRequest } from "@getpaseo/protocol/messages";
import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useRef, useState } from "react";
import { joinDirectoryPath } from "@/add-project-flow/options";
import { registerProjectDescriptor } from "@/hooks/open-project";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { buildReviewPrompt, getReviewRepository } from "./review-model";
import { findPullRequestProject } from "./review-workspaces";

export function usePullRequestCheckout({
  hostId,
  client,
  cloneDirectory,
  canAutoClone,
}: {
  hostId: string;
  client: DaemonClient | null;
  cloneDirectory: string | undefined;
  canAutoClone: boolean;
}) {
  const activeKey = useRef<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const focusLease = useRef<{ client: DaemonClient | null; hostId: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      focusLease.current = { client, hostId };
      return () => {
        focusLease.current = null;
      };
    }, [client, hostId]),
  );

  const checkout = useCallback(
    async (item: GithubInboxPullRequest) => {
      if (activeKey.current !== null) return;
      const lease = focusLease.current;
      if (!lease || lease.client !== client || lease.hostId !== hostId) return;
      const key = item.url;
      activeKey.current = key;
      setPendingKey(key);
      setError(null);
      try {
        if (!client) throw new Error("Connect to the host to check out this pull request.");
        const repository = getReviewRepository(item);
        if (!repository) throw new Error("This pull request does not have a valid GitHub URL.");
        let project = await findPullRequestProject(client, repository);
        if (!project) {
          const directory = cloneDirectory?.trim();
          if (!canAutoClone || !directory) {
            throw new Error(
              `Add ${repository} as a Project on this host before checking out its pull requests.`,
            );
          }
          const owner = repository.slice(0, repository.indexOf("/"));
          const result = await client.cloneGithubProject({
            repo: repository,
            targetDirectory: joinDirectoryPath(directory, owner),
            reuseMatchingCheckout: true,
          });
          if (result.error || !result.project) {
            throw new Error(result.error ?? `The host did not return a project for ${repository}.`);
          }
          const registered = registerProjectDescriptor({
            serverId: hostId,
            project: result.project,
            upsertProject: (serverId, descriptor) =>
              getHostRuntimeStore().acceptProjectSnapshot(serverId, descriptor),
            setHasHydratedWorkspaces: useSessionStore.getState().setHasHydratedWorkspaces,
          });
          if (!registered) throw new Error(`Unable to register ${repository} as a Project.`);
          project = result.project;
        }
        const result = await client.createPaseoWorktree({
          cwd: project.projectRootPath,
          projectId: project.projectId,
          action: "checkout",
          checkoutSource: {
            kind: "change_request",
            forge: "github",
            number: item.number,
            projectPath: repository,
          },
        });
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The host did not return the new workspace.");
        }
        const workspace = normalizeWorkspaceDescriptor(result.workspace);
        getHostRuntimeStore().acceptWorkspaceSnapshots(hostId, [workspace]);
        if (focusLease.current !== lease) return;

        const draftId = generateDraftId();
        useDraftStore.getState().saveDraftInput({
          draftKey: buildDraftStoreKey({ serverId: hostId, agentId: draftId, draftId }),
          draft: { text: buildReviewPrompt(item), attachments: [] },
        });
        navigateToWorkspace({
          serverId: hostId,
          workspaceId: workspace.id,
          target: {
            kind: "draft",
            draftId,
            setup: {
              provider: "omp",
              cwd: workspace.workspaceDirectory,
              modeId: null,
              model: null,
              thinkingOptionId: null,
              providerOptions: {},
            },
          },
        });
      } catch (cause) {
        setError({ key, message: toErrorMessage(cause) });
      } finally {
        activeKey.current = null;
        setPendingKey(null);
      }
    },
    [canAutoClone, client, cloneDirectory, hostId],
  );

  return { checkout, pendingKey, error };
}
