import { queryClient } from "@/data/query-client";
import { loadAppSettingsFromStorage, type AppSettings } from "@/hooks/use-settings";
import { APP_SETTINGS_QUERY_KEY } from "@/hooks/use-settings/storage";

export function isMicrophoneEnabled(): boolean {
  return queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.microphoneEnabled === true;
}

export async function requireMicrophoneEnabled(): Promise<void> {
  if (!queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)) {
    await queryClient.fetchQuery({
      queryKey: APP_SETTINGS_QUERY_KEY,
      queryFn: async () => {
        const settings = await loadAppSettingsFromStorage();
        // A settings update made while storage was loading takes precedence.
        return queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY) ?? settings;
      },
      staleTime: Infinity,
      gcTime: Infinity,
    });
  }
  if (!isMicrophoneEnabled()) {
    throw new Error("Microphone access is disabled in app settings.");
  }
}

export function subscribeMicrophoneDisabled(listener: () => void): () => void {
  let previous = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.microphoneEnabled;
  return queryClient.getQueryCache().subscribe((event) => {
    if (
      event.query.queryKey.length !== APP_SETTINGS_QUERY_KEY.length ||
      event.query.queryKey[0] !== APP_SETTINGS_QUERY_KEY[0]
    ) {
      return;
    }
    const next = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.microphoneEnabled;
    const disabled = next !== true && (previous === true || next === false);
    const changed = next !== previous;
    previous = next;
    if (changed && disabled) {
      listener();
    }
  });
}
