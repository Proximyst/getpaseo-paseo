import {
  forgeWebHost,
  parseGitHubRemoteIdentity,
  parseGitRemoteLocation,
} from "@getpaseo/protocol/git-remote";
import { runGitCommand } from "./run-git-command.js";

export async function listGitHubFetchRemotes(
  cwd: string,
  host = "github.com",
): Promise<Array<{ name: string; repository: string }>> {
  const names = await runGitCommand(["remote"], { cwd });
  if (names.truncated) throw new Error("Git remote list was truncated");
  const webHost = forgeWebHost("github", host);
  const remotes = await Promise.all(
    names.stdout
      .split("\n")
      .filter(Boolean)
      .map(async (name) => {
        // Ask Git for the first effective fetch URL, not the raw config or push URL.
        // Read each separately: a config value can contain newlines and tabs.
        const { stdout, truncated } = await runGitCommand(["remote", "get-url", "--", name], {
          cwd,
        });
        const url = stdout.replace(/\r?\n$/, "");
        if (truncated || /[\r\n\t]/.test(url)) return null;
        const location = parseGitRemoteLocation(url);
        const identity =
          location && forgeWebHost("github", location.host) === webHost
            ? parseGitHubRemoteIdentity(location.path)
            : null;
        return identity ? { name, repository: identity.repo.toLowerCase() } : null;
      }),
  );
  return remotes.filter((remote) => remote !== null);
}
