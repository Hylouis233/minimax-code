// The request/freshness primitive (T03; plan §4.5, §3 P3).
//
// The first case reproduces the old seam's defect on purpose: `query-store.ts`
// fences by an arbitrary key but writes one destination field, so a late answer
// for one key overwrites the answer for another. That reproduction is the
// "before" half of the ticket's requirement — the rest of the file is the
// corrected contract, driven through the same adversarial scheduling (two
// requests, resolved out of order, with an invalidation in between).
//
// Every case asserts an externally visible outcome: which entry holds what, which
// fetch ran, and whether a disposed owner accepted anything.

import { describe, expect, it, vi } from "vitest";

import {
  createWebuiKeyedResource,
  createWebuiSelectedSlot,
  serializeWebuiResourceKey,
} from "../../src/client/application/request-freshness.js";
import { createWebuiQueryStore } from "../../src/client/application/query-store.js";

/** A promise whose settlement the test decides. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("the seam the primitive replaces", () => {
  it("lets a late answer for one key overwrite the field another key wrote", async () => {
    // The reproduction, unchanged: one destination field, two keys, out-of-order
    // settlement. The field ends on the *earlier* request's answer.
    const store = createWebuiQueryStore<{ models?: { value?: string } }>({});
    const slowA = deferred<string>();
    const first = store.readInto("models", "key-A", () => slowA.promise);
    await store.readInto("models", "key-B", async () => "B");
    expect(store.getSnapshot().models?.value).toBe("B");
    slowA.resolve("A");
    await first;
    expect(store.getSnapshot().models?.value).toBe("A");
  });
});

describe("a keyed resource stores identity as identity", () => {
  it("keeps each key's answer in its own entry, so a late answer cannot overwrite another", async () => {
    const resource = createWebuiKeyedResource<string>();
    const slowA = deferred<string>();
    const first = resource.load({ session: "A" }, () => slowA.promise);
    await resource.load({ session: "B" }, async () => "B");

    expect(resource.read({ session: "B" })?.value).toBe("B");
    slowA.resolve("A");
    await first;

    // A's answer landed in A's entry; B's is untouched, which is the invariant
    // the old seam could not state.
    expect(resource.read({ session: "A" })?.value).toBe("A");
    expect(resource.read({ session: "B" })?.value).toBe("B");
    resource.dispose();
  });

  it("treats an explicit undefined and an absent field as different resources", () => {
    expect(serializeWebuiResourceKey({ session: undefined })).not.toBe(
      serializeWebuiResourceKey({}),
    );
    expect(serializeWebuiResourceKey({ a: 1, b: 2 })).toBe(
      serializeWebuiResourceKey({ b: 2, a: 1 }),
    );
    // "No session" and "a session whose id is empty" are different reads too.
    expect(serializeWebuiResourceKey({ session: "" })).not.toBe(
      serializeWebuiResourceKey({ session: undefined }),
    );
  });

  it("coalesces only reads whose key and freshness revision match", async () => {
    const resource = createWebuiKeyedResource<string>();
    const fetch = vi.fn(async () => "value");
    await Promise.all([
      resource.load({ session: "A" }, fetch),
      resource.load({ session: "A" }, fetch),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);

    // A different key is a different resource, so it gets its own request.
    await resource.load({ session: "B" }, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    resource.dispose();
  });

  it("does not join a read that started before an invalidation", async () => {
    const resource = createWebuiKeyedResource<string>();
    const slow = deferred<string>();
    const first = resource.load({ session: "A" }, () => slow.promise);
    resource.invalidate({ session: "A" });

    const secondFetch = vi.fn(async () => "fresh");
    const second = resource.load({ session: "A" }, secondFetch);
    expect(secondFetch).toHaveBeenCalledTimes(1);

    // The pre-invalidation answer cannot land, and it cannot mark the key fresh:
    // the entry is the newer read's, not the older request's.
    slow.resolve("stale");
    await Promise.all([first, second]);
    expect(resource.read({ session: "A" })?.value).toBe("fresh");
    expect(resource.revision({ session: "A" })).toBe(1);
    resource.dispose();
  });

  it("rejects an answer that was in flight when the key was invalidated", async () => {
    const resource = createWebuiKeyedResource<string>();
    const slow = deferred<string>();
    const pending = resource.load({ session: "A" }, () => slow.promise);
    expect(resource.read({ session: "A" })?.status).toBe("loading");
    resource.invalidate({ session: "A" });
    slow.resolve("stale");
    await pending;
    // Nothing committed: the answer belongs to a revision the owner retired.
    expect(resource.read({ session: "A" })?.status).toBe("loading");
  });

  it("accepts nothing after disposal", async () => {
    const resource = createWebuiKeyedResource<string>();
    const slow = deferred<string>();
    const pending = resource.load({ session: "A" }, () => slow.promise);
    resource.dispose();
    expect(resource.isDisposed()).toBe(true);

    slow.resolve("late");
    await pending;
    expect(resource.read({ session: "A" })).toBeUndefined();
    expect(resource.size()).toBe(0);

    // A read after disposal does not schedule: the fetch never runs.
    const fetch = vi.fn(async () => "value");
    await resource.load({ session: "A" }, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("a selected slot belongs to one identity at a time", () => {
  it("drops an answer for an identity that is no longer selected", async () => {
    const slot = createWebuiSelectedSlot<string>();
    slot.select("A");
    const slowA = deferred<string>();
    const pendingA = slot.load("A", () => slowA.promise);

    slot.select("B");
    const pendingB = slot.load("B", async () => "B");
    await pendingB;
    expect(slot.read()?.value).toBe("B");

    // A's answer arrives after the selection moved: it is dropped rather than
    // shown against B.
    slowA.resolve("A");
    await pendingA;
    expect(slot.read()?.value).toBe("B");
    slot.dispose();
  });

  it("rejects an answer captured before the same identity was re-selected", async () => {
    const slot = createWebuiSelectedSlot<string>();
    slot.select("A");
    const slow = deferred<string>();
    const pending = slot.load("A", () => slow.promise);
    // Away and back: the identity is the same, the generation is not.
    slot.select("B");
    slot.select("A");
    slow.resolve("captured-before");
    await pending;
    expect(slot.read()).toBeUndefined();
    slot.dispose();
  });

  it("clears its value when the selection moves", async () => {
    const slot = createWebuiSelectedSlot<string>();
    slot.select("A");
    await slot.load("A", async () => "A");
    expect(slot.read()?.value).toBe("A");
    slot.select("B");
    // The value belonged to the identity that left.
    expect(slot.read()).toBeUndefined();
    expect(slot.identity()).toBe("B");
    slot.dispose();
  });

  it("refuses a token minted by another owner incarnation", async () => {
    // A recreated owner gets a new incarnation. The token is what makes that
    // check observable: a capture from the previous owner is refused by the new
    // one even though its identity and generation still match.
    const first = createWebuiKeyedResource<string>();
    const captured = first.capture({ session: "A" });
    const second = createWebuiKeyedResource<string>();
    expect(second.commit(captured, { status: "ready", value: "from-the-old-owner" })).toBe(false);
    expect(second.read({ session: "A" })).toBeUndefined();
    // Its own token lands, so the refusal is the incarnation and not the commit
    // path being broken.
    expect(second.commit(second.capture({ session: "A" }), { status: "ready", value: "mine" })).toBe(true);
    expect(second.read({ session: "A" })?.value).toBe("mine");
    first.dispose();
    second.dispose();
  });

  it("refuses a token whose freshness revision was superseded", () => {
    const resource = createWebuiKeyedResource<string>();
    const captured = resource.capture({ session: "A" });
    resource.invalidate({ session: "A" });
    expect(resource.commit(captured, { status: "ready", value: "stale" })).toBe(false);
    expect(resource.read({ session: "A" })).toBeUndefined();
    resource.dispose();
  });

  it("accepts nothing after disposal", async () => {
    const slot = createWebuiSelectedSlot<string>();
    slot.select("A");
    const slow = deferred<string>();
    const pending = slot.load("A", () => slow.promise);
    slot.dispose();
    slow.resolve("late");
    await pending;
    expect(slot.read()).toBeUndefined();
    const fetch = vi.fn(async () => "value");
    await slot.load("A", fetch);
    expect(fetch).not.toHaveBeenCalled();
  });
});
