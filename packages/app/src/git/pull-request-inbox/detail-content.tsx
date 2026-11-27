import type {
  GithubInboxPullRequest,
  GithubInboxPullRequestFile,
  GithubPullRequestInboxDetailResponse,
} from "@getpaseo/protocol/messages";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useFetchQuery } from "@/data/query";
import { Section } from "@/git/pull-request-panel/section-kit";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { getDeploymentToolsReports, type DeploymentToolsReports } from "./deployment-tools";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const ATLANTIS_STATUS_LABELS = {
  automergeFailed: "Automatic merge failed",
  applied: "All plans reported applied",
  stale: "Saved plan is stale",
  locked: "Project lock reported",
  policyFailed: "Policy check failed",
  applyFailed: "Apply failed",
  planFailed: "Plan failed",
  applyReported: "Apply result reported",
  planReported: "Plan reported",
  report: "Update reported",
};

const CHECK_PRIORITY: Readonly<Record<string, number>> = {
  ACTION_REQUIRED: 0,
  ERROR: 0,
  FAILURE: 0,
  STARTUP_FAILURE: 0,
  TIMED_OUT: 0,
  EXPECTED: 1,
  IN_PROGRESS: 1,
  PENDING: 1,
  QUEUED: 1,
  REQUESTED: 1,
  WAITING: 1,
  SUCCESS: 3,
  SKIPPED: 3,
};

type InboxDetail = GithubPullRequestInboxDetailResponse["payload"];

function detailQueryKey(hostId: string, pullRequest: GithubInboxPullRequest) {
  return [
    "github-pull-request-inbox-detail",
    hostId,
    pullRequest.repository,
    pullRequest.number,
    pullRequest.baseSha,
    pullRequest.headSha,
  ] as const;
}

function sortDetail(detail: InboxDetail): InboxDetail {
  detail.checks.sort((a, b) => (CHECK_PRIORITY[a.state] ?? 2) - (CHECK_PRIORITY[b.state] ?? 2));
  detail.activity.sort(
    (a, b) =>
      Number(b.resolved === false && !b.outdated) - Number(a.resolved === false && !a.outdated),
  );
  return detail;
}

export function cachePullRequestInboxDetail(
  queryClient: QueryClient,
  hostId: string,
  pullRequest: GithubInboxPullRequest,
  detail: InboxDetail,
) {
  queryClient.setQueryData(detailQueryKey(hostId, pullRequest), sortDetail(detail));
}

export function usePullRequestInboxDetail(hostId: string, pullRequest: GithubInboxPullRequest) {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(hostId);
  const connected = useHostRuntimeIsConnected(hostId);
  const { repository, number } = pullRequest;
  const query = useFetchQuery({
    queryKey: detailQueryKey(hostId, pullRequest),
    enabled: client !== null && connected,
    dataShape: "value",
    refetchOnMount: true,
    staleTimeMs: 30_000,
    queryFn: async () => {
      if (!client) throw new Error("Paseo host is not connected.");
      const result = await client.getGithubPullRequest({ repository, number });
      if (result.error) throw new Error(result.error);
      const detail = sortDetail(result);
      const summary = detail.pullRequest;
      if (
        summary &&
        (summary.headSha !== pullRequest.headSha || summary.baseSha !== pullRequest.baseSha)
      ) {
        // Refresh can discover a new revision. The tab can adopt it without a second fetch.
        queryClient.setQueryData(detailQueryKey(hostId, summary), detail);
      }
      return detail;
    },
  });
  return { query, connected };
}

export function PullRequestInboxDetailsContent({
  pullRequest,
  onRefreshInbox,
  query,
  connected,
}: {
  pullRequest: GithubInboxPullRequest;
  onRefreshInbox?: () => void;
} & ReturnType<typeof usePullRequestInboxDetail>) {
  const { t } = useTranslation();
  const { repository } = pullRequest;
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const detail = query.data;
  if (!detail) {
    if (!connected) return <Text style={styles.muted}>Paseo host is not connected.</Text>;
    if (query.error) {
      return (
        <View style={styles.stack}>
          <Text style={styles.muted}>{query.error.message}</Text>
          <Button variant="outline" size="sm" onPress={refresh}>
            {t("workspace.git.diff.refresh")}
          </Button>
        </View>
      );
    }
    return <ThemedLoadingSpinner />;
  }

  const revisionChanged =
    detail.headSha !== pullRequest.headSha || detail.baseSha !== pullRequest.baseSha;
  const reports = detail.headSha
    ? getDeploymentToolsReports(repository, detail.headSha, detail.activity, detail.checks)
    : null;
  return (
    <View style={styles.stack}>
      <Button
        size="sm"
        variant="ghost"
        style={styles.action}
        leftIcon={RotateCw}
        disabled={query.isFetching || !connected}
        onPress={refresh}
      >
        {t(query.isFetching ? "workspace.git.diff.refreshing" : "workspace.git.diff.refresh")}
      </Button>
      {query.error ? <Text style={styles.muted}>{query.error.message}</Text> : null}
      {revisionChanged ? (
        <View style={styles.stack}>
          <Text style={styles.muted}>
            The pull request moved. Files and activity below are from the latest GitHub revision.
          </Text>
          {onRefreshInbox ? (
            <Button variant="outline" size="sm" onPress={onRefreshInbox}>
              Refresh inbox
            </Button>
          ) : null}
        </View>
      ) : null}
      {!detail.complete ? (
        <Text style={styles.muted}>
          GitHub did not return all details. Open the full pull request to see the rest.
        </Text>
      ) : null}
      {reports ? <DeploymentReports reports={reports} /> : null}
      <DetailSection title={t("workspace.git.pr.sections.checks")} count={detail.checks.length}>
        {detail.checks.length === 0 ? <Text style={styles.muted}>No checks reported.</Text> : null}
        {detail.checks.map((check) => (
          <View key={check.id} style={styles.row}>
            <Text style={styles.label}>{check.name}</Text>
            <Text style={styles.muted}>{check.state}</Text>
            {check.url ? <ExternalLink href={check.url} label="Open check" /> : null}
          </View>
        ))}
      </DetailSection>
      <PublishedFiles files={detail.files} />
      <DetailSection
        title={t("workspace.git.pr.sections.activity")}
        count={detail.activity.length}
        initiallyOpen
      >
        {detail.activity.length === 0 ? (
          <Text style={styles.muted}>{t("workspace.git.pr.empty.noActivity")}</Text>
        ) : null}
        {detail.activity.map((item) => (
          <View key={item.id} style={styles.activity}>
            <View style={styles.row}>
              <Text style={styles.label}>
                {item.author ?? "Unknown author"} ·{" "}
                {t(
                  item.kind === "review"
                    ? "workspace.git.pr.activity.reviewed"
                    : "workspace.git.pr.activity.commented",
                )}
              </Text>
              {item.outdated ? (
                <Text style={styles.muted}>{t("workspace.git.pr.thread.outdated")}</Text>
              ) : null}
              {item.resolved === true ? (
                <Text style={styles.muted}>{t("workspace.git.pr.thread.resolved")}</Text>
              ) : null}
            </View>
            {item.path ? (
              <Text selectable style={styles.patch}>
                {item.path}
                {item.line === null ? "" : `:${item.line}`}
              </Text>
            ) : null}
            {item.body ? (
              <Text selectable style={styles.body}>
                {item.body}
              </Text>
            ) : null}
            <ExternalLink href={item.url} label="Open on GitHub" />
          </View>
        ))}
      </DetailSection>
    </View>
  );
}

function DeploymentReports({ reports }: { reports: DeploymentToolsReports }) {
  const { atlantis, kubernetes, policy } = reports;
  return (
    <DetailSection title="Deployment reports" initiallyOpen>
      {atlantis ? (
        <View style={styles.stack}>
          <Text style={styles.label}>Atlantis · {ATLANTIS_STATUS_LABELS[atlantis.status]}</Text>
          <Text style={styles.muted}>
            Verify the plan and apply state in Atlantis before merging. This is a bot report, not a
            readiness check.
          </Text>
          <ExternalLink href={atlantis.evidence.url} label="Open Atlantis report" />
        </View>
      ) : null}
      {kubernetes ? (
        <View style={styles.stack}>
          <Text style={styles.label}>Kubernetes / Tanka · Manifest preview</Text>
          {kubernetes.environments.length > 0 ? (
            <Text style={styles.muted}>{kubernetes.environments.join(", ")}</Text>
          ) : null}
          <ExternalLink href={kubernetes.evidence.url} label="Open manifest preview" />
        </View>
      ) : null}
      {policy ? (
        <View style={styles.stack}>
          <Text style={styles.label}>Policy Bot · {policy.state}</Text>
          {policy.url ? <ExternalLink href={policy.url} label="Open Policy Bot report" /> : null}
        </View>
      ) : null}
    </DetailSection>
  );
}

function PublishedFiles({ files }: { files: readonly GithubInboxPullRequestFile[] }) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const toggleFile = useCallback(
    (path: string) => setSelectedFile((current) => (current === path ? null : path)),
    [],
  );
  return (
    <DetailSection title="Files changed" count={files.length}>
      {files.length === 0 ? <Text style={styles.muted}>No changed files returned.</Text> : null}
      {files.map((file) => (
        <PublishedFile
          key={file.path}
          file={file}
          open={selectedFile === file.path}
          toggle={toggleFile}
        />
      ))}
    </DetailSection>
  );
}

function PublishedFile({
  file,
  open,
  toggle,
}: {
  file: GithubInboxPullRequestFile;
  open: boolean;
  toggle: (path: string) => void;
}) {
  const { path, previousPath, additions, deletions, patch, status } = file;
  const onPress = useCallback(() => toggle(path), [path, toggle]);
  const patchBody = patch ? (
    <ScrollView horizontal style={styles.patchBox}>
      <Text selectable style={styles.patch}>
        {patch}
      </Text>
    </ScrollView>
  ) : (
    <Text style={styles.muted}>No text patch returned for this {status} file.</Text>
  );
  return (
    <View style={styles.stack}>
      <Button size="sm" variant={open ? "outline" : "ghost"} onPress={onPress}>
        {previousPath ? `${previousPath} → ` : ""}
        {path} +{additions} / −{deletions}
      </Button>
      {open ? patchBody : null}
    </View>
  );
}

function DetailSection({
  title,
  count,
  initiallyOpen = false,
  children,
}: {
  title: string;
  count?: number;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const onToggle = useCallback(() => setOpen((current) => !current), []);
  const summary = useMemo(
    () => (count === undefined ? null : <Text style={styles.muted}>{count}</Text>),
    [count],
  );
  return (
    <Section title={title} open={open} onToggle={onToggle} summary={summary}>
      <View style={styles.stack}>{children}</View>
    </Section>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[2] },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing[2] },
  action: { alignSelf: "flex-start" },
  activity: {
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  body: { color: theme.colors.foreground, fontSize: theme.fontSize.content },
  patchBox: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
  },
  patch: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));
