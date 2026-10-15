// The submission vocabulary (plan §5.5 P02 step 9).
//
// One submission is one intent classified by one decision and closed by one completion. The decision
// is what the admission rule concluded — not a UI instruction: the caller decides how a `busy` or an
// `unsupported` reads, and today's Composer says nothing for either.
//
// The completion never rejects. A refusal is a value, because the caller has to be able to report it
// and keep going: a rejected promise would make the refusal path the exception path, and the
// transition the Composer consumes (P02 step 4) has to be observable either way.

/** What the user asked for, before any decision. */
export interface WebuiSubmissionIntent {
  readonly message: string;
  readonly attachmentCount: number;
  readonly sessionId?: string;
}

/**
 * What the admission rule concluded.
 *
 * `dispatching` and `queued` mean the submission is on its way; the rest mean it is not, and
 * `creation-failed` / `failed` are the two ways an attempt that got as far as IO ended. `busy` covers
 * both reasons a live target refuses input — a creation already in flight for this home (D01) and a
 * turn already running with nowhere to queue it.
 */
export type WebuiSubmissionDecision =
  | "dispatching"
  | "queued"
  | "needs-session"
  | "creation-failed"
  | "busy"
  | "unsupported"
  | "failed";

/** What the admission rule reads. All of it is observed state, none of it is intent. */
export interface WebuiSubmissionAdmissionState {
  /** The target session exists: a home submission has none until its creation returns. */
  readonly hasSession: boolean;
  /** The client can create the session the intent needs. */
  readonly canCreateSession: boolean;
  /** The client can dispatch a turn. */
  readonly canSend: boolean;
  /** The client can queue onto a running turn. */
  readonly canEnqueue: boolean;
  /** A turn is known to be running on the target. */
  readonly turnLive: boolean;
  /**
   * A creation is already in flight for the current home incarnation (D01). This is the one piece of
   * state the reservation owns: the single-flight check itself lives where the create is issued.
   */
  readonly creating: boolean;
}

/** Why a submission was refused, in terms the caller can act on. */
export type WebuiSubmissionRefusal =
  | { readonly kind: "busy"; readonly reason: "creating" | "turn-live" }
  | { readonly kind: "unsupported"; readonly missing: "create-session" | "transport" }
  | { readonly kind: "needs-session" }
  | { readonly kind: "creation-failed"; readonly error: string }
  | { readonly kind: "failed"; readonly error: string };

/** The terminal state of one submission. Never a rejection. */
export type WebuiSubmissionCompletion =
  | {
      readonly kind: "dispatched";
      readonly sessionId: string;
      /** Whether this submission had to create the session first. */
      readonly created: boolean;
    }
  | { readonly kind: "queued"; readonly sessionId: string }
  | WebuiSubmissionRefusal;

/** One submission's record: the decision that classified it and the completion that closed it. */
export interface WebuiSubmissionOperation {
  readonly id: number;
  readonly decision: WebuiSubmissionDecision;
  readonly completion: WebuiSubmissionCompletion;
}
