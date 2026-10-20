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
}

export function BrowserPanelHost({
  surface: surfaceProp,
  port: portProp,
}: BrowserPanelHostProps): ReactElement {
  const slice = useWebuiPortSlice("browser");
  const port = portProp ?? slice;
  const [state, dispatch] = useReducer(
    reduceWebuiBrowserPanelState,
    initialWebuiBrowserPanelState,
  );
  const surface = surfaceProp ?? state.surface;

  // The surface the effects last ran for. The frame stream is re-opened when
  // the surface changes, and the previous subscription has to be closed first —
  // the stream holds provider-side resources, and leaving one open would keep
  // a screencast running for a surface nobody is looking at.
  const subscribedSurface = useRef<WebuiBrowserSurface | undefined>(undefined);

  const refreshTargets = useCallback(
    async (next: WebuiBrowserSurface) => {
      if (!port?.listBrowserTargets) return;
      try {
        const list = await port.listBrowserTargets({ surface: next });
        dispatch({ type: "targets-loaded", list });
      } catch (error) {
        dispatch({ type: "failed", error: toBrowserError(error) });
      }
    },
    [port],
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

  useEffect(() => {
    if (!port?.listBrowserTargets) return;
    void refreshTargets(surface);
  }, [port, refreshTargets, surface]);

  useEffect(() => {
    if (!port?.watchBrowserFrames) return;
    if (subscribedSurface.current === surface) return;
    subscribedSurface.current = surface;
    const stop = port.watchBrowserFrames({ surface }, (frame) => {
      dispatch({ type: "frame", frame });
    });
    return () => {
      stop();
      subscribedSurface.current = undefined;
    };
  }, [port, surface]);

  const onSelectTarget = useCallback(
    (target: WebuiBrowserTargetId) => {
      dispatch({ type: "target-selected", target });
      void port?.selectBrowserTarget?.({ target }).catch((error: unknown) => {
        dispatch({ type: "failed", error: toBrowserError(error) });
      });
    },
    [port],
  );

  const onSendInput = useCallback(
    (command: WebuiBrowserInputCommand) => {
      void port?.sendBrowserInput?.(command).catch((error: unknown) => {
        dispatch({ type: "failed", error: toBrowserError(error) });
      });
    },
    [port],
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
