// The request/freshness primitive (plan §4.5; T03's `request-freshness-primitive`).
//
// One cached read has to answer three questions that a state container plus a
// request counter cannot: *which resource* the answer belongs to, whether the
// answer is still the one that should be visible, and whether an in-flight
// request is still allowed to land. The old `query-store.ts` fenced by an
// arbitrary string key but wrote into an independent destination field, so two
// keys could write one field and both stay "current" — the executed probe in the
// T01 ledger returns B and then a late A overwrites it. This module is the
// repair, expressed as two explicit contracts rather than one loose helper:
//
//   * **Keyed resource** — answers live under a resource key. The key carries
//     every response-affecting input (session/agent context, an opaque
//     credential/config generation, a snapshot or changeset identity), so a late
//     answer populates *its own* entry and cannot overwrite another entry or the
//     view selection. Identity and storage are the same thing here, which is the
//     invariant the probe showed was missing.
//   * **Selected slot** — one destination with an owning identity and a selection
//     generation. Switching identity invalidates the commit token even when the
//     resource itself is still current, which is what the active-only queue
//     mirror and the single catalogue selection need.
//
// Three rules hold for both:
//
//   * a commit requires the owner incarnation and the request generation to be
//     current, and (for a slot) the selected identity to still be selected;
//   * `invalidate` advances freshness *before* a new read is scheduled, so a
//     pre-invalidation answer cannot mark invalidated data fresh, and a read
//     started before an invalidation is never joined as if it repaired the newer
//     revision;
//   * coalescing happens only when the resource key, the freshness revision and
//     the owner incarnation all match.
//
// Disposal fences everything: no commit, no scheduling, no coalescing. The
// primitive owns mechanics only — which key a business uses, and what a write
// invalidates, stay with the business.

/** A response-affecting input of a resource key. */
export type WebuiResourceKeyValue = string | number | boolean | null | undefined;

/** A resource key: the response-affecting inputs of one read. */
export type WebuiResourceKey = Readonly<Record<string, WebuiResourceKeyValue>>;

/** The state of one cached read, keyed or selected. */
export interface WebuiResourceState<T> {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly value?: T;
  readonly error?: string;
}

/**
 * Serializes a key so equal keys compare equal: entries are sorted, and an
 * explicit `undefined` is written rather than dropped, so `{a: undefined}` and
 * `{}` are different resources. That matters because "no session" and "a session
 * whose id is absent" are not the same read.
 */
export function serializeWebuiResourceKey(key: WebuiResourceKey): string {
  return Object.keys(key)
    .sort()
    .map((name) => `${name}=${key[name] === undefined ? "\u0000" : String(key[name])}`)
    .join("\u0001");
}

/**
 * A commit token: everything a commit is checked against. It is minted by
 * `capture` and consumed by `commit`, which is what makes the owner-incarnation
 * fence observable rather than internal — a token captured by one owner and
 * handed to another (a recreated owner, a different primitive instance) is
 * rejected instead of landing.
 */
export interface WebuiCommitToken {
  readonly resource: string;
  readonly revision: number;
  readonly incarnation: number;
}

export interface WebuiKeyedResource<T> {
  /** The entry for one key, or `undefined` when nothing has been read for it. */
  readonly read: (key: WebuiResourceKey) => WebuiResourceState<T> | undefined;
  /** Mints the token a commit for this key must carry. */
  readonly capture: (key: WebuiResourceKey) => WebuiCommitToken;
  /**
   * Commits one state under a captured token. Returns whether it landed: a
   * token from another owner, a superseded revision or a disposed resource is
   * refused rather than written.
   */
  readonly commit: (token: WebuiCommitToken, state: WebuiResourceState<T>) => boolean;
  /**
   * Reads the resource under its key. A call whose key, freshness revision and
   * owner incarnation all match an in-flight request joins that request instead
   * of starting a second one; any difference starts a new one.
   */
  readonly load: (key: WebuiResourceKey, fetch: () => Promise<T>) => Promise<void>;
  /**
   * Advances the key's freshness. An answer already in flight for the previous
   * revision can no longer commit, and a later read cannot join it.
   */
  readonly invalidate: (key: WebuiResourceKey) => void;
  /** The freshness revision a key currently holds; exposed for tests and owners. */
  readonly revision: (key: WebuiResourceKey) => number;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  /** True once disposed: nothing else is accepted. */
  readonly isDisposed: () => boolean;
  /** How many resource keys hold an entry; a cardinality check, not a cache policy. */
  readonly size: () => number;
}

/**
 * A commit token for a selected slot: the identity that was selected, the
 * selection generation and the owner incarnation. `commit` refuses it when any
 * of the three moved.
 */
export interface WebuiSlotCommitToken {
  readonly identity: string;
  readonly generation: number;
  readonly incarnation: number;
}

export interface WebuiSelectedSlot<T> {
  readonly read: () => WebuiResourceState<T> | undefined;
  /** The identity the slot currently belongs to. */
  readonly identity: () => string | undefined;
  /** Mints the token a commit for this identity must carry. */
  readonly capture: () => WebuiSlotCommitToken;
  /** Commits one state under a captured token; returns whether it landed. */
  readonly commit: (token: WebuiSlotCommitToken, state: WebuiResourceState<T>) => boolean;
  /**
   * Points the slot at an identity and advances its selection generation. A
   * commit captured for the previous identity — or for an earlier selection of
   * the same identity — is rejected afterwards.
   */
  readonly select: (identity: string | undefined) => void;
  /**
   * Reads for the selected identity and commits only if that identity is still
   * selected with the same generation. An answer for an identity that is no
   * longer selected is dropped rather than shown.
   */
  readonly load: (identity: string, fetch: () => Promise<T>) => Promise<void>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly isDisposed: () => boolean;
}

/**
 * The incarnation counter, one per created primitive. A recreated owner gets a
 * new one, so a commit captured by the previous incarnation is rejected even
 * when its key and generation happen to match — the property that makes a
 * remount safe rather than merely unlikely to collide.
 */
let incarnationCounter = 0;

export function createWebuiKeyedResource<T>(): WebuiKeyedResource<T> {
  incarnationCounter += 1;
  const incarnation = incarnationCounter;
  const entries = new Map<string, WebuiResourceState<T>>();
  const revisions = new Map<string, number>();
  const inFlight = new Map<
    string,
    { readonly revision: number; readonly promise: Promise<void> }
  >();
  const listeners = new Set<() => void>();
  let disposed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const revisionOf = (serialized: string): number => revisions.get(serialized) ?? 0;

  const commitToken = (token: WebuiCommitToken, state: WebuiResourceState<T>): boolean => {
    if (disposed) return false;
    // Three fences, and the incarnation is the one that survives a recreated
    // owner: a token minted by another instance can never match this one.
    if (token.incarnation !== incarnation) return false;
    // The revision is the freshness fence: an answer captured before an
    // invalidation cannot commit, whatever else still matches.
    if (revisionOf(token.resource) !== token.revision) return false;
    entries.set(token.resource, state);
    notify();
    return true;
  };

  const load = (key: WebuiResourceKey, fetch: () => Promise<T>): Promise<void> => {
    if (disposed) return Promise.resolve();
    const serialized = serializeWebuiResourceKey(key);
    const revision = revisionOf(serialized);
    const joined = inFlight.get(serialized);
    // Coalescing is only sound when nothing that affects the answer changed.
    if (joined && joined.revision === revision) return joined.promise;
    const token: WebuiCommitToken = { resource: serialized, revision, incarnation };
    commitToken(token, { status: "loading" });
    const promise = fetch()
      .then((value) => {
        commitToken(token, { status: "ready", value });
      })
      .catch((reason: unknown) => {
        commitToken(token, {
          status: "error",
          error: reason instanceof Error ? reason.message : String(reason),
        });
      })
      .finally(() => {
        if (inFlight.get(serialized)?.promise === promise) inFlight.delete(serialized);
      });
    inFlight.set(serialized, { revision, promise });
    return promise;
  };

  return {
    read: (key) => entries.get(serializeWebuiResourceKey(key)),
    capture: (key) => {
      const resource = serializeWebuiResourceKey(key);
      return { resource, revision: revisionOf(resource), incarnation };
    },
    commit: commitToken,
    load,
    invalidate: (key) => {
      if (disposed) return;
      const serialized = serializeWebuiResourceKey(key);
      // Freshness advances first, so the request that was already running can no
      // longer land and a new read cannot join it.
      revisions.set(serialized, revisionOf(serialized) + 1);
      inFlight.delete(serialized);
      notify();
    },
    revision: (key) => revisionOf(serializeWebuiResourceKey(key)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      entries.clear();
      inFlight.clear();
      listeners.clear();
    },
    isDisposed: () => disposed,
    size: () => entries.size,
  };
}

export function createWebuiSelectedSlot<T>(): WebuiSelectedSlot<T> {
  incarnationCounter += 1;
  const incarnation = incarnationCounter;
  const state: { entry?: WebuiResourceState<T> } = {};
  const listeners = new Set<() => void>();
  let selected: string | undefined;
  let generation = 0;
  let disposed = false;

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const commitToken = (
    token: WebuiSlotCommitToken,
    entry: WebuiResourceState<T>,
  ): boolean => {
    if (disposed) return false;
    // Three checks, because any one of them alone lets a stale answer through:
    // the identity must still be selected, the selection must not have moved on,
    // and the owner must be the one that asked.
    if (selected !== token.identity) return false;
    if (token.generation !== generation) return false;
    if (token.incarnation !== incarnation) return false;
    state.entry = entry;
    notify();
    return true;
  };

  return {
    read: () => state.entry,
    identity: () => selected,
    capture: () => ({
      identity: selected ?? "",
      generation,
      incarnation,
    }),
    commit: commitToken,
    select: (identity) => {
      if (disposed) return;
      if (selected === identity) return;
      selected = identity;
      generation += 1;
      // The slot's own value belongs to the identity that left it.
      state.entry = undefined;
      notify();
    },
    load: (identity, fetch) => {
      if (disposed) return Promise.resolve();
      const token: WebuiSlotCommitToken = { identity, generation, incarnation };
      commitToken(token, { status: "loading" });
      return fetch()
        .then((value) => {
          commitToken(token, { status: "ready", value });
        })
        .catch((reason: unknown) => {
          commitToken(token, {
            status: "error",
            error: reason instanceof Error ? reason.message : String(reason),
          });
        });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      state.entry = undefined;
      listeners.clear();
    },
    isDisposed: () => disposed,
  };
}
