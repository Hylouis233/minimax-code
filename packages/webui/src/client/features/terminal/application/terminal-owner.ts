// The browser Terminal owner (T15, plan §5.2's terminal row).
//
// The workspace panel used to hold this state and call six raw capability
// methods itself: it kept the catalogue, the active id, the watch handle and the
// last reported size, so a panel that unmounted took the only record of what was
// attached with it, and nothing could answer "which terminals does this client
// still watch" while the panel was gone. The owner holds that truth instead.
//
// What this owner owns: the catalogue of terminals this client knows about, the
// create/write/resize/dispose process commands, and the **watch registry** —
// `attach` returns a real disposer, and `detachAll` releases every watch without
// touching a process. What stays presentation: the xterm instance, the fit
// observer, the resize debounce and the caret. Nothing here reads the DOM, and
// nothing here kills a PTY because a view unmounted: process death is
// `disposeProcess` or `disposeAll`, both explicit.

import type { WebuiTerminalFrame } from "../../../../shared/contracts/terminal.js";
import {
  initialWebuiTerminalCatalogue,
  type WebuiTerminalCatalogue,
  type WebuiTerminalOwner,
  type WebuiTerminalRecord,
} from "../contracts/terminal-owner.js";
import type {
  TerminalPort,
  WebuiTerminalSize,
} from "../contracts/terminal-port.js";

export function createWebuiTerminalOwner(
  port: Partial<TerminalPort>,
): WebuiTerminalOwner {
  let snapshot: WebuiTerminalCatalogue = initialWebuiTerminalCatalogue;
  const listeners = new Set<() => void>();
  const watches = new Map<string, () => void>();

  const publish = (next: WebuiTerminalCatalogue): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const asRecord = (value: unknown): WebuiTerminalRecord | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const record = value as { terminalId?: unknown; status?: unknown; output?: unknown };
    if (typeof record.terminalId !== "string") return undefined;
    return {
      terminalId: record.terminalId,
      status: typeof record.status === "string" ? record.status : "running",
      ...(typeof record.output === "string" ? { output: record.output } : {}),
    };
  };

  const refresh = async (): Promise<void> => {
    const list = port.listTerminals;
    if (!list) return;
    publish({ ...snapshot, loading: true, error: undefined });
    try {
      const answer = await list();
      const terminals = (Array.isArray(answer) ? answer : [])
        .map(asRecord)
        .filter((entry): entry is WebuiTerminalRecord => entry !== undefined);
      publish({ terminals, loading: false });
    } catch (reason) {
      publish({
        ...snapshot,
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

  const create = async (workspaceDir: string): Promise<WebuiTerminalRecord | undefined> => {
    const createTerminal = port.createTerminal;
    if (!createTerminal) return undefined;
    const created = await createTerminal({ workspaceDir });
    await refresh();
    return { terminalId: created.terminalId, status: created.status };
  };

  const write = async (terminalId: string, data: string): Promise<void> => {
    await port.writeTerminal?.({ terminalId, data });
  };

  const resize = async (request: WebuiTerminalSize): Promise<void> => {
    await port.resizeTerminal?.(request);
  };

  const disposeProcess = async (terminalId: string): Promise<void> => {
    // The watch is released first: the frame stream belongs to the process, and a
    // disposer that outlives its terminal would keep the panel's buffer growing.
    watches.get(terminalId)?.();
    watches.delete(terminalId);
    await port.disposeTerminal?.({ terminalId });
    await refresh();
  };

  const attach = (
    terminalId: string,
    onFrame: (frame: WebuiTerminalFrame) => void,
  ): (() => void) => {
    const watch = port.watchTerminal;
    if (!watch) return () => undefined;
    watches.get(terminalId)?.();
    const release = watch({ terminalId }, onFrame);
    watches.set(terminalId, release);
    let released = false;
    return () => {
      // Cancellation finalizes the watch exactly once: a second call is a
      // no-op rather than a second release against a stream that is already
      // gone, and a superseded disposer never clears its successor's entry.
      if (released) return;
      released = true;
      if (watches.get(terminalId) === release) watches.delete(terminalId);
      release();
    };
  };

  const detachAll = (): void => {
    for (const release of watches.values()) release();
    watches.clear();
  };

  const disposeAll = async (): Promise<void> => {
    // End every watch AND every process, which is what the contract says this
    // is for: a view going away calls `detachAll` and leaves the PTYs running,
    // while disposal ends the client's processes too (T15 criterion 3).
    detachAll();
    const known = snapshot.terminals.map((terminal) => terminal.terminalId);
    for (const terminalId of known) await port.disposeTerminal?.({ terminalId });
    if (known.length > 0) await refresh();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    canCreate: port.createTerminal !== undefined,
    canWrite: port.writeTerminal !== undefined,
    canResize: port.resizeTerminal !== undefined,
    canDispose: port.disposeTerminal !== undefined,
    canWatch: port.watchTerminal !== undefined,
    refresh,
    create,
    write,
    resize,
    disposeProcess,
    attach,
    detachAll,
    disposeAll,
  };
}
