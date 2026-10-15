// What the turn substrate needs from the peer command factories it drives,
// declared here so composition can supply them (plan §5.3 rule 2: "composition
// supplies peer command dependencies where a direct import would form a business
// implementation cycle").
//
// Both pairs this replaces are genuine cycles: the sessions business's stream
// commands and the composer's submit workflow each read the turn stream state,
// the stream loop mechanism or the stream-state bundle, so neither can be
// published from a contracts home — and the turn substrate cannot import their
// application modules either. Composition builds the object once
// (`client/application/turn-command-wiring.ts`) and hands it to the commands.
//
// Only the members `turn-commands.ts` calls appear here. The shapes are the
// published ones: the views come from `features/turn/contracts/turn-command-views.ts`
// and the submit objects from `composer/contracts/composer-turn.ts`.

import type { WebuiSessionWriter, WebuiHomeSessionWriter } from "../../../application/session-store.js";
import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "../../composer/contracts/composer-turn.js";
import type {
  WebuiStreamPhaseCommands,
  WebuiTurnCommandWriter,
  WebuiTurnLifecycleCommands,
} from "../contracts/turn-command-views.js";

/** The store writer a turn's command adapter is built over. */
type WebuiTurnWriterTarget = WebuiSessionWriter | WebuiHomeSessionWriter;

export interface WebuiTurnCommandCollaborators {
  /** sessions' `createWebuiTurnCommands`: the writer a turn's sink is built from. */
  readonly createTurnCommands: (writer: WebuiTurnWriterTarget) => WebuiTurnCommandWriter;
  /** sessions' `createWebuiTurnLifecycleCommands`: opening, recording and closing a turn's stream. */
  readonly createLifecycleCommands: (targets: {
    readonly setStream: WebuiTurnWriterTarget["setStream"];
    readonly setSending: WebuiTurnWriterTarget["setSending"];
  }) => WebuiTurnLifecycleCommands;
  /** sessions' `createWebuiStreamPhaseCommands`: the phase writes, and nothing else. */
  readonly createStreamPhaseCommands: (targets: {
    readonly setStream: WebuiTurnWriterTarget["setStream"];
  }) => WebuiStreamPhaseCommands;
  /** composer's `buildWebuiComposerHandlers`: the handler bundle one submit holds. */
  readonly buildComposerHandlers: (
    handlers: WebuiComposerSubmitHandlers,
  ) => WebuiComposerSubmitHandlers;
  /** composer's `submitWebuiComposerTurn`: the path a turn's text takes to the wire. */
  readonly submitComposerTurn: (
    args: WebuiComposerSubmitArgs,
    handlers: WebuiComposerSubmitHandlers,
  ) => Promise<void>;
}
