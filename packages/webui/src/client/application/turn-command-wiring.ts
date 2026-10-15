// The peer command factories the turn substrate drives, wired once for
// composition (plan §5.3 rule 2). The substrate declares what it needs
// (`features/turn/application/turn-command-port.ts`); this module is the single
// place that names the implementations, so the substrate, the sessions business
// and the composer business stay unaware of each other's application modules.
//
// Both construction sites of a turn-command context take the object from here —
// the application composition root and the session binding — so a second caller
// cannot wire a different set.

import {
  buildWebuiComposerHandlers,
  submitWebuiComposerTurn,
} from "../features/composer/application/composer-workflows.js";
import {
  createWebuiStreamPhaseCommands,
  createWebuiTurnCommands,
  createWebuiTurnLifecycleCommands,
} from "../features/sessions/application/session-commands.js";
import type { WebuiTurnCommandCollaborators } from "../features/turn/application/turn-command-port.js";

/**
 * The turn substrate's peer command factories. The members are the peer
 * modules' own exports, passed through: nothing here re-implements a factory,
 * and the substrate's port is what checks their shapes.
 */
export function createWebuiTurnCommandCollaborators(): WebuiTurnCommandCollaborators {
  return {
    createTurnCommands: createWebuiTurnCommands,
    createLifecycleCommands: createWebuiTurnLifecycleCommands,
    createStreamPhaseCommands: createWebuiStreamPhaseCommands,
    buildComposerHandlers: buildWebuiComposerHandlers,
    submitComposerTurn: submitWebuiComposerTurn,
  };
}
