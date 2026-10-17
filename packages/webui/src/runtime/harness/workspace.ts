// Workspace files, git state, review diffs and the canvas.
//
// Split out of the former `server/host.ts` `createHarnessPortFromHost`. Carries
// the workspace result shaping: the file tree is statted here (the one place
// that sees both the runtime tree and the filesystem) and a bare basename is
// resolved to a unique nested path before reading.
import { posix as pathPosix } from "node:path";
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  extractWorkspaceArchiveDirectory,
  readWorkspaceArchiveListing,
} from "../workspace-archive.js";
import type { WebuiHarnessPort } from "../port.js";
import type { WebuiRuntimeHostHandle } from "./host-contract.js";
import { requireCliService, requireHostSlot } from "./requirements.js";
import { toRuntimeCanvasInput } from "./canvas-input.js";
import {
  toWebuiCanvasApplyResult,
  toWebuiCanvasDocument,
  toWebuiReviewDiffs,
  toWebuiReviewFileContent,
  toWebuiReviewSearchResult,
  toWebuiReviewSummary,
  toWebuiWorkspaceFiles,
} from "./result-conversion.js";
import type {
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceEnvironment,
} from "../../shared/contracts/workspace.js";
import type {
  WebuiWorkspaceReviewDiffs,
  WebuiWorkspaceReviewFileContent,
  WebuiWorkspaceReviewSearchResult,
  WebuiWorkspaceReviewSummary,
} from "../../shared/contracts/review.js";
import type { WebuiCanvasDocument } from "../../shared/contracts/canvas.js";

export function createWorkspaceAdapter(
  host: WebuiRuntimeHostHandle,
): Pick<
  WebuiHarnessPort,
  | "listWorkspaceFileTree"
  | "readWorkspaceArchive"
  | "extractWorkspaceArchive"
  | "readWorkspaceFile"
  | "getWorkspaceEnvironment"
  | "mutateWorkspaceGit"
  | "getWorkspaceReviewSummary"
  | "listWorkspaceReviewFileDiffs"
  | "getWorkspaceReviewFileContent"
  | "searchWorkspaceReviewDiffs"
  | "readCanvas"
  | "applyCanvas"
> {
  return {
    async listWorkspaceFileTree(request) {
      const cliService = requireCliService(host);
      const tree = await requireHostSlot(
        cliService.listWorkspaceFileTree,
        "Workspace file listing",
      ).call(cliService, request);
      // The runtime reports names and shape but no file facts, while the port
      // contract now promises `size` and `modifiedAt` for the panel's metadata
      // column. Statted here because this is the one place that sees both the
      // tree and the filesystem — extending the runtime would put the change
      // outside this package, and a tree that silently omits the fields would
      // leave the column blank rather than failing loudly.
      return Promise.all(
        toWebuiWorkspaceFiles(tree).map(async (entry) => {
          if (entry.type === "directory") return entry;
          try {
            const stats = await stat(
              path.join(request.workspaceDir, entry.path),
            );
            return { ...entry, size: stats.size, modifiedAt: stats.mtimeMs };
          } catch {
          // A file that vanished or is unreadable keeps its entry and loses
          // only the metadata; dropping it from the tree would be a lie.
          return entry;
        }
        }),
      );
    },

    // Both operations are served by this package now, so the optional runtime
    // hook is a preference rather than a requirement: a host that implements
    // one keeps it, and a host that implements neither lands on
    // `./workspace-archive.ts` instead of the "capability not connected yet"
    // error this pair used to throw. The built-in reader owns the hardening
    // (path validation, entry ceiling, expansion ratio), which is the reason it
    // is not left to a runtime that may not have shipped one.
    async readWorkspaceArchive(request) {
      const cliService = requireCliService(host);
      if (cliService.readWorkspaceArchive) return cliService.readWorkspaceArchive(request);
      return readWorkspaceArchiveListing(request);
    },

    async extractWorkspaceArchive(request) {
      const cliService = requireCliService(host);
      if (cliService.extractWorkspaceArchive) return cliService.extractWorkspaceArchive(request);
      return extractWorkspaceArchiveDirectory(request);
    },

    async readWorkspaceFile(request) {
      const cliService = requireCliService(host);
      const result = (await cliService.readWorkspaceFile!(
        request,
      )) as WebuiWorkspaceFileContent;
      if (
        result.type !== "binary" ||
        result.error !== "Path traversal denied" ||
        request.path.includes("/") ||
        request.path.includes("\\") ||
        !cliService.searchWorkspaceFiles
      ) return result;

      // Assistant replies sometimes link only a basename (for example,
      // `SessionComposer.tsx`) even when the file lives in a nested package.
      // Resolve only an exact, unique basename; never guess among duplicates.
      try {
        const matches = await cliService.searchWorkspaceFiles({
          workspaceDir: request.workspaceDir,
          query: request.path,
          limit: 100,
        });
        const exactMatches = matches.filter(
          (candidate) => pathPosix.basename(candidate.replace(/\\/gu, "/")) === request.path,
        );
        const [exactMatch] = exactMatches;
        if (exactMatches.length === 1 && exactMatch) {
          const resolved = (await cliService.readWorkspaceFile!({
            ...request,
            path: exactMatch,
          })) as WebuiWorkspaceFileContent;
          return { ...resolved, resolvedPath: exactMatch };
        }
        return {
          type: "text",
          content: "",
          error:
            exactMatches.length > 1
              ? `工作区中有多个名为 ${request.path} 的文件，请使用完整相对路径。`
              : `工作区中没有找到 ${request.path}。`,
        };
      } catch {
        return result;
      }
    },

    async getWorkspaceEnvironment(request) {
      const cliService = requireCliService(host);
      const getWorkspaceGitEnvironment = requireHostSlot(
        cliService.getWorkspaceGitEnvironment,
        "Workspace git state",
      );
      const { metadata, changes } = await getWorkspaceGitEnvironment.call(
        cliService,
        request.workspaceDir,
      );
      return {
        isGitRepo: changes.isGitRepo === true || metadata.isGitRepo === true,
        ...(typeof metadata.branch === "string" ? { branch: metadata.branch } : {}),
        changedFiles: typeof changes.changedFiles === "number" ? changes.changedFiles : 0,
        insertions: typeof changes.insertions === "number" ? changes.insertions : 0,
        deletions: typeof changes.deletions === "number" ? changes.deletions : 0,
        lineStatsStatus: changes.lineStatsStatus === "ready" || changes.lineStatsStatus === "partial" ? changes.lineStatsStatus : "skipped",
        ...(typeof metadata.canPush === "boolean" ? { canPush: metadata.canPush } : {}),
        ...(typeof metadata.hasRemote === "boolean" ? { hasRemote: metadata.hasRemote } : {}),
        ...(typeof metadata.hasUpstream === "boolean" ? { hasUpstream: metadata.hasUpstream } : {}),
        ...(typeof changes.error === "string" ? { changesError: changes.error } : {}),
        ...(typeof metadata.error === "string" ? { metadataError: metadata.error } : {}),
      } as WebuiWorkspaceEnvironment;
    },

    async mutateWorkspaceGit(request) {
      const cliService = requireCliService(host);
      const mutateWorkspaceGit = requireHostSlot(
        cliService.mutateWorkspaceGit,
        "Workspace git mutations",
      );
      return mutateWorkspaceGit.call(cliService, request);
    },

    async getWorkspaceReviewSummary(request) {
      const cliService = requireCliService(host);
      const getWorkspaceReviewSummary = requireHostSlot(
        cliService.getWorkspaceReviewSummary,
        "Workspace review summaries",
      );
      // Converted, not asserted: the runtime answers with its own review view, and
      // every field the panel lists is read and defaulted here so a rename on the
      // runtime side stops at this boundary instead of becoming an undefined
      // column three layers up.
      return toWebuiReviewSummary(
        await getWorkspaceReviewSummary.call(cliService, request.workspaceDir),
      );
    },

    async listWorkspaceReviewFileDiffs(request) {
      const cliService = requireCliService(host);
      const listWorkspaceReviewFileDiffs = requireHostSlot(
        cliService.listWorkspaceReviewFileDiffs,
        "Workspace review file diffs",
      );
      return toWebuiReviewDiffs(
        await listWorkspaceReviewFileDiffs.call(cliService, {
          ...request,
          fileIds: [...request.fileIds],
        }),
      );
    },

    async getWorkspaceReviewFileContent(request) {
      const cliService = requireCliService(host);
      const getWorkspaceReviewFileContent = requireHostSlot(
        cliService.getWorkspaceReviewFileContent,
        "Workspace review file content",
      );
      return toWebuiReviewFileContent(
        await getWorkspaceReviewFileContent.call(cliService, request),
      );
    },

    async searchWorkspaceReviewDiffs(request) {
      const cliService = requireCliService(host);
      const searchWorkspaceReviewDiffs = requireHostSlot(
        cliService.searchWorkspaceReviewDiffs,
        "Workspace review search",
      );
      return toWebuiReviewSearchResult(
        await searchWorkspaceReviewDiffs.call(cliService, request),
      );
    },

    async readCanvas(request) {
      const cliService = requireCliService(host);
      return toWebuiCanvasDocument(
        await requireHostSlot(cliService.readCanvas, "canvas documents").call(
          cliService,
          request,
        ),
      );
    },

    async applyCanvas(request) {
      const cliService = requireCliService(host);
      return toWebuiCanvasApplyResult(
        await requireHostSlot(cliService.applyCanvas, "canvas writes").call(
          cliService,
          toRuntimeCanvasInput(request),
        ),
      );
    },
  };
}
