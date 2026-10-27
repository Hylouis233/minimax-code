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
import type {
  WebuiMiniAppCatalogue,
  WebuiMiniAppCatalogueRow,
} from "../../../../shared/contracts/miniapp.js";
import type {
  WebuiMiniAppAgentCallRequest,
  WebuiMiniAppAgentCallResponse,
  WebuiMiniAppAgentTurnFrame,
  WebuiMiniAppAgentTurnRequest,
} from "../../../../shared/contracts/miniapp-agent.js";
import type { MiniAppPort } from "../contracts/miniapp-port.js";
import {
  webuiMiniAppRows,
  webuiMiniAppStopReason,
  type WebuiMiniAppRow,
} from "../projection/miniapp-view.js";

/** The port members this business drives: its own five, and the package lifecycle. */
export type WebuiMiniAppPortSlice = Pick<
  MiniAppPort,
  | "listMiniApps"
  | "openMiniApp"
  | "stopMiniApp"
  | "watchMiniAppPresentation"
  | "miniappStandaloneUrl"
  | "watchMiniAppAgentTurn"
  | "miniAppAgentCall"
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
  | {
      readonly kind: "open";
      readonly viewUrl: string;
      /**
       * The generation the service issued for this start.
       *
       * Every page-bridge call echoes it, so a request from a replaced frame is
       * refused by the service rather than answered as the live one. It is the
       * client's fencing key and the server's, and it is per start, not per plugin.
       */
      readonly connection: number;
    }
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

/**
 * The presentation this document holds, when it is the standalone one.
 *
 * Only a standalone page has this: it is the frame the service answered its lease
 * with, so it carries what that lease is (the revision) and what the deep link
 * named (the session, and whether the runtime still answers for it).
 */
export interface WebuiMiniAppStandalone {
  readonly pluginId: string;
  readonly sessionId: string;
  readonly presentationRevision: number;
  readonly session: "live" | "ended";
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
   * The standalone presentation this document declared, once the service answered.
   *
   * Absent on an inline client, and absent on a standalone one until the lease's
   * first frame arrives — a host that does not wire the operation never sets it,
   * and the page then renders without a presentation notice rather than refusing.
   */
  readonly standalone?: WebuiMiniAppStandalone;
  /**
   * Why the standalone lease could not be established, when it could not.
   *
   * Distinct from an absent `standalone`: that is "no answer yet", this is "the
   * host answered with a failure". Neither is reported as an ended session.
   */
  readonly standaloneFailure?: string;
  /**
   * The capability's absence, when the host has no Mini App cell at all.
   *
   * A different answer from an empty catalogue, and it is said once here rather
   * than deduced by each surface from a missing port member.
   */
  readonly unavailable?: string;
  /**
   * The Mini App session the rail is showing because a page asked to see it.
   *
   * "Shown" is a claim about the client's selection, so it is recorded only after
   * the view selected the session and the service was told. When the person
   * leaves that session this is what makes the close report possible — and a
   * session nobody shows must not stay answerable, or its permission asks wait on
   * a panel that is gone.
   */
  readonly agentShown?: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly hostSessionId: string;
    readonly connection: number;
  };
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

  /**
   * Present this Mini App inline, or wait for the standalone tab that holds it.
   *
   * The result is what the caller's loop does next:
   *
   *   * `"presented"` — this client now frames it (or already did), so stop asking.
   *   * `"waiting"` — a standalone presentation is live, or the catalogue could not
   *     be read. Ask again: the lease ends when that tab closes, and a fresh read
   *     is the only thing that notices.
   *   * `"blocked"` — a start was refused or the app was stopped. Restarting either
   *     is the person's act, never a timer's.
   *
   * Always a fresh catalogue read, which is the point: a view mounted while another
   * document holds the presentation has no presentation of its own for
   * `syncPresentations` to reconcile.
   */
  readonly presentInline: (
    pluginId: string,
  ) => Promise<"presented" | "waiting" | "blocked">;

  /**
   * The standalone page for one Mini App, or `undefined` when the host does not
   * wire the route.
   *
   * The URL is built by the wire because it carries the service token; a UI that
   * assembled it would have to hold the credential, which is the one thing the
   * client is never given.
   */
  readonly standaloneUrl: (input: {
    readonly pluginId: string;
    readonly sessionId: string;
  }) => string | undefined;
  /**
   * Declare this document as the standalone presentation, and hold the lease.
   *
   * Returns the release. The service ties the lease to the connection this opens,
   * so calling it is what makes `detached` true for the inline view, and the
   * release — a closed tab, an unmount — is what makes it false again.
   */
  readonly claimStandalone: (input: {
    readonly pluginId: string;
    readonly sessionId: string;
  }) => () => void;

  /**
   * One followed turn for a page: the transport is the stream, `observe` is the
   * page's own claim and travels inside the body.
   */
  readonly watchAgentTurn: (
    request: WebuiMiniAppAgentTurnRequest,
    onFrame: (frame: WebuiMiniAppAgentTurnFrame) => void,
    onFailure: (error: Error) => void,
  ) => () => void;
  /** One short call. A host without the capability answers `runtime_unavailable`. */
  readonly agentCall: (
    request: WebuiMiniAppAgentCallRequest,
  ) => Promise<WebuiMiniAppAgentCallResponse>;
  /**
   * Report that the client now shows `sessionId` for `pluginId`.
   *
   * Called after the rail has actually selected it, never on the capability call:
   * the runtime treats a shown session as answerable, so claiming it early makes
   * its asks wait on a panel that is not on screen.
   */
  readonly reportShown: (input: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly hostSessionId: string;
    readonly connection: number;
  }) => Promise<void>;
  /**
   * The selection the shell resolved.
   *
   * Leaving the shown session is the close report; staying on it changes nothing.
   * The call is idempotent because a selection can be re-announced.
   */
  readonly noteSelectedSession: (sessionId: string | undefined) => void;
  /** The view is gone: nothing shows it any more, so stop counting it as shown. */
  readonly releaseShown: (pluginId: string) => void;
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
  let inFlight: Promise<WebuiMiniAppCatalogue | undefined> | undefined;

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

  const readCatalogue = async (): Promise<WebuiMiniAppCatalogue | undefined> => {
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
      setPresentation(pluginId, {
        kind: "open",
        viewUrl: view.viewUrl,
        connection: view.connection ?? 0,
      });
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

  /**
   * The standalone page, when the wire can build one.
   *
   * `undefined` rather than a hand-built path when the member is unwired: a link
   * the client assembled itself would either omit the service token or carry one
   * this layer does not hold.
   */
  const standaloneUrl = (input: {
    readonly pluginId: string;
    readonly sessionId: string;
  }): string | undefined => port.miniappStandaloneUrl?.(input);

  /**
   * Take the standalone lease, and keep it until the returned release is called.
   *
   * The first frame is the service's answer about the lease; it is kept in the
   * snapshot so the standalone surface can say what its deep link named. Nothing
   * here starts the Mini App — the view does that, through `open`, exactly as the
   * inline one does.
   */
  const claimStandalone = (input: {
    readonly pluginId: string;
    readonly sessionId: string;
  }): (() => void) => {
    if (!available || !port.watchMiniAppPresentation) return () => undefined;
    return port.watchMiniAppPresentation(
      input,
      (frame) => {
        if (frame.pluginId !== input.pluginId) return;
        set((current) => {
          const next: WebuiMiniAppWorkflowsState = {
            ...current,
            standalone: {
              pluginId: frame.pluginId,
              sessionId: frame.sessionId,
              presentationRevision: frame.presentationRevision,
              session: frame.session,
            },
          };
          if (current.standaloneFailure === undefined) return next;
          const cleared = { ...next };
          delete cleared.standaloneFailure;
          return cleared;
        });
      },
      // A refused lease is a failure this surface reports. It is deliberately not
      // stored as `standalone.session = "ended"`: nothing here knows what the
      // session is, only that the service could not say.
      (error) => {
        set((current) => ({
          ...current,
          standaloneFailure: error.message,
        }));
      },
    );
  };

  /**
   * Present here unless another document holds it, and keep asking while it does.
   *
   * The read is the mechanism, not an optimisation: the standalone lease is
   * recorded by the service and released when that tab's socket closes, so a fresh
   * catalogue read is the only way this document can learn it is free again.
   */
  const presentInline = async (
    pluginId: string,
  ): Promise<"presented" | "waiting" | "blocked"> => {
    if (!available) return "blocked";
    const current = state;
    const existing = current.presentations[pluginId];
    if (existing?.kind === "open" || existing?.kind === "opening") return "presented";
    // A cleared presentation or a refusal is the person's to retry, never a timer's.
    if (existing?.kind === "stopped" || current.refusals[pluginId] !== undefined) return "blocked";
    let catalogue: WebuiMiniAppCatalogue | undefined;
    try {
      catalogue = await readCatalogue();
    } catch {
      // A read that failed says nothing about the lease, and starting on a guess
      // could present a Mini App another tab is already showing. Ask again.
      return "waiting";
    }
    // A host that does not wire the catalogue has no presentation record to read,
    // so there is nothing to wait for and nothing to honour: start it, as the
    // mount always did.
    if (catalogue === undefined) return (await open(pluginId)) ? "presented" : "blocked";
    const row = catalogue.miniApps.find((candidate) => candidate.pluginId === pluginId);
    if (row?.detached === true) return "waiting";
    if (row?.runtime.status === "stopped") {
      // Terminal, and not this client's doing: the runtime is down and nobody here
      // asked it to stop, which is the cross-document case — this view was waiting
      // on another document's lease when that document stopped the app. #256's rule
      // is that a stopped runtime is reported and never reconnected without a
      // person, so the state is recorded (which is what makes the surface say why
      // and offer its own retry) and the loop ends.
      setPresentation(pluginId, { kind: "stopped", reason: "运行已停止。" });
      return "blocked";
    }
    return (await open(pluginId)) ? "presented" : "blocked";
  };

  /**
   * One page turn.
   *
   * A host without the member — an older client, a runtime composed without the
   * agent application — answers a documented code instead of a promise nobody
   * settles. The refusal is delivered through `onFailure` so both paths settle the
   * page's call the same way.
   */
  const watchAgentTurn: WebuiMiniAppWorkflows["watchAgentTurn"] = (request, onFrame, onFailure) => {
    if (!request.hostSessionId) {
      onFailure(Object.assign(new Error("not_permitted"), { code: "not_permitted" }));
      return () => undefined;
    }
    const watch = port.watchMiniAppAgentTurn;
    if (!watch) {
      onFailure(Object.assign(new Error("runtime_unavailable"), { code: "runtime_unavailable" }));
      return () => undefined;
    }
    return watch(request, onFrame, onFailure);
  };

  const agentCall: WebuiMiniAppWorkflows["agentCall"] = async (request) => {
    // No host session means no chat is showing this page, and the runtime refuses
    // such a caller anyway. Answering here keeps the page from waiting on a reply
    // the service would never send.
    if (!request.hostSessionId) return { ok: false, code: "not_permitted" };
    const call = port.miniAppAgentCall;
    if (!call) return { ok: false, code: "runtime_unavailable" };
    return call(request);
  };

  /** Stops counting one shown session as answerable, and says so. */
  const closeShown = async (shown: NonNullable<WebuiMiniAppWorkflowsState["agentShown"]>): Promise<void> => {
    set((current) => (current.agentShown === shown ? { ...current, agentShown: undefined } : current));
    await agentCall({
      pluginId: shown.pluginId,
      hostSessionId: shown.hostSessionId,
      connection: shown.connection,
      requestId: `panel-closed-${shown.sessionId}`,
      method: "panelClosed",
      targetSessionId: shown.sessionId,
    }).catch(() => undefined);
  };

  const reportShown: WebuiMiniAppWorkflows["reportShown"] = async (input) => {
    const response = await agentCall({
      pluginId: input.pluginId,
      hostSessionId: input.hostSessionId,
      connection: input.connection,
      requestId: `panel-shown-${input.sessionId}`,
      method: "panelOpened",
      targetSessionId: input.sessionId,
    });
    // Only a session the runtime accepted is recorded: recording it on a refused
    // report would make the close report name a panel the runtime never knew about.
    if (!response.ok) return;
    set((current) => ({ ...current, agentShown: input }));
  };

  const noteSelectedSession: WebuiMiniAppWorkflows["noteSelectedSession"] = (sessionId) => {
    const shown = state.agentShown;
    if (!shown) return;
    if (shown.sessionId === sessionId) return;
    void closeShown(shown);
  };

  const releaseShown: WebuiMiniAppWorkflows["releaseShown"] = (pluginId) => {
    const shown = state.agentShown;
    if (!shown || shown.pluginId !== pluginId) return;
    void closeShown(shown);
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
    presentInline,
    standaloneUrl,
    claimStandalone,
    watchAgentTurn,
    agentCall,
    reportShown,
    noteSelectedSession,
    releaseShown,
    setPluginEnabled: (pluginId, enabled) =>
      mutatePlugin(enabled ? "enablePlugin" : "disablePlugin", pluginId),
    uninstall: (pluginId) => mutatePlugin("uninstallPlugin", pluginId),
  };
}
