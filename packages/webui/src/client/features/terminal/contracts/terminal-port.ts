// Terminal capability port.
//
// Terminal create/list/write/dispose and the per-terminal frame stream. Split
// from the monolithic `WebuiTransport` in the former `client/contracts.ts`;
// `transport.ts` composes it. Every method stays optional — `undefined` means
// "the operation is not wired".

import type { WebuiTerminalFrame } from "../../../../shared/contracts/terminal.js";

/**
 * A terminal's viewport, in cells, as the browser reports it.
 *
 * One declaration serves both ends of the report: it is the request
 * `resizeTerminal` carries and the entry the shell's own cache holds, so the
 * size that was sent and the size remembered cannot describe different things.
 */
export interface WebuiTerminalSize {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalPort {
  readonly createTerminal?: (request: {
    readonly workspaceDir: string;
    readonly cols?: number;
    readonly rows?: number;
  }) => Promise<{ readonly terminalId: string; readonly status: string }>;
  readonly listTerminals?: () => Promise<readonly Record<string, unknown>[]>;
  readonly writeTerminal?: (request: {
    readonly terminalId: string;
    readonly data: string;
  }) => Promise<unknown>;
  /**
   * Tell the runtime how large the attached terminal now is.
   *
   * The pseudo-terminal behind the tab is created at 80x24 and this operation
   * is the only thing that moves it, so a client that never sends one leaves
   * full-screen programs drawing into a grid the browser is not showing.
   */
  readonly resizeTerminal?: (request: WebuiTerminalSize) => Promise<unknown>;
  readonly disposeTerminal?: (request: {
    readonly terminalId: string;
  }) => Promise<unknown>;
  readonly watchTerminal?: (
    request: { readonly terminalId: string },
    onFrame: (frame: WebuiTerminalFrame) => void,
  ) => () => void;
}
