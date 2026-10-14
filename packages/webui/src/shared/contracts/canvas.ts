/**
 * The canvas wire contract.
 *
 * `WebuiTransport` has to name these types, so they are declared here rather
 * than in the canvas component: a transport method cannot take a type defined
 * in a module that sits above it in the dependency chain.
 *
 * The shapes are derived from the runtime's canvas contracts
 * (`@mavis/local-runtime-v2/canvas-contracts`), which are the authority — the
 * runtime rejects a reused `operationId` with a different payload, an empty
 * `mutations` array, an `add_file` carrying both or neither file identity, a
 * non-positive width or height, and a non-integer `zIndex`. Where this client's
 * vocabulary differs from the runtime's, the difference is expressed as a
 * narrowing of the runtime's own union rather than as a second declaration:
 *
 *   * `CanvasMutation` is the subset of gestures this browser sends. The runtime
 *     also accepts `add_annotation`, `update_annotation` and `remove_annotation`;
 *     no WebUI surface creates annotations, so the narrowed union is exactly what
 *     the client's code can produce.
 *   * The document is the runtime's `CanvasDocumentV1` unchanged, so a node
 *     carries the real file-node fields instead of an opaque record.
 */
// Wire contract record (plan section 7.1 / 7.5): every exported
// declaration below records its wire purpose, its producer and its
// consumers, verified against the tree. Documentation only.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `CanvasNodeLayout` | One node's x/y/width/height/zIndex inside a canvas mutation. | Browser `client/features/workspace/ui/WorkspaceCanvas.tsx` (gesture handling). | `client/features/workspace/contracts/workspace-port.ts`; runtime `applyCanvas` (`runtime/harness/workspace.ts`). |
// | `CanvasMutation` | A single add_file / update_layout / remove_node canvas gesture. | Browser `client/features/workspace/ui/WorkspaceCanvas.tsx`. | `client/features/workspace/contracts/workspace-port.ts`; runtime `applyCanvas`. |
// | `CanvasOperation` | A batch of mutations plus schemaVersion/operationId sent to the canvas authority. | Browser `client/features/workspace/ui/WorkspaceCanvas.tsx`. | `client/features/workspace/contracts/workspace-port.ts`; `client/features/workspace/ui/WorkspacePanels.tsx`; runtime `applyCanvas`. |
// | `WebuiCanvasDocument` | The canvas document (nodes, changeSeq) returned by read/apply. | Runtime `readCanvas` / `applyCanvas` (`runtime/harness/workspace.ts`; runtime canvas authority). | `client/features/workspace/contracts/workspace-port.ts`; `client/features/workspace/ui/WorkspaceCanvas.tsx`; `client/features/workspace/ui/WorkspacePanels.tsx`. |
import type {
  CanvasDocumentV1,
  CanvasLayoutV1,
  CanvasMutationV1,
  CanvasOperationV1,
} from "@mavis/local-runtime-v2/canvas-wire";

export type CanvasNodeLayout = CanvasLayoutV1;

export type CanvasMutation = Extract<
  CanvasMutationV1,
  { readonly kind: "add_file" | "update_layout" | "remove_node" }
>;

export type CanvasOperation = Omit<CanvasOperationV1, "mutations"> & {
  readonly mutations: readonly CanvasMutation[];
};

export type WebuiCanvasDocument = CanvasDocumentV1;
