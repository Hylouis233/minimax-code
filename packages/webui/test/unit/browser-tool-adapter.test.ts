import { describe, expect, it } from "vitest";

import {
  WebuiBrowserService,
  type WebuiBrowserServiceOptions,
} from "../../src/runtime/browser/browser-service.js";
import { WebuiBrowserOperationError } from "../../src/runtime/browser/errors.js";
import type { WebuiBrowserSurfaceProvider } from "../../src/runtime/browser/isolated-chromium/provider.js";
import {
  createWebuiBrowserToolAdapter,
  type WebuiBrowserToolCommandSurface,
} from "../../src/runtime/browser/tool-adapter.js";
import type { WebuiBrowserAdapter } from "../../src/runtime/browser-provider.js";
import type {
  WebuiBrowserAuthorization,
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
  WebuiBrowserTargetState,
} from "../../src/shared/contracts/browser.js";
import { WEBUI_BROWSER_RESTRICTED_COMMANDS } from "../../src/shared/contracts/browser.js";

/**
 * A provider that records what it was asked to do.
 *
 * The service decides whether a browser may be touched at all and the adapter
 * only translates a tool call, so a provider that records its calls is enough
 * to prove the decisions that matter: which command reached the browser, and
 * which refusals kept the browser untouched.
 */
class RecordingProvider implements WebuiBrowserSurfaceProvider {
  readonly surface = "isolated-chromium" as const;
  readonly browserId = "browser-1";
  readonly commands: { command: string; params: Record<string, unknown> }[] = [];
  /** The tabs this browser has, so two runs can hold different selections. */
  readonly tabIds: readonly string[];
  /** When set, a command is recorded but never answers. */
  neverSettle = false;
  closed = false;

  constructor(tabIds: readonly string[] = ["tab-1"]) {
    this.tabIds = tabIds;
  }

  async sendCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    this.commands.push({ command, params });
    if (this.neverSettle) await new Promise<void>(() => {});
    return { command, params };
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
    _targetId: string,
    _onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void> {}

  async stopImageStream(_targetId: string): Promise<void> {}

  async sendInput(_command: WebuiBrowserInputCommand): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

const ALL_OFF: WebuiBrowserAuthorization = {
  isolatedChromium: false,
  edge: false,
  chrome: false,
  fullCdp: false,
};

const SURFACE_AUTHORIZED: WebuiBrowserAuthorization = {
  ...ALL_OFF,
  isolatedChromium: true,
};

const SELECTED_TARGET: WebuiBrowserTargetId = {
  surface: "isolated-chromium",
  browserId: "browser-1",
  targetId: "tab-1",
  generation: 1,
};

const OTHER_TARGET: WebuiBrowserTargetId = {
  ...SELECTED_TARGET,
  targetId: "tab-2",
};

function createService(authorization: WebuiBrowserAuthorization, tabIds?: readonly string[]): {
  service: WebuiBrowserService;
  provider: RecordingProvider;
} {
  const provider = new RecordingProvider(tabIds);
  const options: WebuiBrowserServiceOptions = {
    authorization: {
      read: async () => authorization,
      write: async (input) => ({ ...authorization, ...input }),
    },
    dataDir: "/tmp/webui-browser-tool-adapter-test",
    createIsolatedProvider: async () => provider,
  };
  return { service: new WebuiBrowserService(options), provider };
}

/**
 * Puts the surface in the state a tool call assumes: authorized, with the
 * target the panel is showing selected.
 *
 * The selection is the run's, not the tool's: an Agent browser-tool call acts
 * on the selected target of *its own run*, so a test that skipped this would be
 * testing the refusal path.
 */
async function selectRunTarget(
  service: WebuiBrowserService,
  runId: string,
  target: WebuiBrowserTargetId = SELECTED_TARGET,
): Promise<void> {
  await service.listTargets("isolated-chromium", runId);
  await service.selectTarget(target, runId);
}

/**
 * The runtime's tool context and action type, read off the adapter contract.
 *
 * Derived from the WebUI's own `WebuiBrowserAdapter` rather than imported from
 * `@mavis/agent-tools`: that package is not this package's dependency, and the
 * adapter contract already *is* the runtime's `LocalBrowserAdapter`.
 */
type WebuiBrowserToolContext = Parameters<WebuiBrowserAdapter["execute"]>[0];
type WebuiBrowserToolAction = Parameters<WebuiBrowserAdapter["execute"]>[1];

/** The tool context: the adapter reads the run off it, and nothing else. */
function toolContextOf(runId: string): WebuiBrowserToolContext {
  return { sessionId: runId } as WebuiBrowserToolContext;
}

const TOOL_CONTEXT = toolContextOf("run-a");

/**
 * A command surface that records instead of driving a browser.
 *
 * Used for the surface rule alone: which surface a tool call lands on is a
 * decision the adapter makes before the service is involved, and asserting it
 * through a real browser would be an expensive way to read one argument.
 */
function recordingCommandSurface(): {
  browser: WebuiBrowserToolCommandSurface;
  calls: {
    surface: WebuiBrowserSurface;
    runId: string;
    command: string;
    params?: Record<string, unknown>;
    signal?: AbortSignal;
  }[];
} {
  const calls: {
    surface: WebuiBrowserSurface;
    runId: string;
    command: string;
    params?: Record<string, unknown>;
    signal?: AbortSignal;
  }[] = [];
  return {
    calls,
    browser: {
      sendCommandToSelection: async (surface, runId, command, params, signal) => {
        calls.push({ surface, runId, command, params, signal });
        return { accepted: true as const, target: SELECTED_TARGET, result: "done" };
      },
    },
  };
}

describe("Agent browser-tool adapter", () => {
  it("declares the restricted command set as its whole capability", () => {
    const { service } = createService(SURFACE_AUTHORIZED);
    const adapter = createWebuiBrowserToolAdapter({ browser: service });
    const capabilities = adapter.getCapabilities?.();
    expect(capabilities?.provider).toBe("webui-browser");
    expect(capabilities?.version).toBe(1);
    // Exactly the restricted set: an action the set does not contain must not
    // be offered to the model, and one it does contain must not be withheld.
    expect([...(capabilities?.actions ?? [])]).toEqual([
      ...WEBUI_BROWSER_RESTRICTED_COMMANDS,
    ]);
    // The person can take over the page these actions drive: it is the page
    // the panel is showing.
    expect(capabilities?.interactiveTakeover).toBe(true);
  });

  it("forwards a restricted action to the browser and returns the result", async () => {
    const { service, provider } = createService(SURFACE_AUTHORIZED);
    await selectRunTarget(service, "run-a");
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    const result = await adapter.execute(
      TOOL_CONTEXT,
      "navigate",
      { url: "https://example.test/page" },
    );

    expect(provider.commands).toEqual([
      { command: "navigate", params: { url: "https://example.test/page" } },
    ]);
    // The provider's own answer, not the service's envelope: the runtime's
    // browser tools read the result at the top level.
    expect(result).toEqual({
      command: "navigate",
      params: { url: "https://example.test/page" },
    });
    await service.close();
  });

  it("refuses an action outside the restricted set, with the browser's own code", async () => {
    // Full CDP is on, so the service would forward a raw DevTools method on the
    // explicit path. The Agent's browser-tool path declares the restricted set
    // as its capability, so it must not widen here — that authorization belongs
    // to the panel's `sendBrowserCommand`.
    const { service, provider } = createService({
      ...SURFACE_AUTHORIZED,
      fullCdp: true,
    });
    await selectRunTarget(service, "run-a");
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    // A caller that reaches past the declared set is modelled as the runtime
    // would never send it: the string reaches `execute` as an action.
    const rawDevToolsMethod = "Page.captureScreenshot" as unknown as WebuiBrowserToolAction;
    const refusal = await adapter
      .execute(TOOL_CONTEXT, rawDevToolsMethod, {})
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    // The refusal keeps the browser's code and its type: a caller that cannot
    // tell "not allowed" from "the browser broke" retries the wrong thing.
    expect(refusal).toBeInstanceOf(WebuiBrowserOperationError);
    expect(refusal).toMatchObject({ code: "browser_capability_denied" });
    expect((refusal as Error).message).toContain(rawDevToolsMethod);
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("refuses a surface that is not authorized before reaching the browser", async () => {
    const { service, provider } = createService({ ...ALL_OFF, fullCdp: true });
    await selectRunTarget(service, "run-a").catch(() => undefined);
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    await expect(
      adapter.execute(TOOL_CONTEXT, "navigate", { url: "https://example.test" }),
    ).rejects.toMatchObject({ code: "browser_surface_not_authorized" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("refuses a surface with no selected target rather than choosing one", async () => {
    const { service, provider } = createService(SURFACE_AUTHORIZED);
    // The surface is authorized and the browser has a tab; nothing is selected.
    await service.listTargets("isolated-chromium");
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    await expect(
      adapter.execute(TOOL_CONTEXT, "navigate", { url: "https://example.test" }),
    ).rejects.toMatchObject({ code: "browser_target_unknown" });
    // Defaulting to the first tab would drive a page nobody chose.
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });

  it("aborts an in-flight command instead of reporting its result", async () => {
    const { service, provider } = createService(SURFACE_AUTHORIZED);
    await selectRunTarget(service, "run-a");
    provider.neverSettle = true;
    const adapter = createWebuiBrowserToolAdapter({ browser: service });
    const controller = new AbortController();

    const call = adapter.execute(
      TOOL_CONTEXT,
      "navigate",
      { url: "https://example.test" },
      controller.signal,
    );
    // The command has reached the browser; the answer has not come back.
    await Promise.resolve();
    controller.abort();

    await expect(call).rejects.toMatchObject({ code: "browser_operation_cancelled" });
    expect(provider.commands).toHaveLength(1);
    await service.close();
  });

  it("acts on the isolated Chromium unless the run is on another surface", async () => {
    const { browser, calls } = recordingCommandSurface();
    const adapter = createWebuiBrowserToolAdapter({ browser });
    await adapter.execute(TOOL_CONTEXT, "reload", {});
    expect(calls).toEqual([
      {
        surface: "isolated-chromium",
        runId: "run-a",
        command: "reload",
        params: {},
        signal: undefined,
      },
    ]);
  });

  it("takes the surface from the tool context when one names it", async () => {
    const { browser, calls } = recordingCommandSurface();
    const adapter = createWebuiBrowserToolAdapter({
      browser,
      defaultSurface: "edge",
      // The tool context carries no surface today, so a caller that knows which
      // surface its run is on supplies it here rather than the adapter guessing.
      resolveSurface: () => "chrome",
    });
    await adapter.execute(TOOL_CONTEXT, "reload", {});
    expect(calls[0]?.surface).toBe("chrome");
  });

  it("names the calling run as the selection the command acts on", async () => {
    // The run is the tool context's session, and the selection belongs to it
    // (ADR 0019): the adapter passing no run would be asking about whichever
    // selection happened to be there.
    const { browser, calls } = recordingCommandSurface();
    const adapter = createWebuiBrowserToolAdapter({ browser });
    await adapter.execute(toolContextOf("run-b"), "reload", {});
    expect(calls[0]?.runId).toBe("run-b");
  });

  it("acts on the calling run's own selected target, not another run's", async () => {
    const { service, provider } = createService(SURFACE_AUTHORIZED, ["tab-1", "tab-2"]);
    // Two runs, one surface, two different pages.
    await selectRunTarget(service, "run-a", SELECTED_TARGET);
    await selectRunTarget(service, "run-b", OTHER_TARGET);
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    const first = await adapter.execute(toolContextOf("run-a"), "reload", {});
    const second = await adapter.execute(toolContextOf("run-b"), "reload", {});

    // Each run drove the page it selected, and neither was moved onto the
    // other's: the command carries the resolved target back, so the run that
    // drove tab-2 could not have driven tab-1.
    expect(first).toEqual({ command: "reload", params: {} });
    expect(second).toEqual({ command: "reload", params: {} });
    expect(await selectedTabOf(service, "run-a")).toBe("tab-1");
    expect(await selectedTabOf(service, "run-b")).toBe("tab-2");
    expect(provider.commands).toHaveLength(2);
    await service.close();
  });

  it("refuses a run that has selected nothing rather than using another's", async () => {
    const { service, provider } = createService(SURFACE_AUTHORIZED, ["tab-1", "tab-2"]);
    await selectRunTarget(service, "run-b", OTHER_TARGET);
    const adapter = createWebuiBrowserToolAdapter({ browser: service });

    // run-a never selected anything. Acting on run-b's page would be two runs
    // sharing one page, which is what the run-scoped selection forbids.
    await expect(
      adapter.execute(toolContextOf("run-a"), "reload", {}),
    ).rejects.toMatchObject({ code: "browser_target_unknown" });
    expect(provider.commands).toHaveLength(0);
    await service.close();
  });
});

/** The tab the named run currently has selected, as the list reports it. */
async function selectedTabOf(
  service: WebuiBrowserService,
  runId: string,
): Promise<string | undefined> {
  const list = await service.listTargets("isolated-chromium", runId);
  return list.targets.find((target) => target.selected)?.id.targetId;
}