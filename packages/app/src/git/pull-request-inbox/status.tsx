import type { GithubInboxPullRequest } from "@getpaseo/protocol/messages";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DensityIcon } from "@/components/ui/density-icon";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";

const STATE = {
  OPEN: { label: "Open", icon: GitPullRequest, color: "statusSuccess" },
  DRAFT: { label: "Draft", icon: GitPullRequestDraft, color: "foregroundMuted" },
  CLOSED: { label: "Closed", icon: GitPullRequestClosed, color: "statusDanger" },
  MERGED: { label: "Merged", icon: GitMerge, color: "statusMerged" },
} as const;

const REVIEW: Record<
  NonNullable<GithubInboxPullRequest["reviewDecision"]>,
  { label: string; variant: StatusBadgeVariant }
> = {
  APPROVED: { label: "Approved", variant: "success" },
  CHANGES_REQUESTED: { label: "Changes requested", variant: "error" },
  REVIEW_REQUIRED: { label: "Review required", variant: "warning" },
};

const MERGE: Record<string, { label: string; variant: StatusBadgeVariant }> = {
  BEHIND: { label: "Behind base branch", variant: "warning" },
  BLOCKED: { label: "Blocked", variant: "warning" },
  CLEAN: { label: "Ready", variant: "success" },
  DIRTY: { label: "Conflicts", variant: "error" },
  DRAFT: { label: "Draft", variant: "muted" },
  HAS_HOOKS: { label: "Merge hooks", variant: "muted" },
  UNSTABLE: { label: "Unstable", variant: "warning" },
};

function checksSummary(checks: GithubInboxPullRequest["checks"]): {
  label: string;
  variant: StatusBadgeVariant;
} {
  if (!checks) return { label: "Unknown", variant: "muted" };
  const { failed, pending, passed, other } = checks;
  const parts = [];
  if (failed) parts.push(`${failed} failed`);
  if (pending) parts.push(`${pending} pending`);
  if (passed) parts.push(`${passed} passed`);
  if (other) parts.push(`${other} other`);
  let variant: StatusBadgeVariant = "muted";
  if (failed) variant = "error";
  else if (pending) variant = "warning";
  else if (passed && !other) variant = "success";
  return {
    label: parts.length > 0 ? parts.join(" · ") : "No checks",
    variant,
  };
}

export function PullRequestInboxStatus({ pullRequest }: { pullRequest: GithubInboxPullRequest }) {
  const state =
    STATE[pullRequest.state === "OPEN" && pullRequest.isDraft ? "DRAFT" : pullRequest.state];
  const review = pullRequest.reviewDecision ? REVIEW[pullRequest.reviewDecision] : null;
  const merge = pullRequest.mergeStateStatus ? MERGE[pullRequest.mergeStateStatus] : null;
  const checks = checksSummary(pullRequest.checks);

  return (
    <View style={styles.details}>
      <View style={styles.line}>
        <View style={styles.state}>
          <DensityIcon icon={state.icon} size="sm" color={state.color} />
          <Text style={styles.count}>{state.label}</Text>
        </View>
        <StatusBadge label={`CI: ${checks.label}`} variant={checks.variant} size="xs" />
        <StatusBadge
          label={`Review: ${review?.label ?? "Unknown"}`}
          variant={review?.variant}
          size="xs"
        />
        {pullRequest.state === "OPEN" ? (
          <StatusBadge
            label={`Merge: ${merge?.label ?? "Unknown"}`}
            variant={merge?.variant}
            size="xs"
          />
        ) : null}
      </View>
      <View style={styles.line}>
        <Text style={styles.count}>Approvals: {pullRequest.approvals ?? "unknown"}</Text>
        <Text style={styles.count}>Comments: {pullRequest.comments ?? "unknown"}</Text>
        <Text style={styles.count}>
          Unresolved threads: {pullRequest.unresolvedThreads ?? "unknown"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  details: { gap: theme.spacing[1] },
  line: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  state: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
