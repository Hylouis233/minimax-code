// The resumed session stream's liveness.
//
// A resume that follows a turn is live: it must stay open until that turn
// publishes its terminal, because the turn's answer is committed after the
// resume and a stream that closed at the replay would drop it. The one case
// that has to end is the turn that is already over — it will publish no other
// terminal, so a stream that waited for one would wait forever.

import { describe, expect, it } from "vitest";

import { SessionStreamService } from "./session-stream-service.js";

const SESSION_ID = "session-1";

function createService() {
  return new SessionStreamService({
    messages: { listAfter: async () => ({ status: "ok", messages: [] }) },
  });
}

function writeTurnFrame(
  service: SessionStreamService,
  input: { readonly identity: string; readonly turnId: string; readonly kind?: "runtime-event" | "turn-terminal" },
): void {
  service.write({
    identity: input.identity,
    sessionId: SESSION_ID,
    kind: input.kind ?? "runtime-event",
    data: {},
    turnId: input.turnId,
  });
}

/** Drain the resume until it ends, and fail if it does not. */
async function drainToEnd(
  service: SessionStreamService,
  input: { readonly afterMsgId: string; readonly followTurnId: string },
): Promise<readonly string[]> {
  const iterator = service.resume({
    sessionId: SESSION_ID,
    afterMsgId: input.afterMsgId,
    waitForTerminal: true,
    followTurnId: input.followTurnId,
  });
  const identities: string[] = [];
  const ended = await Promise.race([
    (async () => {
      for (;;) {
        const step = await iterator.next();
        if (step.done) return true;
        identities.push(step.value.identity);
      }
    })(),
    new Promise<false>((resolve) => {
      const timer = setTimeout(() => resolve(false), 250);
      timer.unref?.();
    }),
  ]);
  if (!ended) {
    throw new Error("the resumed stream did not end");
  }
  return identities;
}

describe("SessionStreamService · the resumed stream's liveness", () => {
  it("stays live for a turn that has not published its terminal", async () => {
    const service = createService();
    writeTurnFrame(service, { identity: "frame-1", turnId: "turn-1" });

    const iterator = service.resume({
      sessionId: SESSION_ID,
      afterMsgId: "msg-0",
      waitForTerminal: true,
      followTurnId: "turn-1",
    });

    // The replay carries what the ring already holds.
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.identity).toBe("frame-1");

    // The turn ends while the stream is open: the terminal closes it.
    writeTurnFrame(service, {
      identity: "terminal-1",
      turnId: "turn-1",
      kind: "turn-terminal",
    });
    const second = await iterator.next();
    expect(second.done).toBe(false);
    expect(second.value?.kind).toBe("turn-terminal");

    const third = await iterator.next();
    expect(third.done).toBe(true);
  });

  it("ends at the replay for a turn that already published its terminal", async () => {
    const service = createService();
    writeTurnFrame(service, { identity: "frame-1", turnId: "turn-1" });
    writeTurnFrame(service, {
      identity: "terminal-1",
      turnId: "turn-1",
      kind: "turn-terminal",
    });

    // The follower names the turn it follows. That turn is over, so the
    // stream must end rather than wait for a terminal that cannot arrive.
    const identities = await drainToEnd(service, {
      afterMsgId: "msg-0",
      followTurnId: "turn-1",
    });
    expect(identities).toEqual(["frame-1"]);
  });

  it("keeps waiting for the turn it follows while that turn runs", async () => {
    const service = createService();
    writeTurnFrame(service, { identity: "frame-1", turnId: "turn-1" });
    // Turn 0 ended; turn 1 is the one being followed and it is still running.
    writeTurnFrame(service, {
      identity: "terminal-0",
      turnId: "turn-0",
      kind: "turn-terminal",
    });

    const iterator = service.resume({
      sessionId: SESSION_ID,
      afterMsgId: "msg-0",
      waitForTerminal: true,
      followTurnId: "turn-1",
    });
    const ended = await Promise.race([
      iterator.next().then((step) => step.done),
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 250);
        timer.unref?.();
      }),
    ]);
    expect(ended).toBe(false);
    await iterator.return?.();
  });
});
