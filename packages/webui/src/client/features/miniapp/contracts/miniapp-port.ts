// Mini App capability port.
//
// The three operations the WebUI's Mini App business drives: the catalogue, the
// launch and the stop. Split from the monolithic transport the way every other
// business's port is, and composed by `transport.ts`.
//
// Every method stays optional — `undefined` means "the operation is not wired",
// which is the state a host without the Mini App cell answers with. The business
// renders that as a report ("this host has no Mini App capability") rather than
// calling into an absent member.
//
// Two things are deliberately absent. The Mini App's own origin, its surface path
// and the launch credential never appear here: the server holds them and the
// client is handed the proxy's `viewUrl` (`shared/contracts/miniapp.ts`). And
// there is no "detach"/"attach": the two presentations of ADR 0020 are two client
// documents, so what a client asks for is a view URL, not a page move.

import type {
  WebuiMiniAppList,
  WebuiMiniAppView,
} from "../../../../shared/contracts/miniapp.js";

export interface MiniAppPort {
  /** The installed Mini Apps, with the runtime state the row renders. */
  readonly listMiniApps?: () => Promise<WebuiMiniAppList>;
  /**
   * Starts one Mini App and answers with the loopback URL the panel frames.
   *
   * A refusal is the runtime's: `OWNED_ELSEWHERE` names the client that holds the
   * app, `BUSY` carries the capacity refusal. The business reports the message
   * it was given rather than inventing one, because the runtime is the only
   * party that knows which of the two happened.
   */
  readonly openMiniApp?: (request: {
    readonly pluginId: string;
  }) => Promise<WebuiMiniAppView>;
  /** Stops one Mini App. The server closes that plugin's proxy with it. */
  readonly stopMiniApp?: (request: {
    readonly pluginId: string;
  }) => Promise<{ readonly success: true }>;
}
