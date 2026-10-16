// The cached-read store, extracted from `settings-workflows.ts`.
//
// The store is the one implementation of the fence every caching owner reads
// through, so its two guarantees are asserted here directly rather than only
// through an owner that happens to use it:
//
//   * one key, one version — a superseded answer is dropped, never applied over
//     a newer one;
//   * a no-op update notifies nobody.

import { describe, expect, it } from "vitest";

import {
  createWebuiQueryStore,
  idleWebuiQueryState,
  webuiQueryMessage,
  type WebuiQueryState,
} from "../../src/client/application/query-store.js";

interface TestState {
  readonly revision: number;
  readonly answer: WebuiQueryState<string>;
}

const initial: TestState = {
  revision: 0,
  answer: idleWebuiQueryState(),
};

describe("the shared cached-read store", () => {
  it("starts on the initial snapshot and notifies on a change", () => {
    const store = createWebuiQueryStore(initial);
    expect(store.getSnapshot()).toBe(initial);

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.set((current) => ({ ...current, revision: current.revision + 1 }));
    expect(notifications).toBe(1);
    expect(store.getSnapshot().revision).toBe(1);

    unsubscribe();
    store.set((current) => ({ ...current, revision: current.revision + 1 }));
    expect(notifications).toBe(1);
  });

  it("a no-op update notifies nobody", () => {
    const store = createWebuiQueryStore(initial);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const same = store.getSnapshot();
    store.set((current) => current);
    expect(notifications).toBe(0);
    expect(store.getSnapshot()).toBe(same);
  });

  it("drops a superseded answer instead of applying it over a newer one", async () => {
    const store = createWebuiQueryStore(initial);
    let releaseFirst: (value: string) => void = () => {};
    const first = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });

    const slow = store.readInto("answer", "key", () => first);
    // The second read for the same key starts and finishes while the first is
    // still in flight, so the first answer is no longer current.
    await store.readInto("answer", "key", async () => "newer");
    expect(store.getSnapshot().answer).toEqual({ status: "ready", value: "newer" });

    releaseFirst("stale");
    await slow;
    expect(store.getSnapshot().answer).toEqual({ status: "ready", value: "newer" });
  });

  it("records a failure's message against the field it was reading", async () => {
    const store = createWebuiQueryStore(initial);
    await store.readInto("answer", "key", async () => {
      throw new Error("boom");
    });
    expect(store.getSnapshot().answer).toEqual({ status: "error", error: "boom" });
    expect(webuiQueryMessage("plain")).toBe("plain");
  });

  it("marks a read the runtime cannot answer at all", () => {
    // `unavailable` is the path a workflow takes when the port method is
    // missing: no fetch is attempted, and the error is the workflow's own copy.
    const store = createWebuiQueryStore(initial);
    store.unavailable("answer", "runtime does not support this");
    expect(store.getSnapshot().answer).toEqual({
      status: "error",
      error: "runtime does not support this",
    });
  });
});
