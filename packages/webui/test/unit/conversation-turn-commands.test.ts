// The conversation turn commands as a surface invokes them (T04's
// `conversation-turn-commands`; plan §4.2, §4.3).
//
// The point of this seam is that a caller supplies intent and data and nothing
// else: no record key, no writer, no sink, no transports. These cases drive the
// factory headlessly — a store and a capability slice, no React — and assert the
// outcomes a surface can observe: which record the attempt was written to, that
// the lease was claimed, what reached the port, and that an absent capability
// refuses instead of pretending.

import { describe, expect, it, vi } from "vitest";

import { createWebuiConversationTurnCommands } from "../../src/client/application/turn/turn-commands.js";
import { createWebuiSessionStore } from "../../src/client/application/session-store.js";
import { WEBUI_HOME_SESSION_KEY } from "../../src/client/application/state.js";

/** A resume that never settles: the attachment's lease stays claimed. */
const openStream = () => new Promise<never>(() => undefined);

describe("the conversation turn commands", () => {
  it("claims the session's lease from an attachment without being given a writer or a key", () => {
    const store = createWebuiSessionStore();
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: "s1",
      capabilities: { resume: openStream as never },
    });

    commands.attach("t-1");

    // The record the attempt was written to is the session's, chosen by the
    // command: the caller named neither the key nor the sink.
    const record = store.readSession("s1");
    expect(record.sending).toBe(true);
    expect(record.stream.subscription).toBeDefined();
    expect(store.readSession(WEBUI_HOME_SESSION_KEY).stream.subscription).toBeUndefined();
  });

  it("attaches nothing without a session: the home slot is a send's, not an attachment's", () => {
    // An attachment follows a turn the server started, and a turn is named by a
    // session. The home slot exists for a first message that will create the
    // session it is sent to, so nothing claims its lease here.
    const store = createWebuiSessionStore();
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: undefined,
      capabilities: { resume: openStream as never },
    });

    commands.attach("t-home");

    expect(store.readSession(WEBUI_HOME_SESSION_KEY).sending).toBe(false);
    expect(store.readSession(WEBUI_HOME_SESSION_KEY).stream.subscription).toBeUndefined();
  });

  it("reaches the port with the session and writes the attempt to the session's record", async () => {
    const store = createWebuiSessionStore();
    const sendMessage = vi.fn(async () => openStream());
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: "s1",
      capabilities: { send: sendMessage as never },
    });

    // The stream the send opens never settles, so the loop is still running when
    // the assertions below read the record — which is the state being asserted.
    void commands.send({
      message: "hello",
      sending: false,
      callbacks: { onDraftChange: () => undefined },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toMatchObject({ id: "s1", content: "hello" });
    // The command chose the key and built the writer, so the attempt landed on
    // the session's record without the caller naming either.
    expect(store.readSession("s1").sending).toBe(true);
    expect(store.readSession("s1").stream.phase).toBe("streaming");
  });

  it("does not pretend to run a send the slice cannot run", async () => {
    const store = createWebuiSessionStore();
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: "s1",
      capabilities: {},
    });

    // The loop's own absent-capability guard decides; what this seam owes the
    // caller is that no attempt is started and nothing is reported as running.
    await expect(
      commands.send({
        message: "hello",
        sending: false,
        callbacks: { onDraftChange: () => undefined },
      }),
    ).resolves.toBeUndefined();
    expect(store.readSession("s1").sending).toBe(false);
    expect(store.readSession("s1").stream.phase).not.toBe("streaming");
  });

  it("stops through the slice's abort and settles the local record", async () => {
    const store = createWebuiSessionStore();
    const abortSession = vi.fn(async () => ({ success: true }));
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: "s1",
      capabilities: { stop: abortSession as never },
    });

    await commands.stop();

    expect(abortSession).toHaveBeenCalledWith({ id: "s1" });
    expect(store.readSession("s1").sending).toBe(false);
    expect(store.readSession("s1").stream.phase).not.toBe("streaming");
  });

  it("does nothing when the slice has no stop", async () => {
    const store = createWebuiSessionStore();
    const commands = createWebuiConversationTurnCommands({
      store,
      sessionId: "s1",
      capabilities: {},
    });

    await expect(commands.stop()).resolves.toBeUndefined();
    expect(store.readSession("s1").sending).toBe(false);
  });

  it("does not require a capability slice at all", () => {
    // A host with nothing wired: the commands still exist and still refuse.
    const store = createWebuiSessionStore();
    const commands = createWebuiConversationTurnCommands({ store, sessionId: "s1" });
    expect(() => commands.attach("t-1")).not.toThrow();
  });
});

