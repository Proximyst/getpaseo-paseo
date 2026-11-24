import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./is-main-module.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function usageAndExit(code = 0) {
  process.stderr.write(
    `Usage: node scripts/push-current-release-tag.mjs [--branch <name>] [--check]\n`,
  );
  process.exit(code);
}

function defaultRun(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

function defaultRunQuiet(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
}

function getLocalTagCommit(tag, runQuiet) {
  try {
    return runQuiet("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
  } catch (error) {
    if (error.status !== 1) throw error;
    return "";
  }
}

function getRemoteRefCommit(ref, runQuiet) {
  return runQuiet("git", ["ls-remote", "fork", ref]).split(/\s+/)[0];
}

export function getRemoteTagCommit(tag, runQuiet) {
  // Do not pass --refs: it suppresses the peeled `^{}` commit entry for annotated tags.
  return (
    getRemoteRefCommit(`refs/tags/${tag}^{}`, runQuiet) ||
    getRemoteRefCommit(`refs/tags/${tag}`, runQuiet)
  );
}

export function assertReleaseBranch(branchRef) {
  const trimmed = typeof branchRef === "string" ? branchRef.trim() : "";
  if (!trimmed || !trimmed.startsWith("release/") || trimmed === "release/") {
    throw new Error(
      `Refusing to push release from branch "${trimmed || "<detached>"}". ` +
        "Releases must be cut from a release/* branch (for example release/vX.Y.Z or release/vX.Y.Z-beta.N).",
    );
  }
  return trimmed;
}

function parseArgs(argv) {
  const args = {
    branch: "",
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") {
      args.branch = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--check") {
      args.check = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usageAndExit(0);
    }
    usageAndExit(1);
  }

  return args;
}

export function pushCurrentReleaseTag(argv = process.argv.slice(2), deps = {}) {
  const cwd = deps.cwd ?? rootDir;
  const run = deps.run ?? ((cmd, args) => defaultRun(cmd, args, cwd));
  const runQuiet = deps.runQuiet ?? ((cmd, args) => defaultRunQuiet(cmd, args, cwd));

  const args = parseArgs(argv);
  const rootPackagePath = path.join(cwd, "package.json");
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  const version = typeof rootPackage.version === "string" ? rootPackage.version.trim() : "";
  if (!version) {
    throw new Error('Root package.json must contain a valid "version"');
  }

  const dirty = runQuiet("git", ["status", "--porcelain"]);
  if (dirty) {
    throw new Error(
      "Git working directory is not clean. Commit and verify changes on the release branch before shipping.",
    );
  }

  const currentBranch = runQuiet("git", ["branch", "--show-current"]);
  const branchRef = assertReleaseBranch(args.branch || currentBranch);
  const headCommit = runQuiet("git", ["rev-parse", "HEAD"]);

  // Require the checked-out commit to match the branch verified by CI and Desktop Packages.
  const remoteBranchCommit = getRemoteRefCommit(`refs/heads/${branchRef}`, runQuiet);
  if (remoteBranchCommit !== headCommit) {
    throw new Error(
      `HEAD (${headCommit.slice(0, 9)}) does not match fork/${branchRef} (${remoteBranchCommit ? remoteBranchCommit.slice(0, 9) : "not pushed"}). ` +
        `Push ${branchRef} and confirm CI and Desktop Packages pass before shipping.`,
    );
  }

  const tag = `v${version}`;
  const localTagCommit = getLocalTagCommit(tag, runQuiet);

  if (localTagCommit && localTagCommit !== headCommit) {
    throw new Error(`Local tag ${tag} points to ${localTagCommit}, but HEAD is ${headCommit}.`);
  }

  const remoteTagCommit = getRemoteTagCommit(tag, runQuiet);
  if (remoteTagCommit && remoteTagCommit !== headCommit) {
    throw new Error(
      `Tag ${tag} on fork points to ${remoteTagCommit}, but HEAD is ${headCommit}. ` +
        "Refusing to reuse an existing release tag for a different commit.",
    );
  }

  if (args.check) {
    return { branchRef, headCommit, tag };
  }

  if (remoteTagCommit) {
    console.log(`Tag ${tag} already exists on fork at ${headCommit.slice(0, 9)}`);
  } else {
    if (!localTagCommit) {
      run("git", ["tag", "-a", tag, "-m", tag]);
    }
    run("git", ["push", "fork", `refs/tags/${tag}`]);
  }

  console.log(`Release push complete: branch ${branchRef} and tag ${tag}`);
  return { branchRef, headCommit, tag };
}

if (isMainModule(import.meta.url)) {
  pushCurrentReleaseTag();
}
