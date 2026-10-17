import { recordValue } from "../../../contracts/value-readers.js";
import type { WebuiRuntimeEvent } from "../../../../shared/contracts/stream.js";

/**
 * A session lifecycle fact, as the runtime publishes it.
 *
 * `kind` is the event's own type so a reader can see what the wire said; the
 * fields are the part the catalogue can apply. Fields the runtime did not send
 * are absent rather than defaulted: patching `title: ""` because a payload
 * omitted it would erase a name on the strength of an event that never carried
 * one.
 */
export type WebuiSessionFact =
  | {
      readonly kind: "created";
      readonly sessionId: string;
      readonly title?: string;
      readonly agentName?: string;
      readonly workspaceDir?: string;
    }
  | {
      readonly kind: "renamed";
      readonly sessionId: string;
      readonly title: string;
    }
  | {
      readonly kind: "re-modelled";
      readonly sessionId: string;
      readonly model?: string;
      readonly agentName?: string;
    }
  | {
      readonly kind: "interaction-mode";
      readonly sessionId: string;
      readonly mode: string;
    }
  | {
      readonly kind: "visibility";
      readonly sessionId: string;
      readonly hidden: boolean;
    }
  | {
      readonly kind: "pinned";
      readonly sessionId: string;
      readonly pinned: boolean;
    }
  | {
      /** Confirmed gone by another client. The catalogue settles it as a delete. */
      readonly kind: "deleted";
      readonly sessionId: string;
    };

/**
 * Decode a session lifecycle fact off the wire envelope.
 *
 * Returns `undefined` for anything that is not one, which is the caller's signal
 * to carry on with its ordinary per-session handling. A session lifecycle event
 * carries no turn effect, so folding one into the effect reducer is not possible:
 * there is no stream to write it into and no phase to move.
 *
 * Every field is read defensively. These events are produced by the runtime and
 * by older CLI processes, so a payload may omit a field or carry the wrong type.
 * An absent field stays absent rather than becoming a default, because applying
 * `title: ""` because a payload did not mention a title erases a name on the
 * strength of an event that never carried one.
 */
export function readWebuiSessionFact(
  event: WebuiRuntimeEvent,
  sessionId: string,
): WebuiSessionFact | undefined {
  const payload = recordValue(event.payload);
  const readString = (key: string): string | undefined => {
    const value = payload?.[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const readBoolean = (key: string): boolean | undefined => {
    const value = payload?.[key];
    return typeof value === "boolean" ? value : undefined;
  };

  switch (event.type) {
    case "session.created":
      return {
        kind: "created",
        sessionId,
        ...(readString("title") !== undefined ? { title: readString("title")! } : {}),
        ...(readString("agentName") !== undefined ? { agentName: readString("agentName")! } : {}),
        ...(readString("workspaceDir") !== undefined ? { workspaceDir: readString("workspaceDir")! } : {}),
      };
    case "session.title_updated":
    case "session.renamed": {
      // A rename with no title in it is not a rename: it says the name changed
      // without saying to what, and guessing would replace a real name with a
      // blank one.
      const title = readString("title");
      return title === undefined ? undefined : { kind: "renamed", sessionId, title };
    }
    case "session.model_updated":
      return {
        kind: "re-modelled",
        sessionId,
        ...(readString("model") !== undefined ? { model: readString("model")! } : {}),
        ...(readString("agentName") !== undefined ? { agentName: readString("agentName")! } : {}),
      };
    case "session.interaction_mode.changed": {
      const mode = readString("mode") ?? readString("interactionMode");
      return mode === undefined ? undefined : { kind: "interaction-mode", sessionId, mode };
    }
    case "session.visibility_updated": {
      const hidden = readBoolean("hidden") ?? readBoolean("visibility") ?? undefined;
      if (hidden === undefined) return undefined;
      return { kind: "visibility", sessionId, hidden };
    }
    case "session.pinned_updated": {
      const pinned = readBoolean("pinned");
      return pinned === undefined ? undefined : { kind: "pinned", sessionId, pinned };
    }
    case "session.deleted":
      return { kind: "deleted", sessionId };
    default:
      return undefined;
  }
}
