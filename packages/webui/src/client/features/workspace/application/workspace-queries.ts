// The workspace composer.
//
// This module owns no resource of its own: the file tree and contents, the git
// environment and the review each have their own owner. The panels read ONE
// snapshot, so this composes the sub-slices on read and forwards every command —
// composing the submodule APIs rather than reimplementing their policy.
//
// It keeps exactly two things: the git-changed fan-out (one signal, the owners it
// names) and the composed snapshot's identity, which `useSyncExternalStore`
// compares.

import type {
  WebuiWorkspaceFile,
  WebuiWorkspaceGitMutationRequest,
} from "../../../../shared/contracts/workspace.js";
import {
  createWebuiWorkspaceFilesOwner,
  initialWebuiWorkspaceFilesState,
  type WebuiWorkspaceDirLoad,
  type WebuiWorkspaceFilesPort,
  type WebuiWorkspaceFilesState,
  type WebuiWorkspaceFileTreeState,
} from "./workspace-files-owner.js";
import {
  createWebuiWorkspaceEnvironmentOwner,
  initialWebuiWorkspaceEnvironmentState,
  type WebuiWorkspaceEnvironmentOwner,
  type WebuiWorkspaceEnvironmentPort,
} from "./workspace-environment-owner.js";
import { createWebuiWorkspaceReviewOwner } from "../../review/application/workspace-review-owner.js";
import {
  createWebuiWorkspacePanelOwner,
  type WebuiWorkspacePanelOwner,
} from "./workspace-panel-owner.js";
import {
  createWebuiWorkspaceCanvasOwner,
  initialWebuiWorkspaceCanvasState,
  type WebuiWorkspaceCanvasOwner,
  type WebuiWorkspaceCanvasPort,
  type WebuiWorkspaceCanvasState,
} from "./workspace-canvas-owner.js";
import {
  createWebuiWorkspaceArchiveOwner,
  initialWebuiWorkspaceArchiveState,
  type WebuiWorkspaceArchiveOwner,
  type WebuiWorkspaceArchivePort,
  type WebuiWorkspaceArchiveState,
} from "./workspace-archive-owner.js";
import {
  initialWebuiWorkspaceReviewState,
  type WebuiWorkspaceReviewPort,
  type WebuiWorkspaceReviewSummaryState,
} from "../../review/contracts/workspace-review.js";

export { initialWebuiWorkspaceFileTreeState } from "./workspace-files-owner.js";
export type {
  WebuiWorkspaceFileContentState,
  WebuiWorkspaceFileTreeState,
  WebuiWorkspaceDirLoad,
} from "./workspace-files-owner.js";
export type { WebuiWorkspaceEnvironmentState } from "./workspace-environment-owner.js";
export type { WebuiWorkspaceReviewPort };

/** Every capability the workspace surfaces read, in one port. */
export interface WebuiWorkspaceQueryPort
  extends WebuiWorkspaceFilesPort,
    WebuiWorkspaceEnvironmentPort,
    WebuiWorkspaceArchivePort,
    WebuiWorkspaceCanvasPort,
    WebuiWorkspaceReviewPort {}

export interface WebuiWorkspaceQueriesState {
  readonly reviewRevision: number;
  readonly fileTree: WebuiWorkspaceFileTreeState;
  readonly environmentRevision: number;
  readonly environment: import("./workspace-environment-owner.js").WebuiWorkspaceEnvironmentState;
  readonly files: ReadonlyMap<string, import("./workspace-files-owner.js").WebuiWorkspaceFileContentState>;
  /** The directory picker's listing (the files owner's slice). */
  readonly directoryBrowse: import("./workspace-files-owner.js").WebuiDirectoryBrowseState;
  /** The archive owner's slice: one listing and one extract outcome. */
  readonly archive: WebuiWorkspaceArchiveState;
  /** The canvas owner's slice: the session's document and the last outcome. */
  readonly canvas: WebuiWorkspaceCanvasState;
  readonly reviewSummary: WebuiWorkspaceReviewSummaryState;
  readonly reviewDiffs: import("../../review/contracts/workspace-review.js").WebuiWorkspaceReviewDiffState;
  readonly reviewSearch: import("../../review/contracts/workspace-review.js").WebuiWorkspaceReviewSearchState;
}

export interface WebuiWorkspaceQueries {
  readonly getSnapshot: () => WebuiWorkspaceQueriesState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly canListFileTree: boolean;
  readonly canReadFile: boolean;
  readonly canReadEnvironment: boolean;
  readonly canMutateGit: boolean;
  readonly canReview: boolean;
  readonly invalidateReview: () => void;
  readonly canSearchReviewDiffs: boolean;
  readonly selectWorkspace: (workspaceDir: string | undefined) => void;
  readonly loadFileTree: (workspaceDir: string) => void;
  readonly loadDirectory: (workspaceDir: string, path: string) => Promise<WebuiWorkspaceDirLoad>;
  readonly readFile: (tabId: string, workspaceDir: string, path: string) => void;
  readonly setInlineFile: (tabId: string, content: string, resolvedPath: string) => void;
  /** Release a closed tab's file slot and its read commit rights. */
  readonly discardFileTab: (tabId: string) => void;
  /** List one directory for the workspace picker (superseded browses dropped). */
  readonly browseWorkspaceDirs: (dir?: string) => void;
  readonly canBrowseWorkspaceDirs: boolean;
  /**
   * The panel/tab owner. Its state is keyed by session and is not part of the
   * composed snapshot: a surface subscribes to the session it shows.
   */
  readonly panel: WebuiWorkspacePanelOwner;
  readonly loadReviewSummary: (
    tabId: string,
    workspaceDir: string,
  ) => Promise<WebuiWorkspaceReviewSummaryState["summary"]>;
  readonly loadReviewDiffs: (request: {
    readonly tabId: string;
    readonly workspaceDir: string;
    readonly snapshotId: string;
    readonly fileIds: readonly string[];
  }) => Promise<void>;
  readonly searchReviewDiffs: (request: {
    readonly tabId: string;
    readonly workspaceDir: string;
    readonly snapshotId: string;
    readonly query: string;
  }) => Promise<void>;
  /** Read one archive listing (superseded reads are dropped). */
  readonly readArchive: WebuiWorkspaceArchiveOwner["read"];
  /** Extract one archive; the outcome is the owner's, not a component's. */
  readonly extractArchive: WebuiWorkspaceArchiveOwner["extract"];
  readonly canReadArchive: boolean;
  /** Read the session's canvas document (a session already left is dropped). */
  readonly readCanvas: WebuiWorkspaceCanvasOwner["read"];
  /** Run one canvas operation; resolves `true` when it landed. */
  readonly applyCanvas: WebuiWorkspaceCanvasOwner["apply"];
  readonly canReadCanvas: boolean;
  readonly canApplyCanvas: boolean;
  readonly canExtractArchive: boolean;
  readonly loadEnvironment: (workspaceDir: string) => void;
  readonly mutateGit: (
    request: WebuiWorkspaceGitMutationRequest,
  ) => Promise<Record<string, unknown>>;
  readonly invalidateWorkspaceGit: (signal: {
    readonly workspace?: string;
    readonly aliases?: readonly string[];
  }) => void;
  readonly reportDirectoryError: (
    workspaceDir: string,
    path: string,
    error: string,
  ) => void;
  readonly dispose: () => void;
}

export const initialWebuiWorkspaceQueriesState: WebuiWorkspaceQueriesState = {
  ...initialWebuiWorkspaceFilesState,
  ...initialWebuiWorkspaceReviewState,
  environment: initialWebuiWorkspaceEnvironmentState,
  environmentRevision: 0,
  archive: initialWebuiWorkspaceArchiveState,
  canvas: initialWebuiWorkspaceCanvasState,
};

export function createWebuiWorkspaceQueries(deps: {
  readonly port: WebuiWorkspaceQueryPort;
}): WebuiWorkspaceQueries {
  const { port } = deps;
  const files = createWebuiWorkspaceFilesOwner({ port });
  const review = createWebuiWorkspaceReviewOwner({ port });
  const archive = createWebuiWorkspaceArchiveOwner({ port });
  const canvas = createWebuiWorkspaceCanvasOwner({ port });
  const panel = createWebuiWorkspacePanelOwner();
  const environment: WebuiWorkspaceEnvironmentOwner =
    createWebuiWorkspaceEnvironmentOwner({
      port,
      invalidateReview: () => review.invalidate(),
    });

  const listeners = new Set<() => void>();
  const compose = (): void => {
    snapshot = {
      ...files.state(),
      ...review.read(),
      environment: environment.state(),
      environmentRevision: environment.revision(),
      archive: archive.state(),
      canvas: canvas.state(),
    };
  };
  let snapshot: WebuiWorkspaceQueriesState = {
    ...files.state(),
    ...review.read(),
    environment: environment.state(),
    environmentRevision: environment.revision(),
    archive: archive.state(),
    canvas: canvas.state(),
  };
  const notify = (): void => {
    compose();
    for (const listener of [...listeners]) listener();
  };
  files.subscribe(notify);
  review.subscribe(notify);
  environment.subscribe(notify);
  archive.subscribe(notify);
  canvas.subscribe(notify);

  const invalidateWorkspaceGit = (signal: {
    readonly workspace?: string;
    readonly aliases?: readonly string[];
  }): void => {
    const matches = (workspaceDir: string | undefined): boolean =>
      workspaceDir !== undefined &&
      (signal.workspace === workspaceDir || Boolean(signal.aliases?.includes(workspaceDir)));
    // Review views for the workspace the signal names, at once.
    review.invalidateForWorkspace(signal);
    // The environment reload is coalesced into the previous 350 ms window.
    const workspaceDir = environment.state().workspaceDir;
    if (matches(workspaceDir)) environment.invalidate(workspaceDir!, 350);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canListFileTree: files.canListFileTree,
    canReadFile: files.canReadFile,
    canReadEnvironment: environment.canReadEnvironment,
    canMutateGit: environment.canMutateGit,
    canReview: review.canReview,
    canSearchReviewDiffs: review.canSearchDiffs,
    selectWorkspace: files.selectWorkspace,
    loadFileTree: files.loadFileTree,
    loadDirectory: files.loadDirectory,
    readFile: files.readFile,
    setInlineFile: files.setInlineFile,
    discardFileTab: files.discardTab,
    browseWorkspaceDirs: files.browse,
    canBrowseWorkspaceDirs: files.canBrowseDirectories,
    panel,
    invalidateReview: review.invalidate,
    loadReviewSummary: review.loadSummary,
    loadReviewDiffs: review.loadDiffs,
    searchReviewDiffs: review.search,
    readArchive: archive.read,
    extractArchive: archive.extract,
    canReadArchive: archive.canRead,
    readCanvas: canvas.read,
    applyCanvas: canvas.apply,
    canReadCanvas: canvas.canRead,
    canApplyCanvas: canvas.canApply,
    canExtractArchive: archive.canExtract,
    loadEnvironment: environment.load,
    mutateGit: environment.mutateGit,
    reportDirectoryError: files.reportDirectoryError,
    invalidateWorkspaceGit,
    dispose: () => {
      files.dispose();
      archive.dispose();
      canvas.dispose();
      panel.dispose();
      environment.dispose();
      listeners.clear();
    },
  };
}
