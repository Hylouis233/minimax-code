// Browser storage IO.
//
// The browser persistence half of the former session-unread module: the
// storage key, the read that validates every stored value, and the write that
// keeps only positive counts. It decides no unread business rule — the badge
// format lives in `projection/common/unread-badge.ts` and the ordering lives with the
// commands that call this module — it only reads and writes what it is given.
//
// Every access is wrapped: storage may be absent (SSR, private mode) or throw
// on quota, and a failure degrades to "no counts" rather than taking the rail
// down with it.

import { isNoProjectFlag } from "./no-project.js";
import {
  parseTeamModeOff,
  parseTeamModeSessionChoices,
  type TeamModeSessionChoices,
} from "./team-mode.js";

export const SESSION_UNREAD_STORAGE_KEY = "mavis-session-unread";
export const MODEL_FAVORITES_KEY = "webui:model-favorites:v1";
export const NO_PROJECT_STORAGE_KEY = "mavis-no-project";
export const TEAM_MODE_STORAGE_KEY = "mavis-team-mode";
export const TEAM_MODE_SESSION_STORAGE_KEY = "mavis-team-mode:sessions:v1";
export const WEBUI_COMPOSER_STATE_KEY = "webui.composer.state.v1";

export function getWebuiBrowserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export interface WebuiBrowserStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
  readonly readFavoriteModels: (normalize: (value: unknown) => string[]) => string[];
  readonly writeFavoriteModels: (ids: readonly string[], normalize: (value: unknown) => string[]) => void;
  readonly readNoProjectFlag: () => boolean;
  readonly writeNoProjectFlag: (value: boolean) => void;
  readonly readTeamModeOff: () => boolean;
  readonly writeTeamModeOff: (value: boolean) => void;
  readonly readTeamModeSessionChoices: () => TeamModeSessionChoices;
  readonly writeTeamModeSessionChoice: (sessionId: string, value: boolean) => void;
  readonly loadComposer: <T>(parse: (raw: string | null | undefined) => T) => T;
  readonly saveComposer: <T>(
    state: T,
    serialize: (state: T, keepKeys?: readonly string[]) => string,
    keepKeys?: readonly string[],
  ) => void;
  readonly readUnreadCounts: () => Record<string, number>;
  readonly writeUnreadCounts: (counts: Readonly<Record<string, number>>) => void;
  /**
   * The rail's browser-local overlays. Declared here as part of the adapter's
   * own surface; the sessions feature states the subset it needs in
   * `features/sessions/bindings/use-session-rail-overlays.ts` and this adapter
   * satisfies it structurally, so a feature binding holds a contract rather
   * than this module.
   */
  readonly readSessionOverlay: (kind: WebuiSessionOverlay) => Record<string, boolean>;
  readonly toggleSessionOverlay: (
    kind: WebuiSessionOverlay,
    sessionId: string,
  ) => Record<string, boolean>;
  readonly readProjectPins: () => Record<string, boolean>;
  readonly toggleProjectPin: (projectKey: string) => Record<string, boolean>;
  readonly readProjectNames: () => Record<string, string>;
  readonly writeProjectName: (projectKey: string, name: string) => Record<string, string>;
}

/** Browser persistence boundary. Pure parsing and pruning remain in projection/value modules. */
export function createWebuiBrowserStorage(
  storage: Storage | undefined,
): WebuiBrowserStorage {
  const readFavoriteModels = (normalize: (value: unknown) => string[]): string[] => {
    if (!storage) return [];
    try {
      const raw = storage.getItem(MODEL_FAVORITES_KEY);
      return raw ? normalize(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  };
  const readTeamChoices = (): TeamModeSessionChoices => {
    if (!storage) return {};
    return parseTeamModeSessionChoices(storage.getItem(TEAM_MODE_SESSION_STORAGE_KEY));
  };
  const browserStorage: WebuiBrowserStorage = {
    getItem: (key) => {
      try { return storage?.getItem(key) ?? null; } catch { return null; }
    },
    setItem: (key, value) => {
      try { storage?.setItem(key, value); } catch { /* Preferences are best-effort. */ }
    },
    removeItem: (key) => {
      try { storage?.removeItem(key); } catch { /* Preferences are best-effort. */ }
    },
    readFavoriteModels,
    writeFavoriteModels: (ids, normalize) => {
      if (!storage) return;
      try {
        storage.setItem(MODEL_FAVORITES_KEY, JSON.stringify(normalize(ids)));
      } catch {
        // Preferences are best-effort; the in-memory selection remains usable.
      }
    },
    readNoProjectFlag: () => {
      if (!storage) return false;
      try {
        return isNoProjectFlag(storage.getItem(NO_PROJECT_STORAGE_KEY));
      } catch {
        return false;
      }
    },
    writeNoProjectFlag: (value) => {
      if (!storage) return;
      try {
        if (value) storage.setItem(NO_PROJECT_STORAGE_KEY, "true");
        else storage.removeItem(NO_PROJECT_STORAGE_KEY);
      } catch {
        // Storage can be unavailable or full; retain the in-memory choice.
      }
    },
    readTeamModeOff: () => storage ? parseTeamModeOff(storage.getItem(TEAM_MODE_STORAGE_KEY)) : true,
    writeTeamModeOff: (value) => storage?.setItem(TEAM_MODE_STORAGE_KEY, JSON.stringify(value)),
    readTeamModeSessionChoices: readTeamChoices,
    writeTeamModeSessionChoice: (sessionId, value) => {
      if (!storage) return;
      storage.setItem(TEAM_MODE_SESSION_STORAGE_KEY, JSON.stringify({ ...readTeamChoices(), [sessionId]: value }));
    },
    loadComposer: (parse) => {
      if (!storage) return parse(undefined);
      try {
        return parse(storage.getItem(WEBUI_COMPOSER_STATE_KEY));
      } catch {
        return parse(undefined);
      }
    },
    saveComposer: (state, serialize, keepKeys) => {
      if (!storage) return;
      try {
        storage.setItem(WEBUI_COMPOSER_STATE_KEY, serialize(state, keepKeys));
      } catch {
        // Draft/history persistence is best-effort; the live composer keeps working.
      }
    },
    readUnreadCounts: () => readWebuiUnreadCounts(storage),
    writeUnreadCounts: (counts) => writeWebuiUnreadCounts(counts, storage),
    // The rail's overlays. The keys and the stored format stay in this module,
    // while the rail's binding reads them through the interface in
    // `features/sessions/bindings/use-session-rail-overlays.ts`, which this
    // adapter satisfies. Self-reference is safe: these run after construction.
    readSessionOverlay: (kind) => readSessionOverlay(kind, browserStorage),
    toggleSessionOverlay: (kind, sessionId) =>
      toggleSessionOverlay(kind, sessionId, browserStorage),
    readProjectPins: () => readProjectPins(browserStorage),
    toggleProjectPin: (projectKey) => toggleProjectPin(projectKey, browserStorage),
    readProjectNames: () => readProjectNames(browserStorage),
    writeProjectName: (projectKey, name) =>
      writeProjectName(projectKey, name, browserStorage),
  };
  return browserStorage;
}

export function readWebuiUnreadCounts(
  storage: Storage | undefined,
): Record<string, number> {
  // `storage` is a **required** argument on purpose. It used to default to
  // `getWebuiBrowserStorage()`, which meant an explicit `undefined` — exactly
  // what `createWebuiBrowserStorage(undefined)` hands down — silently fell back
  // to the page's ambient `localStorage`. An adapter built with no storage then
  // read and wrote the ambient one anyway, so the empty adapter above stopped
  // meaning "no storage". A caller that does want the ambient store asks for it
  // by name (`getWebuiBrowserStorage()`).
  if (!storage) return {};
  try {
    const raw = storage.getItem(SESSION_UNREAD_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A stored value is only a count if it is a finite non-negative integer.
      // Anything else -- an object, a string, a negative, a float -- is dropped
      // rather than coerced, because `unread: NaN` would render a row that
      // claims to be waiting on nothing.
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
        counts[sessionId] = value;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

export function writeWebuiUnreadCounts(
  counts: Readonly<Record<string, number>>,
  storage: Storage | undefined,
): void {
  // Same required argument as `readWebuiUnreadCounts`: an explicit `undefined`
  // must mean "no storage" rather than re-acquiring the ambient one.
  if (!storage) return;
  try {
    const entries = Object.entries(counts).filter(([, count]) => count > 0);
    if (entries.length === 0) storage.removeItem(SESSION_UNREAD_STORAGE_KEY);
    else storage.setItem(SESSION_UNREAD_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage unavailable or over quota; the in-memory count still shows.
  }
}

// ---------------------------------------------------------------------------
// The rail's overlay flags. They live here rather than in the sessions feature's
// rail component (`features/sessions/ui/LeftRail.tsx`): browser storage IO
// belongs with the storage keys and readers, not in a component file. The
// component keeps the frame.
// ---------------------------------------------------------------------------

export const WEBUI_SESSION_OVERLAY_KEYS = {
  stars: "mavis-webui-session-stars:v1",
  pins: "mavis-webui-session-pins:v1",
  archives: "mavis-webui-session-archives:v1",
} as const;

export const WEBUI_PROJECT_OVERLAY_KEYS = {
  pins: "mavis-webui-project-pins:v1",
  names: "mavis-webui-project-names:v1",
} as const;

export type WebuiSessionOverlay = "stars" | "pins" | "archives";

export function readSessionOverlay(kind: WebuiSessionOverlay, storage: WebuiBrowserStorage): Record<string, boolean> {
  try {
    const value = JSON.parse(storage.getItem(WEBUI_SESSION_OVERLAY_KEYS[kind]) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function toggleSessionOverlay(kind: WebuiSessionOverlay, sessionId: string, storage: WebuiBrowserStorage): Record<string, boolean> {
  const next = readSessionOverlay(kind, storage);
  if (next[sessionId]) delete next[sessionId]; else next[sessionId] = true;
  storage.setItem(WEBUI_SESSION_OVERLAY_KEYS[kind], JSON.stringify(next));
  return next;
}

export function readProjectPins(storage: WebuiBrowserStorage): Record<string, boolean> {
  try {
    const value = JSON.parse(storage.getItem(WEBUI_PROJECT_OVERLAY_KEYS.pins) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function toggleProjectPin(projectKey: string, storage: WebuiBrowserStorage): Record<string, boolean> {
  const next = readProjectPins(storage);
  if (next[projectKey]) delete next[projectKey]; else next[projectKey] = true;
  storage.setItem(WEBUI_PROJECT_OVERLAY_KEYS.pins, JSON.stringify(next));
  return next;
}

export function readProjectNames(storage: WebuiBrowserStorage): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(WEBUI_PROJECT_OVERLAY_KEYS.names) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeProjectName(projectKey: string, name: string, storage: WebuiBrowserStorage): Record<string, string> {
  const next = readProjectNames(storage);
  next[projectKey] = name;
  storage.setItem(WEBUI_PROJECT_OVERLAY_KEYS.names, JSON.stringify(next));
  return next;
}
