// The Mini App surface: the catalogue, the launch, the stop, and the standalone
// presentation lease.
//
// Four descriptors over one runtime capability. The first three are dedicated
// handlers rather than bindings (`handlers/miniapp.ts`), because two of them do
// more than forward one call: `openMiniApp` turns the runtime's launch
// coordinates into a loopback proxy and answers with that proxy's URL, and
// `stopMiniApp` closes the proxy it left behind. Keeping the catalogue beside
// them keeps the capability's declarations in one place — a host either has Mini
// Apps or it does not.
//
// `watchMiniAppPresentation` is the fourth and is a stream: ADR 0020's lease
// lives as long as the standalone document's connection, so the operation's
// value is its lifetime rather than its frame.
import type {
  WebuiMiniAppCatalogue,
  WebuiMiniAppView,
} from "../../shared/contracts/miniapp.js";
import { WebuiErrorCode } from "../../shared/envelope.js";
import {
  LIST_MINI_APPS_OPERATION_NAME,
  OPEN_MINI_APP_OPERATION_NAME,
  STOP_MINI_APP_OPERATION_NAME,
  WATCH_MINI_APP_PRESENTATION_OPERATION_NAME,
} from "../../shared/operation-names.js";
import type {
  WebuiOperation,
  WebuiOperationValidation,
} from "./operation-contract.js";

/**
 * Longest plugin or session id a frame may carry.
 *
 * Not a runtime limit — the runtime's own catalogue decides what exists — but a
 * bound on what reaches the log, the error text and the plugin-id-keyed proxy map
 * this capability keeps. A frame naming a 4MB id is a frame that is not asking
 * about an installed Mini App.
 */
const MAX_ID_LENGTH = 200;

/**
 * `listMiniApps` takes no body, and says so rather than accepting a record it
 * ignores: an operation that silently drops input invites a caller to believe the
 * input narrowed the catalogue.
 */
export const listMiniAppsOperation: WebuiOperation<undefined, WebuiMiniAppCatalogue> = {
  name: LIST_MINI_APPS_OPERATION_NAME,
  validate: (body) =>
    body === undefined
      ? { ok: true, body: undefined }
      : {
          ok: false,
          code: WebuiErrorCode.invalidBody,
          message: `${LIST_MINI_APPS_OPERATION_NAME} does not accept a body`,
        },
};

/**
 * The one field the two Mini App mutations carry.
 *
 * Trimmed and non-empty: the id reaches a derived proxy port and a runtime lookup,
 * and neither has anything to say about a blank one. `pluginId` is the runtime's
 * own key — the catalogue's rows and this request name the same value, so a client
 * never has to translate between an index and an identity.
 */
function validatePluginId(
  operation: string,
  body: unknown,
): WebuiOperationValidation<{ readonly pluginId: string }> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body must be an object`,
    };
  const pluginId = (body as Record<string, unknown>).pluginId;
  if (typeof pluginId !== "string" || !pluginId.trim())
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body requires a non-empty pluginId`,
    };
  if (pluginId.length > MAX_ID_LENGTH)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} pluginId must be at most ${MAX_ID_LENGTH} characters`,
    };
  return { ok: true, body: { pluginId: pluginId.trim() } };
}

/**
 * Starts one Mini App. The response is the loopback URL the client frames, not the
 * Mini App's own origin: the origin, the surface path and the launch credential
 * are the proxy's business (`server/miniapp/proxy.ts`) and never travel further
 * than the server.
 */
export const openMiniAppOperation: WebuiOperation<
  { readonly pluginId: string },
  WebuiMiniAppView
> = {
  name: OPEN_MINI_APP_OPERATION_NAME,
  validate: (body) => validatePluginId(OPEN_MINI_APP_OPERATION_NAME, body),
};

/**
 * Stops one Mini App. Answers `success` rather than the runtime's `void` so the
 * client has a body to read: an empty response and a dropped connection would
 * otherwise look the same.
 */
export const stopMiniAppOperation: WebuiOperation<
  { readonly pluginId: string },
  { readonly success: true }
> = {
  name: STOP_MINI_APP_OPERATION_NAME,
  validate: (body) => validatePluginId(STOP_MINI_APP_OPERATION_NAME, body),
};

/**
 * Declares a standalone presentation, and holds it for the connection's life.
 *
 * Both ids are required: the lease names the plugin it presents and the session
 * its deep link carried, and the second is what lets the standalone view report an
 * ended session instead of silently rendering a page whose conversation is gone.
 */
export const watchMiniAppPresentationOperation: WebuiOperation<{
  readonly pluginId: string;
  readonly sessionId: string;
}> = {
  name: WATCH_MINI_APP_PRESENTATION_OPERATION_NAME,
  validate: (body) => {
    const plugin = validatePluginId(WATCH_MINI_APP_PRESENTATION_OPERATION_NAME, body);
    if (!plugin.ok) return plugin;
    const sessionId = (body as Record<string, unknown>).sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim())
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${WATCH_MINI_APP_PRESENTATION_OPERATION_NAME} body requires a non-empty sessionId`,
      };
    if (sessionId.length > MAX_ID_LENGTH)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${WATCH_MINI_APP_PRESENTATION_OPERATION_NAME} sessionId must be at most ${MAX_ID_LENGTH} characters`,
      };
    return { ok: true, body: { pluginId: plugin.body.pluginId, sessionId: sessionId.trim() } };
  },
};
