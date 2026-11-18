import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import { readValidatedString } from "@/storage/validated-storage";
import { areNotificationsEnabled } from "@/hooks/use-settings/notifications";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./types";

const STORAGE_PREFIX = "@paseo:expo-push-token:";
const ExpoPushTokenSchema = z.string().trim().min(1);
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

function storageKey(serverId: string): string {
  return `${STORAGE_PREFIX}${serverId}`;
}

function getExpoProjectId(): string | null {
  const fromEas = ExpoPushTokenSchema.safeParse(Constants.easConfig?.projectId);
  if (fromEas.success) return fromEas.data;
  const fromExtra = ExpoPushTokenSchema.safeParse(Constants.expoConfig?.extra?.eas?.projectId);
  return fromExtra.success ? fromExtra.data : null;
}

async function ensurePushPermission(isActive: () => boolean): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (!isActive()) return false;
  if (existing.status === Notifications.PermissionStatus.GRANTED) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return isActive() && requested.status === Notifications.PermissionStatus.GRANTED;
}

async function resolveToken(serverId: string, isActive: () => boolean): Promise<string | null> {
  const key = storageKey(serverId);
  const cached = await readValidatedString(AsyncStorage, key, ExpoPushTokenSchema);
  if (!isActive() || !(await ensurePushPermission(isActive))) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  if (!isActive()) return null;

  const projectId = getExpoProjectId();
  if (!projectId) {
    console.warn("[PushNotifications] Missing EAS projectId; cannot fetch Expo push token");
    return cached;
  }

  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = result.data.trim();
  if (!token) return cached;
  await AsyncStorage.setItem(key, token);
  return token;
}

export function startSubscription(input: StartPushNotificationsInput): () => void {
  let stopped = false;
  let token: string | null = null;
  const isActive = () => !stopped && input.enabled && areNotificationsEnabled();
  const synchronize = () => {
    void queueSubscriptionOperation(input.serverId, async () => {
      if (stopped) return;
      if (isActive()) {
        token ??= await resolveToken(input.serverId, isActive);
        // The preference or effect may have changed while permission/token APIs were pending.
        if (isActive() && token && input.client.isConnected) {
          input.client.registerPushToken(token);
        }
      } else if (!areNotificationsEnabled()) {
        await revokeStoredToken(input, false);
      }
    }).catch((error) =>
      console.warn("[PushNotifications] Failed to sync push subscription", error),
    );
  };

  synchronize();
  const unsubscribe = input.client.subscribeConnectionStatus((state) => {
    if (state.status === "connected") synchronize();
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}

async function revokeStoredToken(
  input: RevokePushNotificationsInput,
  forgetOnFailure: boolean,
): Promise<void> {
  const key = storageKey(input.serverId);
  const token = await readValidatedString(AsyncStorage, key, ExpoPushTokenSchema);
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
  if (revoked || forgetOnFailure) await AsyncStorage.removeItem(key);
}

export function revokeSubscription(input: RevokePushNotificationsInput): Promise<void> {
  return queueSubscriptionOperation(input.serverId, () => revokeStoredToken(input, true));
}
