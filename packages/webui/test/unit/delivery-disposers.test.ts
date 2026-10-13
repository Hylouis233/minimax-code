// The delivery disposers (plan §4.3; T04's `delivery-disposer-registry`).
//
// Two halves, and the split is the point of the ticket. The registry's own rules
// are driven directly; the wiring is driven through the conversation commands and
// the application's public disposal, so what is asserted is that an attempt this
// client started is closable by the application — and that closing it is a
// *detach*, never a host abort.

import { describe, expect, it, vi } from "vitest";

import { createWebuiDeliveryDisposers } from "../../src/client/application/turn/delivery-disposers.js";
import { createWebuiConversationTurnCommands } from "../../src/client/application/turn/turn-commands.js";
import { createWebuiApplication } from "../../src/client/application/create-application.js";
import type { WebuiClientSessionResumer } from "../../src/client/contracts/turn/execution-port.js";

function handle() {
  const closed = vi.fn();
  return { closed, handle: { close: closed } };
}

describe("the delivery disposers", () => {
  it("tracks each attempt against its session and releases only its own", () => {
    const disposers = createWebuiDeliveryDisposers();
    const first = handle();
    const second = handle();

    const releaseFirst = disposers.track("s1", first.handle);
    disposers.track("s1", second.handle);
    expect(disposers.count("s1")).toBe(2);
    expect(disposers.count()).toBe(2);

    releaseFirst();
    expect(disposers.count("s1")).toBe(1);
    // Releasing twice is harmless: a loop's cleanup can race its own terminal.
    releaseFirst();
    expect(disposers.count("s1")).toBe(1);
    expect(first.closed).not.toHaveBeenCalled();
    expect(second.closed).not.toHaveBeenCalled();
  });

  it("closes one session's deliveries without touching another's", () => {
    const disposers = createWebuiDeliveryDisposers();
    const a = handle();
    const b = handle();
    disposers.track("s1", a.handle);
    disposers.track("s2", b.handle);

    disposers.closeSession("s1");

    expect(a.closed).toHaveBeenCalledTimes(1);
    expect(b.closed).not.toHaveBeenCalled();
    expect(disposers.count("s1")).toBe(0);
  });

  it("closes everything on disposal and accepts nothing afterwards", () => {
    const disposers = createWebuiDeliveryDisposers();
    const a = handle();
    const b = handle();
    disposers.track("s1", a.handle);
    disposers.track("s2", b.handle);

    disposers.closeAll();

    expect(a.closed).toHaveBeenCalledTimes(1);
    expect(b.closed).toHaveBeenCalledTimes(1);
    expect(disposers.count()).toBe(0);
    expect(disposers.isDisposed()).toBe(true);
    const late = handle();
    disposers.track("s3", late.handle);
    expect(disposers.count()).toBe(0);
  });

  it("closes the rest when one delivery refuses to close", () => {
    // Disposal has to finish: one stubborn socket cannot strand the others.
    const disposers = createWebuiDeliveryDisposers();
    const broken = {
      close: () => {
        throw new Error("socket already gone");
      },
    };
    const good = handle();
    disposers.track("s1", broken);
    disposers.track("s1", good.handle);

    expect(() => disposers.closeSession("s1")).not.toThrow();
    expect(good.closed).toHaveBeenCalledTimes(1);
  });
});

describe("an attempt the client started is closable by the application", () => {
  it("registers the attempt's handle and closes it on disposal, without aborting the turn", async () => {
    const app = createWebuiApplication({
      openEventChannel: () => ({ subscribe: () => () => undefined, close: () => undefined }),
      turns: { resumeSession: (async () => undefined) as unknown as WebuiClientSessionResumer },
    });
    app.start({ initialSessionId: "s1" });

    const closed = vi.fn();
    const abort = vi.fn(async () => ({ success: true }));
    // A transport that opens a delivery and hands up its disposer, exactly as
    // `infrastructure/transport.ts` does.
    const send = vi.fn(
      async (
        _body: unknown,
        _onFrame: unknown,
        onDelivery?: (handle: { close: () => void }) => void,
      ) => {
        onDelivery?.({ close: closed });
        return new Promise<never>(() => undefined);
      },
    );
    const commands = createWebuiConversationTurnCommands({
      store: app.store,
      sessionId: "s1",
      capabilities: { send: send as never, stop: abort as never },
      deliveries: app.deliveries,
    });

    void commands.send({
      message: "hello",
      sending: false,
      callbacks: { onDraftChange: () => undefined },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.deliveries.count("s1")).toBe(1);

    app.dispose();

    // The client stopped observing…
    expect(closed).toHaveBeenCalledTimes(1);
    expect(app.deliveries.count()).toBe(0);
    // …and the host turn was never cancelled: disposal is not a stop.
    expect(abort).not.toHaveBeenCalled();
  });
});
