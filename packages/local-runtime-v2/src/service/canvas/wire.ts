/**
 * The canvas wire types, and nothing else.
 *
 * They live apart from `contracts.ts` so that a consumer which only needs the
 * wire shapes can import them without the service interfaces' type graph
 * (`AppDb`, `SessionRecord`, and whatever those reach). The WebUI derives its
 * canvas contract from these types, and a browser-side program that pulled the
 * database and session graph in with them would fail to typecheck against its
 * own settings.
 *
 * `contracts.ts` re-exports everything declared here, so runtime importers keep
 * their existing paths.
 */

export interface CanvasLayoutV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
}

interface CanvasNormalizedRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CanvasImageAnnotationV1 {
  readonly id: string;
  readonly number: number;
  readonly normalizedRect: CanvasNormalizedRectV1;
  readonly comment: string;
  readonly action: 'comment' | 'erase';
  readonly createdAtMs: number;
}

export interface CanvasFileNodeV1 {
  readonly id: string;
  readonly type: 'file_ref';
  readonly file: {
    readonly relativePath: string;
    readonly assetId?: string;
    readonly fileName?: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly sha256?: string;
  };
  readonly layout: CanvasLayoutV1;
  readonly annotations: readonly CanvasImageAnnotationV1[];
}

export interface CanvasDocumentV1 {
  readonly schemaVersion: 1;
  readonly canvasId: string;
  readonly sessionId: string;
  readonly changeSeq: number;
  readonly nodes: readonly CanvasFileNodeV1[];
  readonly updatedAtMs: number;
}

export type CanvasMutationV1 =
  | ({
      readonly kind: 'add_file';
      readonly nodeId: string;
      readonly layout: CanvasLayoutV1;
    } & (
      | { readonly relativePath: string; readonly assetId?: never }
      | { readonly assetId: string; readonly relativePath?: never }
    ))
  | {
      readonly kind: 'update_layout';
      readonly nodeId: string;
      readonly layout: CanvasLayoutV1;
    }
  | {
      readonly kind: 'remove_node';
      readonly nodeId: string;
    }
  | {
      readonly kind: 'add_annotation';
      readonly nodeId: string;
      readonly annotation: CanvasImageAnnotationV1;
    }
  | {
      readonly kind: 'update_annotation';
      readonly nodeId: string;
      readonly annotation: CanvasImageAnnotationV1;
    }
  | {
      readonly kind: 'remove_annotation';
      readonly nodeId: string;
      readonly annotationId: string;
    };

export interface CanvasOperationV1 {
  readonly schemaVersion: 1;
  readonly operationId: string;
  readonly mutations: readonly CanvasMutationV1[];
}

export interface CanvasApplyResultV1 {
  readonly operationId: string;
  readonly document: CanvasDocumentV1;
}

export type CanvasFileTargetV1 =
  | {
      readonly id: string;
      readonly kind: 'workspace';
      readonly relativePath: string;
    }
  | {
      readonly id: string;
      readonly kind: 'asset';
      readonly assetId: string;
    }
  | {
      readonly id: string;
      readonly kind: 'session_deliverable';
      readonly sourcePath: string;
    }
  | {
      readonly id: string;
      readonly kind: 'external_file';
      readonly sourcePath: string;
    };

export interface PreparedCanvasFileV1 {
  readonly id: string;
  readonly relativePath: string;
  readonly assetId?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
}

export type CanvasServiceErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'WORKSPACE_UNAVAILABLE'
  | 'INVALID_OPERATION'
  | 'INVALID_FILE_REFERENCE'
  | 'FILE_ALREADY_ON_CANVAS'
  | 'NODE_ALREADY_EXISTS'
  | 'NODE_NOT_FOUND'
  | 'OPERATION_ID_REUSED'
  | 'PERSISTENCE_FAILED';
