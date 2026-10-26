// The Mini App business's owner.
//
// Everything this client knows about Mini Apps that is not layout: the
// catalogue, the view each Mini App is presented in, why a view was cleared, and
// the refusals a start earned. ADR 0020 puts it here rather than in the plugin
// catalogue (whose lifetime is installing packages) or the workspace panel
// (whose lifetime is layout), because the state is per session and the protocol
// is its own.
//
// Framework-free: no React, no DOM, no `window`. A component reads the snapshot
// and submits these commands; a test drives the same commands against a scripted
// port.
//
// Two rules the state exists to enforce:
//
//   * A refused start is a fact about a row, not a toast. The refusal is kept
//     under the plugin id it was about, so the catalogue's apps area and the
//     launcher's picker — two surfaces, one listing — both show it.
//   * A stopped runtime clears the view and says why, and nothing starts again
//     on its own. Only `open` starts a Mini App, and only a person calls it.

import type { PluginPort } from "../../plugins/contracts/plugin-port.js";
import { createWebuiPluginActions } from "../../plugins/contracts/plugin-actions.js";
import type { WebuiMiniAppList } from "../../../../shared/contracts/miniapp.js";
import type { MiniAppPort } from "../contracts/miniapp-port.js";
import {
  webuiMiniAppRows,
  webuiMiniAppStopReason,
  type WebuiMiniAppRow,
} from "../projection/miniapp-view.js";

/** The port members this business drives: its own three, and the package lifecycle. */
export type WebuiMiniAppPortSlice = Pick<
  MiniAppPort,
  "listMiniApps" | "openMiniApp" | "stopMiniApp"
> &
  Pick<PluginPort, "pluginManagement">;

/**
 * What this client is showing for one Mini App.
 *
 * `open` carries the proxy's view URL and nothing else — not the Mini App's
 * origin, not its surface path, not the credential its guard demands. `stopped`
 * is a cleared view that remembers why, which is what the panel renders instead
 * of a dead frame.
 */
export type WebuiMiniAppPresentation =
  | { readonly kind: "opening" }
  | { readonly kind: "open"; readonly viewUrl: string }
  | { readonly kind: "stopped"; readonly reason: string };

/** A structural refusal, kept under the plugin it was about. */
export interface WebuiMiniAppRefusal {
  /** The runtime's own wire code, e.g. `OWNED_ELSEWHERE`, `BUSY`. */
  readonly code: string;
  /** The runtime's own message. */
  readonly message: string;
}

export interface WebuiMiniAppListing {
  readonly rows: readonly WebuiMiniAppRow[];
  readonly loading: boolean;
  readonly error?: string;
}

export interface WebuiMiniAppWorkflowsState {
  readonly listing: WebuiMiniAppListing;
  /** Per plugin: the presentation this client holds. */
  readonly presentations: Readonly<Record<string, WebuiMiniAppPresentation>>;
  /** Per plugin: the last refusal a start of it earned. */
  readonly refusals: Readonly<Record<string, WebuiMiniAppRefusal>>;
  /** The plugin whose start is in flight, so its row can say so. */
  readonly opening?: string;
  /**
   * The capability's absence, when the host has no Mini App cell at all.
   *
   * A different answer from an empty catalogue, and it is said once here rather
   * than deduced by each surface from a missing port member.
   */
  readonly unavailable?: string;
}

export const initialWebuiMiniAppListing: WebuiMiniAppListing = {
  rows: [],
  loading: false,
};

export const initialWebuiMiniAppWorkflowsState: WebuiMiniAppWorkflowsState = {
  listing: initialWebuiMiniAppListing,
  presentations: {},
  refusals: {},
};

/** The code a refused call carries, when it carries one. */
function refusalOf(error: unknown): WebuiMiniAppRefusal {
  const code =
    error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code: string }).code)
      : "harness_error";
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}

export interface WebuiMiniAppWorkflows {
  readonly getSnapshot: () => WebuiMiniAppWorkflowsState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Whether the host exposes the capability at all. */
  readonly available: boolean;

  /** Read the catalogue. Rows carry the runtime's state; nothing is cached by key. */
  readonly loadListing: () => Promise<void>;
  /**
   * Start one Mini App and keep its view URL.
   *
   * `false` means the start was refused: the refusal is in the snapshot under
   * this plugin id, and both surfaces render it.
   */
  readonly open: (pluginId: string) => Promise<boolean>;
  /** Stop one Mini App and clear its view, recording why. */
  readonly stop: (pluginId: string) => Promise<void>;
  /**
   * Reconcile the open views with the runtime's own answer.
   *
   * A Mini App can stop without this client asking — the process exits, the
   * agent stops it, another window stops it. The view it was shown in has to go,
   * and the reason has to be said, so this is one read plus the transitions it
   * implies. It never starts anything.
   */
  readonly syncPresentations: () => Promise<void>;

  /** Package lifecycle, for the catalogue's apps area. */
  readonly setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  readonly uninstall: (pluginId: string) => Promise<void>;
}

export function createWebuiMiniAppWorkflows(deps: {
  readonly port: WebuiMiniAppPortSlice;
}): WebuiMiniAppWorkflows {
  const { port } = deps;
  const available =
    typeof port.listMiniApps === "function" &&
    typeof port.openMiniApp === "function" &&
    typeof port.stopMiniApp === "function";
  const pluginActions = createWebuiPluginActions({ pluginManagement: port.pluginManagement });
  let state: WebuiMiniAppWorkflowsState = available
    ? initialWebuiMiniAppWorkflowsState
    : {
        ...initialWebuiMiniAppWorkflowsState,
        unavailable: "当前运行时没有提供 Mini App 能力。",
      };
  const listeners = new Set<() => void>();
  /** One catalogue read at a time: a second read while one is open is that read. */
  let inFlight: Promise<WebuiMiniAppList | undefined> | undefined;

  const set = (
    update: (current: WebuiMiniAppWorkflowsState) => WebuiMiniAppWorkflowsState,
  ): void => {
    const next = update(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const setPresentation = (
    pluginId: string,
    presentation: WebuiMiniAppPresentation | undefined,
  ): void => {
    set((current) => {
      const presentations = { ...current.presentations };
      if (presentation) presentations[pluginId] = presentation;
      else delete presentations[pluginId];
      return { ...current, presentations };
    });
  };

  const setRefusal = (pluginId: string, refusal: WebuiMiniAppRefusal | undefined): void => {
    set((current) => {
      const refusals = { ...current.refusals };
      if (refusal) refusals[pluginId] = refusal;
      else delete refusals[pluginId];
      return { ...current, refusals };
    });
  };

  const readCatalogue = async (): Promise<WebuiMiniAppList | undefined> => {
    if (!port.listMiniApps) return undefined;
    const list = await port.listMiniApps();
    // A host that answers nothing, or something else, is an empty catalogue rather
    // than a thrown render: a panel that cannot read "no rows" takes the whole
    // workspace down with it.
    const rows = webuiMiniAppRows(Array.isArray(list?.miniApps) ? list.miniApps : []);
    set((current) => ({ ...current, listing: { rows, loading: false } }));
    return list;
  };

  const loadListing = async (): Promise<void> => {
    if (!available) return;
    set((current) => ({ ...current, listing: { ...current.listing, loading: true } }));
    try {
      inFlight = inFlight ?? readCatalogue();
      await inFlight;
    } catch (error) {
      set((current) => ({
        ...current,
        listing: { rows: current.listing.rows, loading: false, error: refusalOf(error).message },
      }));
    } finally {
      inFlight = undefined;
    }
  };

  const open = async (pluginId: string): Promise<boolean> => {
    if (!available || !port.openMiniApp) return false;
    set((current) => ({ ...current, opening: pluginId }));
    setRefusal(pluginId, undefined);
    try {
      const view = await port.openMiniApp({ pluginId });
      setPresentation(pluginId, { kind: "open", viewUrl: view.viewUrl });
      // The catalogue can open a Mini App without mounting its panel view, so
      // nothing else would refresh the runtime status after a successful start.
      await loadListing();
      return true;
    } catch (error) {
      const refusal = refusalOf(error);
      setPresentation(pluginId, undefined);
      setRefusal(pluginId, refusal);
      // The runtime refused to start, so the row it refused about is stale: a
      // capacity refusal names the running apps, and those names come from here.
      await loadListing();
      setRefusal(pluginId, refusal);
      return false;
    } finally {
      set((current) => {
        if (current.opening !== pluginId) return current;
        const next = { ...current };
        delete next.opening;
        return next;
      });
    }
  };

  const stop = async (pluginId: string): Promise<void> => {
    if (!available || !port.stopMiniApp) return;
    try {
      await port.stopMiniApp({ pluginId });
      setPresentation(pluginId, { kind: "stopped", reason: "运行已停止。" });
      setRefusal(pluginId, undefined);
    } catch (error) {
      setRefusal(pluginId, refusalOf(error));
      return;
    }
    await loadListing();
  };

  const syncPresentations = async (): Promise<void> => {
    if (!available) return;
    const openPlugins = Object.entries(state.presentations)
      .filter(([, presentation]) => presentation.kind === "open")
      .map(([pluginId]) => pluginId);
    if (openPlugins.length === 0) return;
    try {
      await loadListing();
    } catch {
      // A read that failed says nothing about a view that is up; the next one does.
      return;
    }
    set((current) => {
      let presentations: Record<string, WebuiMiniAppPresentation> | undefined;
      for (const pluginId of openPlugins) {
        const row = current.listing.rows.find((candidate) => candidate.pluginId === pluginId);
        const reason = webuiMiniAppStopReason(row);
        if (!reason) continue;
        presentations = presentations ?? { ...current.presentations };
        presentations[pluginId] = { kind: "stopped", reason };
      }
      return presentations ? { ...current, presentations } : current;
    });
  };

  const mutatePlugin = async (
    action: "enablePlugin" | "disablePlugin" | "uninstallPlugin",
    pluginId: string,
  ): Promise<void> => {
    if (!port.pluginManagement) return;
    try {
      await pluginActions.invoke(action, { pluginName: pluginId });
    } catch (error) {
      set((current) => ({ ...current, listing: { ...current.listing, error: refusalOf(error).message } }));
      return;
    }
    await loadListing();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    available,
    loadListing,
    open,
    stop,
    syncPresentations,
    setPluginEnabled: (pluginId, enabled) =>
      mutatePlugin(enabled ? "enablePlugin" : "disablePlugin", pluginId),
    uninstall: (pluginId) => mutatePlugin("uninstallPlugin", pluginId),
  };
}
