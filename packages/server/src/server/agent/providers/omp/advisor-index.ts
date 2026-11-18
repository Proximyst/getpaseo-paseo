import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import type { ProviderSubagentStatus } from "../../provider-subagents/store.js";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";
import { isOmpAdvisorSessionFile } from "./advisor-session.js";
import { OMP_HISTORY_MAPPER_HOOKS } from "./history-hooks.js";
import { OmpHistoryMapper } from "./message-history.js";
import { OmpAgentMessageSchema } from "./rpc-types.js";

interface AdvisorEntry {
  id?: string;
  type?: string;
  timestamp?: string | number;
  message?: Record<string, unknown>;
}

type ReadEntries = (file: string) => Promise<AdvisorEntry[]>;

interface AdvisorTranscriptState {
  size: number;
  mtimeMs: number;
  seen: Set<string>;
  mapper: OmpHistoryMapper;
}

export interface AdvisorRefreshError {
  file: string;
  error: unknown;
}

/** Successful transcript cursors are committed; deliver events even when errors are present. */
interface AdvisorRefreshResult {
  events: AgentStreamEvent[];
  errors: AdvisorRefreshError[];
}

/** Upstream exposes no advisor agent events; only finalized sidecar records are observable. */
export class OmpAdvisorIndex {
  private readonly transcripts = new Map<string, AdvisorTranscriptState>();
  private readonly owners = new Map<string, string>();

  trackSession(sessionFile: string, parentSubagentId: string): void {
    this.owners.set(sessionFile, parentSubagentId);
  }

  async refreshAll(
    sessionFile: string | undefined,
    readEntries: ReadEntries,
  ): Promise<AdvisorRefreshResult> {
    const result = await this.refresh(sessionFile, readEntries);
    if (!sessionFile?.endsWith(".jsonl")) return result;
    const directory = sessionFile.slice(0, -".jsonl".length);
    for (const [file, parentSubagentId] of this.owners) {
      const childPath = relative(directory, file);
      if (childPath === ".." || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) continue;
      const child = await this.refresh(file, readEntries, false, parentSubagentId);
      result.events.push(...child.events);
      result.errors.push(...child.errors);
    }
    return result;
  }

  async refresh(
    sessionFile: string | undefined,
    readEntries: ReadEntries,
    replay = false,
    parentSubagentId: string | null = null,
  ): Promise<AdvisorRefreshResult> {
    const result: AdvisorRefreshResult = { events: [], errors: [] };
    if (parentSubagentId && sessionFile) this.trackSession(sessionFile, parentSubagentId);
    if (!sessionFile?.endsWith(".jsonl") || isOmpAdvisorSessionFile(sessionFile)) return result;
    const directory = sessionFile.slice(0, -".jsonl".length);
    const dirents = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        result.errors.push({ file: directory, error });
      }
      return [];
    });
    const events = result.events;
    for (const dirent of dirents.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!dirent.isFile() || !isOmpAdvisorSessionFile(dirent.name)) continue;
      const file = join(directory, dirent.name);
      try {
        const snapshot = await stat(file);
        const previous = this.transcripts.get(file);
        if (!replay && previous?.size === snapshot.size && previous.mtimeMs === snapshot.mtimeMs) {
          continue;
        }
        const entries = await readEntries(file);
        const messages = entries.flatMap((entry) => {
          if (entry.type !== "message" || !entry.id) return [];
          const parsed = OmpAgentMessageSchema.safeParse(entry.message);
          return parsed.success ? [{ id: entry.id, entry, message: parsed.data }] : [];
        });
        if (messages.length === 0) continue;
        const state: AdvisorTranscriptState =
          replay || !previous
            ? {
                size: snapshot.size,
                mtimeMs: snapshot.mtimeMs,
                seen: new Set(),
                mapper: new OmpHistoryMapper("omp", [], OMP_HISTORY_MAPPER_HOOKS),
              }
            : previous;
        const slug =
          dirent.name === "__advisor.jsonl"
            ? ""
            : dirent.name.slice("__advisor.".length, -".jsonl".length);
        // A separate namespace cannot collide with OMP task ids, including nested advisors.
        const id = `omp-advisor:${file}`;
        const assistant = messages.findLast(({ message }) => message.role === "assistant")?.message;
        let model: string | null = null;
        // This is the last saved outcome, not a claim that the live runtime has stopped.
        let status: ProviderSubagentStatus = "completed";
        if (assistant?.role === "assistant") {
          if (assistant.model) {
            model = [assistant.provider, assistant.model].filter(Boolean).join("/");
          }
          if (assistant.stopReason === "aborted") {
            status = "canceled";
          } else if (assistant.stopReason === "error" || assistant.errorMessage) {
            status = "failed";
          }
        }
        const timestamp = normalizeProviderReplayTimestamp(messages.at(-1)?.entry.timestamp);
        events.push({
          type: "provider_subagent",
          provider: "omp",
          event: {
            type: "upsert",
            id,
            title: slug ? `Advisor · ${slug}` : "Advisor",
            subtitle: [model, "Saved transcript · runtime status unavailable"]
              .filter(Boolean)
              .join(" · "),
            description: slug ? `Advisor · ${slug}` : "Advisor",
            status,
            toolCallId: null,
            parentSubagentId,
            ...(timestamp ? { timestamp } : {}),
          },
        });
        for (const { id: entryId, entry, message } of messages) {
          if (state.seen.has(entryId)) continue;
          state.seen.add(entryId);
          const timestamp = normalizeProviderReplayTimestamp(entry.timestamp);
          for (const mapped of state.mapper.mapMessages([message])) {
            if (mapped.type !== "timeline") continue;
            events.push({
              type: "provider_subagent",
              provider: "omp",
              event: {
                type: "timeline",
                id,
                item: mapped.item,
                ...(timestamp ? { timestamp } : {}),
              },
            });
          }
        }
        state.size = snapshot.size;
        state.mtimeMs = snapshot.mtimeMs;
        this.transcripts.set(file, state);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          result.errors.push({ file, error });
        }
      }
    }
    return result;
  }
}
