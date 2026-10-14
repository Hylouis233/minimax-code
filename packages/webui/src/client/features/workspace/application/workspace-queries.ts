// The workspace composer (T11).
//
// This module owns no resource of its own: the file tree and contents, the git
// environment and the review each have their own owner (plan §5.2 workspace row).
// The panels read ONE snapshot, so this composes the three slices on read and
// forwards every command, which is what the plan means by composing the submodule
// APIs rather than reimplementing their policy.
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
    WebuiWorkspaceReviewPort {}

export interface WebuiWorkspaceQueriesState {
  readonly reviewRevision: number;
  readonly fileTree: WebuiWorkspaceFileTreeState;
  readonly environmentRevision: number;
  readonly environment: import("./workspace-environment-owner.js").WebuiWorkspaceEnvironmentState;
  readonly files: ReadonlyMap<string, import("./workspace-files-owner.js").WebuiWorkspaceFileContentState>;
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
};

export function createWebuiWorkspaceQueries(deps: {
  readonly port: WebuiWorkspaceQueryPort;
}): WebuiWorkspaceQueries {
  const { port } = deps;
  const files = createWebuiWorkspaceFilesOwner({ port });
  const review = createWebuiWorkspaceReviewOwner({ port });
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
    };
  };
  let snapshot: WebuiWorkspaceQueriesState = {
    ...files.state(),
    ...review.read(),
    environment: environment.state(),
    environmentRevision: environment.revision(),
  };
  const notify = (): void => {
    compose();
    for (const listener of [...listeners]) listener();
  };
  files.subscribe(notify);
  review.subscribe(notify);
  environment.subscribe(notify);

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
    invalidateReview: review.invalidate,
    loadReviewSummary: review.loadSummary,
    loadReviewDiffs: review.loadDiffs,
    searchReviewDiffs: review.search,
    loadEnvironment: environment.load,
    mutateGit: environment.mutateGit,
    reportDirectoryError: files.reportDirectoryError,
    invalidateWorkspaceGit,
    dispose: () => {
      files.dispose();
      environment.dispose();
      listeners.clear();
    },
  };
}
