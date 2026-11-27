import { parseServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import {
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from "@getpaseo/protocol/notification-preferences";
import type { QueryClient } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/data/query-client";
import {
  APP_SETTINGS_QUERY_KEY,
  loadAppSettingsFromStorage as loadAppSettingsFromStoragePure,
  type AppSettings,
  type SettingsDeps,
} from "@/hooks/use-settings/storage";
import {
  readCachedExpoPushToken,
  removeCachedExpoPushToken,
  resolveExpoPushToken,
} from "./expo-token";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./types";

const subscriptionOperations = new Map<string, Promise<void>>();

/** Token writes, registration, and revocation must stay ordered across effect restarts. */
function queueSubscriptionOperation(
  serverId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = subscriptionOperations.get(serverId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  subscriptionOperations.set(serverId, next);
  void next
    .finally(() => {
      if (subscriptionOperations.get(serverId) === next) subscriptionOperations.delete(serverId);
    })
    .catch(() => undefined);
  return next;
}

async function loadInitialAppSettings(settingsDeps?: SettingsDeps): Promise<AppSettings> {
  if (settingsDeps) {
    return loadAppSettingsFromStoragePure(settingsDeps);
  }
  // Only the production path loads the platform-specific AsyncStorage/Electron settings adapter.
  const { loadAppSettingsFromStorage } = await import("@/hooks/use-settings");
  return loadAppSettingsFromStorage();
}

function readCachedPreferences(queryClient: QueryClient): NotificationPreferences | null {
  const cached = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return cached ? normalizeNotificationPreferences(cached.notifications) : null;
}

export function startSubscription(input: StartPushNotificationsInput): () => void {
  let stopped = false;
  let token: string | null = null;
  let queued = false;
  let lastRegisteredSignature: string | null = null;
  const queryClient = input.queryClient ?? appQueryClient;
  const resolveToken = input.resolveToken ?? resolveExpoPushToken;
  let preferences = readCachedPreferences(queryClient);
  const isActive = () => !stopped && preferences?.enabled === true;

  const register = () => {
    if (stopped || !token || !preferences || !input.client.isConnected) return;
    // COMPAT(pushNotificationPreferences): added in v0.18.0, remove gate after 2027-06-01.
    const supportsPreferences =
      input.client.getLastServerInfoMessage()?.features?.pushNotificationPreferences === true;
    if (!preferences.enabled && !supportsPreferences) return;
    const signature = supportsPreferences
      ? `${token}:${JSON.stringify(preferences)}`
      : `${token}:legacy`;
    if (signature === lastRegisteredSignature) return;
    if (supportsPreferences) {
      input.client.registerPushToken(token, preferences);
    } else {
      input.client.registerPushToken(token);
    }
    lastRegisteredSignature = signature;
  };

  const synchronize = () => {
    if (queued || stopped || !preferences) return;
    queued = true;
    void queueSubscriptionOperation(input.serverId, async () => {
      queued = false;
      if (stopped) return;
      if (isActive()) token ??= await resolveToken(input.serverId, isActive);
      if (stopped || !input.client.isConnected) return;

      if (!isActive()) {
        const features = input.client.getLastServerInfoMessage()?.features;
        if (features?.pushTokenRevocation === true) {
          await revokeStoredToken(input, false);
          token = null;
          lastRegisteredSignature = null;
          return;
        }
        if (features?.pushNotificationPreferences !== true) return;
        token ??= await readCachedExpoPushToken(input.serverId);
      }
      register();
    }).catch((error) =>
      console.warn("[PushNotifications] Failed to sync push subscription", error),
    );
  };

  if (preferences) {
    synchronize();
  } else {
    void loadInitialAppSettings(input.settingsDeps)
      .then((loaded) => {
        if (stopped) return undefined;
        preferences ??= normalizeNotificationPreferences(loaded.notifications);
        synchronize();
        return undefined;
      })
      .catch((error) =>
        console.warn("[PushNotifications] Failed to load notification preferences", error),
      );
  }

  const unsubscribeConnection = input.client.subscribeConnectionStatus((state) => {
    lastRegisteredSignature = null;
    if (state.status === "connected") synchronize();
  });

  const unsubscribeStatus = input.client.on?.("status", (message) => {
    if (message.type === "status" && parseServerInfoStatusPayload(message.payload)) {
      synchronize();
    }
  });

  const unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.query.queryKey[0] !== APP_SETTINGS_QUERY_KEY[0]) {
      return;
    }
    const nextPreferences = readCachedPreferences(queryClient);
    if (!nextPreferences) return;
    preferences = nextPreferences;
    synchronize();
  });

  return () => {
    stopped = true;
    unsubscribeConnection();
    unsubscribeStatus?.();
    unsubscribeQueryCache();
  };
}

async function revokeStoredToken(
  input: RevokePushNotificationsInput,
  forgetOnFailure: boolean,
): Promise<void> {
  const token = await readCachedExpoPushToken(input.serverId);
  if (!token) return;
  let revoked = false;
  if (
    input.client?.isConnected &&
    input.client.getLastServerInfoMessage()?.features?.pushTokenRevocation === true
  ) {
    try {
      await input.client.unregisterPushToken(token);
      revoked = true;
    } catch (error) {
      console.warn("[PushNotifications] Failed to revoke push token", error);
    }
  }
  // Keep disabled subscriptions available for a later reconnect/restart retry.
  if (revoked || forgetOnFailure) await removeCachedExpoPushToken(input.serverId);
}

export function revokeSubscription(input: RevokePushNotificationsInput): Promise<void> {
  return queueSubscriptionOperation(input.serverId, () => revokeStoredToken(input, true));
}
