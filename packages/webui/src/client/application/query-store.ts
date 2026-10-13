// The cached-read store (plan §16.3: a shared invariant holds when exactly one
// implementation exists; §7.1 files the query machinery here).
//
// Every application owner that caches answers from the transport reads through
// this one object: the owner's snapshot, its listener set, and the version
// guard that drops a superseded answer instead of applying it over a newer one.
// Two owners each holding their own copy of that guard would be two
// implementations of one rule, which §16.3 forbids; two owners *importing* it is
// the permitted shape, and it is why the `models` carve extracts this module
// before it moves any command out of `settings-workflows.ts`.
//
// Framework-free: no React, no DOM, no storage.

/** One cached read: a status, its answer, and the error when it failed. */
export interface WebuiQueryState<T> {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly value?: T;
  readonly error?: string;
}

/** The state of a read nobody has asked for yet. */
export function idleWebuiQueryState<T>(): WebuiQueryState<T> {
  return { status: "idle" };
}

/** A failure's message, for the error field of a cached read. */
export function webuiQueryMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export interface WebuiQueryStore<State extends object> {
  readonly getSnapshot: () => State;
  readonly subscribe: (listener: () => void) => () => void;
  /** Replace the snapshot; a no-op update notifies nobody. */
  readonly set: (update: (current: State) => State) => void;
  /** Store one query result under one field, keeping the state type honest. */
  readonly withQuery: <Field extends keyof State, T>(
    current: State,
    field: Field,
    value: WebuiQueryState<T>,
  ) => State;
  /**
   * A generic cached read: one key, one version guard, one error field. A
   * superseded answer is dropped rather than applied over a newer one.
   */
  readonly readInto: <Field extends keyof State, T>(
    field: Field,
    key: string,
    fetch: () => Promise<T>,
  ) => Promise<void>;
  /** Record that the runtime cannot answer this read at all. */
  readonly unavailable: <Field extends keyof State>(field: Field, error: string) => void;
}

export function createWebuiQueryStore<State extends object>(
  initial: State,
): WebuiQueryStore<State> {
  let state = initial;
  const listeners = new Set<() => void>();
  const versions = new Map<string, number>();

  const bump = (key: string): number => {
    const next = (versions.get(key) ?? 0) + 1;
    versions.set(key, next);
    return next;
  };
  const isCurrent = (key: string, version: number): boolean =>
    (versions.get(key) ?? 0) === version;

  const set = (update: (current: State) => State): void => {
    const next = update(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const withQuery = <Field extends keyof State, T>(
    current: State,
    field: Field,
    value: WebuiQueryState<T>,
  ): State => ({ ...current, [field]: value }) as State;

  const readInto = async <Field extends keyof State, T>(
    field: Field,
    key: string,
    fetch: () => Promise<T>,
  ): Promise<void> => {
    const version = bump(key);
    set((current) => withQuery(current, field, { status: "loading" }));
    try {
      const value = await fetch();
      if (!isCurrent(key, version)) return;
      set((current) => withQuery(current, field, { status: "ready", value }));
    } catch (reason) {
      if (!isCurrent(key, version)) return;
      set((current) => withQuery(current, field, { status: "error", error: webuiQueryMessage(reason) }));
    }
  };

  const unavailable = <Field extends keyof State>(field: Field, error: string): void => {
    set((current) => withQuery(current, field, { status: "error", error }));
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    withQuery,
    readInto,
    unavailable,
  };
}
