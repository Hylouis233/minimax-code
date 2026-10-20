// The browser operations.
//
// Seven operations: four that answer a question, one that changes the
// authorization, one that forwards an input, and one that streams the live
// images.
//
// The validators here are deliberately thin. The *shape* of a request is the
// wire's business and belongs in this layer; whether an input command is
// meaningful — a finite coordinate, a known button, a target that still
// exists — is the runtime's business and belongs in `runtime/browser/input.ts`.
// Splitting it that way keeps one set of rules for every caller of the
// runtime, including the Agent's browser tools, which do not come through
// this wire at all.

import { WebuiErrorCode } from "../../shared/envelope.js";
import {
  GET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  LIST_BROWSER_CAPABILITIES_OPERATION_NAME,
  LIST_BROWSER_TARGETS_OPERATION_NAME,
  SELECT_BROWSER_TARGET_OPERATION_NAME,
  SEND_BROWSER_INPUT_OPERATION_NAME,
  SEND_BROWSER_COMMAND_OPERATION_NAME,
  SET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  WATCH_BROWSER_FRAMES_OPERATION_NAME,
} from "../../shared/operation-names.js";
import {
  WEBUI_BROWSER_SURFACES,
  type WebuiBrowserInputCommand,
  type WebuiBrowserSurface,
  type WebuiBrowserTargetId,
} from "../../shared/contracts/browser.js";
import type { WebuiOperation, WebuiOperationValidation } from "./operation-contract.js";
import { invalidBody, requireRecord } from "./operation-contract.js";

export const getBrowserAuthorizationOperation: WebuiOperation<Record<string, never>> = {
  name: GET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  validate: (body) => validateEmptyBody(GET_BROWSER_AUTHORIZATION_OPERATION_NAME, body),
};

export const listBrowserCapabilitiesOperation: WebuiOperation<Record<string, never>> = {
  name: LIST_BROWSER_CAPABILITIES_OPERATION_NAME,
  validate: (body) => validateEmptyBody(LIST_BROWSER_CAPABILITIES_OPERATION_NAME, body),
};

export const setBrowserAuthorizationOperation: WebuiOperation<Record<string, unknown>> = {
  name: SET_BROWSER_AUTHORIZATION_OPERATION_NAME,
  validate: (body) => validateAuthorizationChange(SET_BROWSER_AUTHORIZATION_OPERATION_NAME, body),
};

export const listBrowserTargetsOperation: WebuiOperation<Record<string, unknown>> = {
  name: LIST_BROWSER_TARGETS_OPERATION_NAME,
  validate: (body) => validateSurface(LIST_BROWSER_TARGETS_OPERATION_NAME, body),
};

export const selectBrowserTargetOperation: WebuiOperation<Record<string, unknown>> = {
  name: SELECT_BROWSER_TARGET_OPERATION_NAME,
  validate: (body) => validateTarget(SELECT_BROWSER_TARGET_OPERATION_NAME, body),
};

export const sendBrowserInputOperation: WebuiOperation<Record<string, unknown>> = {
  name: SEND_BROWSER_INPUT_OPERATION_NAME,
  validate: (body) => validateInputCommand(SEND_BROWSER_INPUT_OPERATION_NAME, body),
};

/**
 * The browser command operation.
 *
 * The validator checks only that the request *names* a surface and a command.
 * Whether the command is allowed — a restricted action, or a raw DevTools
 * method under the Full CDP switch — is the runtime's decision, because only
 * the runtime knows the live authorization.
 */
export const sendBrowserCommandOperation: WebuiOperation<Record<string, unknown>> = {
  name: SEND_BROWSER_COMMAND_OPERATION_NAME,
  validate: (body) => validateCommand(SEND_BROWSER_COMMAND_OPERATION_NAME, body),
};

export const watchBrowserFramesOperation: WebuiOperation<Record<string, unknown>> = {
  name: WATCH_BROWSER_FRAMES_OPERATION_NAME,
  validate: (body) => validateSurface(WATCH_BROWSER_FRAMES_OPERATION_NAME, body),
};

const AUTHORIZATION_SWITCHES = [
  "isolatedChromium",
  "edge",
  "chrome",
  "fullCdp",
] as const;

function validateEmptyBody(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, never>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  return Object.keys(result.body).length === 0
    ? { ok: true, body: {} as Record<string, never> }
    : invalidBody(`${operation} body must be an empty object`);
}

/**
 * Validates an authorization change.
 *
 * A change must name at least one switch and may only name known ones. An
 * empty change would otherwise be a no-op that reported success, which reads
 * to the surface as "it is on" when nothing was written.
 */
function validateAuthorizationChange(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  const entries = Object.entries(result.body);
  if (entries.length === 0) {
    return invalidBody(`${operation} body must name at least one switch`);
  }
  for (const [key, value] of entries) {
    if (!AUTHORIZATION_SWITCHES.includes(key as (typeof AUTHORIZATION_SWITCHES)[number])) {
      return invalidBody(`${operation} body names an unknown switch "${key}"`);
    }
    if (typeof value !== "boolean") {
      return invalidBody(`${operation} body requires a boolean for "${key}"`);
    }
  }
  return { ok: true, body: result.body };
}

function validateSurface(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  const surface = result.body.surface;
  if (
    typeof surface !== "string" ||
    !WEBUI_BROWSER_SURFACES.includes(surface as WebuiBrowserSurface)
  ) {
    return invalidBody(`${operation} body requires a known browser surface`);
  }
  return { ok: true, body: result.body };
}

function validateTarget(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  const target = result.body.target;
  if (!isRecord(target)) {
    return invalidBody(`${operation} body requires a target`);
  }
  if (
    typeof target.surface !== "string" ||
    !WEBUI_BROWSER_SURFACES.includes(target.surface as WebuiBrowserSurface) ||
    typeof target.browserId !== "string" ||
    target.browserId.length === 0 ||
    typeof target.targetId !== "string" ||
    target.targetId.length === 0 ||
    typeof target.generation !== "number" ||
    !Number.isInteger(target.generation)
  ) {
    return invalidBody(`${operation} body requires a complete target identity`);
  }
  return { ok: true, body: result.body };
}

/**
 * Validates the *envelope* of an input command.
 *
 * The command's own rules — finite coordinates, a known button, a non-empty
 * text payload — are enforced by the runtime, once, for every caller.
 */
function validateInputCommand(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  const kind = result.body.kind;
  if (kind !== "pointer" && kind !== "key" && kind !== "text") {
    return invalidBody(`${operation} body requires a pointer, key or text command`);
  }
  if (!isRecord(result.body.target)) {
    return invalidBody(`${operation} body requires a target`);
  }
  return { ok: true, body: result.body };
}

/**
 * Validates the envelope of a browser command.
 *
 * A command with an empty name is malformed and is refused here rather than
 * being forwarded for the runtime to reject.
 */
function validateCommand(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  const result = requireRecord(operation, body);
  if (!result.ok) return result;
  const surface = result.body.surface;
  if (
    typeof surface !== "string" ||
    !WEBUI_BROWSER_SURFACES.includes(surface as WebuiBrowserSurface)
  ) {
    return invalidBody(`${operation} body requires a known browser surface`);
  }
  const command = result.body.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    return invalidBody(`${operation} body requires a command`);
  }
  const params = result.body.params;
  if (params !== undefined && !isRecord(params)) {
    return invalidBody(`${operation} body requires params to be an object`);
  }
  return { ok: true, body: result.body };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The input command a validated body carries, as the runtime expects it. */
export function readBrowserInputCommand(
  body: Record<string, unknown>,
): WebuiBrowserInputCommand {
  return body as unknown as WebuiBrowserInputCommand;
}

/** The target a validated body carries, as the runtime expects it. */
export function readBrowserTarget(body: Record<string, unknown>): WebuiBrowserTargetId {
  return body.target as unknown as WebuiBrowserTargetId;
}

/** The command a validated body carries, as the runtime expects it. */
export function readBrowserCommand(body: Record<string, unknown>): {
  readonly surface: WebuiBrowserSurface;
  readonly command: string;
  readonly params: Record<string, unknown>;
} {
  const params = body.params;
  return {
    surface: body.surface as WebuiBrowserSurface,
    command: String(body.command),
    params: isRecord(params) ? params : {},
  };
}

/** The surface a validated body carries, as the runtime expects it. */
export function readBrowserSurface(body: Record<string, unknown>): WebuiBrowserSurface {
  return body.surface as WebuiBrowserSurface;
}

export { WebuiErrorCode };
