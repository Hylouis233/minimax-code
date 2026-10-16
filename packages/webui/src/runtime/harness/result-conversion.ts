// Runtime result → WebUI wire DTO, member by member.
//
// The harness port promises WebUI shapes. The runtime answers with its own view
// types, which are the same information arranged differently — and in a few
// places arranged differently in a way that matters. Every member that did not
// simply type-check used to be closed with a cast, which moved the difference
// out of sight instead of recording it: a runtime that renamed a field, or began
// returning a value of a type the cast could not see, would have kept compiling
// and failed at the browser.
//
// These functions are that record. Each one names the fields it reads, the ones
// it defaults when the runtime omits or mistypes them, and the ones it refuses —
// so a shape change stops at the boundary that owns it rather than surfacing as
// an undefined field three layers up in a panel.
//
// The rule every function follows: a value the WebUI contract declares as
// required is either read or *failed on*. Guessing a default for an identity
// would produce a review over the wrong repository, and a panel rendering that as
// empty rather than wrong is the worst of the three outcomes.

import type {
  WebuiWorkspaceReviewDiffs,
  WebuiWorkspaceReviewFile,
  WebuiWorkspaceReviewFileContent,
  WebuiWorkspaceReviewFileDiff,
  WebuiWorkspaceReviewSearchResult,
  WebuiWorkspaceReviewSummary,
} from "../../shared/contracts/review.js";
import type { WebuiCanvasDocument } from "../../shared/contracts/canvas.js";

/**
 * A runtime value that could not be converted.
 *
 * Carries `capability_unavailable` so a shape drift reaches the browser as "this
 * host cannot answer" rather than as a `harness_error` a user is invited to
 * retry — retrying a deterministic conversion failure is how a permanent break
 * turns into an error the user can never dismiss.
 */
export class WebuiResultShapeError extends Error {
  readonly code = "capability_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "WebuiResultShapeError";
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebuiResultShapeError("expected a record from the runtime, got a different shape");
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const count = (value: unknown): number => (typeof value === "number" ? value : 0);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const requiredText = (value: unknown, what: string): string => {
  if (typeof value !== "string" || !value) {
    throw new WebuiResultShapeError(`the runtime's review result is missing ${what}`);
  }
  return value;
};

/** One reviewed file. `path` and the two counts are what the panel lists. */
function toReviewFile(value: unknown): WebuiWorkspaceReviewFile {
  const file = record(value);
  return {
    fileId: requiredText(file.fileId ?? file.id, "a file id"),
    path: text(file.path, ""),
    // Git status is required by the wire contract, so an absent one is named
    // rather than dropped: an empty string would render as a file with no status
    // rather than as a runtime answer that left it out.
    status: text(file.status, "unknown"),
    additions: count(file.additions),
    deletions: count(file.deletions),
    ...(typeof file.originalPath === "string"
      ? { originalPath: file.originalPath }
      : {}),
    ...(file.type === "binary" || file.type === "text" ? { type: file.type } : {}),
  };
}

/**
 * The review summary.
 *
 * The three totals are read from the runtime's own counts rather than summed
 * here: the runtime's total can cover files this snapshot deliberately omits, and
 * re-deriving it would silently disagree with the runtime about what was reviewed.
 */
export function toWebuiReviewSummary(value: unknown): WebuiWorkspaceReviewSummary {
  const summary = record(value);
  const totals = record(summary.totals ?? {});
  return {
    repositoryId: text(summary.repositoryId, ""),
    reviewSnapshotId: requiredText(
      summary.reviewSnapshotId,
      "a review snapshot id",
    ),
    files: list(summary.files).map(toReviewFile),
    totals: {
      files: count(totals.files),
      additions: count(totals.additions),
      deletions: count(totals.deletions),
    },
  };
}

/**
 * One file's diff.
 *
 * A diff the runtime reports as an error carries the code and message and no
 * content, and that is passed through rather than turned into an empty diff: the
 * panel shows the reason, and an empty diff would read as "no changes".
 */
function toReviewDiff(value: unknown): WebuiWorkspaceReviewFileDiff {
  const entry = record(value);
  const errorCode = typeof entry.errorCode === "string" ? entry.errorCode : undefined;
  const error = typeof entry.error === "string" ? entry.error : undefined;
  const fileId = requiredText(entry.fileId ?? entry.id, "a file id");
  if (errorCode || error) {
    return {
      fileId,
      ...(errorCode ? { errorCode } : {}),
      ...(error ? { error } : {}),
    };
  }
  const diff = record(entry.diff);
  const type = diff.type === "binary" ? "binary" : "text";
  return {
    fileId,
    diff: {
      type,
      content: text(diff.content, ""),
      ...(typeof diff.diff === "string" ? { diff: diff.diff } : {}),
      ...(typeof diff.previewState === "string"
        ? { previewState: diff.previewState }
        : {}),
    },
  };
}

export function toWebuiReviewDiffs(value: unknown): WebuiWorkspaceReviewDiffs {
  const diffs = record(value);
  return {
    reviewSnapshotId: requiredText(diffs.reviewSnapshotId, "a review snapshot id"),
    diffs: list(diffs.diffs ?? diffs.files).map(toReviewDiff),
  };
}

/**
 * One side of one file.
 *
 * `side` is not defaulted. The two sides are different content, so a diff that
 * arrives without one would be attributed to the wrong side of the file and read
 * as a real change that is not in the file at all.
 */
export function toWebuiReviewFileContent(value: unknown): WebuiWorkspaceReviewFileContent {
  const content = record(value);
  const side = content.side;
  if (side !== "old" && side !== "new") {
    throw new WebuiResultShapeError("the runtime's file content carries no side");
  }
  const errorCode =
    typeof content.errorCode === "string" ? content.errorCode : undefined;
  const error = typeof content.error === "string" ? content.error : undefined;
  return {
    fileId: requiredText(content.fileId ?? content.id, "a file id"),
    path: text(content.path, ""),
    side,
    type: content.type === "binary" ? "binary" : "text",
    ...(typeof content.content === "string" ? { content: content.content } : {}),
    ...(error ? { error } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

export function toWebuiReviewSearchResult(value: unknown): WebuiWorkspaceReviewSearchResult {
  const search = record(value);
  return {
    reviewSnapshotId: requiredText(
      search.reviewSnapshotId,
      "a review snapshot id",
    ),
    matchedFiles: list(search.matchedFiles).map((entry) => {
      const matched = record(entry);
      return {
        fileId: requiredText(matched.fileId ?? matched.id, "a file id"),
        path: text(matched.path, ""),
        matchCount: count(matched.matchCount),
      };
    }),
    totalMatches: count(search.totalMatches),
    totalMatchedFiles: count(search.totalMatchedFiles),
    pageIndex: count(search.pageIndex),
    pageSize: count(search.pageSize),
    matchesBeforePage: count(search.matchesBeforePage),
    hasPreviousPage: search.hasPreviousPage === true,
    hasNextPage: search.hasNextPage === true,
  };
}

/**
 * The canvas document.
 *
 * Every node is rebuilt as a plain record. The runtime's node type is an
 * interface, and an interface is not assignable to an index-signature type — so
 * the field the WebUI contract declares (`readonly Record<string, unknown>[]`)
 * could not be satisfied by the runtime's own node type at all, which is exactly
 * the difference this file exists to state. Copying the fields keeps the node
 * opaque to the wire while letting the WebUI's own contract stay independently
 * owned: a new runtime field reaches the panel as an extra key rather than as a
 * type error the cast would have hidden.
 */
export function toWebuiCanvasDocument(value: unknown): WebuiCanvasDocument {
  const document = record(value);
  return {
    schemaVersion: count(document.schemaVersion),
    canvasId: requiredText(document.canvasId, "a canvas id"),
    sessionId: text(document.sessionId, ""),
    changeSeq: count(document.changeSeq),
    nodes: list(document.nodes).map((node) =>
      node && typeof node === "object" && !Array.isArray(node)
        ? { ...(node as Record<string, unknown>) }
        : { value: node },
    ),
    updatedAtMs: count(document.updatedAtMs),
  };
}

/** The canvas mutation result: the operation's own id plus the document it produced. */
export function toWebuiCanvasApplyResult(value: unknown): {
  readonly operationId: string;
  readonly document: WebuiCanvasDocument;
} {
  const result = record(value);
  return {
    operationId: requiredText(result.operationId, "an operation id"),
    document: toWebuiCanvasDocument(result.document),
  };
}
