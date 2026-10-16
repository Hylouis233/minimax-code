// The stream-state transforms the loop needs, bundled so a caller can inject
// them instead of the mechanism importing `projection/` directly.
// The generation counter and the scoped release live in
// `client/conversation/stream-lease.ts`, so this bundle is an `application` module.
// `client/conversation/stream-loop.ts` may import only `contracts` and
// `shared`, so the callers that already sit above that boundary supply this
// bundle, exactly as they supply `streamRecoveryProjection`.
//
// The functions are the existing ones, re-used, not re-implemented. The export
// is left structurally typed (no annotation) so a `view` module does not have to
// import the mechanism-declared `WebuiStreamStateBundle` interface back from the
// loop; TypeScript's structural compatibility is what the caller's expected type
// checks against.

import { recogniseWebuiStreamPayload, reduceWebuiStreamFrame } from "../projection/stream-state.js";
import {
  nextWebuiLeaseGeneration,
  releaseWebuiSubscription,
} from "../../../conversation/stream-lease.js";

/** The default bundle: the existing pure stream-state functions, injected. */
export const streamStateBundle = {
  nextSubscriptionGeneration: nextWebuiLeaseGeneration,
  recognisePayload: recogniseWebuiStreamPayload,
  reduceFrame: reduceWebuiStreamFrame,
  releaseSubscription: releaseWebuiSubscription,
};
