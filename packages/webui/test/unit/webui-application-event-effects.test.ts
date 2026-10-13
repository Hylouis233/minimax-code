// The application's late-binding event effects (plan §8 Phase 2 step 2; ticket #61).
//
// The composition root constructs the application and provides it; the subtree
// below registers the per-session handlers and its own view reactions once it is
// mounted. That only works if the coordinator reads its effects through a slot
// instead of a value captured at construction, and these cases pin the three
// properties that make the slot correct rather than convenient:
//
// 1. a registration made **after** construction is what the next event sees;
// 2. registering **replaces** the set — a member the new set does not carry stops
//    being called, because the coordinator branches on a member's presence;
// 3. the detach restores the set in force before the call, so a remount is
//    symmetric and a torn-down consumer cannot keep receiving events.

import { describe, expect, it, vi } from "vitest";

import { createWebuiApplication } from "../../src/client/application/create-application.js";
import type { WebuiEventEffects } from "../../src/client/application/turn/event-coordinator.js";
import type { WebuiProcessEventChannel } from "../../src/client/application/turn/event-channel.js";
import type { WebuiRuntimeEvent } from "../../src/shared/contracts/stream.js";

interface FakeChannel {
  readonly channel: WebuiProcessEventChannel;
  readonly emit: (event: WebuiRuntimeEvent) => void;
  readonly ready: () => void;
}

function makeChannel(): FakeChannel {
  const listeners = new Set<(event: WebuiRuntimeEvent) => void>();
  const readyCallbacks = new Set<() => void>();
  return {
    channel: {
      subscribe: (listener, onReady) => {
        listeners.add(listener);
        if (onReady) readyCallbacks.add(onReady);
        return () => {
          listeners.delete(listener);
          if (onReady) readyCallbacks.delete(onReady);
        };
      },
      close: () => undefined,
    },
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    ready: () => {
      for (const onReady of [...readyCallbacks]) onReady();
    },
  };
}

function makeApplication(effects: WebuiEventEffects = {}) {
  const fake = makeChannel();
  const application = createWebuiApplication({
    openEventChannel: () => fake.channel,
    effects,
    turns: { resumeSession: async () => {} },
  });
  return { application, fake };
}

const gitChanged = (): WebuiRuntimeEvent =>
  ({
    type: "workspace.git.changed",
    payload: {},
    timestamp: 1,
    source: "synthetic",
  }) as never;

describe("an effects set registered after construction is the one that runs", () => {
  it("delivers channel readiness to a handler registered after construction", () => {
    const { application, fake } = makeApplication();
    const onReady = vi.fn();
    application.setEventEffects({ channelReady: onReady });

    fake.ready();

    expect(onReady).toHaveBeenCalledTimes(1);
    application.dispose();
  });

  it("delivers an application-wide event to a handler registered after construction", () => {
    const { application, fake } = makeApplication();
    const onGitChanged = vi.fn();
    application.setEventEffects({ workspaceGitChanged: onGitChanged });

    fake.emit(gitChanged());

    expect(onGitChanged).toHaveBeenCalledTimes(1);
    application.dispose();
  });

  it("still runs the effects the composition root supplied at construction", () => {
    const onReady = vi.fn();
    const { application, fake } = makeApplication({ channelReady: onReady });

    fake.ready();

    expect(onReady).toHaveBeenCalledTimes(1);
    application.dispose();
  });
});

describe("registering replaces the set rather than merging into it", () => {
  it("stops calling a member the new set does not carry", () => {
    // Not a tidiness assertion: the coordinator chooses between two write paths
    // by testing whether a member exists (`if (effects.setGoal)`), so a member
    // that survived a replacement would keep the registered branch alive on a
    // host whose new registration does not own it.
    const onGitChanged = vi.fn();
    const { application, fake } = makeApplication({
      workspaceGitChanged: onGitChanged,
    });
    fake.emit(gitChanged());
    expect(onGitChanged).toHaveBeenCalledTimes(1);

    application.setEventEffects({ channelReady: () => undefined });
    fake.emit(gitChanged());

    expect(onGitChanged).toHaveBeenCalledTimes(1);
    application.dispose();
  });

  it("restores the previous set when the registration is detached", () => {
    const onGitChanged = vi.fn();
    const { application, fake } = makeApplication({
      workspaceGitChanged: onGitChanged,
    });

    const detach = application.setEventEffects({ channelReady: () => undefined });
    fake.emit(gitChanged());
    expect(onGitChanged).not.toHaveBeenCalled();

    detach();
    fake.emit(gitChanged());
    expect(onGitChanged).toHaveBeenCalledTimes(1);
    application.dispose();
  });

  it("leaves nothing registered when the detach follows an empty set", () => {
    const onGitChanged = vi.fn();
    const { application, fake } = makeApplication();
    const detach = application.setEventEffects({ workspaceGitChanged: onGitChanged });
    detach();

    fake.emit(gitChanged());

    expect(onGitChanged).not.toHaveBeenCalled();
    application.dispose();
  });
});
