import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useFetchQuery } from "@/data/query";
import { readValidatedJson } from "@/storage/validated-storage";

export const EXAMPLE_INBOX_CLONE_DIRECTORY = "~/work";

const inboxPreferencesSchema = z.object({
  projectsOnly: z.boolean(),
  cloneDirectory: z.string().trim(),
});

export type InboxPreferences = z.infer<typeof inboxPreferencesSchema>;

const defaultPreferences: InboxPreferences = {
  projectsOnly: false,
  cloneDirectory: "",
};

export function usePullRequestInboxPreferences(hostId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["github-pull-request-inbox-preferences", hostId] as const;
  const storageKey = `@paseo:github-pull-request-inbox-preferences:${hostId}`;
  const query = useFetchQuery({
    queryKey,
    queryFn: async () =>
      (await readValidatedJson(AsyncStorage, storageKey, inboxPreferencesSchema)) ??
      defaultPreferences,
    dataShape: "value",
    immutableWhen: () => true,
    retry: false,
  });
  const { mutateAsync: save, isPending: saving } = useMutation({
    mutationKey: queryKey,
    mutationFn: async (preferences: InboxPreferences) => {
      await AsyncStorage.setItem(storageKey, JSON.stringify(preferences));
    },
    onSuccess: (_result, preferences) => {
      queryClient.setQueryData(queryKey, preferences);
    },
  });
  return { query, save, saving };
}
