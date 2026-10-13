// Sessions capability port (plan §9; ticket #59).
//
// The session's own lifecycle: list, tree, create, archive, delete, update, fork
// and the per-session usage read, with the loader/creator types those members
// take. §9 halves `session-port` between `sessions` and `transcript`; the session
// records themselves are this file's, and the message half is
// `transcript/transcript-port.ts`.
//
// Every method stays optional — `undefined` means "the operation is not wired".

import type { WebuiClientProject, WebuiClientSessionPage, WebuiClientSessionTreePage } from ".././sessions/session-view.js";
import type { WebuiForkSessionRequest, WebuiForkSessionResult, WebuiGetSessionForkOptionsRequest, WebuiGetSessionForkOptionsResult, WebuiUpdateSessionRequest, WebuiUpdateSessionResult } from "../../../shared/contracts/session.js";

export interface SessionPort {
  readonly loadProjects?: () => Promise<readonly WebuiClientProject[]>;
  readonly listArchivedSessions?: () => Promise<WebuiClientSessionPage>;
  readonly loadSessions?: WebuiClientSessionLoader;
  readonly loadSessionTree?: WebuiClientSessionTreeLoader;
  readonly createSession?: WebuiClientSessionCreator;
  readonly archiveSession?: (request: {
    readonly id: string;
    readonly archived?: boolean;
  }) => Promise<{ readonly success?: boolean }>;
  readonly deleteSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly updateSession?: (
    request: WebuiUpdateSessionRequest,
  ) => Promise<WebuiUpdateSessionResult>;
  readonly getSessionForkOptions?: (
    request: WebuiGetSessionForkOptionsRequest,
  ) => Promise<WebuiGetSessionForkOptionsResult>;
  readonly forkSession?: (
    request: WebuiForkSessionRequest,
  ) => Promise<WebuiForkSessionResult>;
  readonly getSessionUsage?: (request: {
    readonly id: string;
  }) => Promise<Record<string, unknown>>;
}

export type WebuiClientSessionTreeLoader = (
  cursor?: string,
) => Promise<WebuiClientSessionTreePage>;

export type WebuiClientSessionLoader = (
  cursor?: string,
) => Promise<WebuiClientSessionPage>;

export interface WebuiClientCreateSessionRequest {
  readonly name: string;
  /** Optional: absent means "use the default workspace" (harness resolves it). */
  readonly workspaceDir?: string;
  readonly teamModeOff?: boolean;
}

export interface WebuiClientCreateSessionResult {
  readonly sessionId?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly workspaceDir?: string;
  };
}

export type WebuiClientSessionCreator = (
  request: WebuiClientCreateSessionRequest,
) => Promise<WebuiClientCreateSessionResult>;
