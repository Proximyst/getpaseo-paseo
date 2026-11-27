import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import { readValidatedString } from "@/storage/validated-storage";

const STORAGE_PREFIX = "@paseo:expo-push-token:";
const ExpoPushTokenSchema = z.string().trim().min(1);

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

export async function readCachedExpoPushToken(serverId: string): Promise<string | null> {
  return readValidatedString(AsyncStorage, storageKey(serverId), ExpoPushTokenSchema);
}

export async function removeCachedExpoPushToken(serverId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey(serverId));
}

export async function resolveExpoPushToken(
  serverId: string,
  isActive: () => boolean,
): Promise<string | null> {
  const key = storageKey(serverId);
  const cached = await readCachedExpoPushToken(serverId);
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
