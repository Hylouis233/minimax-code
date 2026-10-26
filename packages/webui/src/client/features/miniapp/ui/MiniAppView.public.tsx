// The Mini App view the workspace panel frames.
//
// Published by the Mini App business because the state it renders is this
// business's: which view URL a Mini App is presented at, whether it is starting,
// and why a view was cleared. The panel mounts it for its `miniapp` tab kind and
// stays the layout owner; it learns nothing about Mini Apps beyond the plugin id
// its tab carries.
//
// Two properties are worth stating, because both were decisions:
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
import { webuiMiniAppRefusalText } from "../projection/miniapp-view.js";

/**
 * How often an open view asks the runtime whether it is still up.
 *
 * One read of a small catalogue. A Mini App can stop without this client asking,
 * and the alternative to asking is a frame that silently serves a dead page — the
 * case ADR 0020 calls out ("a stopped runtime clears the view and reports why").
 */
const PRESENTATION_SYNC_MS = 2_000;

export interface MiniAppViewProps {
  readonly pluginId: string;
  /** The session whose composer a confirmed append writes to. */
  readonly sessionId?: string;
  /** The tab's own title, when the panel has one. */
  readonly title?: string;
}

export function MiniAppView({ pluginId, sessionId, title }: MiniAppViewProps): ReactElement {
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const composer = useWebuiComposerStore();
  const presentation = state.presentations[pluginId];
  const refusal = state.refusals[pluginId];
  const row = state.listing.rows.find((candidate) => candidate.pluginId === pluginId);
  const name = row?.name ?? pluginId;
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Whether this mount has already asked for the view. A retry is a person's. */
  const asked = useRef(false);

  /**
   * The first show starts the Mini App — that is what opening a tab means.
   *
   * Only the first: a presentation that was cleared stays cleared until the
   * person presses the button, so a refusal cannot turn into a retry loop.
   */
  useEffect(() => {
    if (!workflows || presentation !== undefined || asked.current) return;
    asked.current = true;
    void workflows.open(pluginId);
  }, [pluginId, presentation, workflows]);

  /** While a view is up, the runtime is asked whether it still is. */
  useEffect(() => {
    if (!workflows || presentation?.kind !== "open") return;
    const timer = setInterval(() => void workflows.syncPresentations(), PRESENTATION_SYNC_MS);
    return () => clearInterval(timer);
  }, [presentation?.kind, workflows]);

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
    if (presentation?.kind !== "open") return;
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
  }, [answer, composer, name, presentation, sessionId]);

  return (
    <div
      className="webui-miniapp-view"
      data-testid="miniapp-view"
      data-plugin-id={pluginId}
      data-state={presentation?.kind ?? "idle"}
    >
      {presentation?.kind === "opening" ? (
        <p className="webui-miniapp-view-status" role="status">
          正在启动 {name}…
        </p>
      ) : null}
      {presentation?.kind === "open" ? (
        <iframe
          ref={frameRef}
          className="webui-miniapp-view-frame"
          data-testid="miniapp-view-frame"
          title={title ?? name}
          src={presentation.viewUrl}
        />
      ) : null}
      {presentation?.kind === "stopped" ? (
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
