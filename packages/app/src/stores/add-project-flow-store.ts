import { create } from "zustand";

export interface AddProjectFlowRequest {
  id: number;
  preferredHostId?: string;
}

interface ProjectLocationHistory {
  lastLocation: string;
  lastCloneParent: string | undefined;
}

interface AddProjectFlowStoreState {
  request: AddProjectFlowRequest | null;
  /** Session history of successful clones and new folders, indexed by host. */
  locationsByHost: Record<string, ProjectLocationHistory | undefined>;
  open: (preferredHostId?: string) => void;
  close: () => void;
  rememberLocation: (hostId: string, location: string, kind: "clone" | "new-folder") => void;
}

let nextRequestId = 1;

export const useAddProjectFlowStore = create<AddProjectFlowStoreState>((set) => ({
  request: null,
  locationsByHost: {},
  open: (preferredHostId) => {
    set({
      request: {
        id: nextRequestId++,
        ...(preferredHostId ? { preferredHostId } : {}),
      },
    });
  },
  close: () => set({ request: null }),
  rememberLocation: (hostId, location, kind) =>
    set((state) => ({
      locationsByHost: {
        ...state.locationsByHost,
        [hostId]: {
          lastLocation: location,
          lastCloneParent:
            kind === "clone" ? location : state.locationsByHost[hostId]?.lastCloneParent,
        },
      },
    })),
}));
