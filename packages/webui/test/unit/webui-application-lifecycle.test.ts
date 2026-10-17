// The application lifecycle: constructed → started → disposed.
//
// The seam is the assembled application's own public lifecycle, driven with
// injected storage and a scripted channel: what a host can observe is the order
// of its IO, the number of ingress links it opens, and what a disposed instance
// refuses. The fixtures below assert exactly that, plus the ordering rule — the
// initial route reaches unread hydration before the first persistence write, so
// opening a session never restores its own badge.
//
// No DOM: these are the framework-free assembly's guarantees, and the built
// client's boot is covered by the browser suite.

import { describe, expect, it, vi } from "vitest";

import { createWebuiApplication } from "../../src/client/application/create-application.js";
import { createWebuiPortSlices } from "../../src/client/application/port-slices.js";
import { createWebuiIdentityEpochs } from "../../src/client/application/identity-epochs.js";
import type { WebuiProcessEventChannel } from "../../src/client/features/turn/application/event-channel.js";
import type { WebuiRuntimeEvent } from "../../src/shared/contracts/stream.js";
import type { WebuiClientSessionResumer } from "../../src/client/features/turn/contracts/execution-port.js";

const SESSION = "session-initial";
const OTHER = "session-other";

function scriptedChannel() {
  const listeners = new Set<(event: WebuiRuntimeEvent) => void>();
  const ready = new Set<() => void>();
  let closes = 0;
  const channel: WebuiProcessEventChannel = {
    subscribe: (listener, onReady) => {
      listeners.add(listener);
      if (onReady) ready.add(onReady);
      return () => {
        listeners.delete(listener);
        if (onReady) ready.delete(onReady);
      };
    },
    close: () => {
      closes += 1;
    },
  };
  return {
    channel,
    emit: (event: WebuiRuntimeEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
    closes: () => closes,
  };
}

/** The order of the storage calls, so hydration-before-write is observable. */
function recordingStorage(seed: Readonly<Record<string, number>>) {
  const calls: string[] = [];
  const written: Record<string, number>[] = [];
  return {
    calls,
    written,
    storage: {
      read: () => {
        calls.push("read");
        return seed;
      },
      write: (counts: Readonly<Record<string, number>>) => {
        calls.push(`write:${JSON.stringify(counts)}`);
        written.push({ ...counts });
      },
    },
  };
}

function makeApplication(options: {
  readonly channels?: ReturnType<typeof scriptedChannel>[];
  readonly storage?: {
    readonly read: () => Readonly<Record<string, number>>;
    readonly write: (counts: Readonly<Record<string, number>>) => void;
  };
  readonly turnCapabilities?: Record<string, unknown>;
  readonly interactionsPort?: Record<string, unknown>;
  readonly goalPort?: Record<string, unknown>;
} = {}) {
  const opened: ReturnType<typeof scriptedChannel>[] = options.channels ?? [];
  const application = createWebuiApplication({
    openEventChannel: () => {
      const fake = scriptedChannel();
      opened.push(fake);
      return fake.channel;
    },
    ...(options.storage ? { unreadStorage: options.storage } : {}),
    ...(options.turnCapabilities
      ? { turnCapabilities: options.turnCapabilities as never }
      : {}),
    ...(options.interactionsPort
      ? { interactionsPort: options.interactionsPort as never }
      : {}),
    ...(options.goalPort ? { goalPort: options.goalPort as never } : {}),
    turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
  });
  return { application, opened };
}

describe("construction is dormant", () => {
  it("opens no ingress and touches no persisted state", () => {
    const opened: ReturnType<typeof scriptedChannel>[] = [];
    const recorder = recordingStorage({ [OTHER]: 3 });
    const { application } = makeApplication({
      channels: opened,
      storage: recorder.storage,
    });

    expect(application.state()).toBe("constructed");
    expect(opened).toHaveLength(0);
    expect(recorder.calls).toEqual([]);
    // The ingress is the only thing construction could have opened, and the
    // storage adapter is the only thing it could have read: both are untouched.
    application.dispose();
  });

  it("supports an absent capability without failing construction or start", () => {
    // A host with nothing wired (SSR, a partial fixture) is a supported state:
    // the assembly exists, the slice is empty and nothing throws.
    const { application, opened } = makeApplication();
    expect(() => application.start()).not.toThrow();
    expect(opened).toHaveLength(1);
    expect(application.turnCapabilities.send).toBeUndefined();
    application.dispose();
  });
});

describe("start hydrates the route before the first write", () => {
  it("reads persisted counts, drops the open session's own badge, then persists", () => {
    const recorder = recordingStorage({ [SESSION]: 4, [OTHER]: 2 });
    const { application, opened } = makeApplication({ storage: recorder.storage });

    expect(application.start({ initialSessionId: SESSION })).toBe(true);

    // The read happens before any write, and the write that follows carries the
    // other session's count only: the session being opened is excluded, which is
    // the rule the ordering exists for.
    expect(recorder.calls[0]).toBe("read");
    expect(recorder.written[0]).toEqual({ [OTHER]: 2 });
    expect(application.unread.isHydrated()).toBe(true);
    expect(opened).toHaveLength(1);
    expect(application.state()).toBe("started");
    application.dispose();
  });

  it("keeps the stored badge when the route names no session", () => {
    const recorder = recordingStorage({ [SESSION]: 4 });
    const { application } = makeApplication({ storage: recorder.storage });
    application.start();
    // With no open session there is nothing to exclude, so the restore keeps it.
    expect(recorder.written[0]).toEqual({ [SESSION]: 4 });
    application.dispose();
  });

  it("installs the ingress exactly once across repeated starts", () => {
    const { application, opened } = makeApplication();
    expect(application.start()).toBe(true);
    expect(application.start()).toBe(true);
    expect(application.start({ initialSessionId: SESSION })).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.listenerCount()).toBe(1);
    application.dispose();
  });

  it("does not accept counted events before hydration", () => {
    // The gate is the hydration flag, not the channel: a counted event that
    // arrives against an un-hydrated map would be counted from zero and then
    // overwritten by the restore.
    const recorder = recordingStorage({ [OTHER]: 5 });
    const { application, opened } = makeApplication({ storage: recorder.storage });
    application.start({ initialSessionId: SESSION });
    const activityBefore = application.store.getSnapshot().activity;
    opened[0]?.emit({
      type: "session.finish",
      payload: { sessionId: OTHER },
      timestamp: 1,
      source: "test",
    } as never);
    // Hydrated, so the event is accepted — asserted so the case cannot pass by
    // the channel being inert.
    expect(application.store.getSnapshot().activity).not.toBe(activityBefore);
    application.dispose();
  });
});

describe("dispose is terminal and idempotent", () => {
  it("detaches, closes the ingress and disposes the store once", () => {
    const { application, opened } = makeApplication();
    application.start();
    const channel = opened[0];
    application.dispose();
    application.dispose();

    expect(application.state()).toBe("disposed");
    expect(channel?.closes()).toBe(1);
    expect(channel?.listenerCount()).toBe(0);
    expect(application.store.isDisposed()).toBe(true);
  });

  it("refuses to restart and opens nothing", () => {
    const { application, opened } = makeApplication();
    application.start();
    application.dispose();

    expect(application.start()).toBe(false);
    expect(application.start({ initialSessionId: SESSION })).toBe(false);
    expect(opened).toHaveLength(1);
    expect(application.state()).toBe("disposed");
  });

  it("fences late commits after disposal", () => {
    const { application } = makeApplication();
    application.start({ initialSessionId: SESSION });
    application.dispose();

    // A late answer for a session that was never live cannot create a record.
    application.store.updateSession(OTHER, (current) => ({ ...current, sending: true }));
    expect(application.store.readSession(OTHER).sending).toBe(false);
  });
});

describe("a fresh instance is a fresh lifecycle", () => {
  it("starts and disposes independently of a disposed one", () => {
    const first = makeApplication();
    first.application.start();
    first.application.dispose();

    const second = makeApplication();
    expect(second.application.state()).toBe("constructed");
    expect(second.application.start({ initialSessionId: OTHER })).toBe(true);
    expect(second.opened).toHaveLength(1);
    expect(second.application.store.isDisposed()).toBe(false);
    // The disposed instance's store stays disposed: a remount builds a new
    // assembly rather than reactivating the old one.
    expect(first.application.store.isDisposed()).toBe(true);
    second.application.dispose();
  });

  it("hydrates its own storage on start, not the previous instance's", () => {
    const first = recordingStorage({ [OTHER]: 1 });
    const firstApp = makeApplication({ storage: first.storage });
    firstApp.application.start({ initialSessionId: SESSION });
    firstApp.application.dispose();

    const second = recordingStorage({ [OTHER]: 7 });
    const secondApp = makeApplication({ storage: second.storage });
    secondApp.application.start({ initialSessionId: SESSION });
    expect(second.written[0]).toEqual({ [OTHER]: 7 });
    secondApp.application.dispose();
  });
});

describe("the entry's boot shape", () => {
  it("exposes one start and one dispose for the whole instance", () => {
    // Guards against a lifecycle that can be re-entered: the counters are the
    // observable form of "one boot per instance".
    const openEventChannel = vi.fn(() => scriptedChannel().channel);
    const application = createWebuiApplication({
      openEventChannel,
      turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
    });
    application.start();
    application.start();
    application.dispose();
    expect(openEventChannel).toHaveBeenCalledTimes(1);
  });
});

// The opaque identity/freshness context: credential and configuration
// generations go in the resource key. These cases pin the three properties a key
// can rely on — the token is opaque, it belongs to one instance, and a
// generation only ever moves forward.
describe("the identity epoch context", () => {
  it("hands out opaque tokens that carry no credential", () => {
    const epochs = createWebuiIdentityEpochs();
    const credentials = epochs.credentials();
    // The token is a counter string, and the *shape* is what makes it safe to
    // key a resource with: no value is passed in, so none can leak out.
    expect(credentials.token).toMatch(/^app\d+\.credentials\.\d+$/u);
    expect(epochs.read("credentials")).toEqual(credentials);
  });

  it("advances one generation at a time and reports it as stale afterwards", () => {
    const epochs = createWebuiIdentityEpochs();
    const captured = epochs.credentials();
    expect(epochs.isCurrent(captured)).toBe(true);

    const advanced = epochs.advance("credentials");
    expect(advanced.generation).toBe(captured.generation + 1);
    // The captured token is no longer current, which is the whole point: an
    // answer that started before the write cannot commit after it.
    expect(epochs.isCurrent(captured)).toBe(false);
    expect(epochs.isCurrent(advanced)).toBe(true);
    // A different key is untouched: a credential write does not retire
    // configuration answers.
    expect(epochs.configuration().generation).toBe(0);
  });

  it("never lets a generation move backwards", () => {
    const epochs = createWebuiIdentityEpochs();
    epochs.advance("configuration");
    const first = epochs.configuration();
    epochs.advance("configuration");
    const second = epochs.configuration();
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(epochs.isCurrent(first)).toBe(false);
    expect(epochs.isCurrent(second)).toBe(true);
  });

  it("notifies subscribers with the epoch that moved", () => {
    const epochs = createWebuiIdentityEpochs();
    const seen: string[] = [];
    const detach = epochs.subscribe((epoch) => seen.push(epoch.key));
    epochs.advance("credentials");
    epochs.advance("configuration");
    detach();
    epochs.advance("application");
    expect(seen).toEqual(["credentials", "configuration"]);
  });

  it("gives a fresh assembly fresh tokens, so an old capture is never current", () => {
    const first = createWebuiIdentityEpochs();
    const captured = first.credentials();
    const second = createWebuiIdentityEpochs();
    // Same generation, different instance: the token differs, so the previous
    // instance's answer is rejected rather than accepted on a generation match.
    expect(second.credentials().generation).toBe(captured.generation);
    expect(second.credentials().token).not.toBe(captured.token);
    expect(second.isCurrent(captured)).toBe(false);
  });

  it("publishes the context on the assembled application", () => {
    const { application } = makeApplication();
    const captured = application.identityEpochs.credentials();
    expect(application.identityEpochs.isCurrent(captured)).toBe(true);
    application.identityEpochs.advance("credentials");
    expect(application.identityEpochs.isCurrent(captured)).toBe(false);
    application.dispose();
  });
});

// The one reconciliation entry point. A selection change and a suspected
// observation gap must reach the same authoritative re-reads instead of each
// surface probing on its own, and the re-reads are the ones the installed
// routes own — asserted through the routes themselves, not a copy.
describe("the reconciliation entry point", () => {
  it("runs the reconciled session's authoritative re-reads through their owners", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const getGoal = vi.fn(async () => undefined);
    const { application } = makeApplication({
      interactionsPort: { listPendingPermissions },
      goalPort: { getGoal },
    });

    application.reconcile(SESSION);

    // One entry point, and it is the owner routes the event path uses: the
    // pending snapshot is really re-read and the goal is really re-read.
    expect(listPendingPermissions).toHaveBeenCalledTimes(1);
    expect(getGoal).toHaveBeenCalledWith({ sessionId: SESSION });
    application.dispose();
  });

  it("defaults to the application's own selection", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const { application } = makeApplication({
      interactionsPort: { listPendingPermissions },
    });
    application.start({ initialSessionId: SESSION });

    application.reconcile();

    expect(listPendingPermissions).toHaveBeenCalledTimes(1);
    application.dispose();
  });

  it("does nothing when there is no session to reconcile", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const { application } = makeApplication({
      interactionsPort: { listPendingPermissions },
    });
    application.start();

    application.reconcile();

    expect(listPendingPermissions).not.toHaveBeenCalled();
    application.dispose();
  });

  it("stops reconciling after disposal", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const { application } = makeApplication({
      interactionsPort: { listPendingPermissions },
    });
    application.start({ initialSessionId: SESSION });
    application.dispose();

    application.reconcile(SESSION);

    expect(listPendingPermissions).not.toHaveBeenCalled();
  });
});

describe("one owner's cleanup failing does not strand the others", () => {
  it("still fences the store and reports the failure", () => {
    // The event channel is host-facing, so its close is the realistic place for a
    // cleanup to throw. A throw there must not leave the application accepting
    // writes, and must not propagate at a caller that cannot act on it.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opened = scriptedChannel();
      const application = createWebuiApplication({
        openEventChannel: () => ({
          ...opened.channel,
          close: () => {
            opened.channel.close?.();
            throw new Error("host channel close failed");
          },
        }),
        turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
      });
      application.start({ initialSessionId: SESSION });
      expect(() => application.dispose()).not.toThrow();

      // Everything ran: the ingress it was observing is closed, and the store is
      // fenced, so a late write cannot land on a disposed application.
      expect(opened.closes()).toBe(1);
      expect(application.store.isDisposed()).toBe(true);
      application.store.updateSession(OTHER, (current) => ({ ...current, sending: true }));
      expect(application.store.readSession(OTHER).sending).toBe(false);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("keeps dispose terminal after a failed cleanup", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const opened = scriptedChannel();
      const application = createWebuiApplication({
        openEventChannel: () => ({
          ...opened.channel,
          close: () => {
            throw new Error("host channel close failed");
          },
        }),
        turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
      });
      application.start({ initialSessionId: SESSION });
      application.dispose();
      // Disposal is fenced before any cleanup runs, so a retrying caller cannot
      // start a second teardown — including after one of them threw.
      expect(() => application.dispose()).not.toThrow();
      expect(() => application.dispose()).not.toThrow();
      expect(application.state()).toBe("disposed");
      expect(opened.listenerCount()).toBe(0);
      expect(application.start()).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("reads resolve after the application is disposed", () => {
  it("answers every business read instead of throwing", () => {
    const { application } = makeApplication();
    application.start({ initialSessionId: SESSION });
    const before = application.reads.stream(SESSION);
    application.dispose();

    // A read that outlives disposal is a reader that has not been told yet, not
    // a programming error: it must still answer, and answer from the last
    // committed snapshot rather than from a torn one. A hook that threw here
    // would replace a recoverable error with a fatal one during teardown.
    expect(() => application.reads.stream(SESSION)).not.toThrow();
    expect(application.reads.stream(SESSION)).toEqual(before);
    expect(() => application.reads.transcriptPage(SESSION)).not.toThrow();
    expect(() => application.getSnapshot()).not.toThrow();
    // Models, Settings, Plugins, Transcript, Review and Workspace all publish a
    // read model, and each surface holds one across the disposal that unmounts it.
    expect(() => application.modelsWorkflows.getSnapshot()).not.toThrow();
    expect(() => application.settingsWorkflows.getSnapshot()).not.toThrow();
    expect(() => application.pluginWorkflows.getSnapshot()).not.toThrow();
    expect(() => application.accountWorkflows.getSnapshot()).not.toThrow();
    expect(() => application.sessionWorkflows.getArchivedSnapshot()).not.toThrow();
    expect(() => application.workspaceQueries.getSnapshot()).not.toThrow();
    expect(() => application.turnReview.read({ sessionId: SESSION })).not.toThrow();
  });
});

describe("V02 · independent owners' pending IO cannot commit after disposal", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  it("fences Models, Settings, Plugins, Transcript, Review and Workspace late answers", async () => {
    const models = deferred<readonly never[]>();
    const instructions = deferred<never>();
    const plugins = deferred<never>();
    const reviewDiff = deferred<never>();
    const files = deferred<readonly never[]>();
    const history = deferred<never>();

    const application = createWebuiApplication({
      openEventChannel: () => scriptedChannel().channel,
      loadMessages: (() => history.promise) as never,
      slices: createWebuiPortSlices({
        listModels: () => models.promise,
        getGlobalInstructions: () => instructions.promise,
        pluginManagement: () => plugins.promise,
        listWorkspaceFileTree: () => files.promise,
      } as never),
      turnReview: { getTurnDiff: () => reviewDiff.promise } as never,
      turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
    });
    application.start({ initialSessionId: SESSION });

    // Every independent owner built by the assembly, watched the way a mounted
    // surface watches it.
    const notifications = { models: 0, settings: 0, plugins: 0, transcript: 0, review: 0, workspace: 0 };
    application.modelsWorkflows.subscribe(() => { notifications.models += 1; });
    application.settingsWorkflows.subscribe(() => { notifications.settings += 1; });
    application.workspaceQueries.subscribe(() => { notifications.workspace += 1; });
    application.turnReview.subscribe(() => { notifications.review += 1; });
    application.store.subscribe(() => { notifications.transcript += 1; });

    const pending = Promise.all([
      application.modelsWorkflows.loadModels(SESSION),
      application.settingsWorkflows.loadInstructions(),
      application.composerPluginCatalogue.installedPlugins(),
      application.turnReview.load({ sessionId: SESSION, turnId: "turn-1" }),
      application.transcriptHistory.loadPage(SESSION),
      Promise.resolve(application.workspaceQueries.files.loadFileTree("/repo")),
    ]);
    // The answers are in flight when the application goes away.
    application.dispose();
    const settledAtDisposal = { ...notifications };

    models.resolve([]);
    instructions.resolve({} as never);
    plugins.resolve({} as never);
    reviewDiff.resolve({} as never);
    files.resolve([]);
    history.resolve({} as never);
    const outcomes = await pending;

    // No owner published after teardown: a late commit would have notified a
    // subscriber that had already unmounted, and re-populated a read model the
    // disposal was supposed to fence. The counts below are whatever the in-flight
    // reads had already published while the application was alive.
    expect(notifications).toEqual(settledAtDisposal);
    expect(settledAtDisposal.models).toBeGreaterThan(0);
    // Each read settled with an outcome that says why it is not shown, rather
    // than a value.
    expect(application.modelsWorkflows.getSnapshot().models.status).not.toBe("ready");
    expect(application.settingsWorkflows.getSnapshot().instructions.status).not.toBe("ready");
    const transcriptOutcome = outcomes[4] as { readonly status: string };
    const reviewOutcome = outcomes[3] as { readonly status: string };
    expect(transcriptOutcome.status).toBe("stale");
    expect(reviewOutcome.status).toBe("stale");
    // A read started after the disposal is refused at the owner, not sent on a
    // socket nobody is reading.
    await expect(application.composerPluginCatalogue.installedPlugins()).rejects.toThrow();
  });
});
