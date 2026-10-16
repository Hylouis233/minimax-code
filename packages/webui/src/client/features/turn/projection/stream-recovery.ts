// The pure history/context transforms the stream loop needs, bundled so a
// caller can inject them instead of the mechanism importing `projection/`
// directly. `client/conversation/stream-loop.ts` is a mechanism and
// may not reach into view/domain modules; the callers that already live below
// that boundary — the composer, the recovery helper and the composer-state
// orchestration — supply this bundle.
//
// The functions are the existing ones, re-used, not re-implemented: no second
// history-to-message conversion is introduced. The export is left structurally
// typed (no annotation) so a `view` module does not have to import the
// mechanism-declared `StreamRecoveryProjection` interface from the stream loop;
// TypeScript's structural compatibility is what the caller's expected type
// checks against.

import { projectWebuiMessageToStreamMessage } from "../../transcript/contracts/message-stream.js";
import { latestContextUsage, readContextUsageSnapshot } from "../../composer/contracts/context-usage.js";

/** The default bundle: the existing pure projection functions, injected. */
export const streamRecoveryProjection = {
  projectMessage: projectWebuiMessageToStreamMessage,
  latestContextUsage,
  readContextUsageSnapshot,
};
