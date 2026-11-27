import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { GithubInboxPullRequest } from "@getpaseo/protocol/messages";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { cachePullRequestInboxDetail } from "./detail-content";
import { parsePullRequestReference } from "./search";

export function InboxRefreshButton({
  loading,
  busy,
  onRefresh,
}: {
  loading: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      leftIcon={RefreshCw}
      accessibilityLabel={t("workspace.git.diff.refresh")}
      testID="pr-inbox-refresh"
      loading={loading}
      disabled={busy}
      onPress={onRefresh}
    />
  );
}

export function InboxFindForms({
  hostId,
  client,
  canOpen,
  onOpen,
  onSearch,
}: {
  hostId: string;
  client: DaemonClient;
  canOpen: boolean;
  onOpen: (pullRequest: GithubInboxPullRequest) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.forms}>
      {canOpen ? (
        <OpenPullRequestForm hostId={hostId} client={client} onOpen={onOpen} />
      ) : (
        <Text style={styles.notice} testID="pr-inbox-open-update-required">
          {t("sidebar.pullRequestInbox.updateHostToOpen")}
        </Text>
      )}
      <SearchForm onSearch={onSearch} />
    </View>
  );
}

function OpenPullRequestForm({
  hostId,
  client,
  onOpen,
}: {
  hostId: string;
  client: DaemonClient;
  onOpen: (pullRequest: GithubInboxPullRequest) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async (text: string) => {
      const reference = parsePullRequestReference(text);
      if (!reference) throw new Error(t("sidebar.pullRequestInbox.invalidReference"));
      const detail = await client.getGithubPullRequest(reference);
      if (detail.error) throw new Error(detail.error);
      const { pullRequest } = detail;
      if (!pullRequest) throw new Error(t("sidebar.pullRequestInbox.updateHostToOpen"));
      return { detail, pullRequest };
    },
  });
  const change = useCallback(
    (text: string) => {
      setInput(text);
      reset();
    },
    [reset],
  );
  const submit = useCallback(() => {
    if (!input.trim() || isPending) return;
    mutate(input, {
      onSuccess: ({ detail, pullRequest }) => {
        cachePullRequestInboxDetail(queryClient, hostId, pullRequest, detail);
        onOpen(pullRequest);
      },
    });
  }, [hostId, input, isPending, mutate, onOpen, queryClient]);
  const label = t("sidebar.pullRequestInbox.reference");
  return (
    <Field label={label}>
      <View style={styles.row}>
        <FormTextInput
          style={styles.input}
          accessibilityLabel={label}
          placeholder="owner/repo#123"
          onChangeText={change}
          onSubmitEditing={submit}
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isPending}
          invalid={error !== null}
          testID="pr-inbox-pr-reference"
        />
        <Button
          variant="outline"
          disabled={!input.trim()}
          loading={isPending}
          onPress={submit}
          testID="pr-inbox-open-pr"
        >
          {t("sidebar.pullRequestInbox.open")}
        </Button>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error} testID="pr-inbox-open-error">
          {error.message}
        </Text>
      ) : null}
    </Field>
  );
}

function SearchForm({ onSearch }: { onSearch: (query: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const submit = useCallback(() => {
    const query = text.trim();
    if (query) onSearch(query);
  }, [onSearch, text]);
  const label = t("sidebar.pullRequestInbox.searchQuery");
  return (
    <Field label={label}>
      <View style={styles.row}>
        <FormTextInput
          style={styles.input}
          accessibilityLabel={label}
          placeholder="repo:owner/repo is:open label:bug"
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          testID="pr-inbox-query"
        />
        <Button variant="outline" disabled={!text.trim()} onPress={submit} testID="pr-inbox-search">
          {t("sidebar.sections.search")}
        </Button>
      </View>
    </Field>
  );
}

const styles = StyleSheet.create((theme) => ({
  forms: { gap: theme.spacing[3], marginBottom: theme.spacing[3], maxWidth: 640 },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  input: { flex: 1, minWidth: 0 },
  notice: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
