// The Terminal business's published surface (T15, plan §5.2's terminal row).
//
// These declarations are what a peer business — the workspace panel today —
// consumes: the owner interface and the catalogue it answers with. The
// implementation (`createWebuiTerminalOwner`) and its policy stay in
// `../application/terminal-owner.js`; a peer needs to *drive* a terminal and to
// render its catalogue, not to build the owner.

/** One terminal this client knows about, as the process half reports it. */
export interface WebuiTerminalRecord {
  readonly terminalId: string;
  readonly status: string;
  readonly output?: string;
}

export interface WebuiTerminalCatalogue {
  readonly terminals: readonly WebuiTerminalRecord[];
  readonly loading: boolean;
  readonly error?: string;
}

/** The state before anyone has asked the runtime anything. */
export const initialWebuiTerminalCatalogue: WebuiTerminalCatalogue = {
  terminals: [],
  loading: false,
};

export interface WebuiTerminalOwner {
  readonly getSnapshot: () => WebuiTerminalCatalogue;
  readonly subscribe: (listener: () => void) => () => void;

  readonly canCreate: boolean;
  readonly canWrite: boolean;
  readonly canResize: boolean;
  readonly canDispose: boolean;
  readonly canWatch: boolean;

  /** Read the catalogue; a failure is recorded in the snapshot, not thrown. */
  readonly refresh: () => Promise<void>;
  /** Create a terminal and adopt it into the catalogue. */
  readonly create: (workspaceDir: string) => Promise<WebuiTerminalRecord | undefined>;
  readonly write: (terminalId: string, data: string) => Promise<void>;
  readonly resize: (request: WebuiTerminalSizeRequest) => Promise<void>;
  /** Explicit process death. A view release never calls this. */
  readonly disposeProcess: (terminalId: string) => Promise<void>;
  /**
   * Watch one terminal's frames. The returned disposer releases exactly that
   * watch — it does not stop the process, which is the whole point of the split.
   */
  readonly attach: (
    terminalId: string,
    onFrame: (frame: WebuiTerminalFrameView) => void,
  ) => () => void;
  /** Release every watch (a view going away). Processes stay alive. */
  readonly detachAll: () => void;
  /** End every watch and every process; the application calls this on disposal. */
  readonly disposeAll: () => Promise<void>;
}

/** The resize request the owner forwards, named here so peers need one import. */
export interface WebuiTerminalSizeRequest {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
}

/** One terminal frame, named here for the same reason. */
export interface WebuiTerminalFrameView {
  readonly terminalId: string;
  readonly data: string;
  readonly exited: boolean;
}
