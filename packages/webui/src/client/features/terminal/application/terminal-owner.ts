// The browser Terminal owner.
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
// nothing here kills a PTY because a view unmounted: the process is
// `disposeProcess` or the service's own shutdown, and `dispose` only ends this
// page's observation.

import type { WebuiTerminalFrame } from "../../../../shared/contracts/terminal.js";
import {
  initialWebuiTerminalCatalogue,
  type WebuiTerminalCatalogue,
  type WebuiTerminalOwner,
  type WebuiTerminalRecord,
  type WebuiTerminalSupport,
  type WebuiTerminalSupportReport,
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

  /**
   * Reachability per operation. Seeded from what the port offers — a method that
   * is not there is `absent`, full stop — and then *observed*: a call this host
   * refuses moves its operation to `incompatible`. That is the distinction the
   * contract asks for, and it can only be drawn by calling: a port that declares
   * `createTerminal` and then refuses it is not the same as a port without one.
   */
  const support: Record<keyof WebuiTerminalSupportReport, WebuiTerminalSupport> = {
    create: port.createTerminal === undefined ? "absent" : "supported",
    list: port.listTerminals === undefined ? "absent" : "supported",
    write: port.writeTerminal === undefined ? "absent" : "supported",
    resize: port.resizeTerminal === undefined ? "absent" : "supported",
    dispose: port.disposeTerminal === undefined ? "absent" : "supported",
    watch: port.watchTerminal === undefined ? "absent" : "supported",
  };
  const markIncompatible = (operation: keyof WebuiTerminalSupportReport): void => {
    support[operation] = "incompatible";
  };

  let disposed = false;

  const publish = (next: WebuiTerminalCatalogue): void => {
    // A fenced owner has no page to tell: a create or a roster read that lands
    // after teardown must not repopulate a catalogue nothing renders, and must
    // not notify a listener the page already dropped.
    if (disposed) return;
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
    if (disposed) return;
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
      // The host offers the roster and refused to produce one: that is a version
      // mismatch, not an empty terminal list. Reporting it as "no terminals"
      // would tell the user their sessions' shells had all exited.
      markIncompatible("list");
      publish({
        ...snapshot,
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

  const create = async (workspaceDir: string): Promise<WebuiTerminalRecord | undefined> => {
    if (disposed) return undefined;
    const createTerminal = port.createTerminal;
    if (!createTerminal) return undefined;
    const created = await createTerminal({ workspaceDir }).catch((reason: unknown) => {
      markIncompatible("create");
      throw reason;
    });
    await refresh();
    return { terminalId: created.terminalId, status: created.status };
  };

  const write = async (terminalId: string, data: string): Promise<void> => {
    if (disposed) return;
    if (!port.writeTerminal) return;
    await port.writeTerminal({ terminalId, data }).catch((reason: unknown) => {
      markIncompatible("write");
      throw reason;
    });
  };

  const resize = async (request: WebuiTerminalSize): Promise<void> => {
    if (disposed) return;
    if (!port.resizeTerminal) return;
    await port.resizeTerminal(request).catch((reason: unknown) => {
      markIncompatible("resize");
      throw reason;
    });
  };

  const disposeProcess = async (terminalId: string): Promise<void> => {
    if (disposed) return;
    // The watch is released first: the frame stream belongs to the process, and a
    // disposer that outlives its terminal would keep the panel's buffer growing.
    watches.get(terminalId)?.();
    watches.delete(terminalId);
    if (!port.disposeTerminal) return;
    await port.disposeTerminal({ terminalId }).catch((reason: unknown) => {
      markIncompatible("dispose");
      throw reason;
    });
    await refresh();
  };

  const attach = (
    terminalId: string,
    onFrame: (frame: WebuiTerminalFrame) => void,
  ): (() => void) => {
    if (disposed) return () => undefined;
    const watch = port.watchTerminal;
    if (!watch) return () => undefined;
    watches.get(terminalId)?.();
    let release: () => void;
    try {
      release = watch({ terminalId }, onFrame);
    } catch (reason) {
      // The host offers the frame stream and refused to open it. That is a
      // version mismatch, and it must not leave the previous watch's disposer in
      // the map: the old one was already released above.
      markIncompatible("watch");
      throw reason;
    }
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

  /**
   * Fence the page: stop observing, stop publishing, never touch a process.
   *
   * This is the whole process-ownership policy in one function. The service owns
   * the PTYs, so a page that goes away releases what it *observed* — its watches
   * — and nothing else. A terminal this page only listed can be in use by another
   * page, or outlive the page entirely because a create response was lost.
   */
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    detachAll();
    listeners.clear();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // The `can*` flags answer "may I"; `support` answers why not. A host that
    // does not provide the operation is `absent`; a host that provides one and
    // refuses it is `incompatible`, and only a call could have told them apart.
    get canCreate() {
      return support.create === "supported";
    },
    get canWrite() {
      return support.write === "supported";
    },
    get canResize() {
      return support.resize === "supported";
    },
    get canDispose() {
      return support.dispose === "supported";
    },
    get canWatch() {
      return support.watch === "supported";
    },
    support: () => ({ ...support }),
    refresh,
    create,
    write,
    resize,
    disposeProcess,
    attach,
    detachAll,
    dispose,
  };
}
