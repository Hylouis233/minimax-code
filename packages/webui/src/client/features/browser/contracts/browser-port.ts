// Browser capability port.
//
// The browser business is the one that owns target state, authorization and
// connection projections (ADR 0019, "Business and source layout decisions").
// Settings and the workspace panel consume Browser Use through this port rather
// than through their own copies of the vocabulary, because a second copy of the
// authorization switches is a second answer to "is this browser allowed", and the
// failure the ADR names — the panel shows one page while the Agent drives
// another — starts as exactly that kind of disagreement.
//
// Every method is optional, like every other port in this package: `undefined`
// means "this host does not wire the operation", which is a state the UI has to
// be able to say out loud rather than a failure to discover by calling.
//
// The operation-name constants below are declared here rather than imported from
// `shared/operation-names.ts` because this port lands before the shared table
// does; they carry the same strings the server will bind, and reconciling the
// two spellings is a one-line move once the shared table has the family. What
// matters now is that the strings are named once and are not repeated as
// literals anywhere else in the feature.

import type {
  WebuiBrowserAuthorization,
  WebuiBrowserAuthorizationChange,
  WebuiBrowserCapabilityEntry,
  WebuiBrowserCommandRequest,
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
  WebuiBrowserTargetList,
  WebuiBrowserTargetState,
} from "../../../../shared/contracts/browser.js";

// The operation names come from the shared table rather than being declared
// here. A second copy of a wire name is a second answer to "what is this
// operation called", and the browser family is exactly the place where the
// server and the client must not disagree: the panel addresses the same
// session the Agent's tools drive.
import {
  GET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  SET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  LIST_BROWSER_TARGETS_OPERATION_NAME,
  SELECT_BROWSER_TARGET_OPERATION_NAME,
  SEND_BROWSER_INPUT_OPERATION_NAME,
  SEND_BROWSER_COMMAND_OPERATION_NAME,
  WATCH_BROWSER_FRAMES_OPERATION_NAME,
  LIST_BROWSER_CAPABILITIES_OPERATION_NAME,
} from "../../../../shared/operation-names.js";

export {
  GET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  SET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  LIST_BROWSER_TARGETS_OPERATION_NAME,
  SELECT_BROWSER_TARGET_OPERATION_NAME,
  SEND_BROWSER_INPUT_OPERATION_NAME,
  SEND_BROWSER_COMMAND_OPERATION_NAME,
  WATCH_BROWSER_FRAMES_OPERATION_NAME,
  LIST_BROWSER_CAPABILITIES_OPERATION_NAME,
};

/** Every browser operation name, as one closed set. */
export const WEBUI_BROWSER_OPERATION_NAMES = Object.freeze([
  GET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  SET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  LIST_BROWSER_TARGETS_OPERATION_NAME,
  SELECT_BROWSER_TARGET_OPERATION_NAME,
  SEND_BROWSER_INPUT_OPERATION_NAME,
  SEND_BROWSER_COMMAND_OPERATION_NAME,
  WATCH_BROWSER_FRAMES_OPERATION_NAME,
  LIST_BROWSER_CAPABILITIES_OPERATION_NAME,
] as const);

/**
 * Which switch a UI toggle moved.
 *
 * The three surfaces are `WebuiBrowserSurface` verbatim; `full-cdp` is not a
 * surface because it is not a browser — it widens the command set of whatever
 * surface is already authorized. Carrying it in the same union is deliberate: the
 * UI has one row per switch and one row's worth of meaning, and Full CDP is one
 * of those rows.
 *
 * This is the *toggle*, not the wire request. The write that travels is the
 * shared `WebuiBrowserAuthorizationChange`, and `webuiBrowserAuthorizationChange`
 * in `../application/browser-commands.ts` is the one mapping between them — so
 * the shape the wire accepts is named in `shared/` and nowhere here.
 */
export type WebuiBrowserAuthorizationSwitch = WebuiBrowserSurface | "full-cdp";

export const WEBUI_BROWSER_AUTHORIZATION_SWITCHES = Object.freeze([
  "isolated-chromium",
  "edge",
  "chrome",
  "full-cdp",
] as const satisfies readonly WebuiBrowserAuthorizationSwitch[]);

/** One switch moving, as a UI row reports it. */
export interface WebuiBrowserAuthorizationToggle {
  readonly surface: WebuiBrowserAuthorizationSwitch;
  readonly enabled: boolean;
}

/** What `listBrowserCapabilities` reports: the matrix, not a probe result. */
export interface WebuiBrowserCapabilityList {
  readonly entries: readonly WebuiBrowserCapabilityEntry[];
}

/** What `sendBrowserInput` answers. */
export interface WebuiBrowserInputReceipt {
  readonly accepted: boolean;
}

export interface BrowserPort {
  /** The four switches as they stand. Absent means "never read". */
  readonly getBrowserAuthorization?: () => Promise<WebuiBrowserAuthorization>;
  /**
   * Writes the switches named by `change` and returns the whole set afterwards.
   *
   * The request is the shared `WebuiBrowserAuthorizationChange`, whose fields are
   * all optional, and that optionality is what carries the ADR's rule: naming one
   * switch cannot clear the other three. A change that names none is refused by
   * the operation's validator rather than read as "turn everything off".
   */
  readonly setBrowserAuthorization?: (
    change: WebuiBrowserAuthorizationChange,
  ) => Promise<WebuiBrowserAuthorization>;
  readonly listBrowserTargets?: (request: {
    readonly surface: WebuiBrowserSurface;
  }) => Promise<WebuiBrowserTargetList>;
  /** Moves the panel's selection to one target, bound to its generation. */
  readonly selectBrowserTarget?: (request: {
    readonly target: WebuiBrowserTargetId;
  }) => Promise<WebuiBrowserTargetState>;
  /**
   * Delivers one already-validated command.
   *
   * The command arrives validated rather than as a DOM event: the panel that
   * converts a pointer press into this shape is the only place that knows what
   * the user aimed at, and a host that accepted raw input would have to guess.
   */
  readonly sendBrowserInput?: (
    command: WebuiBrowserInputCommand,
  ) => Promise<WebuiBrowserInputReceipt>;
  /**
   * Runs one browser command.
   *
   * The runtime decides whether the command is allowed — a restricted
   * browser-tool action, or a raw DevTools command under the Full CDP switch.
   */
  readonly sendBrowserCommand?: (
    request: WebuiBrowserCommandRequest,
  ) => Promise<{ readonly accepted: true; readonly result?: unknown }>;

  /**
   * The live image stream for one surface. Returns the disposer, matching
   * `TerminalPort.watchTerminal`, because the subscription outlives the render
   * that opened it and something has to close it when the panel goes away.
   */
  readonly watchBrowserFrames?: (
    request: { readonly surface: WebuiBrowserSurface },
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ) => () => void;
  readonly listBrowserCapabilities?: () => Promise<WebuiBrowserCapabilityList>;
}
