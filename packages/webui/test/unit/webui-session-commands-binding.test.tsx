// The binding's own contribution to the turn seam (U43; ticket #57).
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
// Ticket #57 added a fifth: the hook now takes its capabilities from the
// application's published turn capability slice, so an intent call site supplies
// none. The tests below therefore hand capabilities to the *application*, never
// to `attachTurn` / `sendTurn`, and pin the two consequences that matter — an
// unwired resume refuses without starting a stream, an unwired send refuses
// without setting `sending`, and a capability smuggled into an intent object at
// runtime is ignored.
//
// The package has no DOM and no `react-test-renderer`, but it does not need
// either: `useMemo` runs during SSR, so a probe component rendered inside the
// providers hands the test the hook's return value.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WebuiApplicationProvider } from "../../src/client/bindings/application-context.js";
import {
  useWebuiSessionCommands,
  type WebuiTurnAttachIntent,
  type WebuiTurnSendIntent,
} from "../../src/client/bindings/use-session-state.js";
import { createWebuiApplication } from "../../src/client/application/create-application.js";
import {
  createWebuiSessionStore,
  type WebuiSessionStore,
} from "../../src/client/application/session-store.js";
import type { WebuiTurnCapabilityPort } from "../../src/client/application/turn/turn-capabilities.js";
import type { WebuiStreamFrame } from "../../src/shared/contracts/stream.js";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Render the binding over a store and the application that owns it. The turn
 * capabilities arrive through `turnCapabilities` — the composition root's
 * slice — because an intent call site has no way to hand the hook one
 * (ticket #57).
 */
function commandsFor(
  sessionId: string | undefined,
  store: WebuiSessionStore,
  capabilities: WebuiTurnCapabilityPort = {},
) {
  const application = createWebuiApplication({
    openEventChannel: () => ({ subscribe: () => () => undefined }),
    store,
    turns: {
      resumeSession: capabilities.resumeSession ?? (async () => undefined),
    },
    turnCapabilities: capabilities,
  });
  let captured: ReturnType<typeof useWebuiSessionCommands> | undefined;
  function Probe() {
    captured = useWebuiSessionCommands(sessionId);
    return null;
  }
  renderToStaticMarkup(
    createElement(WebuiApplicationProvider, {
      application,
      children: createElement(Probe),
    }),
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
    const { resumeSession } = pendingResumer();
    const commands = commandsFor("s1", store, { resumeSession });
    commands.attachTurn({ turnId: "t1" });
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
    const { resumeSession } = pendingResumer();
    const commands = commandsFor("s1", store, { resumeSession });
    commands.attachTurn({ turnId: "t1" });
    await flush();
    commands.attachTurn({ turnId: "t2" });
    await flush();
    // `attachWebuiTurn` returns early when `readStream().subscription` is set.
    // That guard only works if the reader is live — a snapshot of the idle slice
    // would let a second loop attach to the same session and fight the first.
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  it("refuses when the application wires no resume capability, without starting a stream", async () => {
    const store = createWebuiSessionStore();
    // The capability exists here, but it is NOT in the application's slice — so
    // the intent has no way to reach it. That is the guard's whole point.
    const { resumeSession } = pendingResumer();
    const commands = commandsFor("s1", store);
    commands.attachTurn({ turnId: "t1" });
    await flush();
    expect(resumeSession).not.toHaveBeenCalled();
    expect(store.readSession("s1").sending).toBe(false);
    expect(store.readSession("s1").stream.phase).toBe("idle");
  });

  it("ignores a capability smuggled into the intent object at runtime", async () => {
    const store = createWebuiSessionStore();
    const { resumeSession } = pendingResumer();
    const commands = commandsFor("s1", store);
    // A cast defeats the type the way a plain-JavaScript caller would. The
    // runtime path has to be as narrow as the type: the hook reads the slice,
    // not the object it was handed.
    commands.attachTurn({
      turnId: "t1",
      resumeSession,
    } as unknown as WebuiTurnAttachIntent);
    await flush();
    expect(resumeSession).not.toHaveBeenCalled();
    expect(store.readSession("s1").sending).toBe(false);
  });

  it("does nothing without a session", async () => {
    const store = createWebuiSessionStore();
    const { resumeSession } = pendingResumer();
    const home = commandsFor(undefined, store, { resumeSession });
    home.attachTurn({ turnId: "t1" });
    await flush();
    expect(resumeSession).not.toHaveBeenCalled();
  });
});

describe("sendTurn", () => {
  it("sends through the application's capability slice", async () => {
    const store = createWebuiSessionStore();
    const sendMessage = vi.fn(
      async (_request: { readonly id: string; readonly content: string }) =>
        undefined,
    );
    const commands = commandsFor("s1", store, { sendMessage });
    await commands.sendTurn({
      message: "你好",
      sending: false,
      onDraftChange: () => undefined,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toEqual({ id: "s1", content: "你好" });
  });

  it("refuses when the application wires no send capability, without setting sending or opening a stream", async () => {
    const store = createWebuiSessionStore();
    // Again the capability exists and the slice does not carry it.
    const sendMessage = vi.fn(async () => undefined);
    const commands = commandsFor("s1", store);
    await commands.sendTurn({
      message: "你好",
      sending: false,
      onDraftChange: () => undefined,
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.readSession("s1").sending).toBe(false);
    expect(store.readSession("s1").stream.phase).toBe("idle");
  });

  it("ignores a capability bag smuggled into the intent object at runtime", async () => {
    const store = createWebuiSessionStore();
    const sendMessage = vi.fn(async () => undefined);
    const commands = commandsFor("s1", store);
    await commands.sendTurn({
      message: "你好",
      sending: false,
      onDraftChange: () => undefined,
      deps: { sendMessage },
    } as unknown as WebuiTurnSendIntent);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(store.readSession("s1").sending).toBe(false);
  });
});

describe("stopTurn", () => {
  it("aborts through the slice and settles the local stream", async () => {
    const store = createWebuiSessionStore();
    const abortSession = vi.fn(async () => ({ success: true }));
    const commands = commandsFor("s1", store, { abortSession });
    store.createSessionWriter({ kind: "session", sessionId: "s1" }).setSending(true);
    await commands.stopTurn();
    expect(abortSession).toHaveBeenCalledWith({ id: "s1" });
    expect(store.readSession("s1").sending).toBe(false);
    expect(store.readSession("s1").stream.phase).toBe("done");
  });

  it("does nothing when the application wires no stop capability", async () => {
    const store = createWebuiSessionStore();
    const abortSession = vi.fn(async () => ({ success: true }));
    const commands = commandsFor("s1", store);
    await commands.stopTurn();
    expect(abortSession).not.toHaveBeenCalled();
  });
});

/**
 * The intent types, checked as types, and the checks are total rather than
 * "the literal I happened to write".
 *
 * `AttachIntentCapabilityFields` is `never` as long as neither intent declares
 * a capability field; if one is ever added, that type becomes that literal, the
 * `... extends never ? true : never` collapses to `never`, and the `const`
 * below stops compiling under `pnpm typecheck:webui-full`. `keyof` reads the
 * *declared* surface, so this holds for every caller rather than for the one
 * object literal a test might write.
 */
type AttachIntentCapabilityFields = Extract<
  keyof WebuiTurnAttachIntent,
  "resumeSession" | "loadMessages" | "sendMessage" | "deps" | "sink"
>;
type SendIntentCapabilityFields = Extract<
  keyof WebuiTurnSendIntent,
  "resumeSession" | "loadMessages" | "sendMessage" | "deps" | "sink" | "createWriter"
>;
type OnlyTrue<T extends true> = T;

const attachIntentRejectsCapabilities: OnlyTrue<
  AttachIntentCapabilityFields extends never ? true : never
> = true;
const sendIntentRejectsCapabilities: OnlyTrue<
  SendIntentCapabilityFields extends never ? true : never
> = true;

describe("the published intent types", () => {
  it("declare no capability field", () => {
    expect(attachIntentRejectsCapabilities).toBe(true);
    expect(sendIntentRejectsCapabilities).toBe(true);
  });
});
