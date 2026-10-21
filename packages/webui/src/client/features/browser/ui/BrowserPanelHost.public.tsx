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
//
// The host is now keyed by **a target**, not by a switchable surface. Edge and
// Chrome are reached in the person's own windows, and the only surface the
// host is ever pointed at is the isolated Chromium: a web tab is the
// isolated Chromium's page, and the tab decides which target the host is on.
// The surface-switcher that used to sit at the top of `BrowserPanel` is gone.
//
// The authorization switches are not here any more: they are settings, and they
// live in the Settings page now. What is left in the panel is the answer —
// whether the surface on screen is authorized — and it comes from the browser
// family's owner, which the Settings page writes to.

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
  useWebuiBrowserAuthorization,
  useWebuiBrowserAuthorizationState,
} from "../bindings/use-browser-authorization.public.js";
import { prepareWebuiBrowserInputCommand } from "../application/browser-commands.js";
import type { BrowserPort } from "../contracts/browser-port.js";
import type { WebuiBrowserInputIntent } from "../contracts/browser-panel.js";
import {
  initialWebuiBrowserPanelState,
  reduceWebuiBrowserPanelState,
  selectWebuiBrowserStreamTarget,
  selectedWebuiBrowserRunTarget,
  webuiBrowserStreamTargetKey,
} from "../projection/browser-state.js";
import { BrowserPanel } from "./BrowserPanel.public.js";

export interface BrowserPanelHostProps {
  /**
   * The target the panel is showing.
   *
   * The strip passes the web tab's target here, and the host reads the
   * surface off the target. Edge and Chrome are no longer reachable from the
   * panel — they are driven in the person's own windows — so a target that
   * names another surface is left to show the unauthorized notice rather
   * than being hidden by a switcher.
   */
  readonly target?: WebuiBrowserTargetId;
  /**
   * The port.
   *
   * Optional, like every port member in this package: an absent port means the
   * host does not wire the browser family at all, and the panel says so rather
   * than discovering it by calling.
   *
   * The authorization is not read through this port: it belongs to the browser
   * family's owner, which the Settings page reads too, so that a switch moved
   * in the settings page reaches this panel.
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
  target: targetProp,
  port: portProp,
  runId: runIdProp,
}: BrowserPanelHostProps): ReactElement {
  const slice = useWebuiPortSlice("browser");
  const port = portProp ?? slice;
  const [state, dispatch] = useReducer(
    reduceWebuiBrowserPanelState,
    initialWebuiBrowserPanelState,
  );
  // The target the strip or the run handed us is the surface-bearing one; the
  // state still carries a `surface` because the reducer and the stream key
  // both want it, but the only writes it gets now are derived from the
  // target's surface, never from a switcher click.
  const surface = targetProp?.surface ?? state.surface;
  const activeRunId = useWebuiBrowserRunId();
  const runId = runIdProp ?? activeRunId;
  const runScope = useMemo(() => (runId ? { runId } : {}), [runId]);

  // The authorization is the browser family's, and it is read from the owner
  // the Settings page also reads: the switches moved to the settings page, and
  // a panel that kept a second copy would go on showing the answer it had when
  // the person moved the switch somewhere else.
  const authorizationOwner = useWebuiBrowserAuthorization();
  const authorizationState = useWebuiBrowserAuthorizationState();
  const authorization =
    authorizationState?.status === "ready" ? authorizationState.authorization : undefined;

  // The surface the effects last ran for. The frame stream is re-opened when
  // the surface changes, and the previous subscription has to be closed first —
  // the stream holds provider-side resources, and leaving one open would keep
  // a screencast running for a surface nobody is looking at.
  const subscribedSurface = useRef<WebuiBrowserSurface | undefined>(undefined);

  // The target the open subscription is attached to. The stream is keyed by
  // the target rather than by the run, so a run change does not reopen it —
  // the run decides what the Agent's commands act on, and the panel decides
  // what it shows.
  const subscribedTarget = useRef<string | undefined>(undefined);
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

  // The authorization is read by its owner, once, for every surface that needs
  // it. The panel asks for it here because the panel is a surface that needs it.
  useEffect(() => {
    void authorizationOwner?.load();
  }, [authorizationOwner]);

  // The panel's own state follows the owner's answer.
  useEffect(() => {
    if (!authorization) return;
    dispatch({ type: "authorization-loaded", authorization });
  }, [authorization]);

  useEffect(() => {
    let cancelled = false;
    if (!port) return () => undefined;
    void (async () => {
      try {
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

  // A target's surface moves the panel to that surface — the same effect the
  // old switcher used to drive, only the input is a target rather than a click.
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

  // The live image stream is opened for the **target** the panel is showing.
  //
  // The stream is keyed by the target rather than by the run, so two tabs get
  // their own pictures and the person and the Agent can work on different
  // pages at the same time. The subscription is tied to the target rather than
  // to the panel's lifetime: a subscription opened before there was anything
  // to show would never deliver a frame, and the panel would stay blank until
  // something else changed. A page that navigates gets a new generation, and
  // the subscription follows it.
  const streamTarget = selectWebuiBrowserStreamTarget(state);
  const selectedTargetKey = webuiBrowserStreamTargetKey(streamTarget);

  useEffect(() => {
    if (!port?.watchBrowserFrames) return;
    if (!streamTarget || !selectedTargetKey) {
      // Nothing is shown, so there is no page to stream.
      return;
    }
    if (
      subscribedSurface.current === surface &&
      subscribedTarget.current === selectedTargetKey
    ) {
      return;
    }
    subscribedSurface.current = surface;
    subscribedTarget.current = selectedTargetKey;
    const stop = port.watchBrowserFrames({ surface, target: streamTarget }, (frame) => {
      dispatch({ type: "frame", frame });
    });
    return () => {
      stop();
      subscribedSurface.current = undefined;
      subscribedTarget.current = undefined;
    };
  }, [port, selectedTargetKey, streamTarget, surface]);

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
        onSendInput={onSendInput}
        onRejected={onRejected}
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
