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
