// The Mini App view the workspace panel frames, and the standalone page reuses.
//
// Published by the Mini App business because the state it renders is this
// business's: which view URL a Mini App is presented at, whether it is starting,
// why a view was cleared, and whether the same Mini App is already on screen in a
// browser tab of its own. The panel mounts it for its `miniapp` tab kind and stays
// the layout owner; it learns nothing about Mini Apps beyond the plugin id its tab
// carries.
//
// Four properties are worth stating, because all four were decisions:
//
//   * **The iframe is not sandboxed.** Isolation is origin separation (ADR 0020):
//     the document comes from the proxy's own loopback origin, so it runs in its
//     own process and cannot read this client's credential. A sandbox attribute
//     would instead deny the page the storage and runtime a Mini App is a
//     Mini App because of.
//   * **A stopped runtime is a rendered state, not an empty frame.** The view
//     remembers why it was cleared and offers one button to reopen it. Nothing
//     reopens on its own: a tab may be unattended, and a retry loop would restart
//     an application the person did not ask for.
//   * **One presentation is live at a time.** While a standalone tab holds the
//     lease, this view reports that and offers to switch to it — it does not frame
//     a second presentation and does not start anything. `detached` comes from the
//     service's record, not from this component's own guess.
//   * **The standalone page has no way back.** `surface="standalone"` renders the
//     same view without the move controls, because returning is closing the tab
//     and that releases the lease (ADR 0020). It also claims the browsing-context
//     name the inline control focuses.

import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
} from "react";

import {
  WEBUI_MINIAPP_BRIDGE_APPEND_REPLY,
  type WebuiMiniAppComposerResult,
} from "../../../../shared/contracts/miniapp.js";
import { useWebuiComposerStore } from "../../../bindings/composer-store.js";
import {
  useWebuiMiniAppWorkflows,
  useWebuiMiniAppWorkflowsState,
} from "../bindings/use-miniapp-workflows.js";
import { WEBUI_COMPOSER_HOME_KEY } from "../../composer/contracts/composer-state.js";
import {
  webuiMiniAppBridgeAppend,
  webuiMiniAppBridgeRequest,
  webuiMiniAppBridgeSenderAllowed,
} from "../application/miniapp-bridge.js";
import { createWebuiMiniAppAgentBridge } from "../application/miniapp-agent-bridge.js";
import {
  readSessionIdFromHash,
  subscribeToSessionHash,
} from "../../../bindings/navigation.js";
import { sessionHash } from "../../../projection/common/router.js";
import {
  webuiMiniAppRefusalText,
  webuiMiniAppWindowName,
} from "../projection/miniapp-view.js";

/**
 * How often an open view asks the runtime whether it is still up.
 *
 * One read of a small catalogue. A Mini App can stop without this client asking,
 * and the alternative to asking is a frame that silently serves a dead page — the
 * case ADR 0020 calls out ("a stopped runtime clears the view and reports why").
 * The same read is what tells this view that a standalone tab took the
 * presentation, or gave it back.
 */
const PRESENTATION_SYNC_MS = 2_000;

/** Which of ADR 0020's two presentations is mounting this view. */
export type WebuiMiniAppSurface = "inline" | "standalone";

export interface MiniAppViewProps {
  readonly pluginId: string;
  /** The session whose composer a confirmed append writes to. */
  readonly sessionId?: string;
  /** The tab's own title, when the panel has one. */
  readonly title?: string;
  /**
   * The presentation this view is, `inline` by default.
   *
   * The only difference is the move controls: an inline view offers to open a
   * standalone one and to switch to it, while the standalone view offers neither.
   */
  readonly surface?: WebuiMiniAppSurface;
}

export function MiniAppView({
  pluginId,
  sessionId,
  title,
  surface = "inline",
}: MiniAppViewProps): ReactElement {
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const composer = useWebuiComposerStore();
  const presentation = state.presentations[pluginId];
  const refusal = state.refusals[pluginId];
  const row = state.listing.rows.find((candidate) => candidate.pluginId === pluginId);
  const name = row?.name ?? pluginId;
  const standalone = surface === "standalone";
  /**
   * Whether another document is presenting this Mini App right now.
   *
   * Never true for the standalone surface: it is the document holding the lease,
   * so reporting itself as "open elsewhere" would be the one wrong answer.
   */
  const detached = !standalone && row?.detached === true;
  const frameRef = useRef<HTMLIFrameElement>(null);

  /**
   * Present the Mini App here, or wait for the standalone tab that holds it.
   *
   * The first ask starts it — that is what opening a tab means — and every later
   * ask is one catalogue read, because the only event that says the tab closed is
   * the record itself. `presentInline` refuses to restart a refused or stopped
   * Mini App, so this loop cannot turn into a retry the person did not ask for.
   *
   * The standalone surface never waits: it *is* the presentation, so the lease the
   * catalogue reports is its own.
   */
  useEffect(() => {
    if (!workflows || presentation !== undefined) return;
    if (standalone) {
      void workflows.open(pluginId);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const ask = async (): Promise<void> => {
      const outcome = await workflows.presentInline(pluginId).catch(() => "waiting" as const);
      if (stopped) return;
      if (outcome !== "waiting") {
        if (timer !== undefined) clearInterval(timer);
        return;
      }
      timer ??= setInterval(() => void ask(), PRESENTATION_SYNC_MS);
    };
    void ask();
    return () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [pluginId, presentation, standalone, workflows]);

  /** While a view is up, the runtime is asked whether it still is. */
  useEffect(() => {
    if (!workflows || presentation?.kind !== "open") return;
    const timer = setInterval(() => void workflows.syncPresentations(), PRESENTATION_SYNC_MS);
    return () => clearInterval(timer);
  }, [presentation?.kind, workflows]);

  /**
   * Claim the tab's browsing-context name, so the inline view can focus it.
   *
   * A tab opened by the inline control already has the name it was opened with; a
   * tab reached by a pasted deep link does not, and without this the inline view's
   * switch would open one more document instead of focusing this one.
   */
  useEffect(() => {
    if (!standalone) return;
    window.name = webuiMiniAppWindowName(pluginId);
  }, [pluginId, standalone]);

  /** Open the standalone page, or focus the tab that already holds it. */
  const standaloneHref =
    !standalone && sessionId !== undefined
      ? workflows?.standaloneUrl({ pluginId, sessionId })
      : undefined;

  const moveToStandalone = useCallback((): void => {
    if (!standaloneHref) return;
    // A named context is reused when it exists, which is what makes the switch a
    // switch: same URL, same name, and the browser focuses the document that is
    // already there rather than creating a second one.
    window.open(standaloneHref, webuiMiniAppWindowName(pluginId));
  }, [pluginId, standaloneHref]);

  const answer = useCallback(
    (target: Window, origin: string, reply: { requestId: string; result: WebuiMiniAppComposerResult }) => {
      target.postMessage(
        { type: WEBUI_MINIAPP_BRIDGE_APPEND_REPLY, requestId: reply.requestId, result: reply.result },
        origin,
      );
    },
    [],
  );

  /**
   * The page bridge's host half.
   *
   * A message is read only when it came from the frame this view created, on the
   * origin this view framed, and the answer goes back to that origin only. Every
   * other sender is ignored rather than answered: a page that is not this Mini App
   * has nothing this client would say to it.
   */
  useEffect(() => {
    if (presentation?.kind !== "open" || detached) return;
    const viewUrl = presentation.viewUrl;
    const onMessage = (event: MessageEvent): void => {
      const request = webuiMiniAppBridgeRequest(event.data);
      if (!request) return;
      const frame = frameRef.current?.contentWindow;
      if (
        !webuiMiniAppBridgeSenderAllowed({
          origin: event.origin,
          viewUrl,
          source: event.source,
          frame: frame ?? null,
        }) ||
        !frame
      ) {
        return;
      }
      const origin = event.origin;
      void webuiMiniAppBridgeAppend({
        request,
        ...(sessionId !== undefined ? { sessionId } : {}),
        pluginName: name,
        // The person's confirmation, not the page's claim: an untrusted document
        // may ask, and only a person may decide.
        confirm: (question) => window.confirm(question),
        readDraft: () => composer.readDraft(sessionId ?? WEBUI_COMPOSER_HOME_KEY),
        writeDraft: (text) => composer.setDraft(sessionId ?? WEBUI_COMPOSER_HOME_KEY, text),
      })
        .then((result) => answer(frame, origin, { requestId: request.requestId, result }))
        .catch(() => answer(frame, origin, { requestId: request.requestId, result: { success: false, code: "result_unknown" } }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [answer, composer, detached, name, presentation, sessionId]);

  /**
   * The page's agent bridge.
   *
   * One host per framed document, created with the generation the service issued
   * for this start. A replacement frame gets a new host, and the old one's teardown
   * ends the turns it had open — that is the client's half of generation fencing,
   * while the service refuses any call whose generation it never issued.
   *
   * Selection runs through the `#session=` hash, the same anchor a rail link uses,
   * because ADR 0020 maps a page's `open` onto the rail rather than onto a second
   * conversation surface. Reporting it shown waits until the rail has actually
   * selected it: the runtime treats a shown session as answerable, so claiming it
   * early would make its permission asks wait on a panel that is not on screen.
   */
  useEffect(() => {
    if (!workflows || presentation?.kind !== "open" || detached) return;
    const viewUrl = presentation.viewUrl;
    const connection = presentation.connection;
    const hostSessionId = sessionId ?? "";
    const agentHost = createWebuiMiniAppAgentBridge({
      pluginId,
      hostSessionId,
      connection,
      viewUrl,
      post: (message) => {
        const target = frameRef.current?.contentWindow;
        if (!target) return;
        try {
          target.postMessage(message, new URL(viewUrl).origin);
        } catch {
          // The frame this answer belonged to is gone; nothing is delivered into a
          // replacement document.
        }
      },
      commands: {
        call: async (request) => {
          const response = await workflows.agentCall(request);
          if (response.ok && response.method === "open") {
            if (typeof window !== "undefined") {
              window.location.hash = sessionHash(response.sessionId);
            }
            await workflows.reportShown({
              pluginId,
              sessionId: response.sessionId,
              hostSessionId,
              connection,
            });
          }
          return response;
        },
        watchTurn: (request, onFrame, onFailure) =>
          workflows.watchAgentTurn(request, onFrame, onFailure),
      },
    });
    const onMessage = (event: MessageEvent): void => {
      agentHost.handleMessage(
        { data: event.data, origin: event.origin, source: event.source },
        frameRef.current?.contentWindow ?? null,
      );
    };
    window.addEventListener("message", onMessage);
    const unsubscribe = subscribeToSessionHash((id) => workflows.noteSelectedSession(id));
    // The selection at mount is the baseline: a shown session from a previous
    // document must not be re-reported, and one already switched away is closed.
    workflows.noteSelectedSession(readSessionIdFromHash(window.location.hash));
    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribe();
      agentHost.close();
      // Nothing shows it any more, so the runtime stops counting it as answerable.
      workflows.releaseShown(pluginId);
    };
  }, [detached, pluginId, presentation, sessionId, workflows]);

  /**
   * Whether this view can offer the move at all.
   *
   * A session is required because the deep link names one, and the URL comes from
   * the wire because it carries the service token. A host that wires neither is a
   * host where the standalone presentation does not exist, and the view then
   * simply does not offer it rather than offering a control that does nothing.
   */
  const canMove = !standalone && !detached && standaloneHref !== undefined;

  return (
    <div
      className="webui-miniapp-view"
      data-testid="miniapp-view"
      data-plugin-id={pluginId}
      data-state={presentation?.kind ?? "idle"}
      data-surface={surface}
      data-detached={detached ? "true" : "false"}
    >
      {presentation?.kind === "opening" && !detached ? (
        <p className="webui-miniapp-view-status" role="status">
          正在启动 {name}…
        </p>
      ) : null}
      {detached ? (
        <div className="webui-miniapp-view-detached" data-testid="miniapp-view-detached">
          <p role="status">已在独立的浏览器标签页中打开。</p>
          <button type="button" data-testid="miniapp-switch-standalone" onClick={moveToStandalone}>
            切换到该标签页
          </button>
        </div>
      ) : null}
      {presentation?.kind === "open" && !detached ? (
        <iframe
          // Keyed on the presentation revision so a lease that came and went
          // remounts the frame: the page's in-page state is gone either way
          // (ADR 0020), and a stale document would otherwise keep rendering from
          // an origin the service has already re-pointed.
          key={`${pluginId}:${row?.presentationRevision ?? 0}`}
          ref={frameRef}
          className="webui-miniapp-view-frame"
          data-testid="miniapp-view-frame"
          title={title ?? name}
          src={presentation.viewUrl}
        />
      ) : null}
      {canMove ? (
        <div className="webui-miniapp-view-move">
          <button type="button" data-testid="miniapp-open-standalone" onClick={moveToStandalone}>
            在新标签页中打开
          </button>
        </div>
      ) : null}
      {presentation?.kind === "stopped" && !detached ? (
        <div className="webui-miniapp-view-stopped" data-testid="miniapp-view-stopped">
          <p role="alert">{presentation.reason}</p>
          <button type="button" onClick={() => void workflows?.open(pluginId)}>
            重新打开
          </button>
        </div>
      ) : null}
      {presentation === undefined && refusal ? (
        <p className="webui-plugin-error" role="alert" data-testid="miniapp-view-refusal">
          {webuiMiniAppRefusalText({
            code: refusal.code,
            message: refusal.message,
            rows: state.listing.rows,
          })}
        </p>
      ) : null}
      {presentation === undefined && !refusal && state.unavailable ? (
        <p className="webui-plugin-empty">{state.unavailable}</p>
      ) : null}
    </div>
  );
}
