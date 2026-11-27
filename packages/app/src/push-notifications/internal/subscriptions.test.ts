import { QueryClient } from "@tanstack/react-query";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
} from "@getpaseo/protocol/notification-preferences";
import type { ServerInfoStatusPayload, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { ConnectionState } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it, vi } from "vitest";
import { createFakeDesktopBridge, createInMemoryKeyValueStorage } from "@/hooks/use-settings/fakes";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  saveAppSettings,
  type AppSettings,
  type SettingsDeps,
} from "@/hooks/use-settings/storage";
import { readCachedExpoPushToken, removeCachedExpoPushToken } from "./expo-token";
import { startSubscription } from "./subscriptions";
import type { PushNotificationClient } from "./types";

vi.mock("./expo-token", () => ({
  readCachedExpoPushToken: vi.fn(async () => null),
  removeCachedExpoPushToken: vi.fn(async () => undefined),
  resolveExpoPushToken: vi.fn(async () => null),
}));

function createFakePushClient(options?: {
  isConnected?: boolean;
  pushNotificationPreferences?: boolean;
  pushTokenRevocation?: boolean;
}) {
  let connected = options?.isConnected ?? true;
  let serverInfo: ServerInfoStatusPayload = {
    status: "server_info",
    serverId: "srv-test",
    hostname: "test-host",
    version: "0.18.0",
    features: {
      pushNotificationPreferences: options?.pushNotificationPreferences,
      pushTokenRevocation: options?.pushTokenRevocation,
    },
  };

  const connectionListeners = new Set<(state: ConnectionState) => void>();
  const statusListeners = new Set<(message: SessionOutboundMessage) => void>();
  const registrations: Array<{
    token: string;
    preferencesProvided: boolean;
    preferences: NotificationPreferences | undefined;
  }> = [];
  const unregisterPushToken = vi.fn(async (_token: string) => undefined);

  const client: PushNotificationClient = {
    get isConnected() {
      return connected;
    },
    registerPushToken(token: string, preferences?: NotificationPreferences) {
      registrations.push({
        token,
        preferencesProvided: arguments.length >= 2 && preferences !== undefined,
        preferences,
      });
    },
    unregisterPushToken,
    getLastServerInfoMessage() {
      return serverInfo;
    },
    subscribeConnectionStatus(listener: (state: ConnectionState) => void) {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    on(type: "status", handler: (message: SessionOutboundMessage) => void) {
      if (type === "status") {
        statusListeners.add(handler);
      }
      return () => {
        statusListeners.delete(handler);
      };
    },
  };

  return {
    client,
    registrations,
    unregisterPushToken,
    setConnected(nextConnected: boolean) {
      connected = nextConnected;
      const state: ConnectionState = nextConnected
        ? { status: "connected" }
        : { status: "disconnected" };
      for (const listener of connectionListeners) {
        listener(state);
      }
    },
    emitServerInfo(nextFeatures?: ServerInfoStatusPayload["features"]) {
      serverInfo = {
        status: "server_info",
        serverId: "srv-test",
        hostname: "test-host",
        version: "0.18.0",
        ...(nextFeatures ? { features: nextFeatures } : {}),
      };
      const message: Extract<SessionOutboundMessage, { type: "status" }> = {
        type: "status",
        payload: serverInfo,
      };
      for (const listener of statusListeners) {
        listener(message);
      }
    },
  };
}

function makeSettingsEnv(initialNotifications?: NotificationPreferences): {
  queryClient: QueryClient;
  settingsDeps: SettingsDeps;
} {
  const queryClient = new QueryClient();
  const settings: AppSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
    ...(initialNotifications ? { notifications: initialNotifications } : {}),
  };
  queryClient.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, settings);
  const settingsDeps: SettingsDeps = {
    storage: createInMemoryKeyValueStorage(),
    desktop: createFakeDesktopBridge(),
  };
  return { queryClient, settingsDeps };
}

describe("startSubscription push notification preferences sync", () => {
  it("sends current notification preferences on connect when pushNotificationPreferences is supported", async () => {
    const fake = createFakePushClient({
      isConnected: true,
      pushNotificationPreferences: true,
    });
    const { queryClient, settingsDeps } = makeSettingsEnv();

    const stop = startSubscription({
      client: fake.client,
      serverId: "srv-test",
      queryClient,
      settingsDeps,
      resolveToken: async () => "ExponentPushToken[device-1]",
    });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(1));

    expect(fake.registrations).toEqual([
      {
        token: "ExponentPushToken[device-1]",
        preferencesProvided: true,
        preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      },
    ]);

    stop();
  });

  it("re-syncs preferences immediately when AppSettings.notifications changes while connected", async () => {
    const fake = createFakePushClient({
      isConnected: true,
      pushNotificationPreferences: true,
    });
    const { queryClient, settingsDeps } = makeSettingsEnv();

    const stop = startSubscription({
      client: fake.client,
      serverId: "srv-test",
      queryClient,
      settingsDeps,
      resolveToken: async () => "ExponentPushToken[device-1]",
    });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(1));

    const updatedPreferences: NotificationPreferences = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      events: {
        ...DEFAULT_NOTIFICATION_PREFERENCES.events,
        agentFinished: true,
      },
      plugins: {
        enabled: true,
        muted: ["ci-watchdog"],
      },
    };

    await saveAppSettings({
      queryClient,
      deps: settingsDeps,
      updates: { notifications: updatedPreferences },
    });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(2));
    expect(fake.registrations[1]).toEqual({
      token: "ExponentPushToken[device-1]",
      preferencesProvided: true,
      preferences: updatedPreferences,
    });

    stop();
  });

  it("omits preferences against older daemons without pushNotificationPreferences", async () => {
    const fake = createFakePushClient({
      isConnected: true,
      pushNotificationPreferences: undefined,
    });
    const { queryClient, settingsDeps } = makeSettingsEnv();

    const stop = startSubscription({
      client: fake.client,
      serverId: "srv-test",
      queryClient,
      settingsDeps,
      resolveToken: async () => "ExponentPushToken[legacy-device]",
    });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(1));

    expect(fake.registrations).toEqual([
      {
        token: "ExponentPushToken[legacy-device]",
        preferencesProvided: false,
        preferences: undefined,
      },
    ]);

    await saveAppSettings({
      queryClient,
      deps: settingsDeps,
      updates: {
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          enabled: false,
        },
      },
    });

    for (const registration of fake.registrations) {
      expect(registration.preferencesProvided).toBe(false);
      expect(registration.preferences).toBeUndefined();
    }

    stop();
  });

  it("re-syncs preferences on reconnect and when server_info upgrades pushNotificationPreferences", async () => {
    const fake = createFakePushClient({
      isConnected: true,
      pushNotificationPreferences: false,
    });
    const { queryClient, settingsDeps } = makeSettingsEnv();

    const stop = startSubscription({
      client: fake.client,
      serverId: "srv-test",
      queryClient,
      settingsDeps,
      resolveToken: async () => "ExponentPushToken[upgrade-device]",
    });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(1));

    expect(fake.registrations).toEqual([
      {
        token: "ExponentPushToken[upgrade-device]",
        preferencesProvided: false,
        preferences: undefined,
      },
    ]);

    fake.emitServerInfo({ pushNotificationPreferences: true });

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(2));
    expect(fake.registrations[1]).toEqual({
      token: "ExponentPushToken[upgrade-device]",
      preferencesProvided: true,
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    });

    fake.setConnected(false);
    fake.setConnected(true);

    await vi.waitFor(() => expect(fake.registrations).toHaveLength(3));
    expect(fake.registrations[2]).toEqual({
      token: "ExponentPushToken[upgrade-device]",
      preferencesProvided: true,
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    });

    stop();
  });

  it("does not resolve a new push token while paused and revokes a stored token on reconnect", async () => {
    const token = "ExponentPushToken[paused-device]";
    const fake = createFakePushClient({ isConnected: false, pushTokenRevocation: true });
    vi.mocked(readCachedExpoPushToken).mockResolvedValueOnce(token);
    const resolveToken = vi.fn(async () => token);
    const { queryClient, settingsDeps } = makeSettingsEnv({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      enabled: false,
    });

    const stop = startSubscription({
      client: fake.client,
      serverId: "paused-host",
      queryClient,
      settingsDeps,
      resolveToken,
    });

    fake.setConnected(true);
    await vi.waitFor(() => expect(removeCachedExpoPushToken).toHaveBeenCalledWith("paused-host"));
    expect(fake.unregisterPushToken).toHaveBeenCalledWith(token);
    expect(resolveToken).not.toHaveBeenCalled();
    expect(fake.registrations).toHaveLength(0);

    await saveAppSettings({
      queryClient,
      deps: settingsDeps,
      updates: { notifications: DEFAULT_NOTIFICATION_PREFERENCES },
    });
    await vi.waitFor(() => expect(fake.registrations).toHaveLength(1));
    stop();
  });
});
