// Wire contract record: every exported declaration below records its wire
// purpose, its producer and its consumers, verified against the tree.
// Documentation only.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `WebuiMiniAppRuntimeStatus` | The states a Mini App row can be in, as the runtime reports them. | Runtime `MiniAppSurfaceSummary.runtime.status` (`@mavis/shared/miniapp-surface`), copied field by field in `runtime/harness/miniapp.ts`. | `WebuiMiniAppSummary`; the row a picker renders. |
// | `WebuiMiniAppSummary` | One catalogue row: identity, display copy and the runtime state, which is what tells a stopped Mini App from a running one. | `listMiniApps` and the `miniApp` half of `openMiniApp` (`runtime/harness/miniapp.ts`; CliService). | `shared/operation-names.ts`; `runtime/port.ts`; `server/operation/handlers/miniapp.ts`. |
// | `WebuiMiniAppList` | The envelope `listMiniApps` answers with. | `server/operation/handlers/miniapp.ts`. | `shared/operation-names.ts`. |
// | `WebuiMiniAppView` | Where the client frames a started Mini App: the loopback proxy's URL, with the plugin it belongs to. It never carries the Mini App's own origin, surface path or launch credential. | `openMiniApp` (`server/operation/handlers/miniapp.ts`, from `server/miniapp/proxy.ts` `viewUrl`). | `shared/operation-names.ts`; unverified — no importer yet; the panel that frames `viewUrl` is a later slice of the same work. |

/**
 * A Mini App's runtime state, as the runtime names it.
 *
 * Kept a closed union rather than a string: the picker decides whether to offer
 * "open" or "stop" from this field, and an unrecognised value would silently
 * become one of those two decisions.
 */
export type WebuiMiniAppRuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

/**
 * One catalogue row.
 *
 * `runtime.kind` is present because a Mini App's runtime is a process here and
 * the panel reads the kind before the status; a second kind would be a different
 * surface, not another status.
 */
export interface WebuiMiniAppSummary {
  readonly pluginId: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly iconUrl?: string;
  /**
   * Whether the runtime may start this package.
   *
   * Absent means "the runtime lists only startable packages", which is what the
   * older read answered. `false` marks a row from the installed listing — a Mini
   * App the person disabled, which the catalogue offers to enable rather than to
   * open.
   */
  readonly enabled?: boolean;
  readonly runtime: {
    readonly kind: "process";
    readonly status: WebuiMiniAppRuntimeStatus;
    readonly errorCode?: string;
  };
}

/** The catalogue `listMiniApps` answers with. */
export interface WebuiMiniAppList {
  readonly miniApps: readonly WebuiMiniAppSummary[];
}

/**
 * What `openMiniApp` hands the client: the proxy's own loopback URL.
 *
 * `viewUrl` points at the WebUI's proxy, so the document the client frames is
 * same-machine and the credential the Mini App's guard demands is injected on
 * the way out. Neither that credential nor the Mini App's real origin has any
 * place in this record.
 */
export interface WebuiMiniAppView {
  readonly pluginId: string;
  readonly viewUrl: string;
}

// ---------------------------------------------------------------------------
// The page bridge: the composer half, over `postMessage`.
//
// ADR 0020 lists "how a page's request identifier survives the `postMessage`
// boundary" as the one open implementation question, so the answer is written
// down here rather than left to the page and the host to guess at separately:
// the page mints the request id, the host echoes it in the reply, and a reply
// that names no live request is dropped.
//
// The shapes are the shipped contract's (`@mavis/shared/miniapp-surface`): the
// failure codes and the text bound are copied rather than imported because this
// module is a wire contract the browser bundle may hold, and the shipped module
// is the runtime's. A change there is a change here, and the two constants are
// pinned together by the bridge test.
// ---------------------------------------------------------------------------

/** Absolute path on the Mini App's proxy origin that serves the bridge script. */
export const WEBUI_MINIAPP_BRIDGE_PATH = "/__miniapp/bridge.js";

/** The page's append request, page → host. */
export const WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST = "mcode:miniapp:message-append" as const;

/** The host's answer, host → page. */
export const WEBUI_MINIAPP_BRIDGE_APPEND_REPLY = "mcode:miniapp:message-append-result" as const;

/** The shipped contract's bound (`MINIAPP_COMPOSER_MAX_TEXT_LENGTH`). */
export const WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH = 100_000;

/** The shipped contract's composer failure codes, in its order. */
export type WebuiMiniAppComposerFailureCode =
  | "user_cancelled"
  | "invalid_request"
  | "text_too_large"
  | "not_allowed"
  | "target_unavailable"
  | "result_unknown";

/**
 * What the page is told about one append.
 *
 * Success acknowledges a draft append — never a sent message and never a disk
 * commit. `user_cancelled` is the person declining the confirmation, and it is a
 * refusal like any other: the page cannot tell a decline from a policy refusal
 * apart from the code, and it must not retry either.
 */
export type WebuiMiniAppComposerResult =
  | { readonly success: true }
  | { readonly success: false; readonly code: WebuiMiniAppComposerFailureCode };

/** One append request, as the page sent it. */
export interface WebuiMiniAppBridgeAppendRequest {
  readonly requestId: string;
  readonly text: string;
}

/** The host's reply for one request. */
export interface WebuiMiniAppBridgeAppendReply {
  readonly type: typeof WEBUI_MINIAPP_BRIDGE_APPEND_REPLY;
  readonly requestId: string;
  readonly result: WebuiMiniAppComposerResult;
}
