// The browser terminal owner's watch registry: what a view release does, what a
// process disposal does, and what must never happen (a PTY killed because a view
// went away). T15's criteria 2, 3 and 4 turn on exactly these distinctions, and
// they are claims about calls — so the cases assert the port's call trace.
//
// The defect this pins: `disposeAll` is documented as ending every watch AND
// every process, while the application's disposal is the only caller it has. It
// used to call `detachAll` and nothing else, so a client that went away left its
// PTYs running.

import { describe, expect, it } from "vitest";

import { createWebuiTerminalOwner } from "../../src/client/features/terminal/application/terminal-owner.js";
import type { WebuiTerminalFrame } from "../../src/shared/contracts/terminal.js";

interface Trace {
  readonly calls: string[];
  readonly releases: number[];
}

function port(trace: Trace, terminals: string[] = ["terminal-a", "terminal-b"]) {
  let watches = 0;
  return {
    listTerminals: async () =>
      terminals.map((terminalId) => ({ terminalId, status: "running" as const, output: "" })),
    createTerminal: async ({ workspaceDir }: { readonly workspaceDir: string }) => {
      trace.calls.push(`create:${workspaceDir}`);
      return { terminalId: "terminal-new", status: "running" as const };
    },
    writeTerminal: async ({ terminalId, data }: { readonly terminalId: string; readonly data: string }) => {
      trace.calls.push(`write:${terminalId}:${data}`);
    },
    resizeTerminal: async ({ terminalId, cols, rows }: { readonly terminalId: string; readonly cols: number; readonly rows: number }) => {
      trace.calls.push(`resize:${terminalId}:${cols}x${rows}`);
    },
    disposeTerminal: async ({ terminalId }: { readonly terminalId: string }) => {
      trace.calls.push(`dispose:${terminalId}`);
    },
    watchTerminal: (_request: { readonly terminalId: string }, _onFrame: (frame: WebuiTerminalFrame) => void) => {
      const index = (watches += 1);
      trace.calls.push(`watch:${index}`);
      return () => {
        trace.calls.push(`release:${index}`);
        trace.releases.push(index);
      };
    },
  };
}

const newTrace = (): Trace => ({ calls: [], releases: [] });

describe("the terminal owner's watch registry", () => {
  it("returns a real disposer that releases its watch exactly once", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    const release = owner.attach("terminal-a", () => undefined);
    expect(trace.calls).toEqual(["watch:1"]);
    release();
    release();
    expect(trace.calls).toEqual(["watch:1", "release:1"]);
  });

  it("supersedes the previous watch when the same terminal is attached again", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    owner.attach("terminal-a", () => undefined);
    owner.attach("terminal-a", () => undefined);
    expect(trace.calls).toEqual(["watch:1", "release:1", "watch:2"]);
  });

  it("detaches every watch without touching a single process", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    owner.attach("terminal-a", () => undefined);
    owner.attach("terminal-b", () => undefined);
    owner.detachAll();
    expect(trace.releases).toEqual([1, 2]);
    expect(trace.calls.filter((entry) => entry.startsWith("dispose:"))).toEqual([]);
  });

  it("ends the watches and the processes it knows about on disposal", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    await owner.refresh();
    owner.attach("terminal-a", () => undefined);
    await owner.disposeAll();
    expect(trace.releases).toEqual([1]);
    expect(trace.calls.filter((entry) => entry.startsWith("dispose:")).sort()).toEqual([
      "dispose:terminal-a",
      "dispose:terminal-b",
    ]);
  });

  it("releases a terminal's watch before asking the port to dispose it", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    owner.attach("terminal-a", () => undefined);
    await owner.disposeProcess("terminal-a");
    expect(trace.calls.indexOf("release:1")).toBeLessThan(trace.calls.indexOf("dispose:terminal-a"));
  });

  it("publishes what the port can do and what the catalogue holds", async () => {
    const trace = newTrace();
    const owner = createWebuiTerminalOwner(port(trace));
    expect(owner.canWatch).toBe(true);
    expect(owner.canCreate).toBe(true);
    expect(owner.getSnapshot().terminals).toEqual([]);
    await owner.refresh();
    expect(owner.getSnapshot().terminals.map((entry) => entry.terminalId)).toEqual([
      "terminal-a",
      "terminal-b",
    ]);
    await owner.create("/tmp/workspace");
    expect(trace.calls[0]).toBe("create:/tmp/workspace");
  });

  it("keeps a port that offers nothing safe to hold", async () => {
    const owner = createWebuiTerminalOwner({});
    expect(owner.canCreate).toBe(false);
    expect(owner.canWatch).toBe(false);
    expect(owner.attach("terminal-a", () => undefined)).toBeTypeOf("function");
    await expect(owner.disposeAll()).resolves.toBeUndefined();
  });
});
