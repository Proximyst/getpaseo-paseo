import { GithubPullRequestInboxDetailRequestSchema } from "@getpaseo/protocol/messages";

export const INBOX_PRESET_QUERIES = {
  mine: "is:pr is:open author:@me",
  review: "is:pr is:open review-requested:@me",
} as const;

const REPOSITORY = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/[a-z0-9_.-]+`;
const SHORT_REFERENCE = new RegExp(`^(${REPOSITORY})#([1-9][0-9]*)$`, "i");
const PULL_REQUEST_URL = new RegExp(
  String.raw`^https?://(?:www\.)?github\.com/(${REPOSITORY})/pull/([1-9][0-9]*)(?:/(?:checks|changes|commits|files)(?:/[a-f0-9]{7,40})?)?/?(?:[?#]\S*)?$`,
  "i",
);
const REFERENCE_SCHEMA = GithubPullRequestInboxDetailRequestSchema.pick({
  repository: true,
  number: true,
});

export function parsePullRequestReference(
  text: string,
): { repository: string; number: number } | null {
  const input = text.trim();
  const match = SHORT_REFERENCE.exec(input) ?? PULL_REQUEST_URL.exec(input);
  if (!match) return null;

  const [, repository, digits] = match;
  const result = REFERENCE_SCHEMA.safeParse({ repository, number: Number(digits) });
  return result.success ? result.data : null;
}
