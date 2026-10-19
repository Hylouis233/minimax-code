// The rail's overlay state: the pins of sessions, and the pins
// and names of projects.
//
// It used to live in the shell's rail hook, which read the platform storage
// adapter for it. The state belongs to Sessions — the overlays are part of the
// catalogue the rail presents — and the read belongs behind the feature's own
// surface, so both moved here; the adapter arrives as the injected capability
// the composition root supplies.
//
// The storage keys, the stored format and the normalization stay in the
// platform adapter (`platform/storage.ts`) — they are the persisted
// contract with earlier builds, not this feature's invention. What this module
// states is the surface it needs, so neither it nor the shell names a platform
// module. The behaviour is unchanged: a toggle writes through and returns the
// whole map, and the state starts from what storage already holds.
import { useCallback, useState } from "react";

/** The per-session overlay retained by the rail. */
export type WebuiSessionOverlayKind = "pins";

/** What the overlays need from browser storage, satisfied by that adapter. */
export interface WebuiRailOverlayStorage {
  readonly readSessionOverlay: (
    kind: WebuiSessionOverlayKind,
  ) => Record<string, boolean>;
  readonly toggleSessionOverlay: (
    kind: WebuiSessionOverlayKind,
    sessionId: string,
  ) => Record<string, boolean>;
  readonly readProjectPins: () => Record<string, boolean>;
  readonly toggleProjectPin: (projectKey: string) => Record<string, boolean>;
  readonly readProjectNames: () => Record<string, string>;
  readonly writeProjectName: (
    projectKey: string,
    name: string,
  ) => Record<string, string>;
}

export interface SessionRailOverlays {
  readonly pinnedSessions: Record<string, boolean>;
  readonly pinnedProjects: Record<string, boolean>;
  readonly projectNames: Record<string, string>;
  /** Toggle one session's pin and take the persisted map as truth. */
  readonly toggleSessionOverlay: (
    kind: WebuiSessionOverlayKind,
    sessionId: string,
  ) => void;
  readonly toggleProjectPin: (projectKey: string) => void;
  /** Persist a project's display name. The prompt that asks for it stays UI. */
  readonly renameProject: (projectKey: string, name: string) => void;
}

export function useSessionRailOverlays(
  storage: WebuiRailOverlayStorage,
): SessionRailOverlays {
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, boolean>>(
    () => storage.readSessionOverlay("pins"),
  );
  const [pinnedProjects, setPinnedProjects] = useState<Record<string, boolean>>(
    () => storage.readProjectPins(),
  );
  const [projectNames, setProjectNames] = useState<Record<string, string>>(
    () => storage.readProjectNames(),
  );
  const toggleSessionOverlay = useCallback(
    (kind: WebuiSessionOverlayKind, sessionId: string) => {
      const toggled = storage.toggleSessionOverlay(kind, sessionId);
      setPinnedSessions(toggled);
    },
    [storage],
  );
  const toggleProjectPin = useCallback(
    (projectKey: string) => {
      setPinnedProjects(storage.toggleProjectPin(projectKey));
    },
    [storage],
  );
  const renameProject = useCallback(
    (projectKey: string, name: string) => {
      setProjectNames(storage.writeProjectName(projectKey, name));
    },
    [storage],
  );
  return {
    pinnedSessions,
    pinnedProjects,
    projectNames,
    toggleSessionOverlay,
    toggleProjectPin,
    renameProject,
  };
}
