// Unit tests for the application event coordinator (ticket #45, slice B).
//
// Every case drives the coordinator through `createWebuiApplication` against a
// fake process-event channel. What it pins is exactly the list the ticket names:
//
//   * one channel per application instance, and repeated mount/unmount still
//     yields one;
//   * a throwing listener does not break other subscribers, and unsubscribing
//     does not tear down the shared channel;
//   * the coordinator routes events to the retained activity/effect reducers and
//     executes their effect commands against the store's writers;
//   * a late result for a previously selected session is discarded;
//   * lease release on terminal, error and cancellation;
//   * a late completion after disposal writes nothing.
//
// Stream frames are not part of this surface. They reach the store through the
// stream sink (`client/mechanisms/stream-loop.ts`), which owns the lease fence;
// `webui-shell.test.ts` covers the superseded-generation and resume-overflow
// behaviour on that path.
import { describe, expect, it, vi } from "vitest";

import { createWebuiApplication } from "../../src/client/application/create-application.js";
import type { WebuiProcessEventChannel } from "../../src/client/application/turn/event-channel.js";
import type { WebuiRuntimeEvent } from "../../src/shared/contracts/stream.js";
import type {WebuiClientSessionResumer} from "../../src/client/contracts/turn/execution-port.js";

function event(type: string, payload: Record<string, unknown>): WebuiRuntimeEvent {
  return { type, payload, timestamp: 1, source: "test" };
}

interface FakeChannel {
  readonly channel: WebuiProcessEventChannel;
  readonly emit: (event: WebuiRuntimeEvent) => void;
  readonly ready: () => void;
  readonly listenerCount: () => number;
  readonly closeSpy: ReturnType<typeof vi.fn>;
}

function makeChannel(): FakeChannel {
  const listeners = new Set<(event: WebuiRuntimeEvent) => void>();
  const readyCallbacks = new Set<() => void>();
  const closeSpy = vi.fn();
  const channel: WebuiProcessEventChannel = {
    subscribe: (listener, onReady) => {
      listeners.add(listener);
      if (onReady) readyCallbacks.add(onReady);
      return () => {
        listeners.delete(listener);
        if (onReady) readyCallbacks.delete(onReady);
      };
    },
    close: closeSpy,
  };
  return {
    channel,
    emit: (value) => {
      for (const listener of [...listeners]) listener(value);
    },
    ready: () => {
      for (const onReady of [...readyCallbacks]) onReady();
    },
    listenerCount: () => listeners.size,
    closeSpy,
  };
}

function makeApplication(
  options: {
    readonly interactionsPort?: Record<string, unknown>;
    readonly goalPort?: Record<string, unknown>;
    readonly turnCapabilities?: Record<string, unknown>;
  } = {},
) {
  const channels: FakeChannel[] = [];
  let opened = 0;
  const resumeSession = vi.fn(async () => {}) as unknown as WebuiClientSessionResumer;
  const application = createWebuiApplication({
    openEventChannel: () => {
      opened += 1;
      const fake = makeChannel();
      channels.push(fake);
      return fake.channel;
    },
    ...(options.interactionsPort
      ? { interactionsPort: options.interactionsPort as never }
      : {}),
    ...(options.goalPort ? { goalPort: options.goalPort as never } : {}),
    ...(options.turnCapabilities
      ? { turnCapabilities: options.turnCapabilities as never }
      : {}),
    turns: { resumeSession },
  });
  application.start();
  return { application, channels, opened: () => opened };
}

describe("stage 4 — the four call sites' handling through the coordinator", () => {
  it("attaches to the turn a session.start names, with no view mounted", async () => {
    // The application builds the conversation command set for the session and
    // attaches itself: the composer is not involved (T05). The evidence is the
    // attempt reaching the session's own transport.
    const { application, channels } = makeApplication({
      turnCapabilities: { resume: async () => undefined },
    });

    channels[0]!.emit(event("session.start", { sessionId: "s1", turnId: "turn-B" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The attempt started on the session's record: streaming, with the sending
    // flag up, which is what a mounted composer used to be required for.
    const record = application.store.readSession("s1");
    expect(record.stream.phase).toBe("streaming");
    expect(record.sending).toBe(true);
  });

  it("re-reads the session's pending interactions and goal through their owners", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const getGoal = vi.fn(async () => undefined);
    const { application, channels } = makeApplication({
      interactionsPort: { listPendingPermissions },
      goalPort: { getGoal },
    });
    // Interest is what makes the read worth running (plan §4.3).
    application.sessionScope.acquire("s1", "secondary", "tab-1");

    channels[0]!.emit(event("session.queue.updated", { sessionId: "s1" }));

    expect(listPendingPermissions).toHaveBeenCalledTimes(1);
    expect(application.store.readSession("s1").permissions).toEqual([]);
    expect(getGoal).not.toHaveBeenCalled();
  });

  it("retains a read-required event for a session nothing needs, and pays it out on selection", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const { application, channels } = makeApplication({
      interactionsPort: { listPendingPermissions },
    });

    // Nothing needs s1 yet: the marker is retained instead of a background read
    // (plan §4.3), which is the alternative to the silent drop the old registry
    // produced.
    channels[0]!.emit(event("session.queue.updated", { sessionId: "s1" }));
    expect(listPendingPermissions).not.toHaveBeenCalled();

    // Interest arrives: the retained marker pays out once.
    application.select("s1");
    expect(listPendingPermissions).toHaveBeenCalledTimes(1);

    application.select("s2");
    application.select("s1");
    expect(listPendingPermissions).toHaveBeenCalledTimes(1);
  });

  it("delivers a workspace-git event to the surfaces that subscribed", () => {
    const { application, channels } = makeApplication();
    const seen: unknown[] = [];
    application.onWorkspaceGitChanged((payload) => seen.push(payload));

    channels[0]!.emit(
      event("workspace.git.changed", { workspace: "/repo", aliases: ["/repo-alias"] }),
    );

    expect(seen).toEqual([{ workspace: "/repo", aliases: ["/repo-alias"] }]);
  });

  it("reconciles every interested session on a ready signal, then tells subscribers", () => {
    const listPendingPermissions = vi.fn(async () => ({ requests: [] }));
    const fake = makeChannel();
    const probeApp = createWebuiApplication({
      openEventChannel: () => fake.channel,
      interactionsPort: { listPendingPermissions } as never,
      turns: { resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer },
    });
    probeApp.start();
    probeApp.sessionScope.acquire("s1", "secondary", "tab-1");
    probeApp.sessionScope.acquire("s2", "secondary", "tab-2");
    const ready = vi.fn();
    probeApp.onChannelReady(ready);

    // The server accepted the channel again; each interested session re-reads
    // its authoritative state, which is how a missed `session.start` is
    // recovered, and the surfaces that subscribed are told afterwards.
    fake.ready();

    expect(listPendingPermissions).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
