import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceProjectDescriptorPayload } from "@getpaseo/protocol/messages";

export async function findPullRequestProject(client: DaemonClient, repository: string) {
  const path = repository.toLowerCase();
  const projects = await loadProjectMatches(client, path);
  return projects.get(path) ?? null;
}

export function loadPullRequestProjects(
  client: DaemonClient,
): Promise<ReadonlyMap<string, WorkspaceProjectDescriptorPayload>> {
  return loadProjectMatches(client);
}

async function loadProjectMatches(client: DaemonClient, targetRepository?: string) {
  const matches = new Map<string, WorkspaceProjectDescriptorPayload>();
  const { projects } = await client.listProjects();
  const gitProjects = projects.filter((project) => project.projectKind === "git");

  let failedPath: string | undefined;
  for (let start = 0; start < gitProjects.length; start += 8) {
    const batch = gitProjects.slice(start, start + 8);
    const results = await Promise.allSettled(
      batch.map((project) =>
        client.getCheckoutStatus(project.projectRootPath, { includeGithubRepositories: true }),
      ),
    );
    for (const [index, result] of results.entries()) {
      const project = batch[index];
      if (!project) continue;
      if (result.status === "rejected") {
        failedPath ??= project.projectRootPath;
        continue;
      }
      const { error, isGit, githubRepositories } = result.value;
      if (error?.code === "NOT_GIT_REPO" || (!error && !isGit)) continue;
      // An omitted remote list is not a confirmed absence of a matching remote.
      if (error || !githubRepositories) {
        failedPath ??= project.projectRootPath;
        continue;
      }
      for (const repository of githubRepositories) {
        const path = repository.toLowerCase();
        if (path === targetRepository) {
          matches.set(path, project);
          return matches;
        }
        if (targetRepository === undefined && !matches.has(path)) matches.set(path, project);
      }
    }
  }
  if (failedPath) {
    throw new Error(`Could not check GitHub remotes for ${failedPath}.`);
  }
  return matches;
}
