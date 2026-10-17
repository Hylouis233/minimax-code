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
 * Session lifecycle fact types this client receives and deliberately does not apply.
 *
 * One list, so "the client looked at this and chose to do nothing" is a decision a
 * reader can find rather than an absence. The decoder below answers `undefined` for
 * a non-session event and for a listed type, and `unapplied` for a session event
 * whose type has no case here — so a fact the runtime begins publishing is either
 * applied, listed as covered by another surface, or explicitly surfaced. It is never
 * indistinguishable from an event that was not routed at all.
 *
 * Adding a name here is a decision; removing one is a routing change.
 */
export const WEBUI_SESSION_FACTS_NOT_APPLIED: readonly WebuiUnappliedSessionFact[] = [
  // The host publishes these catalogue facts and the TUI consumes them; no client
  // route exists today. Each is named so "this page ignores it" is a recorded
  // decision, and so adding a route is a deletion here rather than a silent
  // behaviour change.
  { type: "session.compaction.started", why: "compaction progress is shown by the turn's own stream, not by a catalogue patch" },
  { type: "session.compaction.completed", why: "the settled transcript arrives through the transcript read the turn already refreshes" },
  { type: "session.compaction.failed", why: "the failure reaches the page as the turn's refusal, which is where a user acts on it" },
  { type: "session.llm_retry", why: "a retry is transient turn progress; it changes no session fact a rail or header renders" },
  { type: "message.rewind", why: "rewinding changes the transcript, whose read the turn owns; the catalogue row is unaffected" },
  { type: "agent.created", why: "an agent identity is not a session fact; the rail groups by the session's own agent name" },
  { type: "agent.updated", why: "same: the name a session shows is patched by the session's own fact" },
  { type: "rotation.completed", why: "credential rotation is the account owner's concern and invalidates its own reads" },
  { type: "content.retry.exceeded", why: "a content retry limit is turn progress; the turn's failure path settles it" },
];

/** One catalogue fact this client receives and deliberately does not apply. */
export interface WebuiUnappliedSessionFact {
  readonly type: string;
  /** Why applying it is not this client's job. Read by this file's tests and a reader. */
  readonly why: string;
}

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
      // Not a session lifecycle fact. `session.start`, `session.queue.updated` and
      // the other turn events share the `session.` prefix and are the coordinator's
      // own business, so the decoder must not claim them: it answers only for the
      // facts it can apply, and `undefined` is what keeps every other route
      // working.
      //
      // A fact that is neither applied nor named in `WEBUI_SESSION_FACTS_NOT_APPLIED`
      // is therefore still dropped here — the row that asks for it to fail loudly
      // wants the *host* catalogue to decide that, and the runtime publishes no such
      // catalogue to derive from (see the repair report, V36).
      return undefined;
  }
}
