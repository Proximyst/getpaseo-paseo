import type { GithubInboxPullRequest } from "@getpaseo/protocol/messages";
import { GitBranch } from "lucide-react-native";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import {
  PullRequestInboxDetailsContent,
  usePullRequestInboxDetail,
} from "@/git/pull-request-inbox/detail-content";
import { PullRequestInboxStatus } from "@/git/pull-request-inbox/status";

const updatedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function PullRequestInboxDetail({
  hostId,
  pullRequest: tabSummary,
  onRefreshInbox,
  onSummary,
  onCheckout,
  checkoutBusy,
  checkingOut,
}: {
  hostId: string;
  pullRequest: GithubInboxPullRequest;
  onRefreshInbox?: () => void;
  onSummary: (url: string, summary: GithubInboxPullRequest) => void;
  onCheckout: (pullRequest: GithubInboxPullRequest) => Promise<void>;
  checkoutBusy: boolean;
  checkingOut: boolean;
}) {
  const { t } = useTranslation();
  const { query, connected } = usePullRequestInboxDetail(hostId, tabSummary);
  const summary = query.data?.pullRequest;
  const pullRequest = summary ?? tabSummary;
  const tabUrl = tabSummary.url;
  useEffect(() => {
    if (summary) onSummary(tabUrl, summary);
  }, [onSummary, summary, tabUrl]);
  const checkout = useCallback(() => void onCheckout(pullRequest), [onCheckout, pullRequest]);
  const updated = Date.parse(pullRequest.updatedAt);
  const description = pullRequest.body?.trim();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} testID="pr-inbox-detail">
      <View style={styles.content}>
        <View style={styles.actions}>
          <ExternalLink
            href={pullRequest.url}
            label="Open on GitHub"
            testID="pr-inbox-open-github"
          />
          <Button
            variant="outline"
            size="sm"
            leftIcon={GitBranch}
            loading={checkingOut}
            disabled={checkoutBusy}
            onPress={checkout}
            testID="pr-inbox-detail-checkout"
          >
            {t("sidebar.pullRequestInbox.checkout")}
          </Button>
        </View>
        <View style={styles.identity}>
          <Text style={styles.metadata}>
            {pullRequest.repository} #{pullRequest.number}
          </Text>
          <Text accessibilityRole="header" style={styles.title} selectable>
            {pullRequest.title}
          </Text>
          <Text style={styles.metadata} selectable>
            {pullRequest.author ?? "Unknown author"}
            {Number.isNaN(updated) ? "" : ` · Updated ${updatedDate.format(updated)}`}
          </Text>
          <Text style={styles.metadata} selectable>
            {pullRequest.headRef} ({pullRequest.headSha.slice(0, 12)}) → {pullRequest.baseRef} (
            {pullRequest.baseSha.slice(0, 12)})
          </Text>
        </View>
        <PullRequestInboxStatus pullRequest={pullRequest} />
        <View style={styles.description}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Description
          </Text>
          {description ? (
            <MarkdownRenderer external text={description} />
          ) : (
            <Text style={styles.metadata}>No description provided.</Text>
          )}
        </View>
        <PullRequestInboxDetailsContent
          query={query}
          connected={connected}
          pullRequest={pullRequest}
          onRefreshInbox={onRefreshInbox}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: { flex: 1 },
  page: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[4],
  },
  content: {
    alignSelf: "center",
    gap: theme.spacing[4],
    maxWidth: 920,
    width: "100%",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  identity: { gap: theme.spacing[1] },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  metadata: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  description: {
    paddingTop: theme.spacing[4],
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
}));
