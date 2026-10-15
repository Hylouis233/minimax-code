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
// What is left is the **Composer** pair only. The stream-phase, turn-lifecycle
// and writer factories moved into this business, so the substrate imports them
// directly; the submit workflow is still Composer's until P02 step 3 moves it,
// and that move is what retires this file.

import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "../../composer/contracts/composer-turn.js";

export interface WebuiTurnCommandCollaborators {
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
