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
  WebuiBrowserTargetId,
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
 *
 * Tabs and frame handlers are keyed per target rather than held singly, because
 * two runs on one surface may be watching two different tabs at the same time —
 * the case the run-scoped selection exists for.
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
  /** The tabs this browser has, in listing order. */
  readonly tabIds: readonly string[];
  /** One frame handler per open stream, keyed by the tab it watches. */
  readonly frameHandlers = new Map<string, (frame: WebuiBrowserImageFrame) => void>();
  /** The most recently opened stream's handler. */
  frameHandler: ((frame: WebuiBrowserImageFrame) => void) | undefined;
  closed = false;

  constructor(tabIds: readonly string[] = ["tab-1"]) {
    this.tabIds = tabIds;
  }

  onTargetChanged(
    listener: (change: { targetId: string; generation: number }) => void,
  ): () => void {
    this.targetChangeListeners.add(listener);
    return () => {
      this.targetChangeListeners.delete(listener);
    };
  }

  /** Announces that the page behind the target was replaced. */
  announceTargetChange(generation: number, targetId = "tab-1"): void {
    for (const listener of this.targetChangeListeners) {
      listener({ targetId, generation });
    }
  }

  async sendCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    this.commands.push({ command, params });
  }

  async listTargets(): Promise<readonly WebuiBrowserTargetState[]> {
    return this.tabIds.map((targetId) => ({
      id: {
        surface: this.surface,
        browserId: this.browserId,
        targetId,
        generation: 1,
      },
      title: "Example",
      url: "https://example.test",
      status: "open" as const,
      selected: true,
    }));
  }

  async startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void> {
    this.startedStreams.push(targetId);
    this.frameHandlers.set(targetId, onFrame);
    this.frameHandler = onFrame;
  }

  /**
   * Pushes one frame down one tab's stream.
   *
   * The frame is pushed on demand rather than on subscription, so a test can
   * decide *when* it arrives — which is the whole point of the fencing: a
   * frame that arrives after the panel moved on has to be dropped, and a frame
   * that belongs to another run's tab must be dropped too.
   */
  pushFrame(generation: number, targetId = "tab-1"): void {
    this.frameHandlers.get(targetId)?.({
      target: {
        surface: this.surface,
        browserId: this.browserId,
        targetId,
        generation,
      },
      data: "AAAA",
      format: "jpeg",
      sequence: 1,
    });
  }

  async stopImageStream(targetId: string): Promise<void> {
    this.stoppedStreams.push(targetId);
    this.frameHandlers.delete(targetId);
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
  tabIds: readonly string[] = ["tab-1"],
): {
  service: WebuiBrowserService;
  provider: RecordingProvider;
  state: { authorization: WebuiBrowserAuthorization };
} {
  const provider = new RecordingProvider(tabIds);
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

/** A tab identity at the generation the fake provider lists it under. */
function tab(targetId: string, generation = 1): WebuiBrowserTargetId {
  return {
    surface: "isolated-chromium",
    browserId: "browser-1",
    targetId,
    generation,
  };
}

/** The target the named run currently has selected, as the list reports it. */
async function selectedTargetOf(
  service: WebuiBrowserService,
  runId?: string,
): Promise<string | undefined> {
  const list = await service.listTargets("isolated-chromium", runId);
  return list.targets.find((target) => target.selected)?.id.targetId;
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
    await service.selectTarget(tab("tab-1"), "run-panel");

    const controller = new AbortController();
    const received: WebuiBrowserImageFrame[] = [];
    const stream = service.watchFrames("isolated-chromium", "run-panel", controller.signal);
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
    await service.selectTarget(tab("tab-1"), "run-panel");

    const controller = new AbortController();
    const received: WebuiBrowserImageFrame[] = [];
    const stream = service.watchFrames("isolated-chromium", "run-panel", controller.signal);
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

/**
 * The selection belongs to the run that made it (ADR 0019), so these are the
 * decisions two concurrent runs force on the service: neither may overwrite the
 * other's selection, each stream must carry only its own run's target, and the
 * panel with no run behind it must still have somewhere to put its own.
 */
describe("run-scoped selection", () => {
  const TWO_TABS: WebuiBrowserAuthorization = {
    ...ALL_OFF,
    isolatedChromium: true,
  };

  it("keeps two runs' selections apart on one surface", async () => {
    const { service } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    await service.listTargets("isolated-chromium", "run-b");

    await service.selectTarget(tab("tab-1"), "run-a");
    await service.selectTarget(tab("tab-2"), "run-b");

    // Neither write cleared the other: the second selection did not become the
    // surface's one true selection.
    expect(await selectedTargetOf(service, "run-a")).toBe("tab-1");
    expect(await selectedTargetOf(service, "run-b")).toBe("tab-2");
    await service.close();
  });

  it("reports one run's selected flag to that run only", async () => {
    const { service } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    await service.selectTarget(tab("tab-2"), "run-a");

    // The panel asks as the run it is following, so the flag it reads is that
    // run's selection and not the other run's.
    expect(await selectedTargetOf(service, "run-a")).toBe("tab-2");
    expect(await selectedTargetOf(service, "run-b")).toBeUndefined();
    await service.close();
  });

  it("keeps the no-run selection separate from every run's", async () => {
    const { service } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium");
    await service.selectTarget(tab("tab-1"));

    // The person pointing at a page before any run exists owns that selection.
    expect(await selectedTargetOf(service)).toBe("tab-1");
    expect(await selectedTargetOf(service, "run-a")).toBeUndefined();

    await service.selectTarget(tab("tab-2"), "run-a");
    // A run's selection does not disturb the panel's own, and the other way
    // round: they are different runs' selections, not two writers of one.
    expect(await selectedTargetOf(service, "run-a")).toBe("tab-2");
    expect(await selectedTargetOf(service)).toBe("tab-1");
    await service.close();
  });

  it("refuses a run's command when that run has selected nothing", async () => {
    const { service, provider } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    // Another run's selection is not this run's to act on.
    await service.selectTarget(tab("tab-1"), "run-b");

    await expect(
      service.sendCommandToSelection("isolated-chromium", "run-a", "reload"),
    ).rejects.toMatchObject({ code: "browser_target_unknown" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("gives each run's stream only that run's target's frames", async () => {
    const { service, provider } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    await service.listTargets("isolated-chromium", "run-b");
    await service.selectTarget(tab("tab-1"), "run-a");
    await service.selectTarget(tab("tab-2"), "run-b");

    const first = collectFrames(service, "run-a");
    const second = collectFrames(service, "run-b");
    await waitForStreams(provider, 2);

    provider.pushFrame(1, "tab-1");
    provider.pushFrame(1, "tab-2");
    await settleFrames();

    expect(first.frames.map((frame) => frame.target.targetId)).toEqual(["tab-1"]);
    expect(second.frames.map((frame) => frame.target.targetId)).toEqual(["tab-2"]);
    await stop(service, [first, second]);
  });

  it("drops a frame that belongs to another run's target", async () => {
    const { service, provider } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    await service.listTargets("isolated-chromium", "run-b");
    await service.selectTarget(tab("tab-1"), "run-a");
    await service.selectTarget(tab("tab-2"), "run-b");

    const first = collectFrames(service, "run-a");
    const second = collectFrames(service, "run-b");
    await waitForStreams(provider, 2);

    // The provider hands run A's stream a frame of run B's tab. Keeping the
    // streams apart is the service's job, not the provider's, so the fence is
    // against this run's own selection and the foreign frame is dropped.
    provider.frameHandlers.get("tab-1")?.({
      target: {
        surface: "isolated-chromium",
        browserId: "browser-1",
        targetId: "tab-2",
        generation: 1,
      },
      data: "QlRSQVk=",
      format: "jpeg",
      sequence: 1,
    });
    await settleFrames();

    expect(first.frames).toHaveLength(0);
    expect(second.frames).toHaveLength(0);
    await stop(service, [first, second]);
  });

  it("moves every run's selection with the tab its page navigated", async () => {
    const { service, provider } = createService(TWO_TABS, ["tab-1", "tab-2"]);
    await service.listTargets("isolated-chromium", "run-a");
    await service.listTargets("isolated-chromium", "run-b");
    await service.selectTarget(tab("tab-1"), "run-a");
    await service.selectTarget(tab("tab-2"), "run-b");

    // The tab run A is on navigated, and so did the tab run B is on. Each run's
    // selection follows *its own* tab to the new generation — otherwise run A's
    // tools would refuse its own page as stale, and its stream would drop every
    // frame of it.
    provider.announceTargetChange(2);
    provider.announceTargetChange(2, "tab-2");

    const forA = await service.listTargets("isolated-chromium", "run-a");
    expect(forA.targets.find((target) => target.selected)?.id).toEqual(
      tab("tab-1", 2),
    );
    const forB = await service.listTargets("isolated-chromium", "run-b");
    expect(forB.targets.find((target) => target.selected)?.id).toEqual(
      tab("tab-2", 2),
    );
    await service.close();
  });
});

/** One open stream, plus what it has delivered so far. */
interface OpenStream {
  readonly controller: AbortController;
  readonly frames: WebuiBrowserImageFrame[];
}

/** Starts one run's stream and drains it in the background. */
function collectFrames(service: WebuiBrowserService, runId: string): OpenStream {
  const controller = new AbortController();
  const stream: OpenStream = { controller, frames: [] };
  void (async () => {
    for await (const frame of service.watchFrames(
      "isolated-chromium",
      runId,
      controller.signal,
    )) {
      stream.frames.push(frame);
      if (stream.frames.length >= 1) break;
    }
  })().catch(() => undefined);
  return stream;
}

async function waitForStreams(
  provider: RecordingProvider,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (provider.startedStreams.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Gives the streams long enough to have yielded what was pushed. */
async function settleFrames(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function stop(
  service: WebuiBrowserService,
  streams: readonly OpenStream[],
): Promise<void> {
  for (const stream of streams) stream.controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await service.close();
}
