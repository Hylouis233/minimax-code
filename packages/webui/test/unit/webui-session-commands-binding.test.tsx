// The binding's own contribution to the turn seam (U43).
//
// `webui-application-commands.test.ts` drives `sendWebuiTurn` and
// `attachWebuiTurn` directly, and `webui-shell.test.ts` renders the shell — but
// nothing crossed `useWebuiSessionCommands` itself, so the four things the hook
// is responsible for went unverified: that `readStream` reads the *live* store
// slice rather than a snapshot, that an attachment's sink is minted from the
// store's writer (so its frames and its `sending` flag land in the store), that
// the live slice is what refuses a second attachment to a session that is
// already streaming, and that `undefined` routes to the home slot.
//
// The package has no DOM and no `react-test-renderer`, but it does not need
// either: `useMemo` runs during SSR, so a probe component rendered inside the
// store provider hands the test the hook's return value.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WebuiSessionStoreProvider } from "../../src/client/bindings/application-context.js";
import { useWebuiSessionCommands } from "../../src/client/bindings/use-session-state.js";
import {
  createWebuiSessionStore,
  type WebuiSessionStore,
} from "../../src/client/application/session-store.js";
import type { WebuiStreamFrame } from "../../src/shared/contracts/stream.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function commandsFor(sessionId: string | undefined, store: WebuiSessionStore) {
  let captured: ReturnType<typeof useWebuiSessionCommands> | undefined;
  function Probe() {
    captured = useWebuiSessionCommands(sessionId);
    return null;
  }
  renderToStaticMarkup(
    createElement(WebuiSessionStoreProvider, { store, children: createElement(Probe) }),
  );
  if (!captured) throw new Error("the probe did not render");
  return captured;
}

/** A resumer that delivers one frame and then stays open until released. */
function pendingResumer() {
  let release: () => void = () => {};
  const frames: WebuiStreamFrame[] = [{ dataJson: '{"type":10}' }];
  const resumeSession = vi.fn(
    async (_body: unknown, onFrame: (frame: WebuiStreamFrame) => void) => {
      for (const frame of frames) onFrame(frame);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      onFrame({ dataJson: "[DONE]" });
    },
  );
  return { resumeSession, release: () => release() };
}

describe("readStream", () => {
  it("reads the slice the store holds now, not the one it held at render", () => {
    const store = createWebuiSessionStore();
    const { readStream } = commandsFor("s1", store);
    expect(readStream().phase).toBe("idle");
    // A write from anywhere else — the transcript owner, a projection, another
    // binding — has to be visible to this reader. A captured snapshot would
    // still say "idle" here, and every guard built on it would be blind.
    store.createSessionWriter({ kind: "session", sessionId: "s1" }).setStream((current) => ({
      ...current,
      phase: "streaming",
    }));
    expect(readStream().phase).toBe("streaming");
  });

  it("routes an undefined session to the home slot, not to a session key", () => {
    const store = createWebuiSessionStore();
    const { readStream } = commandsFor(undefined, store);
    store.createSessionWriter({ kind: "home" }).setStream((current) => ({
      ...current,
      phase: "streaming",
    }));
    expect(readStream().phase).toBe("streaming");
    expect(store.readSession("s1").stream.phase).toBe("idle");
  });
});

describe("attachTurn", () => {
  it("mints its sink from the store writer, so frames and sending land in the store", async () => {
    const store = createWebuiSessionStore();
    const commands = commandsFor("s1", store);
    const { resumeSession } = pendingResumer();
    commands.attachTurn({ turnId: "t1", resumeSession });
    await flush();
    expect(resumeSession).toHaveBeenCalledTimes(1);
    // The resume body names the session. `turnId` is not part of it: the loop
    // takes it as an option and uses it to frame what comes back, so a test that
    // expected it here would be asserting a wire shape that does not exist.
    expect(resumeSession.mock.calls[0]?.[0]).toEqual({ id: "s1" });
    // The frame went through `buildWebuiStreamLoopSink(writer.setStream, …)`: a
    // sink built from anything but the store's writer leaves this slice idle.
    expect(store.readSession("s1").stream.phase).not.toBe("idle");
    // …and `sending` through `writer.setSending`, which is the flag the composer
    // reads to disable its send button.
    expect(store.readSession("s1").sending).toBe(true);
  });

  it("refuses a second attachment while the first is live, because it reads the live slice", async () => {
    const store = createWebuiSessionStore();
    const commands = commandsFor("s1", store);
    const { resumeSession } = pendingResumer();
    commands.attachTurn({ turnId: "t1", resumeSession });
    await flush();
    commands.attachTurn({ turnId: "t2", resumeSession });
    await flush();
    // `attachWebuiTurn` returns early when `readStream().subscription` is set.
    // That guard only works if the reader is live — a snapshot of the idle slice
    // would let a second loop attach to the same session and fight the first.
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a session or a resumer", async () => {
    const store = createWebuiSessionStore();
    const home = commandsFor(undefined, store);
    const { resumeSession } = pendingResumer();
    home.attachTurn({ turnId: "t1", resumeSession });
    await flush();
    expect(resumeSession).not.toHaveBeenCalled();

    const commands = commandsFor("s1", store);
    commands.attachTurn({ turnId: "t1" });
    await flush();
    expect(store.readSession("s1").sending).toBe(false);
  });
});
