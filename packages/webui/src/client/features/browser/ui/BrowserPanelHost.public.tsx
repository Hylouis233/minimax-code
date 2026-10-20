// The browser panel's host.
//
// The panel itself is a pure view: it renders a state and reports what the
// person did. Something has to own that state, drive the port and keep the two
// in step — and that something cannot live in another business. The workspace
// panel may only reach this business's **published** surface, so the owner
// lives here, in the browser business, and the workspace mounts this one
// component.
//
// The alternative — a workspace component importing this business's reducer
// directly — is a private-peer import the dependency rules forbid, and the
// rules are right: a foreign business must not be able to construct another
// business's state. It may only ask the owner to.

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactElement,
} from "react";

import type {
  WebuiBrowserError,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
} from "../../../../shared/contracts/browser.js";
import { useWebuiPortSlice } from "../../../bindings/port-slices-context.js";
import { useWebuiBrowserRunId } from "../bindings/use-browser-run.public.js";
import {
  applyWebuiBrowserAuthorizationChange,
  prepareWebuiBrowserInputCommand,
  webuiBrowserAuthorizationChange,
} from "../application/browser-commands.js";
import type { BrowserPort } from "../contracts/browser-port.js";
import type { WebuiBrowserInputIntent } from "../contracts/browser-panel.js";
import {
  initialWebuiBrowserPanelState,
  reduceWebuiBrowserPanelState,
  selectedWebuiBrowserRunTarget,
} from "../projection/browser-state.js";
import { BrowserAuthorizationSwitches } from "./BrowserAuthorizationSwitches.public.js";
import { BrowserPanel } from "./BrowserPanel.public.js";

export interface BrowserPanelHostProps {
  /**
   * The surface the panel is showing.
   *
   * The isolated Chromium by default; the person's own Edge or Chrome once the
   * panel is pointed at them. Changing it re-reads the targets and re-opens the
   * live image stream for the new surface.
   */
  readonly surface?: WebuiBrowserSurface;
  /**
   * The port.
   *
   * Optional, like every port member in this package: an absent port means the
   * host does not wire the browser family at all, and the panel says so rather
   * than discovering it by calling.
   */
  readonly port?: BrowserPort;
  /**
   * The run whose selection the panel is showing, when the host knows it.
   *
   * Normally left out: the panel reads the active run itself (ADR 0019 — the
   * panel follows the active run's target), so a caller that happens to know it
   * does not have to keep saying so.
   */
  readonly runId?: string;
}

export function BrowserPanelHost({
  surface: surfaceProp,
  port: portProp,
  runId: runIdProp,
}: BrowserPanelHostProps): ReactElement {
  const slice = useWebuiPortSlice("browser");
  const port = portProp ?? slice;
  const [state, dispatch] = useReducer(
    reduceWebuiBrowserPanelState,
    initialWebuiBrowserPanelState,
  );
  const surface = surfaceProp ?? state.surface;
  const activeRunId = useWebuiBrowserRunId();
  const runId = runIdProp ?? activeRunId;
  const runScope = useMemo(() => (runId ? { runId } : {}), [runId]);

  // The surface the effects last ran for. The frame stream is re-opened when
  // the surface changes, and the previous subscription has to be closed first —
  // the stream holds provider-side resources, and leaving one open would keep
  // a screencast running for a surface nobody is looking at.
  const subscribedSurface = useRef<WebuiBrowserSurface | undefined>(undefined);

  // The run the stream was opened for. The stream carries one run's target, so
  // the active run changing means the old one has to be closed and the new one's
  // opened — otherwise the panel would keep showing the previous run's page.
  const subscribedRunId = useRef<string | undefined>(undefined);

  // The run the panel is on, kept where a read that is still in flight can see
  // it. The effect below is what moves it, so it is current before any read for
  // the new run starts.
  const currentRunId = useRef(runId);

  const refreshTargets = useCallback(
    async (next: WebuiBrowserSurface) => {
      if (!port?.listBrowserTargets) return;
      const askedFor = runId;
      try {
        const list = await port.listBrowserTargets({ surface: next, ...runScope });
        // The list answers for the run that asked for it. One that lands after
        // the active run moved on is the previous run's selection, and taking it
        // would put the panel back on a page nobody is following.
        if (askedFor !== currentRunId.current) return;
        dispatch({ type: "targets-loaded", list, selected: selectedWebuiBrowserRunTarget(list) });
      } catch (error) {
        if (askedFor !== currentRunId.current) return;
        dispatch({ type: "failed", error: toBrowserError(error) });
      }
    },
    [port, runId, runScope],
  );

  useEffect(() => {
    let cancelled = false;
    if (!port) return () => undefined;
    void (async () => {
      try {
        if (port.getBrowserAuthorization) {
          const authorization = await port.getBrowserAuthorization();
          if (!cancelled) dispatch({ type: "authorization-loaded", authorization });
        }
        if (port.listBrowserCapabilities) {
          const capabilities = await port.listBrowserCapabilities();
          if (!cancelled) {
            dispatch({ type: "capabilities-loaded", entries: capabilities.entries });
          }
        }
      } catch (error) {
        if (!cancelled) dispatch({ type: "failed", error: toBrowserError(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port]);

  useEffect(() => {
    if (surface !== state.surface) {
      dispatch({ type: "surface-changed", surface });
    }
  }, [surface, state.surface]);

  // The panel follows the active run. A run's selection belongs to that run, so
  // when the active run changes the previous one is forgotten rather than shown
  // as if it were still the run's target — and this runs before the read below,
  // so the new run's own selection is what arrives next.
  useEffect(() => {
    currentRunId.current = runId;
    dispatch({ type: "run-changed" });
  }, [runId]);

  useEffect(() => {
    if (!port?.listBrowserTargets) return;
    void refreshTargets(surface);
  }, [port, refreshTargets, surface]);

  useEffect(() => {
    if (!port?.watchBrowserFrames) return;
    if (subscribedSurface.current === surface && subscribedRunId.current === runId) return;
    subscribedSurface.current = surface;
    subscribedRunId.current = runId;
    const stop = port.watchBrowserFrames({ surface, ...runScope }, (frame) => {
      dispatch({ type: "frame", frame });
    });
    return () => {
      stop();
      subscribedSurface.current = undefined;
      subscribedRunId.current = undefined;
    };
  }, [port, runScope, surface, runId]);

  const onSelectTarget = useCallback(
    (target: WebuiBrowserTargetId) => {
      dispatch({ type: "target-selected", target });
      void port?.selectBrowserTarget?.({ target, ...runScope }).catch((error: unknown) => {
        dispatch({ type: "failed", error: toBrowserError(error) });
      });
    },
    [port, runScope],
  );

  const onSendInput = useCallback(
    (command: WebuiBrowserInputCommand) => {
      void port
        ?.sendBrowserInput?.({ command, ...runScope })
        .catch((error: unknown) => {
          dispatch({ type: "failed", error: toBrowserError(error) });
        });
    },
    [port, runScope],
  );

  const onRejected = useCallback((error: WebuiBrowserError) => {
    dispatch({ type: "failed", error });
  }, []);

  const onToggle = useCallback(
    (toggle: Parameters<typeof webuiBrowserAuthorizationChange>[0]) => {
      const change = webuiBrowserAuthorizationChange(toggle);
      // The optimistic preview is only safe because the change names one
      // field: the other three switches are carried over untouched.
      dispatch({
        type: "authorization-loaded",
        authorization: applyWebuiBrowserAuthorizationChange(state.authorization, change),
      });
      void port
        ?.setBrowserAuthorization?.(change)
        ?.then((authorization) => {
          dispatch({ type: "authorization-loaded", authorization });
        })
        .catch((error: unknown) => {
          dispatch({
            type: "authorization-loaded",
            authorization: state.authorization,
          });
          dispatch({ type: "failed", error: toBrowserError(error) });
        });
    },
    [port, state.authorization],
  );

  const buildInput = useMemo(
    () =>
      (intent: WebuiBrowserInputIntent) => prepareWebuiBrowserInputCommand(state, intent),
    [state],
  );

  return (
    <div className="webui-browser-host" data-testid="browser-panel-host">
      <BrowserPanel
        port={port}
        state={state}
        onSelectTarget={onSelectTarget}
        onSurfaceChange={(next) => dispatch({ type: "surface-changed", surface: next })}
        onSendInput={onSendInput}
        onRejected={onRejected}
      />
      <BrowserAuthorizationSwitches
        authorization={state.authorization}
        onChange={onToggle}
        disabled={!port?.setBrowserAuthorization}
      />
    </div>
  );
}

/**
 * A failure that reached the client without a browser error code.
 *
 * The port's refusals arrive already shaped; anything else is a transport
 * failure, and it is reported as such rather than dressed up as a browser
 * refusal the person would try to fix by toggling a switch.
 */
function toBrowserError(error: unknown): WebuiBrowserError {
  if (error && typeof error === "object" && "code" in error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code as WebuiBrowserError["code"],
        message:
          typeof candidate.message === "string" ? candidate.message : "The browser request failed.",
        retryable: false,
      };
    }
  }
  return {
    code: "browser_provider_unavailable",
    message: error instanceof Error ? error.message : "The browser request failed.",
    retryable: true,
  };
}
