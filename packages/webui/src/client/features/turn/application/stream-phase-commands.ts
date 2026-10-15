// The **stream-phase** view: the phase field, and nothing else (plan §5.5 P02
// step 2 — it was Sessions' until the execution substrate took it over).
//
// Ticket #58 split the old command bag into three views so a consumer handed one
// cannot reach another's commands; this is the narrowest of them. It carries no
// `sending` write, because `sending` is the submit's lifecycle flag rather than
// part of the phase, and that flag belongs to the lifecycle view next door.

import { settleAbortedStream } from "../projection/stream-state.js";
import type { WebuiStreamState } from "../projection/stream-state.js";
import type { WebuiStreamPhaseCommands } from "../contracts/turn-command-views.js";

/** The write target both turn views are bound to. */
export interface WebuiStreamWriteTarget {
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
}

/** The stream-phase view needs no `sending` write, and is not given one. */
export type WebuiStreamPhaseTargets = WebuiStreamWriteTarget;

export function createWebuiStreamPhaseCommands(
  targets: WebuiStreamPhaseTargets,
): WebuiStreamPhaseCommands {
  const { setStream } = targets;
  return {
    markStreamPhase: (phase) => setStream((current) => ({ ...current, phase })),
    startStreaming: () =>
      setStream((current) => ({ ...current, phase: "streaming" })),
    endStreaming: () => setStream((current) => ({ ...current, phase: "idle" })),
    awaitInteraction: () =>
      setStream((current) => ({ ...current, phase: "waiting" })),
    settleStoppedStream: () => setStream(settleAbortedStream),
  };
}
