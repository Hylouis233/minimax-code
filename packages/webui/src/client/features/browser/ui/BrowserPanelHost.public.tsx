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
//
// The **toolbar** is here too, above the panel. It is chrome for one page, and
// the page is this business's: the strip owns the row of tabs and nothing
// between them, and a workspace component that drew the chrome of a foreign
// business's page would be the dependency rule inverted. So the toolbar is a
// view over what the tab holds — its target and the url the runtime published
// with it — and both are values, not authority: the host drives the port and
// the strip never does.
//
// **Two cells meet here.** The `target` prop is the client's: the tab the person
// is looking at, which the strip chooses and this host binds every display and
// every gesture to. The run's selection is the runtime's, and the host only
// reads it — out of the target list the runtime publishes — so that the panel
// can say which page the Agent is on. Nothing a person does in this component
// writes it, and the one write that crosses cells is the runtime's bootstrap
// (ADR 0022).

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
} from "react";

import type {
  WebuiBrowserCommandRequest,
  WebuiBrowserError,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
  WebuiBrowserWebTabSnapshot,
} from "../../../../shared/contracts/browser.js";
import { useWebuiPortSlice } from "../../../bindings/port-slices-context.js";
import { useWebuiSettingsWorkflowsState } from "../../../bindings/use-query-state.js";
import { useWebuiBrowserRunId } from "../bindings/use-browser-run.public.js";
import {
  useWebuiBrowserAuthorization,
  useWebuiBrowserAuthorizationState,
} from "../bindings/use-browser-authorization.public.js";
import { prepareWebuiBrowserInputCommand } from "../application/browser-commands.js";
import type { BrowserPort } from "../contracts/browser-port.js";
import {
  isUsableWebuiBrowserTargetId,
  type WebuiBrowserInputIntent,
} from "../contracts/browser-panel.js";
import {
  initialWebuiBrowserPanelState,
  reduceWebuiBrowserPanelState,
  selectWebuiBrowserStreamTarget,
  selectedWebuiBrowserRunTarget,
  webuiBrowserStreamTargetKey,
} from "../projection/browser-state.js";
import { BrowserPanel } from "./BrowserPanel.public.js";

/**
 * The commands a web tab's toolbar can send.
 *
 * Three, and no more. They are the page's own history and its own re-read —
 * what a tab does to the page it holds. Opening a url is not one of them: the
 * address box exists in the new tab page, which is the only place a person
 * types a url.
 */
export const WEBUI_BROWSER_TOOLBAR_COMMANDS = ["back", "forward", "reload"] as const;

export type WebuiBrowserToolbarCommand = (typeof WEBUI_BROWSER_TOOLBAR_COMMANDS)[number];

const TOOLBAR_COPY = {
  label: "网页工具栏",
  urlLabel: "当前网址",
  commands: {
    back: "后退",
    forward: "前进",
    reload: "刷新",
  },
} as const;

export interface BrowserPanelHostProps {
  /**
   * The target the panel is showing — the tab the person is looking at.
   *
   * The strip passes the web tab's target here, and the host reads the
   * surface off the target. This is the client's cell: the picture, the toolbar
   * and every pointer, key and text gesture are bound to this page and to no
   * other, so a person working in one tab never types into the Agent's page
   * (ADR 0022). Edge and Chrome are no longer reachable from the
   * panel — they are driven in the person's own windows — so a target that
   * names another surface is left to show the unauthorized notice rather
   * than being hidden by a switcher.
   */
  readonly target?: WebuiBrowserTargetId;
  /**
   * The url of the page the target is on, as the runtime last reported it.
   *
   * The toolbar shows this as text and never as a field: the only address box
   * in the workspace is the new tab page's. It arrives as a prop for the same
   * reason the target does — the runtime publishes the url with the target, and
   * the host reads both together so the toolbar and the frame describe the same
   * navigation rather than a pair that has drifted.
   */
  readonly url?: string;
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
   * The run whose selection the panel is reporting, when the host knows it.
   *
   * Normally left out: the panel reads the active run itself (ADR 0019 — the
   * panel follows the active run), so a caller that happens to know it does not
   * have to keep saying so. It scopes the *runtime's* cell and the fences that
   * are scoped with it; it is not what the panel shows, which is the tab's own
   * target.
   */
  readonly runId?: string;
}

export function BrowserPanelHost({
  target: targetProp,
  url: urlProp,
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

  // The handshake's manifest, so the panel can say *why* a family is unusable.
  // It arrives with the runtime's version, and the shell reads that; a panel
  // that asked for nothing was told "unknown" for ever, and said the runtime
  // had no browser while it was drawing one.
  const settingsState = useWebuiSettingsWorkflowsState();
  const capabilityManifest = settingsState.runtimeVersion.value?.capabilities;

  // The session's web tabs, as the runtime published them. The panel's list
  // shows these: a browser holds pages that are not tabs — the page it opens at
  // startup, the one the provider drives for itself — and listing those beside
  // the tabs is what makes a browser with one tab read as three.
  const [webTabs, setWebTabs] = useState<WebuiBrowserWebTabSnapshot | undefined>(undefined);
  const watchBrowserWebTabs = port?.watchBrowserWebTabs;

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

  // The session's web tabs, subscribed once for the surface the panel is on.
  // When the slice's `watchBrowserWebTabs` changes identity the previous
  // subscription is closed and a new one is opened, the same way the strip's
  // own subscription is managed.
  const watchTabsKey = watchBrowserWebTabs ?? null;
  useEffect(() => {
    if (!watchBrowserWebTabs) return;
    const stop = watchBrowserWebTabs({ surface, ...runScope }, (snapshot) => {
      setWebTabs(snapshot);
    });
    return () => {
      stop();
    };
  }, [watchTabsKey, surface, runScope]);

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

  // The client's cell, written here and only here. The strip hands the host the
  // tab that is in front, and this is what tells the panel which page that is — so
  // the picture, the alt text and the input binding all follow the tab the person
  // chose. The run's selection is a different cell (ADR 0022) and this effect does
  // not touch it: a person switching tabs never moves the Agent off its page.
  useEffect(() => {
    if (!isUsableWebuiBrowserTargetId(targetProp)) return;
    dispatch({ type: "page-viewed", target: targetProp });
  }, [targetProp]);

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
  const streamTargetKey = webuiBrowserStreamTargetKey(streamTarget);

  useEffect(() => {
    if (!port?.watchBrowserFrames) return;
    if (!streamTarget || !streamTargetKey) {
      // Nothing is shown, so there is no page to stream.
      return;
    }
    if (
      subscribedSurface.current === surface &&
      subscribedTarget.current === streamTargetKey
    ) {
      return;
    }
    subscribedSurface.current = surface;
    subscribedTarget.current = streamTargetKey;
    const stop = port.watchBrowserFrames({ surface, target: streamTarget }, (frame) => {
      dispatch({ type: "frame", frame });
    });
    return () => {
      stop();
      subscribedSurface.current = undefined;
      subscribedTarget.current = undefined;
    };
  }, [port, streamTargetKey, streamTarget, surface]);

  const onSendInput = useCallback(
    (command: WebuiBrowserInputCommand) => {
      // The command already names the page in front — the target was bound to it
      // when the gesture was built — so this is a send, not a selection. The run
      // scope rides along only because the runtime's own fence is scoped; nothing
      // here reads or moves the run's selection.
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

  // The toolbar's three commands go through the browser family's own command
  // operation — the same one a run's tools use, with the page named so that the
  // runtime acts on the tab rather than on whichever page a selection points at.
  const onToolbarCommand = useCallback(
    (command: WebuiBrowserToolbarCommand) => {
      if (!targetProp) return;
      void webuiBrowserToolbarRun({
        send: port?.sendBrowserCommand,
        target: targetProp,
        command,
      }).catch((error: unknown) => {
        dispatch({ type: "failed", error: toBrowserError(error) });
      });
    },
    [port, targetProp],
  );

  const buildInput = useMemo(
    () =>
      // Bound to the page the person is looking at, and read at send time from
      // that cell alone: a gesture can never be re-aimed at the Agent's page.
      (intent: WebuiBrowserInputIntent) =>
        prepareWebuiBrowserInputCommand(state.viewedPage, intent),
    [state],
  );

  return (
    <div className="webui-browser-host" data-testid="browser-panel-host">
      {targetProp ? (
        <WebuiBrowserToolbar url={urlProp} onCommand={onToolbarCommand} />
      ) : null}
      <BrowserPanel
        port={port}
        state={state}
        capabilities={capabilityManifest}
        webTabs={webTabs}
        onSendInput={onSendInput}
        onRejected={onRejected}
      />
    </div>
  );
}

/**
 * The request one toolbar press sends.
 *
 * The target rides along with the command rather than being resolved on the
 * other end. A web tab holds exactly one page, so the person pressing back means
 * the page in front of them; a request that left the target off would act on the
 * surface's selection — a run's page, or the panel's own cell — which is a page
 * the tab may not even be showing.
 */
export function webuiBrowserToolbarRequest(
  target: WebuiBrowserTargetId,
  command: WebuiBrowserToolbarCommand,
): WebuiBrowserCommandRequest {
  return { surface: target.surface, command, target };
}

/**
 * Runs one toolbar press through the browser family's command path.
 *
 * The send function is injected so the transition is testable on its own, and a
 * refusal travels out unchanged: the runtime's own code and message are what the
 * person needs — a bridge that is switched off says `browser_capability_denied`,
 * and a page that moved says `browser_target_stale`. Neither is papered over here.
 */
export async function webuiBrowserToolbarRun(input: {
  readonly send: ((request: WebuiBrowserCommandRequest) => Promise<unknown>) | undefined;
  readonly target: WebuiBrowserTargetId;
  readonly command: WebuiBrowserToolbarCommand;
}): Promise<void> {
  if (!input.send) {
    throw {
      code: "browser_provider_unavailable",
      message: "当前运行时没有浏览器命令能力，工具栏不可用。",
      retryable: false,
    } satisfies WebuiBrowserError;
  }
  await input.send(webuiBrowserToolbarRequest(input.target, input.command));
}

/**
 * The chrome above one page.
 *
 * The url is a `<span>`, not an `<input>`. A web tab is not somewhere a person
 * types a url: the address box is the new tab page's, and a field here would be
 * a second one that could disagree with it.
 */
function WebuiBrowserToolbar({
  url,
  onCommand,
}: {
  readonly url?: string;
  readonly onCommand: (command: WebuiBrowserToolbarCommand) => void;
}): ReactElement {
  return (
    <div
      className="webui-browser-toolbar"
      role="toolbar"
      aria-label={TOOLBAR_COPY.label}
      data-testid="browser-toolbar"
    >
      {WEBUI_BROWSER_TOOLBAR_COMMANDS.map((command) => (
        <button
          key={command}
          type="button"
          className="webui-browser-toolbar-command"
          aria-label={TOOLBAR_COPY.commands[command]}
          data-testid={`browser-toolbar-${command}`}
          onClick={() => onCommand(command)}
        >
          {TOOLBAR_COPY.commands[command]}
        </button>
      ))}
      <span
        className="webui-browser-toolbar-url"
        aria-label={TOOLBAR_COPY.urlLabel}
        data-testid="browser-toolbar-url"
      >
        {url ?? ""}
      </span>
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
