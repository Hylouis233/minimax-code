import { describe, expect, it } from "vitest";

import {
  WebuiBrowserService,
  type WebuiBrowserServiceOptions,
} from "../../src/runtime/browser/browser-service.js";
import { WebuiBrowserOperationError } from "../../src/runtime/browser/errors.js";
import type { WebuiBrowserSurfaceProvider } from "../../src/runtime/browser/isolated-chromium/provider.js";
import type {
  WebuiBrowserAuthorization,
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserTargetState,
} from "../../src/shared/contracts/browser.js";

/**
 * A provider that records what it was asked to do.
 *
 * The service is what decides whether a browser may be touched at all; the
 * provider only does what it is told. A fake that records the calls is
 * therefore enough to prove the *decisions*: that a disabled surface is never
 * reached, that a stale target is refused before the provider is asked, and
 * that the input reaches the same provider the panel's frames come from.
 */
class RecordingProvider implements WebuiBrowserSurfaceProvider {
  readonly surface = "isolated-chromium" as const;
  readonly browserId = "browser-1";
  readonly inputs: WebuiBrowserInputCommand[] = [];
  readonly commands: { command: string; params: Record<string, unknown> }[] = [];
  readonly startedStreams: string[] = [];
  readonly stoppedStreams: string[] = [];
  readonly targetChangeListeners = new Set<
    (change: { targetId: string; generation: number }) => void
  >();
  frameHandler: ((frame: WebuiBrowserImageFrame) => void) | undefined;
  closed = false;

  onTargetChanged(
    listener: (change: { targetId: string; generation: number }) => void,
  ): () => void {
    this.targetChangeListeners.add(listener);
    return () => {
      this.targetChangeListeners.delete(listener);
    };
  }

  /** Announces that the page behind the target was replaced. */
  announceTargetChange(generation: number): void {
    for (const listener of this.targetChangeListeners) {
      listener({ targetId: "tab-1", generation });
    }
  }

  async sendCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    this.commands.push({ command, params });
  }

  async listTargets(): Promise<readonly WebuiBrowserTargetState[]> {
    return [
      {
        id: {
          surface: this.surface,
          browserId: this.browserId,
          targetId: "tab-1",
          generation: 1,
        },
        title: "Example",
        url: "https://example.test",
        status: "open",
        selected: true,
      },
    ];
  }

  async startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void> {
    this.startedStreams.push(targetId);
    this.frameHandler = onFrame;
  }

  /**
   * Pushes one frame.
   *
   * The frame is pushed on demand rather than on subscription, so a test can
   * decide *when* it arrives — which is the whole point of the fencing: a
   * frame that arrives after the panel moved on has to be dropped.
   */
  pushFrame(generation: number): void {
    this.frameHandler?.({
      target: {
        surface: this.surface,
        browserId: this.browserId,
        targetId: "tab-1",
        generation,
      },
      data: "AAAA",
      format: "jpeg",
      sequence: 1,
    });
  }

  async stopImageStream(targetId: string): Promise<void> {
    this.stoppedStreams.push(targetId);
  }

  async sendInput(command: WebuiBrowserInputCommand): Promise<void> {
    this.inputs.push(command);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function createService(
  initial: WebuiBrowserAuthorization,
): {
  service: WebuiBrowserService;
  provider: RecordingProvider;
  state: { authorization: WebuiBrowserAuthorization };
} {
  const provider = new RecordingProvider();
  const state = { authorization: initial };
  const options: WebuiBrowserServiceOptions = {
    authorization: {
      read: async () => state.authorization,
      write: async (input) => {
        state.authorization = { ...state.authorization, ...input };
        return state.authorization;
      },
    },
    dataDir: "/tmp/webui-browser-use-test",
    createIsolatedProvider: async () => provider,
  };
  return { service: new WebuiBrowserService(options), provider, state };
}

const ALL_OFF: WebuiBrowserAuthorization = {
  isolatedChromium: false,
  edge: false,
  chrome: false,
  fullCdp: false,
};

describe("browser service", () => {
  it("refuses a surface that is not authorized before touching the provider", async () => {
    const { service, provider } = createService(ALL_OFF);
    await expect(service.listTargets("isolated-chromium")).rejects.toMatchObject({
      code: "browser_surface_not_authorized",
    });
    // The provider was never reached: a refusal that names the switch is
    // different from a browser that failed.
    expect(provider.inputs).toHaveLength(0);
    await service.close();
  });

  it("refuses the input of a surface that is not authorized", async () => {
    const { service, provider } = createService(ALL_OFF);
    await expect(
      service.sendInput({
        kind: "text",
        target: {
          surface: "isolated-chromium",
          browserId: "browser-1",
          targetId: "tab-1",
          generation: 1,
        },
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "browser_surface_not_authorized" });
    expect(provider.inputs).toHaveLength(0);
    await service.close();
  });

  it("lists the targets of an authorized surface", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    const list = await service.listTargets("isolated-chromium");
    expect(list.surface).toBe("isolated-chromium");
    expect(list.targets).toHaveLength(1);
    expect(list.targets[0]?.id.targetId).toBe("tab-1");
    await service.close();
  });

  it("refuses an input aimed at a target whose generation moved on", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    // The registry observed the target at generation 1.
    await expect(
      service.sendInput({
        kind: "text",
        target: {
          surface: "isolated-chromium",
          browserId: "browser-1",
          targetId: "tab-1",
          generation: 7,
        },
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "browser_target_stale" });
    // The input was not delivered to whatever replaced the page.
    expect(provider.inputs).toHaveLength(0);
    await service.close();
  });

  it("delivers an input that names the current generation", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    await service.sendInput({
      kind: "text",
      target: {
        surface: "isolated-chromium",
        browserId: "browser-1",
        targetId: "tab-1",
        generation: 1,
      },
      text: "hello",
    });
    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0]?.kind).toBe("text");
    await service.close();
  });

  it("refuses a malformed input before it reaches the provider", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    await expect(
      service.sendInput({
        kind: "pointer",
        target: {
          surface: "isolated-chromium",
          browserId: "browser-1",
          targetId: "tab-1",
          generation: 1,
        },
        x: Number.NaN,
        y: 10,
        button: "left",
        clickCount: 1,
      }),
    ).rejects.toMatchObject({ code: "browser_command_invalid" });
    expect(provider.inputs).toHaveLength(0);
    await service.close();
  });

  it("stops the provider when its surface is switched off", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    await service.writeAuthorization({ isolatedChromium: false });
    expect(provider.closed).toBe(true);
    await expect(service.listTargets("isolated-chromium")).rejects.toMatchObject({
      code: "browser_surface_not_authorized",
    });
    await service.close();
  });

  it("keeps the four switches independent", async () => {
    const { service, state } = createService(ALL_OFF);
    await service.writeAuthorization({ edge: true });
    expect(state.authorization).toEqual({
      isolatedChromium: false,
      edge: true,
      chrome: false,
      fullCdp: false,
    });
    await service.writeAuthorization({ fullCdp: true });
    expect(state.authorization).toEqual({
      isolatedChromium: false,
      edge: true,
      chrome: false,
      fullCdp: true,
    });
    await service.close();
  });

  it("reports the capability matrix per surface", async () => {
    const { service } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    const { entries } = await service.listCapabilities();
    const isolated = entries.find((entry) => entry.surface === "isolated-chromium");
    const chrome = entries.find((entry) => entry.surface === "chrome");
    expect(isolated?.liveImages).toBe(true);
    expect(isolated?.bridged).toBe(false);
    expect(chrome?.liveImages).toBe(false);
    expect(chrome?.bridged).toBe(true);
    await service.close();
  });

  it("carries the browser error code on the wire", () => {
    const error = new WebuiBrowserOperationError({
      code: "browser_target_stale",
      message: "stale",
      retryable: false,
    });
    expect(error.code).toBe("browser_target_stale");
    expect(error.retryable).toBe(false);
  });

  it("refuses an input recorded against the page a navigation replaced", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    // The provider is the party that knows the page was replaced. When it says
    // so, the registry raises the generation and the input recorded against
    // the previous page stops being current.
    provider.announceTargetChange(2);

    await expect(
      service.sendInput({
        kind: "text",
        target: {
          surface: "isolated-chromium",
          browserId: "browser-1",
          targetId: "tab-1",
          generation: 1,
        },
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "browser_target_stale" });
    expect(provider.inputs).toHaveLength(0);
    await service.close();
  });

  it("delivers an input recorded against the page that is current", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    provider.announceTargetChange(2);
    await service.sendInput({
      kind: "text",
      target: {
        surface: "isolated-chromium",
        browserId: "browser-1",
        targetId: "tab-1",
        generation: 2,
      },
      text: "hello",
    });
    expect(provider.inputs).toHaveLength(1);
    await service.close();
  });

  it("refuses a command outside the restricted set while Full CDP is off", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await expect(
      service.sendCommand("isolated-chromium", "Network.setCookies"),
    ).rejects.toMatchObject({ code: "browser_capability_denied" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("allows a command outside the restricted set once Full CDP is on", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
      fullCdp: true,
    });
    await service.sendCommand("isolated-chromium", "Network.setCookies", {
      name: "a",
    });
    expect(provider.commands).toHaveLength(1);
    expect(provider.commands[0]?.command).toBe("Network.setCookies");
    await service.close();
  });

  it("allows a restricted command whatever the Full CDP switch says", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.sendCommand("isolated-chromium", "reload");
    expect(provider.commands.map((entry) => entry.command)).toEqual(["reload"]);
    await service.close();
  });

  it("refuses a command on a surface that is not authorized", async () => {
    const { service, provider } = createService(ALL_OFF);
    await expect(
      service.sendCommand("isolated-chromium", "reload"),
    ).rejects.toMatchObject({ code: "browser_surface_not_authorized" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("does not let Full CDP authorize a surface", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      fullCdp: true,
    });
    await expect(
      service.sendCommand("isolated-chromium", "reload"),
    ).rejects.toMatchObject({ code: "browser_surface_not_authorized" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  /** Waits until the stream has subscribed, then pushes one frame. */
  async function pushWhenSubscribed(
    provider: RecordingProvider,
    generation: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (provider.frameHandler) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    provider.pushFrame(generation);
  }

  it("shows a frame that names the page the panel is showing", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    await service.selectTarget({
      surface: "isolated-chromium",
      browserId: "browser-1",
      targetId: "tab-1",
      generation: 1,
    });

    const controller = new AbortController();
    const received: WebuiBrowserImageFrame[] = [];
    const stream = service.watchFrames("isolated-chromium", controller.signal);
    const consumer = (async () => {
      for await (const frame of stream) {
        received.push(frame);
        if (received.length >= 1) break;
      }
    })();

    await pushWhenSubscribed(provider, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await consumer.catch(() => undefined);

    expect(received).toHaveLength(1);
    expect(received[0]?.target.generation).toBe(1);
    await service.close();
  });

  it("drops a frame that names a target the panel is no longer showing", async () => {
    const { service, provider } = createService({
      ...ALL_OFF,
      isolatedChromium: true,
    });
    await service.listTargets("isolated-chromium");
    await service.selectTarget({
      surface: "isolated-chromium",
      browserId: "browser-1",
      targetId: "tab-1",
      generation: 1,
    });

    const controller = new AbortController();
    const received: WebuiBrowserImageFrame[] = [];
    const stream = service.watchFrames("isolated-chromium", controller.signal);
    const consumer = (async () => {
      for await (const frame of stream) {
        received.push(frame);
        if (received.length >= 1) break;
      }
    })();

    // The provider announces that the page behind the tab was replaced. A frame
    // that arrives afterwards still names the previous page, and the panel has
    // already moved past it, so it must not reach the screen.
    provider.announceTargetChange(2);
    await pushWhenSubscribed(provider, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await consumer.catch(() => undefined);

    expect(received).toHaveLength(0);
    await service.close();
  });
});
