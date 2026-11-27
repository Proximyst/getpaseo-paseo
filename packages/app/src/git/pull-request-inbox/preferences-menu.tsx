import { Settings2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DensityIcon } from "@/components/ui/density-icon";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { MenuTextField, menuRowContentInset, useMenuContext } from "@/components/ui/menu";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { EXAMPLE_INBOX_CLONE_DIRECTORY, type InboxPreferences } from "./preferences";

const CLONE_DIRECTORY_PAGE = "clone-directory";

type SavePreferences = (preferences: InboxPreferences) => Promise<void>;

export function InboxPreferencesMenu({
  preferences,
  canAutoClone,
  saving,
  loadError,
  onRetry,
  onSave,
}: {
  preferences: InboxPreferences | undefined;
  canAutoClone: boolean;
  saving: boolean;
  loadError: boolean;
  onRetry: () => void;
  onSave: SavePreferences;
}) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const toast = useToast();
  const title = t("sidebar.pullRequestInbox.options");
  const directoryLabel = t("sidebar.pullRequestInbox.cloneDirectory");
  const toggleProjectsOnly = useCallback(() => {
    if (!preferences || saving) return;
    void onSave({ ...preferences, projectsOnly: !preferences.projectsOnly }).catch(() => {
      toast.error(t("common.errors.unableToSave"));
    });
  }, [preferences, saving, onSave, toast, t]);
  const pages = useMemo<MenuPageDefinition[] | undefined>(() => {
    if (!canAutoClone || !preferences) return undefined;
    return [
      {
        id: CLONE_DIRECTORY_PAGE,
        title: directoryLabel,
        hoverIntent: false,
        content: <CloneDirectoryPage preferences={preferences} saving={saving} onSave={onSave} />,
      },
    ];
  }, [canAutoClone, preferences, directoryLabel, saving, onSave]);

  return (
    <DropdownMenu compactMode="sheet">
      <ToolbarButton kind="menu" label={title} compact={compact} testID="pr-inbox-options">
        <DensityIcon icon={Settings2} size="sm" color="foregroundMuted" />
      </ToolbarButton>
      <DropdownMenuContent align="end" width={320} minWidth={272} sheetTitle={title} pages={pages}>
        {loadError ? (
          <DropdownMenuItem
            description={t("sidebar.pullRequestInbox.preferencesError")}
            onSelect={onRetry}
          >
            {t("common.actions.retry")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuCheckboxItem
            checked={preferences?.projectsOnly ?? false}
            disabled={!preferences || saving}
            onToggle={toggleProjectsOnly}
            testID="pr-inbox-projects-only"
          >
            {t("sidebar.pullRequestInbox.projectsOnly")}
          </DropdownMenuCheckboxItem>
        )}
        {pages ? (
          <DropdownMenuSubTrigger
            id={CLONE_DIRECTORY_PAGE}
            indicator={Boolean(preferences?.cloneDirectory)}
            disabled={saving}
            testID="pr-inbox-clone-directory"
          >
            {directoryLabel}
          </DropdownMenuSubTrigger>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CloneDirectoryPage({
  preferences,
  saving,
  onSave,
}: {
  preferences: InboxPreferences;
  saving: boolean;
  onSave: SavePreferences;
}) {
  const { t } = useTranslation();
  const { goBack } = useMenuContext("CloneDirectoryPage");
  const [draft, setDraft] = useState(preferences.cloneDirectory);
  const [saveError, setSaveError] = useState(false);
  const cloneDirectory = draft.trim();
  const changed = cloneDirectory !== preferences.cloneDirectory;
  const save = useCallback(() => {
    if (saving || !changed) return;
    setSaveError(false);
    void onSave({ ...preferences, cloneDirectory })
      .then(goBack)
      .catch(() => setSaveError(true));
  }, [saving, changed, onSave, preferences, cloneDirectory, goBack]);

  return (
    <>
      <MenuTextField
        initialValue={preferences.cloneDirectory}
        onChangeText={setDraft}
        placeholder={EXAMPLE_INBOX_CLONE_DIRECTORY}
        accessibilityLabel={t("sidebar.pullRequestInbox.cloneDirectory")}
        autoFocus
        editable={!saving}
        onSubmitEditing={save}
        testID="pr-inbox-clone-directory-input"
      />
      <Text style={styles.hint}>{t("sidebar.pullRequestInbox.cloneDirectoryHint")}</Text>
      {saveError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t("common.errors.unableToSave")}
        </Text>
      ) : null}
      <DropdownMenuItem
        disabled={!changed}
        status={saving ? "pending" : "idle"}
        closeOnSelect={false}
        onSelect={save}
        testID="pr-inbox-clone-directory-save"
      >
        {t("common.actions.save")}
      </DropdownMenuItem>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: menuRowContentInset(theme),
    paddingVertical: theme.spacing[1],
    maxWidth: 320,
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: menuRowContentInset(theme),
    paddingVertical: theme.spacing[1],
  },
}));
