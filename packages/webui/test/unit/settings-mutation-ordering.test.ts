// Settings' mutation ordering.
//
// The owner's read primitive already reports what its own request produced; these
// cases are about the *write* half of the same contract, which the plan states as
// three separate obligations:
//
//   * a write retires the reads that started before it, so an older answer cannot
//     land on top of a newer write;
//   * two writes to one resource serialize, while different resources stay
//     independent;
//   * a known rejection leaves the last committed value alone, and an unknown
//     outcome is reconciled by re-reading rather than retried blindly.

import { describe, expect, it, vi } from "vitest";

import { createWebuiSettingsWorkflows } from "../../src/client/features/settings/application/settings-workflows.js";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};

function workflowsWith(port: Record<string, unknown>) {
  return createWebuiSettingsWorkflows({ port: port as never });
}

describe("V09 · a write retires the reads that started before it", () => {
  it("reports an in-flight read as superseded and never lands it", async () => {
    const read = deferred<{ content: string }>();
    const port = {
      getGlobalInstructions: () => read.promise,
      setGlobalInstructions: async ({ content }: { content: string }) => ({ content }),
    };
    const workflows = workflowsWith(port);

    const pending = workflows.loadInstructions();
    // The write lands first.
    await workflows.saveInstructions("written");
    read.resolve({ content: "read-before-the-write" });
    const outcome = await pending;

    // The read's own outcome says what happened to it, rather than the caller
    // re-reading the snapshot and guessing.
    expect(outcome.status).toBe("superseded");
    expect(workflows.getSnapshot().instructions.value?.content).toBe("written");
  });

  it("keeps a rejected write from replacing the committed value", async () => {
    const port = {
      getGlobalInstructions: async () => ({ content: "committed" }),
      setGlobalInstructions: async () => {
        throw new Error("runtime refused");
      },
    };
    const workflows = workflowsWith(port);
    await workflows.loadInstructions();

    await expect(workflows.saveInstructions("would-be")).rejects.toThrow("runtime refused");
    // The write did not happen, so the committed value is still what a surface
    // shows: an intent on screen is not an accepted change.
    expect(workflows.getSnapshot().instructions.value?.content).toBe("committed");
  });

  it("reconciles an unknown outcome by re-reading instead of retrying", async () => {
    const read = vi.fn(async () => ({ content: "server-truth" }));
    const set = vi.fn(async () => {
      const error = new Error("WebUI connection closed before the response");
      error.name = "AbortError";
      throw error;
    });
    const workflows = workflowsWith({
      getGlobalInstructions: read,
      setGlobalInstructions: set,
    });
    await workflows.loadInstructions();
    read.mockClear();

    await expect(workflows.saveInstructions("maybe-landed")).rejects.toThrow();
    // A lost response means the write may have taken effect, so the honest next
    // step is to find out — one re-read, and no second mutation.
    expect(read).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe("V10 · same-resource writes serialize, different resources do not", () => {
  it("runs two writes to one resource in submission order", async () => {
    const order: string[] = [];
    const first = deferred<{ content: string }>();
    const port = {
      getGlobalInstructions: async () => ({ content: "start" }),
      setGlobalInstructions: async ({ content }: { content: string }) => {
        order.push(`start:${content}`);
        if (content === "one") return first.promise;
        order.push(`end:${content}`);
        return { content };
      },
    };
    const workflows = workflowsWith(port);
    // The snapshot field is published by the subscription a read installs, so the
    // first read is part of the fixture rather than an accident of ordering.
    await workflows.loadInstructions();

    const one = workflows.saveInstructions("one");
    const two = workflows.saveInstructions("two");
    await Promise.resolve();
    await Promise.resolve();
    // The second write has not started while the first is in flight.
    expect(order).toEqual(["start:one"]);

    first.resolve({ content: "one" });
    await one;
    await two;
    expect(order).toEqual(["start:one", "start:two", "end:two"]);
    expect(workflows.getSnapshot().instructions.value?.content).toBe("two");
  });

  it("lets a write to another resource proceed concurrently", async () => {
    const order: string[] = [];
    const instructions = deferred<{ content: string }>();
    const port = {
      getGlobalInstructions: async () => ({ content: "" }),
      setGlobalInstructions: async () => {
        order.push("instructions");
        return instructions.promise;
      },
      getMemorySettings: async () => ({ enabled: true }),
      setMemorySettings: async () => {
        order.push("memorySettings");
        return { enabled: false };
      },
    };
    const workflows = workflowsWith(port);
    await workflows.loadInstructions();
    await workflows.loadMemorySettings();

    const a = workflows.saveInstructions("x");
    const b = workflows.saveMemorySettings({ enabled: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Both writes are in flight: the second did not wait behind the first.
    expect(order).toEqual(["instructions", "memorySettings"]);
    instructions.resolve({ content: "x" });
    await a;
    await b;
    expect(workflows.getSnapshot().memorySettings.value?.enabled).toBe(false);
  });
});
