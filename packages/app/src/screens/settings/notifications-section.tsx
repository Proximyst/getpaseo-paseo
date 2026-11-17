import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Text, View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { isNative } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";
import { useAppSettings } from "@/hooks/use-settings";
import { useToast } from "@/contexts/toast-context";

const ThemedRotateCw = withUnistyles(RotateCw, (theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foregroundMuted,
}));

export function NotificationsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, isLoading, updateSettings } = useAppSettings();
  const [isSaving, setIsSaving] = useState(false);
  const handleToggle = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await updateSettings({ notificationsEnabled: !settings.notificationsEnabled });
    } catch {
      toast.error(t("settings.notifications.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, settings.notificationsEnabled, t, toast, updateSettings]);
  const handleOpenSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      toast.error(t("settings.notifications.openSettingsFailed"));
    });
  }, [t, toast]);

  return (
    <>
      <SettingsSection title={t("settings.notifications.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {settings.notificationsEnabled
                  ? t("settings.notifications.enabled")
                  : t("settings.notifications.disabled")}
              </Text>
              <Text style={settingsStyles.rowHint}>{t("settings.notifications.enabledHint")}</Text>
            </View>
            <Button
              variant="outline"
              onPress={handleToggle}
              disabled={isLoading || isSaving}
              loading={isSaving}
            >
              {settings.notificationsEnabled
                ? t("settings.notifications.disable")
                : t("settings.notifications.enable")}
            </Button>
          </View>
          {isNative ? (
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.notifications.systemSettings")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("settings.notifications.nativeDisableHint")}
                </Text>
              </View>
              <Button variant="outline" onPress={handleOpenSettings}>
                {t("settings.notifications.openSettings")}
              </Button>
            </View>
          ) : null}
        </View>
      </SettingsSection>
      {isElectronRuntime() && settings.notificationsEnabled ? <DesktopNotificationControls /> : null}
    </>
  );
}

function DesktopNotificationControls() {
  const { t } = useTranslation();
  const { settings, isSaving, updateSettings } = useDesktopSettings();
  const {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    testNotificationState,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  } = useDesktopPermissions();

  const handleRefreshPress = useCallback(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const handleRequestNotifications = useCallback(() => {
    void requestPermission("notifications");
  }, [requestPermission]);

  const handlePlaySoundChange = useCallback(
    (playSound: boolean) => {
      void updateSettings({ notifications: { playSound } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  const handleSendTestNotification = useCallback(() => {
    void sendTestNotification();
  }, [sendTestNotification]);

  const isPermissionBusy = isRefreshing || requestingPermission !== null;
  const isSendingTestNotification = testNotificationState.status === "sending";
  const refreshIcon = useMemo(() => <ThemedRotateCw />, []);
  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        leftIcon={refreshIcon}
        onPress={handleRefreshPress}
        disabled={isPermissionBusy}
        accessibilityLabel={t("settings.notifications.refreshAccessibility")}
      >
        {isRefreshing ? t("settings.permissions.refreshing") : t("settings.permissions.refresh")}
      </Button>
    ),
    [handleRefreshPress, isPermissionBusy, isRefreshing, refreshIcon, t],
  );
  const permissionLabels = useMemo(
    () => ({
      granted: t("settings.permissions.actions.granted"),
      request: t("settings.permissions.actions.request"),
      requesting: t("settings.permissions.actions.requesting"),
    }),
    [t],
  );

  if (!isDesktopApp) {
    return null;
  }

  const notificationsGranted = snapshot?.notifications.state === "granted";

  return (
    <SettingsSection title={t("settings.notifications.permission")} trailing={refreshButton}>
      <View style={settingsStyles.card}>
        <DesktopPermissionRow
          title={t("settings.notifications.permission")}
          status={snapshot?.notifications ?? null}
          isRequesting={requestingPermission === "notifications"}
          onRequest={handleRequestNotifications}
          labels={permissionLabels}
        />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.notifications.playSound")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.notifications.playSoundHint")}</Text>
          </View>
          <Switch
            value={settings.notifications.playSound}
            onValueChange={handlePlaySoundChange}
            disabled={isSaving}
            accessibilityLabel={t("settings.notifications.playSound")}
            testID="desktop-notifications-play-sound-switch"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.notifications.test")}</Text>
            <Text style={settingsStyles.rowHint}>
              {notificationsGranted
                ? t("settings.notifications.testHint")
                : t("settings.notifications.permissionRequired")}
            </Text>
          </View>
          <Button
            variant="outline"
            onPress={handleSendTestNotification}
            disabled={!notificationsGranted || isPermissionBusy || isSendingTestNotification}
          >
            {isSendingTestNotification
              ? t("settings.notifications.sending")
              : t("settings.notifications.send")}
          </Button>
        </View>
      </View>
      {testNotificationState.status === "success" ? (
        <Alert
          size="sm"
          variant="success"
          title={t("settings.notifications.sentTitle")}
          description={t("settings.notifications.sentDescription")}
          testID="desktop-notifications-test-success"
        />
      ) : null}
      {testNotificationState.status === "error" ? (
        <Alert
          size="sm"
          variant="error"
          title={t("settings.notifications.sendFailedTitle")}
          description={testNotificationState.message}
          testID="desktop-notifications-test-error"
        />
      ) : null}
    </SettingsSection>
  );
}
