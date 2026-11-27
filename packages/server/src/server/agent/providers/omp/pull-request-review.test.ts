import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { writePaseoWorktreeMetadata } from "../../../../utils/worktree-metadata.js";
import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { OmpAgentClient } from "./agent.js";
import { ompReviewCwd } from "./pull-request-review.js";
import { FakeOmp } from "./test-utils/fake-omp.js";

async function withReviewFixture(
  run: (fixture: {
    config: AgentSessionConfig;
    worktree: string;
    hostAgent: string;
  }) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "paseo-omp-review-")));
  const worktree = join(root, "worktree");
  const cwd = join(worktree, "project");
  const home = join(root, "home");
  const hostAgent = join(home, ".omp", "agent");
  vi.stubEnv("PASEO_HOME", join(root, "paseo"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", undefined);
  vi.stubEnv("PI_CONFIG_DIR", undefined);
  vi.stubEnv("OMP_PROFILE", "");
  vi.stubEnv("XDG_DATA_HOME", undefined);
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(hostAgent, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", `core.hooksPath=${join(root, "no-hooks")}`, ...args], {
        cwd: worktree,
        encoding: "utf8",
      }).trim();
    git("init", "--quiet");
    git("config", "user.name", "Review Test");
    git("config", "user.email", "test@example.invalid");
    await writeFile(join(cwd, "source.txt"), "base version\n");
    git("add", "project/source.txt");
    git("commit", "--quiet", "-m", "base");
    const baseSha = git("rev-parse", "HEAD");
    await writeFile(join(cwd, "source.txt"), "committed review content\n");
    git("add", "project/source.txt");
    git("commit", "--quiet", "-m", "review");
    const headSha = git("rev-parse", "HEAD");
    await writePaseoWorktreeMetadata(worktree, {
      baseRefName: "main",
      review: { repository: "owner/repo", number: 12, baseSha, headSha },
    });
    await writeFile(join(cwd, "source.txt"), "unreviewed dirty content\n");
    await writeFile(join(worktree, "AGENTS.md"), "Checkout instructions");
    await mkdir(join(worktree, ".omp"));
    await writeFile(join(worktree, ".omp", "config.yml"), "extensions: [untrusted-extension.ts]");
    await run({
      config: {
        provider: "omp",
        cwd,
        launchProfile: "pull-request-review",
        reviewHeadSha: headSha,
        reviewBaseSha: baseSha,
      },
      worktree,
      hostAgent,
    });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
}

test("OMP review is isolated on open and resume and serves only pinned Git objects", () =>
  withReviewFixture(async ({ config, worktree, hostAgent }) => {
    await writeFile(
      join(hostAgent, "config.yml"),
      [
        "modelRoles:",
        "  default: acme/test-model",
        "extensions: [do-not-copy.ts]",
        "tools:",
        "  xdev: true",
      ].join("\n"),
    );
    await writeFile(join(hostAgent, "models.yml"), "providers: {}\n");
    await writeFile(join(hostAgent, "agent.db"), "auth DB fixture");
    await writeFile(join(hostAgent, "mcp.json"), "do not copy MCP config");
    vi.stubEnv("OMP_AUTH_BROKER_TOKEN", "daemon-auth-env");
    vi.stubEnv("PI_CONFIG_FILES", join(worktree, ".omp", "config.yml"));
    const runtimeCwd = ompReviewCwd();
    const nativeHandle = join(runtimeCwd, "sessions", "review.jsonl");
    const runtime = new FakeOmp();
    runtime.queueSessionSetup((session) => {
      session.state.sessionFile = nativeHandle;
    });
    const client = new OmpAgentClient({ runtime, logger: createTestLogger() });
    const session = await client.createSession(
      {
        ...config,
        modeId: "full",
        systemPrompt: "Do not use this prompt",
        daemonAppendSystemPrompt: "Do not use the daemon prompt",
        pluginAppendSystemPrompt: ["Do not use these instructions"],
        providerOptions: { fast_mode: true },
      },
      { env: { OMP_AUTH_BROKER_TOKEN: "launch-token", PI_CODING_AGENT_DIR: worktree } },
    );
    const firstLaunch = runtime.recordedLaunches[0];
    const fakeSession = runtime.latestSession();
    const handle = session.describePersistence()!;
    try {
      expect(firstLaunch.cwd).toBe(runtimeCwd);
      expect(firstLaunch.argv).toEqual([
        "omp",
        "--mode",
        "rpc",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-rules",
        "--no-context-files",
        "--no-lsp",
        "--no-pty",
        "--no-title",
        "--no-prewalk",
        "--offline",
        "--session-dir",
        join(runtimeCwd, "sessions"),
        "--system-prompt",
        expect.stringContaining("only output is review findings"),
      ]);
      expect(firstLaunch.systemPrompt).not.toContain("Do not use");
      expect(firstLaunch.env).toMatchObject({
        PWD: runtimeCwd,
        OMP_AUTH_BROKER_TOKEN: "daemon-auth-env",
      });
      expect(firstLaunch.env).not.toHaveProperty("PI_CONFIG_FILES");
      expect(firstLaunch.env?.HOME).not.toBe(process.env.HOME);
      const reviewAgentDir = firstLaunch.env?.PI_CODING_AGENT_DIR;
      if (!reviewAgentDir) throw new Error("Expected an isolated agent directory");
      const settings = JSON.parse(await readFile(join(reviewAgentDir, "config.yml"), "utf8"));
      expect(settings).toMatchObject({
        modelRoles: { default: "acme/test-model" },
        tools: { xdev: false },
      });
      expect(settings).not.toHaveProperty("extensions");
      expect(await realpath(join(reviewAgentDir, "agent.db"))).toBe(join(hostAgent, "agent.db"));
      expect(await realpath(join(reviewAgentDir, "models.yml"))).toBe(
        join(hostAgent, "models.yml"),
      );
      await expect(readFile(join(reviewAgentDir, "mcp.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await session.getAvailableModes()).toMatchObject([{ id: "findings-only" }]);
      expect(await session.listCommands?.()).toEqual([]);
      await expect(session.setMode?.("full")).rejects.toThrow("findings-only");
      await expect(session.startTurn("  /reload")).rejects.toThrow("Slash commands");
      expect(fakeSession.prompts).toEqual([]);
      expect(
        fakeSession.hostToolSetRequests[0].map(({ name, loadMode }) => ({ name, loadMode })),
      ).toEqual(
        ["changed_files", "read_diff", "read_file", "list_directory"].map((name) => ({
          name,
          loadMode: "essential",
        })),
      );
      const tool = async (toolName: string, args: Record<string, unknown>) => {
        const result = fakeSession.nextHostToolResult();
        fakeSession.emit({
          type: "host_tool_call",
          id: toolName,
          toolCallId: toolName,
          toolName,
          arguments: args,
        });
        return result;
      };
      await expect(tool("changed_files", {})).resolves.toMatchObject({
        result: { content: [{ text: expect.stringContaining("project/source.txt") }] },
      });
      await expect(tool("read_diff", { path: "project/source.txt" })).resolves.toMatchObject({
        result: { content: [{ text: expect.stringContaining("+committed review content") }] },
      });
      await expect(tool("read_file", { path: "project/source.txt" })).resolves.toMatchObject({
        result: { content: [{ text: "1: committed review content" }] },
      });
      await expect(
        tool("read_file", { path: "project/source.txt", revision: "base" }),
      ).resolves.toMatchObject({
        result: { content: [{ text: "1: base version" }] },
      });
      await expect(tool("list_directory", { path: "project" })).resolves.toMatchObject({
        result: { content: [{ text: "1: source.txt" }] },
      });
      for (const [name, args] of [
        ["read_file", { path: "AGENTS.md" }],
        ["read_file", { path: "../source.txt" }],
        ["read_file", { path: "project/source.txt", revision: "HEAD" }],
        ["bash", { command: "pwd" }],
        ["create_agent", {}],
      ] as const) {
        await expect(tool(name, args)).resolves.toMatchObject({ isError: true });
      }
      expect(handle.metadata).toMatchObject({
        cwd: config.cwd,
        launchProfile: "pull-request-review",
        reviewHeadSha: config.reviewHeadSha,
        reviewBaseSha: config.reviewBaseSha,
      });
    } finally {
      await session.close();
    }

    const writeHeader = (cwd: string) =>
      writeFile(
        nativeHandle,
        `${JSON.stringify({ type: "session", id: handle.sessionId, cwd })}\n`,
      );
    await writeHeader(runtimeCwd);
    await expect(client.resumeSession({ ...handle, metadata: { cwd: worktree } })).rejects.toThrow(
      "original isolated review agent",
    );
    await writeHeader(worktree);
    await expect(client.resumeSession(handle)).rejects.toThrow("original isolated session file");
    await writeHeader(runtimeCwd);
    await rename(join(hostAgent, "models.yml"), join(hostAgent, "models.yaml"));
    runtime.queueSessionSetup((runtimeSession) => {
      runtimeSession.state.sessionId = handle.sessionId;
    });
    const resumed = await client.resumeSession(handle, {
      cwd: "/not-the-original-cwd",
      modeId: "full",
      reviewHeadSha: "a".repeat(40),
    });
    try {
      const launch = runtime.recordedLaunches[1];
      expect(launch.cwd).toBe(runtimeCwd);
      const movedModels = join(launch.env!.PI_CODING_AGENT_DIR!, "models.yml");
      expect(await realpath(movedModels)).toBe(join(hostAgent, "models.yaml"));
      expect(launch.argv).toEqual(expect.arrayContaining(["--resume", nativeHandle, "--no-tools"]));
      expect(runtime.latestSession().hostToolSetRequests[0]).toEqual(
        fakeSession.hostToolSetRequests[0],
      );
      expect(await resumed.getCurrentMode()).toBe("findings-only");
      expect(resumed.describePersistence()?.metadata).toEqual(handle.metadata);
    } finally {
      await resumed.close();
    }

    execFileSync("git", ["reset", "--hard", config.reviewBaseSha!], { cwd: worktree });
    await expect(client.resumeSession(handle)).rejects.toThrow("no longer matches");
    expect(runtime.recordedLaunches).toHaveLength(2);
  }));

test("OMP review fails closed if tool registration or explicit model selection is incomplete", () =>
  withReviewFixture(async ({ config }) => {
    const runtime = new FakeOmp();
    const client = new OmpAgentClient({ runtime, logger: createTestLogger() });
    runtime.queueSessionSetup((session) => {
      session.setHostTools = async () => ["changed_files", "read_diff", "read_file", "bash"];
    });
    await expect(client.createSession(config)).rejects.toThrow("did not register the exact");
    expect(runtime.latestSession().closed).toBe(true);
    await expect(client.createSession({ ...config, model: "acme/missing-model" })).rejects.toThrow(
      "did not select the requested review model",
    );
    expect(runtime.latestSession().closed).toBe(true);
  }));

test.skipIf(process.platform === "win32")(
  "OMP review refuses a host model file linked into the checkout",
  () =>
    withReviewFixture(async ({ config, worktree, hostAgent }) => {
      const runtime = new FakeOmp();
      const client = new OmpAgentClient({ runtime, logger: createTestLogger() });
      const checkoutModels = join(worktree, ".omp", "models.yml");
      await writeFile(checkoutModels, "providers: {}\n");
      await symlink(checkoutModels, join(hostAgent, "models.yml"));
      await expect(client.createSession(config)).rejects.toThrow("from the checkout");
      expect(runtime.recordedLaunches).toHaveLength(0);
    }),
);

test.skipIf(process.platform === "win32").each([{ prefix: [] }, { prefix: ["--", "omp"] }])(
  "OMP review preserves the configured transport prefix $prefix but not agent flags or environment",
  ({ prefix }) =>
    withReviewFixture(async ({ config, hostAgent }) => {
      const binary = join(hostAgent, "omp-review-fixture");
      const capture = join(hostAgent, "launch.txt");
      await writeFile(
        binary,
        `#!/bin/sh\nprintf '%s\\n' "\${PASEO_FIXTURE_OVERRIDE-unset}" "$@" > '${capture}'\nexit 2\n`,
        { mode: 0o700 },
      );
      const client = new OmpAgentClient({
        logger: createTestLogger(),
        runtimeSettings: {
          command: {
            mode: "replace",
            argv: ["omp-review-fixture", ...prefix, "--ordinary-launch-only"],
          },
          env: { PATH: hostAgent, PASEO_FIXTURE_OVERRIDE: "ordinary launch" },
        },
      });
      await expect(client.createSession(config)).rejects.toThrow();
      const [override, ...args] = (await readFile(capture, "utf8")).trimEnd().split("\n");
      expect(override).toBe("unset");
      expect(args.slice(0, prefix.length + 2)).toEqual([...prefix, "--mode", "rpc"]);
      expect(args).not.toContain("--ordinary-launch-only");
      expect(args).toContain("--no-tools");
    }),
);
