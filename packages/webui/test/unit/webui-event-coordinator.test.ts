// The event coordinator's routing guard.
//
// `thread_goal.updated` declares its session id inside `goal` rather than at
// the payload top level. The effect reducer's own session guard carries a
// nested-goal fallback for that, but the coordinator — the thing that decides
// whether an event is delivered at all — read the top level only, so every
// such event was dropped before the reducer could see it. The symptom was a
// goal banner frozen on whatever `getGoal()` returned when the session opened.
//
// This is the deterministic half of that fix; the browser half lives in
// `test/webui-browser/workspace-progress-live.spec.mjs`.

import { describe, expect, it } from "vitest";

import { createWebuiEventCoordinator } from "../../src/client/features/turn/application/event-coordinator.js";
import { createWebuiSessionStore } from "../../src/client/application/session-store.js";
import { createWebuiStreamLeaseController } from "../../src/client/features/turn/application/stream-lease-controller.js";
import { createWebuiUnreadController } from "../../src/client/features/sessions/application/unread.js";
import { createWebuiGoalSessionOwners } from "../../src/client/features/goal/application/goal-session-owners.js";

function coordinator() {
  const store = createWebuiSessionStore();
  const leases = createWebuiStreamLeaseController(store);
  const unread = createWebuiUnreadController({ store });
  // The permanent goal route, installed exactly as the assembly installs it: the
  // owner is the application's, so a goal event commits with nothing registered.
  const goals = createWebuiGoalSessionOwners({ store });
  const events = createWebuiEventCoordinator({
    store,
    leases,
    readActiveSessionId: () => store.getSelectedSessionId(),
    unread,
    routes: {
      setGoal: (sessionId, goal) => goals.owner(sessionId).applyGoal(goal),
      refreshGoal: (sessionId) => goals.owner(sessionId).refreshGoal(),
      invalidatePending: () => undefined,
      refreshPending: () => undefined,
      attachStream: () => undefined,
      channelReady: () => undefined,
      workspaceGitChanged: () => undefined,
    },
  });
  return { store, events, goals };
}

const event = (type: string, payload: Record<string, unknown>) =>
  ({ type, payload, timestamp: 1, source: "synthetic" }) as never;

describe("the coordinator routes by the id an event actually carries", () => {
  it("delivers a thread_goal.updated whose id is nested inside goal", () => {
    const { store, events } = coordinator();

    events.handleEvent(
      event("thread_goal.updated", {
        goal: {
          sessionId: "A",
          goalId: "g1",
          objective: "生产形态目标",
          status: "complete",
          tokensUsed: 1,
          turnsUsed: 1,
          timeUsedSeconds: 1,
          updatedAt: 1,
        },
      }),
    );

    expect(store.readSession("A").goal?.objective).toBe("生产形态目标");
  });

  it("still drops an event that names no session anywhere", () => {
    const { store, events } = coordinator();

    events.handleEvent(event("thread_goal.updated", { goal: { goalId: "g1" } }));

    expect(store.getSnapshot().sessions.size).toBe(0);
  });

  it("applies an event to the session it names, not to another", () => {
    const { store, events } = coordinator();

    events.handleEvent(
      event("thread_goal.updated", {
        goal: { sessionId: "B", goalId: "g1", objective: "B 的目标", status: "active", updatedAt: 1 },
      }),
    );

    // Background sessions keep updating: the coordinator routes by the id the
    // event carries, so B gets the goal and A is untouched.
    expect(store.readSession("B").goal?.objective).toBe("B 的目标");
    expect(store.readSession("A").goal).toBeUndefined();
  });
});
