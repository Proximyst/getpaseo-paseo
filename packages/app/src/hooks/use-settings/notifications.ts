import { queryClient } from "@/data/query-client";
import { APP_SETTINGS_QUERY_KEY } from "./keys";
import type { AppSettings } from "./storage";

/** Fail closed until persisted settings have loaded, including during notification callbacks. */
export function areNotificationsEnabled(): boolean {
  return (
    queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.notificationsEnabled === true
  );
}
