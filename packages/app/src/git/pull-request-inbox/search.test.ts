import { describe, expect, it } from "vitest";
import { INBOX_PRESET_QUERIES, parsePullRequestReference } from "./search";

describe("pull request inbox queries", () => {
  it("uses the signed-in GitHub user's open authored and review-requested PRs for the presets", () => {
    expect(INBOX_PRESET_QUERIES.mine).toBe("is:pr is:open author:@me");
    expect(INBOX_PRESET_QUERIES.review).toBe("is:pr is:open review-requested:@me");
  });
});

describe("pull request references", () => {
  it.each([
    "  Example/Project.name#42  ",
    "https://github.com/Example/Project.name/pull/42",
    "https://www.github.com/Example/Project.name/pull/42/",
    "https://github.com/Example/Project.name/pull/42/files?view=split#diff-abc",
    "https://github.com/Example/Project.name/pull/42/commits/abcdef0",
  ])("extracts the exact repository and number from %s", (text) => {
    expect(parsePullRequestReference(text)).toEqual({
      repository: "Example/Project.name",
      number: 42,
    });
  });

  it.each([
    "",
    "#42",
    "repo:example/project is:pr",
    "example/project#0",
    "example/project#2147483648",
    "example/project#9007199254740992",
    "example/project#12x",
    "example/..#42",
    "example/nested/project#42",
    "https://github.com/example/project/issues/42",
    "https://github.com/example/project/pull/42oops",
    "https://github.com/example/project/pull/42/not-a-pr-tab",
    "https://github.com.evil.test/example/project/pull/42",
    "https://github.com@evil.test/example/project/pull/42",
  ])("rejects invalid or non-PR references: %s", (text) => {
    expect(parsePullRequestReference(text)).toBeNull();
  });
});
