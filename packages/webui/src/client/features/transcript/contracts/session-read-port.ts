// Transcript capability port (plan §9; ticket #59).
//
// The conversation's own reads and rewrites: loading a history page, the turn
// diff read/revert/reapply, the rewind preview, rewinding and editing a message.
// §9 assigns `message-view` (the message half) to `transcript`, and these
// operations travel with it because §5.6 files the review surface — and the read
// that presents it — inside the business that presents it.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type { WebuiClientMessageLoader } from "./message-view.js";
import type { WebuiEditSessionMessageRequest, WebuiEditSessionMessageResult, WebuiGetSessionDiffRequest, WebuiGetSessionDiffResult, WebuiGetSessionRewindPreviewRequest, WebuiGetSessionRewindPreviewResult, WebuiGetTurnDiffRequest, WebuiGetTurnDiffResult, WebuiReapplyTurnDiffRequest, WebuiReapplyTurnDiffResult, WebuiRevertTurnDiffRequest, WebuiRevertTurnDiffResult, WebuiRewindSessionRequest, WebuiRewindSessionResult } from "../../../../shared/contracts/session.js";

export interface TranscriptPort {
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly getSessionDiff?: (
    request: WebuiGetSessionDiffRequest,
  ) => Promise<WebuiGetSessionDiffResult>;
  readonly getTurnDiff?: (
    request: WebuiGetTurnDiffRequest,
  ) => Promise<WebuiGetTurnDiffResult>;
  readonly revertTurnDiff?: (
    request: WebuiRevertTurnDiffRequest,
  ) => Promise<WebuiRevertTurnDiffResult>;
  readonly reapplyTurnDiff?: (
    request: WebuiReapplyTurnDiffRequest,
  ) => Promise<WebuiReapplyTurnDiffResult>;
  readonly getSessionRewindPreview?: (
    request: WebuiGetSessionRewindPreviewRequest,
  ) => Promise<WebuiGetSessionRewindPreviewResult>;
  readonly rewindSession?: (
    request: WebuiRewindSessionRequest,
  ) => Promise<WebuiRewindSessionResult>;
  readonly editSessionMessage?: (
    request: WebuiEditSessionMessageRequest,
  ) => Promise<WebuiEditSessionMessageResult>;
}
