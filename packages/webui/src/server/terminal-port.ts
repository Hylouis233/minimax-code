// The narrow terminal-process port (T14, produced target
// `terminal-process-port-contract`).
//
// The six terminal operations consume this port, not a concrete manager: the
// registry must not depend on the class that happens to implement it. The real
// `WebuiTerminalManager` implements it today; T15 migrates the implementation and
// the service's terminal resource ownership behind the same port, which is why
// only the members the operations actually call are declared here.
//
// Every member is synchronous except `watch`, which is the delivery stream: the
// operation handler drives it and the WebSocket server frames what it yields.

export interface WebuiTerminalProcessPort {
  create(workspaceDir: string): {
    readonly terminalId: string;
    readonly status: "running";
  };
  list(): readonly {
    readonly terminalId: string;
    readonly status: "running" | "exited";
    readonly output: string;
  }[];
  write(terminalId: string, data: string): { readonly success: true };
  resize(
    terminalId: string,
    cols: number,
    rows: number,
  ): { readonly success: true };
  dispose(terminalId: string): { readonly success: true };
  watch(
    terminalId: string,
    signal?: AbortSignal,
  ): AsyncIterable<{
    readonly terminalId: string;
    readonly data: string;
    readonly exited: boolean;
  }>;
  /** Ends every terminal this port owns. The service calls it on shutdown. */
  disposeBySession(): void;
}
