import { useFocusEffect, useIsFocused } from "expo-router/react-navigation";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  GithubInboxPullRequest,
  GithubPullRequestInboxSearchResponse,
  WorkspaceProjectDescriptorPayload,
} from "@getpaseo/protocol/messages";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { GitBranch, GitPullRequest, X } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import {
  BackHandler,
  FlatList,
  Platform,
  ScrollView,
  Text,
  View,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { RetainedPanel } from "@/components/retained-panel";
import { Button } from "@/components/ui/button";
import { DensityIcon } from "@/components/ui/density-icon";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ToolbarButton, ToolbarControls } from "@/components/ui/pane-content-toolbar";
import { PressHighlight } from "@/components/ui/press-highlight";
import { useFetchInfiniteQuery, useFetchQuery } from "@/data/query";
import { InboxFindForms, InboxRefreshButton } from "@/git/pull-request-inbox/controls";
import { usePullRequestInboxPreferences } from "@/git/pull-request-inbox/preferences";
import { InboxPreferencesMenu } from "@/git/pull-request-inbox/preferences-menu";
import { getReviewRepository } from "@/git/pull-request-inbox/review-model";
import { loadPullRequestProjects } from "@/git/pull-request-inbox/review-workspaces";
import { INBOX_PRESET_QUERIES } from "@/git/pull-request-inbox/search";
import { PullRequestInboxStatus } from "@/git/pull-request-inbox/status";
import { usePullRequestCheckout } from "@/git/pull-request-inbox/use-pull-request-checkout";
import { hostSupportsFeature } from "@/runtime/host-features";
import {
  useHostRuntimeClient,
  useHostRuntimeConnectionStatus,
  useHosts,
  type HostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { PullRequestInboxDetail } from "./pull-request-inbox-detail";

const updatedDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

type SearchPage = GithubPullRequestInboxSearchResponse["payload"];
type InboxQueryResult = UseInfiniteQueryResult<InfiniteData<SearchPage, string | undefined>, Error>;

type InboxFilter =
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "projects"; repositories: ReadonlyMap<string, WorkspaceProjectDescriptorPayload> };

const INBOX_COLLECTIONS = ["mine", "review", "open"] as const;
type InboxCollection = (typeof INBOX_COLLECTIONS)[number];
const COLLECTION_LABELS = {
  mine: "sidebar.pullRequestInbox.mine",
  review: "sidebar.pullRequestInbox.reviewRequested",
  open: "sidebar.pullRequestInbox.open",
} as const;

type InboxTabTarget =
  | { collection: InboxCollection; url?: never }
  | { url: string; collection?: never };

interface InboxTabs {
  collection: InboxCollection;
  open: readonly GithubInboxPullRequest[];
  activeUrl: string | null;
}

type InboxTabAction =
  | { kind: "open"; pullRequest: GithubInboxPullRequest }
  | { kind: "refresh"; url: string; pullRequest: GithubInboxPullRequest }
  | { kind: "select"; url: string }
  | { kind: "collection"; collection: InboxCollection }
  | { kind: "close"; url: string };

const initialInboxTabs: InboxTabs = { collection: "mine", open: [], activeUrl: null };
const TAB_SELECTED = { selected: true };
const TAB_NOT_SELECTED = { selected: false };

function reduceInboxTabs(tabs: InboxTabs, action: InboxTabAction): InboxTabs {
  switch (action.kind) {
    case "open": {
      const { pullRequest } = action;
      const existing = tabs.open.find((tab) => tab.url === pullRequest.url);
      if (existing === pullRequest) return { ...tabs, activeUrl: pullRequest.url };
      if (existing) {
        const open = tabs.open.map((tab) => (tab === existing ? pullRequest : tab));
        return { ...tabs, open, activeUrl: pullRequest.url };
      }
      return { ...tabs, open: [...tabs.open, pullRequest], activeUrl: pullRequest.url };
    }
    case "refresh": {
      const { url, pullRequest } = action;
      const previous = tabs.open.find((tab) => tab.url === url);
      if (!previous || previous === pullRequest) return tabs;
      return {
        ...tabs,
        open: tabs.open.map((tab) => (tab === previous ? pullRequest : tab)),
        activeUrl: tabs.activeUrl === url ? pullRequest.url : tabs.activeUrl,
      };
    }
    case "select":
      return { ...tabs, activeUrl: action.url };
    case "collection":
      return { ...tabs, collection: action.collection, activeUrl: null };
    case "close": {
      const index = tabs.open.findIndex((tab) => tab.url === action.url);
      const open = tabs.open.filter((tab) => tab.url !== action.url);
      const next = open[index] ?? open[index - 1];
      const activeUrl = tabs.activeUrl === action.url ? (next?.url ?? null) : tabs.activeUrl;
      return { ...tabs, open, activeUrl };
    }
  }
}

export function PullRequestInboxScreen({ hostId }: { hostId: string }) {
  const { t } = useTranslation();
  const [tabs, dispatchTab] = useReducer(reduceInboxTabs, initialInboxTabs);
  const hostLabel = useHosts().find((host) => host.serverId === hostId)?.label ?? hostId;
  const client = useHostRuntimeClient(hostId);
  const connectionStatus = useHostRuntimeConnectionStatus(hostId);
  const serverInfo = useSessionStore((state) => state.sessions[hostId]?.serverInfo);
  const feature = serverInfo ? hostSupportsFeature(serverInfo, "githubPullRequestInbox") : null;
  return (
    <View style={styles.screen} testID="pr-inbox-screen">
      {client && connectionStatus === "online" && serverInfo && feature ? (
        <InboxResults
          hostId={hostId}
          canOpen={hostSupportsFeature(serverInfo, "githubPullRequestInboxOpen")}
          canAutoClone={hostSupportsFeature(serverInfo, "githubPullRequestInboxAutoClone")}
          client={client}
          tabs={tabs}
          dispatchTab={dispatchTab}
        />
      ) : (
        <>
          <MenuHeader title={t("sidebar.sections.githubPullRequests")} />
          <InboxTabBar tabs={tabs} dispatch={dispatchTab} />
          <View style={styles.gate}>
            <HostUnavailable hostLabel={hostLabel} status={connectionStatus} feature={feature} />
          </View>
        </>
      )}
    </View>
  );
}

function HostUnavailable({
  hostLabel,
  status,
  feature,
}: {
  hostLabel: string;
  status: HostRuntimeConnectionStatus;
  feature: boolean | null;
}) {
  if (status === "connecting" || status === "idle" || (status === "online" && feature === null)) {
    return (
      <InboxMessage
        testID="pr-inbox-checking-host"
        message={`Checking ${hostLabel} for pull request support…`}
        loading
      />
    );
  }
  if (status !== "online") {
    return (
      <InboxMessage
        testID="pr-inbox-offline"
        message={`${hostLabel} is offline. Reconnect to view pull requests.`}
      />
    );
  }
  return (
    <InboxMessage
      testID="pr-inbox-update-required"
      message={`Update Paseo on ${hostLabel} to use the pull request inbox.`}
    />
  );
}

function InboxResults({
  hostId,
  canOpen,
  canAutoClone,
  client,
  tabs,
  dispatchTab,
}: {
  hostId: string;
  canOpen: boolean;
  canAutoClone: boolean;
  client: DaemonClient;
  tabs: InboxTabs;
  dispatchTab: (action: InboxTabAction) => void;
}) {
  const { t } = useTranslation();
  const isFocused = useIsFocused();
  const [rawSearch, setRawSearch] = useState("");
  const isCollectionActive = tabs.activeUrl === null;
  const activeCollection = isCollectionActive ? tabs.collection : null;
  const queries = {
    mine: useInboxQuery(
      hostId,
      client,
      INBOX_PRESET_QUERIES.mine,
      isFocused && activeCollection === "mine",
    ),
    review: useInboxQuery(
      hostId,
      client,
      INBOX_PRESET_QUERIES.review,
      isFocused && activeCollection === "review",
    ),
    open: useInboxQuery(hostId, client, rawSearch, isFocused && activeCollection === "open"),
  };
  const query = queries[tabs.collection];
  const { refetch } = query;
  const hasSearch = tabs.collection !== "open" || rawSearch !== "";
  const showRefresh = isCollectionActive && hasSearch;
  const {
    filter,
    preferences,
    saving,
    preferenceError,
    retryPreferences,
    savePreferences,
    refreshProjects,
    isFetchingProjects,
    isRefetchingProjects,
  } = useInboxResultPreferences(hostId, client, isFocused && showRefresh);
  const refresh = useCallback(() => {
    void refetch();
    refreshProjects();
  }, [refetch, refreshProjects]);
  const {
    checkout,
    pendingKey,
    error: checkoutError,
  } = usePullRequestCheckout({
    hostId,
    client,
    canAutoClone,
    cloneDirectory: preferences?.cloneDirectory || undefined,
  });
  const checkoutBusy = !preferences || pendingKey !== null;
  const openPullRequest = useCallback(
    (pullRequest: GithubInboxPullRequest) => dispatchTab({ kind: "open", pullRequest }),
    [dispatchTab],
  );
  const refreshPullRequest = useCallback(
    (url: string, pullRequest: GithubInboxPullRequest) =>
      dispatchTab({ kind: "refresh", url, pullRequest }),
    [dispatchTab],
  );
  const activeTab = tabs.open.find((tab) => tab.url === tabs.activeUrl);
  const selected = activeTab && currentPullRequest(activeTab, query.data?.pages);
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || isCollectionActive) return;
      const handler = BackHandler.addEventListener("hardwareBackPress", () => {
        dispatchTab({ kind: "collection", collection: tabs.collection });
        return true;
      });
      return () => handler.remove();
    }, [isCollectionActive, dispatchTab, tabs.collection]),
  );
  const findForms = useMemo(
    () => (
      <InboxFindForms
        hostId={hostId}
        client={client}
        canOpen={canOpen}
        onOpen={openPullRequest}
        onSearch={setRawSearch}
      />
    ),
    [hostId, client, canOpen, openPullRequest],
  );
  const headerActions = useMemo(
    () => (
      <ToolbarControls>
        {showRefresh ? (
          <InboxRefreshButton
            loading={query.isRefetching || isRefetchingProjects}
            busy={query.isFetching || isFetchingProjects}
            onRefresh={refresh}
          />
        ) : null}
        <InboxPreferencesMenu
          key={hostId}
          preferences={preferences}
          canAutoClone={canAutoClone}
          saving={saving}
          loadError={preferenceError}
          onRetry={retryPreferences}
          onSave={savePreferences}
        />
      </ToolbarControls>
    ),
    [
      showRefresh,
      query.isRefetching,
      query.isFetching,
      isRefetchingProjects,
      isFetchingProjects,
      refresh,
      hostId,
      preferences,
      canAutoClone,
      saving,
      preferenceError,
      retryPreferences,
      savePreferences,
    ],
  );

  return (
    <>
      <MenuHeader title={t("sidebar.sections.githubPullRequests")} rightContent={headerActions} />
      <InboxTabBar tabs={tabs} dispatch={dispatchTab} />
      {checkoutError ? (
        <Text
          accessibilityRole="alert"
          style={styles.checkoutError}
          testID="pr-inbox-checkout-error"
        >
          {checkoutError.message}
        </Text>
      ) : null}
      {INBOX_COLLECTIONS.map((collection) => (
        <RetainedPanel
          key={collection}
          active={activeCollection === collection}
          style={styles.list}
        >
          <SearchResults
            query={queries[collection]}
            hasSearch={collection !== "open" || rawSearch !== ""}
            filter={filter}
            header={collection === "open" ? findForms : undefined}
            onSelect={openPullRequest}
            onCheckout={checkout}
            checkoutBusy={checkoutBusy}
            pendingCheckout={pendingKey}
            testID={`pr-inbox-${collection}-results`}
          />
        </RetainedPanel>
      ))}
      {selected ? (
        <PullRequestInboxDetail
          key={selected.url}
          hostId={hostId}
          pullRequest={selected}
          onSummary={refreshPullRequest}
          onRefreshInbox={hasSearch ? refresh : undefined}
          onCheckout={checkout}
          checkoutBusy={checkoutBusy}
          checkingOut={pendingKey === selected.url}
        />
      ) : null}
    </>
  );
}

function useInboxResultPreferences(hostId: string, client: DaemonClient, active: boolean) {
  const { t } = useTranslation();
  const {
    query: preferenceQuery,
    save: savePreferences,
    saving,
  } = usePullRequestInboxPreferences(hostId);
  const preferences = preferenceQuery.data;
  const { refetch: refetchPreferences } = preferenceQuery;
  const retryPreferences = useCallback(() => void refetchPreferences(), [refetchPreferences]);
  const projectsOnly = preferences?.projectsOnly ?? false;
  const matchProjects = active && projectsOnly;
  const projectsQuery = useFetchQuery({
    queryKey: ["github-pull-request-inbox-projects", hostId],
    queryFn: () => loadPullRequestProjects(client),
    dataShape: "value",
    enabled: matchProjects,
    staleTimeMs: 0,
    retry: false,
  });
  const { refetch: refetchProjects } = projectsQuery;
  const retryProjects = useCallback(() => void refetchProjects(), [refetchProjects]);
  const projectReplica = useSessionStore((state) =>
    projectsOnly ? state.sessions[hostId]?.projects : undefined,
  );
  const previousProjectReplica = useRef(projectReplica);
  useEffect(() => {
    const previous = previousProjectReplica.current;
    previousProjectReplica.current = projectReplica;
    if (matchProjects && previous && projectReplica !== previous) retryProjects();
  }, [matchProjects, projectReplica, retryProjects]);
  const filter = useMemo<InboxFilter | null>(() => {
    if (preferenceQuery.error) {
      return {
        kind: "error",
        message: t("sidebar.pullRequestInbox.preferencesError"),
        onRetry: retryPreferences,
      };
    }
    if (!preferences) return { kind: "loading", message: t("common.loading") };
    if (!projectsOnly) return null;
    if (projectsQuery.error && !projectsQuery.isFetching) {
      return {
        kind: "error",
        message: t("sidebar.pullRequestInbox.projectMatchError", {
          message: projectsQuery.error.message,
        }),
        onRetry: retryProjects,
      };
    }
    if (!projectsQuery.data || projectsQuery.error) {
      return { kind: "loading", message: t("sidebar.pullRequestInbox.matchingProjects") };
    }
    return { kind: "projects", repositories: projectsQuery.data };
  }, [
    preferenceQuery.error,
    preferences,
    projectsOnly,
    projectsQuery.error,
    projectsQuery.data,
    projectsQuery.isFetching,
    retryPreferences,
    retryProjects,
    t,
  ]);
  const refreshProjects = useCallback(() => {
    if (projectsOnly) retryProjects();
  }, [projectsOnly, retryProjects]);
  return {
    filter,
    preferences,
    saving,
    preferenceError: preferenceQuery.isError,
    retryPreferences,
    savePreferences,
    refreshProjects,
    isFetchingProjects: projectsOnly && projectsQuery.isFetching,
    isRefetchingProjects: projectsOnly && projectsQuery.isRefetching,
  };
}

function useInboxQuery(
  hostId: string,
  client: DaemonClient,
  search: string,
  active: boolean,
): InboxQueryResult {
  return useFetchInfiniteQuery<SearchPage, string | undefined>({
    queryKey: ["github-pull-request-inbox", hostId, search],
    queryFn: async ({ pageParam }) => {
      const page = await client.searchGithubPullRequests({ query: search, cursor: pageParam });
      if (page.error) throw new Error(page.error);
      return page;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: active && Boolean(search),
    staleTimeMs: 30_000,
    retry: false,
  });
}

function currentPullRequest(
  tab: GithubInboxPullRequest,
  pages: SearchPage[] | undefined,
): GithubInboxPullRequest {
  for (const page of pages ?? []) {
    const item = page.items.find((pullRequest) => pullRequest.url === tab.url);
    if (item && item.updatedAt > tab.updatedAt) return item;
  }
  return tab;
}

function SearchResults({
  query,
  hasSearch,
  filter,
  header,
  onSelect,
  onCheckout,
  checkoutBusy,
  pendingCheckout,
  testID,
}: {
  query: InboxQueryResult;
  hasSearch: boolean;
  filter: InboxFilter | null;
  header?: ReactElement;
  onSelect: (pullRequest: GithubInboxPullRequest) => void;
  onCheckout: (pullRequest: GithubInboxPullRequest) => Promise<void>;
  checkoutBusy: boolean;
  pendingCheckout: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const { refetch, fetchNextPage, data, error } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const projects = filter?.kind === "projects" ? filter.repositories : undefined;
  const filterReady = !filter || filter.kind === "projects";
  const rows = useMemo(() => {
    if (!filterReady || !data) return [];
    const seen = new Set<string>();
    const items: GithubInboxPullRequest[] = [];
    for (const page of data.pages) {
      for (const item of page.items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        if (projects) {
          const repository = getReviewRepository(item);
          if (!repository || !projects.has(repository.toLowerCase())) continue;
        }
        items.push(item);
      }
    }
    return items;
  }, [data, filterReady, projects]);
  const renderRow = useCallback<ListRenderItem<GithubInboxPullRequest>>(
    ({ item }) => (
      <PullRequestRow
        pullRequest={item}
        onSelect={onSelect}
        onCheckout={onCheckout}
        checkoutBusy={checkoutBusy}
        checkingOut={pendingCheckout === item.url}
      />
    ),
    [onSelect, onCheckout, checkoutBusy, pendingCheckout],
  );
  const empty = useMemo(() => {
    if (!hasSearch) return null;
    if (filter?.kind === "loading") {
      return <InboxMessage testID="pr-inbox-filter-loading" message={filter.message} loading />;
    }
    if (filter?.kind === "error") {
      return (
        <InboxMessage
          testID="pr-inbox-filter-error"
          message={filter.message}
          onRetry={filter.onRetry}
          retryLabel={t("common.actions.retry")}
        />
      );
    }
    let emptyMessage: string | undefined;
    if (projects) {
      emptyMessage = query.hasNextPage
        ? t("sidebar.pullRequestInbox.noProjectPullRequestsOnLoadedPages")
        : t("sidebar.pullRequestInbox.noProjectPullRequests");
    }
    return (
      <EmptyResults
        loading={query.isPending}
        error={data ? null : error}
        emptyMessage={emptyMessage}
        onRetry={refresh}
      />
    );
  }, [hasSearch, filter, projects, query.hasNextPage, query.isPending, data, error, refresh, t]);
  const footer = useMemo(
    () =>
      filterReady && data ? (
        <ResultsFooter
          error={error}
          canLoadMore={query.hasNextPage}
          loadingMore={query.isFetchingNextPage}
          busy={query.isFetching}
          retryingPage={query.isFetchNextPageError}
          onLoadMore={loadMore}
        />
      ) : null,
    [
      filterReady,
      data,
      error,
      query.hasNextPage,
      query.isFetchingNextPage,
      query.isFetching,
      query.isFetchNextPageError,
      loadMore,
    ],
  );
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={inboxRowKey}
      renderItem={renderRow}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      testID={testID}
    />
  );
}

function InboxTabBar({
  tabs,
  dispatch,
}: {
  tabs: InboxTabs;
  dispatch: (action: InboxTabAction) => void;
}) {
  const { t } = useTranslation();
  const tabsRef = useRef<ScrollView>(null);
  const isLastTabActive = tabs.activeUrl !== null && tabs.open.at(-1)?.url === tabs.activeUrl;
  const revealLastTab = useCallback(() => {
    if (isLastTabActive) tabsRef.current?.scrollToEnd({ animated: false });
  }, [isLastTabActive]);
  useEffect(() => {
    if (tabs.activeUrl === null) tabsRef.current?.scrollTo({ x: 0, animated: false });
    else revealLastTab();
  }, [revealLastTab, tabs.activeUrl]);
  return (
    <View accessibilityRole="tablist" style={styles.tabs} testID="pr-inbox-tabs">
      <ScrollView
        ref={tabsRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={revealLastTab}
        contentContainerStyle={styles.tabsContent}
      >
        {INBOX_COLLECTIONS.map((collection) => (
          <InboxTab
            key={collection}
            active={tabs.activeUrl === null && tabs.collection === collection}
            label={t(COLLECTION_LABELS[collection])}
            collection={collection}
            dispatch={dispatch}
            testID={`pr-inbox-${collection}-tab`}
          />
        ))}
        {tabs.open.map((pullRequest) => (
          <InboxTab
            key={pullRequest.url}
            active={tabs.activeUrl === pullRequest.url}
            label={`#${pullRequest.number} ${pullRequest.title}`}
            url={pullRequest.url}
            dispatch={dispatch}
            testID="pr-inbox-detail-tab"
          />
        ))}
      </ScrollView>
    </View>
  );
}

function InboxTab({
  active,
  label,
  url,
  collection,
  dispatch,
  testID,
}: InboxTabTarget & {
  active: boolean;
  label: string;
  dispatch: (action: InboxTabAction) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => {
    if (url === undefined) dispatch({ kind: "collection", collection });
    else dispatch({ kind: "select", url });
  }, [collection, dispatch, url]);
  const close = useCallback(() => {
    if (url !== undefined) dispatch({ kind: "close", url });
  }, [dispatch, url]);
  return (
    <View style={[styles.tab, active && styles.tabActive]}>
      <PressHighlight
        accessibilityRole="tab"
        accessibilityState={active ? TAB_SELECTED : TAB_NOT_SELECTED}
        aria-selected={active}
        style={styles.tabTrigger}
        highlightStyle={styles.resultHover}
        onPress={select}
        testID={testID}
      >
        {url !== undefined ? (
          <DensityIcon
            icon={GitPullRequest}
            size="sm"
            color={active ? "foreground" : "foregroundMuted"}
          />
        ) : null}
        <Text numberOfLines={1} style={[styles.tabLabel, active && styles.tabLabelActive]}>
          {label}
        </Text>
      </PressHighlight>
      {url !== undefined ? (
        <ToolbarButton
          label={t("workspace.tabs.menu.close")}
          onPress={close}
          testID="pr-inbox-close-detail-tab"
        >
          <DensityIcon icon={X} size="sm" color="foregroundMuted" />
        </ToolbarButton>
      ) : null}
    </View>
  );
}

function inboxRowKey(row: GithubInboxPullRequest) {
  return row.url;
}

function EmptyResults({
  loading,
  error,
  emptyMessage = "No pull requests match this view.",
  onRetry,
}: {
  loading: boolean;
  error: Error | null;
  emptyMessage?: string;
  onRetry: () => void;
}) {
  if (loading) {
    return <InboxMessage testID="pr-inbox-loading" message="Loading pull requests…" loading />;
  }
  if (error) {
    return <InboxMessage testID="pr-inbox-error" message={error.message} onRetry={onRetry} />;
  }
  return <InboxMessage testID="pr-inbox-empty" message={emptyMessage} />;
}

function ResultsFooter({
  error,
  canLoadMore,
  loadingMore,
  busy,
  retryingPage,
  onLoadMore,
}: {
  error: Error | null;
  canLoadMore: boolean;
  loadingMore: boolean;
  busy: boolean;
  retryingPage: boolean;
  onLoadMore: () => void;
}) {
  if (!error && !canLoadMore) return null;
  return (
    <View style={styles.footer}>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error.message}
        </Text>
      ) : null}
      {canLoadMore ? (
        <Button
          variant="outline"
          loading={loadingMore}
          disabled={busy}
          onPress={onLoadMore}
          testID="pr-inbox-load-more"
        >
          {retryingPage ? "Retry loading more" : "Load more"}
        </Button>
      ) : null}
    </View>
  );
}

function pullRequestRowStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.result, hovered && styles.resultHover];
}

function PullRequestRow({
  pullRequest,
  onSelect,
  onCheckout,
  checkoutBusy,
  checkingOut,
}: {
  pullRequest: GithubInboxPullRequest;
  onSelect: (pullRequest: GithubInboxPullRequest) => void;
  onCheckout: (pullRequest: GithubInboxPullRequest) => Promise<void>;
  checkoutBusy: boolean;
  checkingOut: boolean;
}) {
  const { t } = useTranslation();
  const { additions, deletions } = pullRequest;
  const updated = Date.parse(pullRequest.updatedAt);
  const description = pullRequest.body?.trim().replace(/\s+/g, " ");
  const hasChangeCounts = additions !== undefined || deletions !== undefined;
  const select = useCallback(() => onSelect(pullRequest), [onSelect, pullRequest]);
  const checkout = useCallback(() => void onCheckout(pullRequest), [onCheckout, pullRequest]);
  return (
    <View style={styles.resultRow} testID="pr-inbox-result-row">
      <PressHighlight
        style={pullRequestRowStyle}
        highlightStyle={styles.resultHover}
        accessibilityRole="button"
        onPress={select}
        testID="pr-inbox-result"
      >
        <View style={styles.resultCopy}>
          <Text style={styles.resultTitle}>{pullRequest.title}</Text>
          {description ? (
            <Text style={styles.description} numberOfLines={2} testID="pr-inbox-result-description">
              {description}
            </Text>
          ) : null}
          <Text style={styles.meta} numberOfLines={1}>
            {pullRequest.repository} #{pullRequest.number} ·{" "}
            {pullRequest.author ?? "Unknown author"}
            {Number.isNaN(updated) ? "" : ` · Updated ${updatedDate.format(updated)}`}
          </Text>
          <View style={styles.resultStatus}>
            <PullRequestInboxStatus pullRequest={pullRequest} />
            {hasChangeCounts ? (
              <View style={styles.changeCounts} testID="pr-inbox-change-counts">
                {additions !== undefined ? (
                  <Text style={styles.additions}>+{additions}</Text>
                ) : null}
                {deletions !== undefined ? (
                  <Text style={styles.deletions}>−{deletions}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>
      </PressHighlight>
      <Button
        variant="outline"
        size="sm"
        leftIcon={GitBranch}
        loading={checkingOut}
        disabled={checkoutBusy}
        onPress={checkout}
        testID="pr-inbox-checkout"
        style={styles.checkoutButton}
      >
        {t("sidebar.pullRequestInbox.checkout")}
      </Button>
    </View>
  );
}

function InboxMessage({
  message,
  loading,
  onRetry,
  retryLabel = "Try again",
  testID,
}: {
  message: string;
  loading?: boolean;
  onRetry?: () => void;
  retryLabel?: string;
  testID: string;
}) {
  return (
    <View style={styles.message} testID={testID}>
      {loading ? <LoadingSpinner size="small" color={styles.meta.color} /> : null}
      <Text
        accessibilityRole={onRetry ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={styles.messageText}
      >
        {message}
      </Text>
      {onRetry ? (
        <Button variant="ghost" size="sm" onPress={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  list: { flex: 1, minHeight: 0 },
  tabs: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  tabsContent: {
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[1],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    maxWidth: 260,
  },
  tabActive: { backgroundColor: theme.colors.interactionHighlight },
  tabTrigger: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
  },
  tabLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tabLabelActive: { color: theme.colors.foreground },
  listContent: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[1],
  },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  resultRow: {
    flexDirection: { xs: "column", md: "row" },
    alignItems: { xs: "stretch", md: "center" },
    gap: theme.spacing[1],
    paddingRight: theme.spacing[2],
  },
  result: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
  },
  resultHover: { backgroundColor: theme.colors.interactionHighlight },
  resultCopy: { gap: theme.spacing[1] },
  resultTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.content },
  resultStatus: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  changeCounts: { flexDirection: "row", gap: theme.spacing[1] },
  additions: { color: theme.colors.statusSuccess, fontSize: theme.fontSize.sm },
  deletions: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
  checkoutButton: { alignSelf: { xs: "flex-start", md: "center" }, marginLeft: theme.spacing[3] },
  checkoutError: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: theme.spacing[2],
  },
  footer: { alignItems: "center", gap: theme.spacing[2], padding: theme.spacing[4] },
  gate: { flex: 1, justifyContent: "center", padding: theme.spacing[4] },
  message: { gap: theme.spacing[2], alignItems: "center", padding: theme.spacing[4] },
  messageText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
