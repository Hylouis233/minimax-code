import type { AppDb } from '../../infra/db/client.js';
import type { SessionRecord } from '../session-system/index.js';
import type {
  CanvasApplyResultV1,
  CanvasDocumentV1,
  CanvasFileTargetV1,
  CanvasOperationV1,
  CanvasServiceErrorCode,
  PreparedCanvasFileV1,
} from './wire.js';

/**
 * The wire types are declared in `./wire.js`, which imports nothing: a consumer
 * that only needs the wire shapes (the WebUI's canvas contract derives from
 * them) must not pull this module's database and session type graph in with it.
 * They are re-exported below so existing importers of `contracts.js` keep their
 * paths.
 */
export type {
  CanvasApplyResultV1,
  CanvasDocumentV1,
  CanvasFileNodeV1,
  CanvasFileTargetV1,
  CanvasImageAnnotationV1,
  CanvasLayoutV1,
  CanvasMutationV1,
  CanvasOperationV1,
  CanvasServiceErrorCode,
  PreparedCanvasFileV1,
} from './wire.js';

export class CanvasServiceError extends Error {
  constructor(
    readonly code: CanvasServiceErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'CanvasServiceError';
  }
}

interface CanvasSessionReader {
  get(sessionId: string): Promise<SessionRecord | undefined>;
}

export interface CanvasAssetResolution {
  readonly assetId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly absolutePath: string;
}

interface CanvasAssetReader {
  importDeliverable(input: {
    readonly sessionId: string;
    readonly path: string;
  }): Promise<CanvasAssetResolution | undefined>;
  importExternal(input: {
    readonly sessionId: string;
    readonly path: string;
  }): Promise<CanvasAssetResolution | undefined>;
  resolve(input: {
    readonly sessionId: string;
    readonly assetId: string;
  }): Promise<CanvasAssetResolution | undefined>;
}

export interface CanvasServiceOptions {
  readonly db: AppDb;
  readonly sessions: CanvasSessionReader;
  readonly assets: CanvasAssetReader;
  readonly nowMs?: () => number;
}

export interface CanvasService {
  read(input: { readonly sessionId: string }): Promise<CanvasDocumentV1>;
  prepareFiles(input: {
    readonly sessionId: string;
    readonly targets: readonly CanvasFileTargetV1[];
  }): Promise<readonly PreparedCanvasFileV1[]>;
  apply(input: {
    readonly sessionId: string;
    readonly operation: CanvasOperationV1;
  }): Promise<CanvasApplyResultV1>;
  deleteSession(sessionId: string): Promise<void>;
}
