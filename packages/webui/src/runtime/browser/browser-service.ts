// The browser service: the one place that owns the browser surfaces.
//
// The service owns three things and keeps them consistent:
//
//   * the **authorization** — the four switches, read from and written to the
//     host's configuration so they survive a restart;
//   * the **providers** — one per surface, started only when the surface is
//     authorized and stopped when it is not;
//   * the **target registry** — the identity and generation of every target,
//     which is what makes a stale reference detectable.
//
// Every browser path — the panel's image stream, the panel's input, the
// Agent's browser tools — goes through this service. That is what keeps the
// panel and the Agent on the same browser session: there is one session, and
// both sides address it here.
//
// A surface that is not authorized is refused before anything is attempted, so
// "you did not switch this on" is distinguishable from "the browser broke".

import {
  isSameWebuiBrowserTarget,
  WEBUI_BROWSER_RESTRICTED_COMMANDS,
  type WebuiBrowserAuthorization,
  type WebuiBrowserCapabilityEntry,
  type WebuiBrowserImageFrame,
  type WebuiBrowserInputCommand,
  type WebuiBrowserSurface,
  type WebuiBrowserTargetId,
  type WebuiBrowserTargetList,
  type WebuiBrowserTargetState,
} from "../../shared/contracts/browser.js";
import {
  browserOperationError,
  WebuiBrowserOperationError,
} from "./errors.js";
import {
  isBrowserCommandAllowed,
  isBrowserSurfaceUsable,
  normalizeBrowserAuthorization,
} from "./authorization.js";
import { validateBrowserInputCommand } from "./input.js";
import { WebuiBrowserTargetRegistry } from "./target-registry.js";
import {
  WebuiIsolatedChromiumProvider,
  type WebuiBrowserSurfaceProvider,
} from "./isolated-chromium/provider.js";

/** How the service reads and writes the authorization. */
export interface WebuiBrowserAuthorizationStore {
  read(): Promise<WebuiBrowserAuthorization>;
  write(
    input: Partial<WebuiBrowserAuthorization>,
  ): Promise<WebuiBrowserAuthorization>;
}

/** What the service needs to start an isolated browser. */
export interface WebuiBrowserServiceOptions {
  readonly authorization: WebuiBrowserAuthorizationStore;
  /** The directory the isolated browser keeps its profile under. */
  readonly dataDir: string;
  /**
   * How the isolated browser is started.
   *
   * Injectable so a test can supply a provider that does not launch a real
   * browser. The default launches Chromium.
   */
  readonly createIsolatedProvider?: (
    options: { readonly dataDir: string; readonly chromePath?: string },
  ) => Promise<WebuiBrowserSurfaceProvider>;
  /**
   * How the external browsers are reached.
   *
   * The Edge and Chrome surfaces are the person's own browsers, reached
   * through the extension bridge. The bridge owns the sessions; this factory
   * is how the service borrows one as a provider, so that the panel and the
   * Agent's tools address the same session the extension is driving.
   *
   * Returning `undefined` means "no browser of that kind is connected right
   * now" — which is different from "that surface is not authorized" and is
   * reported as such.
   */
  readonly createBridgeProvider?: (
    surface: "edge" | "chrome",
  ) => Promise<WebuiBrowserSurfaceProvider | undefined>;
  /** The Chrome executable the isolated browser should use. */
  readonly chromePath?: string;
}

/**
 * The browser service.
 *
 * One instance per host. It is the thing the server's browser operations call.
 */
export class WebuiBrowserService {
  readonly #options: WebuiBrowserServiceOptions;
  readonly #registry = new WebuiBrowserTargetRegistry();
  readonly #providers = new Map<WebuiBrowserSurface, WebuiBrowserSurfaceProvider>();
  /** The target the panel is currently showing, per surface. */
  readonly #selected = new Map<WebuiBrowserSurface, WebuiBrowserTargetId>();
  /** The frame subscribers, per surface. */
  readonly #frameSubscribers = new Map<
    WebuiBrowserSurface,
    Set<(frame: WebuiBrowserImageFrame) => void>
  >();

  constructor(options: WebuiBrowserServiceOptions) {
    this.#options = options;
  }

  /** The current authorization, normalised so a missing key is off. */
  async readAuthorization(): Promise<WebuiBrowserAuthorization> {
    return normalizeBrowserAuthorization(await this.#options.authorization.read());
  }

  /**
   * Writes one switch and applies the consequence.
   *
   * Turning a surface off stops its provider and forgets its targets; turning
   * it on starts the provider so the surface is usable immediately, without a
   * second confirmation and without waiting for the next request to pay for
   * the launch.
   */
  async writeAuthorization(
    input: Partial<WebuiBrowserAuthorization>,
  ): Promise<WebuiBrowserAuthorization> {
    const written = normalizeBrowserAuthorization(
      await this.#options.authorization.write(input),
    );
    await this.#applyAuthorization(written);
    return written;
  }

  async #applyAuthorization(authorization: WebuiBrowserAuthorization): Promise<void> {
    for (const surface of ["isolated-chromium", "edge", "chrome"] as const) {
      const usable = isBrowserSurfaceUsable(authorization, surface);
      const provider = this.#providers.get(surface);
      if (!usable && provider) {
        await this.#stopProvider(surface, provider);
      }
      if (usable && surface === "isolated-chromium" && !provider) {
        // Starting eagerly is what makes "turn it on and it works" true. A
        // failure here is not fatal: the surface stays unauthorized-but-on, and
        // the next list request reports the provider failure with its own code.
        try {
          await this.#ensureProvider(surface);
        } catch {
          // Reported by the call that needs the provider.
        }
      }
    }
  }

  async #ensureProvider(
    surface: WebuiBrowserSurface,
  ): Promise<WebuiBrowserSurfaceProvider | undefined> {
    const existing = this.#providers.get(surface);
    if (existing) return existing;
    if (surface !== "isolated-chromium") {
      // The external surfaces are reached through the bridge, which the server
      // owns. The bridge lends the service a provider for the session that is
      // currently connected; there is none when the extension has not paired.
      //
      // The provider is deliberately NOT cached: the extension's worker may be
      // terminated and restarted, and a cached provider would keep addressing
      // the session that went away.
      if (!this.#options.createBridgeProvider) return undefined;
      return (await this.#options.createBridgeProvider(surface)) ?? undefined;
    }
    const create =
      this.#options.createIsolatedProvider ??
      ((options: { readonly dataDir: string; readonly chromePath?: string }) =>
        WebuiIsolatedChromiumProvider.launch(options));
    const provider = await create({
      dataDir: this.#options.dataDir,
      ...(this.#options.chromePath ? { chromePath: this.#options.chromePath } : {}),
    });
    this.#providers.set(surface, provider);
    // The provider is the only party that knows when the page behind a target
    // is replaced. The registry has to hear about it, or an input recorded
    // against the previous page would still look current and would be
    // delivered to the page that replaced it.
    provider.onTargetChanged?.((change) => {
      const raised = this.#registry.raiseGeneration({
        surface,
        browserId: provider.browserId,
        targetId: change.targetId,
      });
      // The panel follows the *tab*, and a navigation replaces the page behind
      // the tab rather than changing which tab is shown. The selection
      // therefore moves to the new generation: otherwise the panel would show
      // nothing at all after a navigation, and a frame from the previous page
      // would still look current to it.
      const selected = this.#selected.get(surface);
      if (selected && raised && selected.targetId === change.targetId) {
        this.#selected.set(surface, raised.id);
      }
    });
    return provider;
  }

  async #stopProvider(
    surface: WebuiBrowserSurface,
    provider: WebuiBrowserSurfaceProvider,
  ): Promise<void> {
    this.#providers.delete(surface);
    this.#selected.delete(surface);
    this.#frameSubscribers.delete(surface);
    for (const target of this.#registry.list(surface)) {
      this.#registry.close({
        surface,
        browserId: target.id.browserId,
        targetId: target.id.targetId,
      });
    }
    try {
      await provider.close();
    } catch {
      // A provider that fails to close cleanly must not stop the rest of the
      // teardown.
    }
  }

  /**
   * The provider of an external surface, if one is connected right now.
   *
   * Used by the bridge wiring to hand the service a provider for the live
   * extension session.
   */
  async bridgeProvider(
    surface: "edge" | "chrome",
  ): Promise<WebuiBrowserSurfaceProvider | undefined> {
    return await this.#ensureProvider(surface);
  }

  /** Every target of one surface. */
  async listTargets(surface: WebuiBrowserSurface): Promise<WebuiBrowserTargetList> {
    const authorization = await this.readAuthorization();
    if (!isBrowserSurfaceUsable(authorization, surface)) {
      throw browserOperationError(
        "browser_surface_not_authorized",
        `Browser surface "${surface}" is not authorized.`,
      );
    }
    const provider = await this.#ensureProvider(surface);
    if (!provider) {
      throw browserOperationError(
        "browser_provider_unavailable",
        `Browser surface "${surface}" has no connected browser.`,
        true,
      );
    }
    const selected = this.#selected.get(surface);
    const states: WebuiBrowserTargetState[] = [];
    for (const target of await provider.listTargets()) {
      const identity = this.#registry.observe({
        surface: target.id.surface,
        browserId: target.id.browserId,
        targetId: target.id.targetId,
        title: target.title,
        url: target.url,
        status: target.status,
      });
      states.push({
        ...identity,
        selected: selected
          ? isSameWebuiBrowserTarget(selected, identity.id)
          : identity.id.targetId === target.id.targetId,
      });
    }
    return { surface, targets: states };
  }

  /** Selects the target the panel shows for a surface. */
  async selectTarget(target: WebuiBrowserTargetId): Promise<WebuiBrowserTargetState> {
    const authorization = await this.readAuthorization();
    if (!isBrowserSurfaceUsable(authorization, target.surface)) {
      throw browserOperationError(
        "browser_surface_not_authorized",
        `Browser surface "${target.surface}" is not authorized.`,
      );
    }
    const known = this.#registry.resolve(target);
    if (!known) {
      throw browserOperationError(
        "browser_target_unknown",
        "The browser target does not exist.",
      );
    }
    if (!this.#registry.isCurrent(target)) {
      throw browserOperationError(
        "browser_target_stale",
        "The browser target has been replaced; select it again.",
      );
    }
    this.#selected.set(target.surface, target);
    return { ...known, selected: true };
  }

  /**
   * Forwards one validated input command.
   *
   * The command is validated before the target is checked, so a malformed
   * command is reported as malformed even when its target is also wrong: the
   * two are different mistakes and a caller that fixed only one would be sent
   * round again.
   */
  async sendInput(command: WebuiBrowserInputCommand): Promise<{ readonly accepted: true }> {
    const validated = validateBrowserInputCommand(command);
    const authorization = await this.readAuthorization();
    if (!isBrowserSurfaceUsable(authorization, validated.target.surface)) {
      throw browserOperationError(
        "browser_surface_not_authorized",
        `Browser surface "${validated.target.surface}" is not authorized.`,
      );
    }
    if (!this.#registry.isCurrent(validated.target)) {
      throw browserOperationError(
        "browser_target_stale",
        "The browser target has been replaced; the input was not delivered.",
      );
    }
    const provider = await this.#ensureProvider(validated.target.surface);
    if (!provider) {
      throw browserOperationError(
        "browser_provider_unavailable",
        `Browser surface "${validated.target.surface}" has no connected browser.`,
        true,
      );
    }
    await provider.sendInput(validated);
    return { accepted: true };
  }

  /**
   * The live image stream of one surface.
   *
   * The stream is an async iterable so the server frames it the same way it
   * frames the terminal's output: the operation handler drives it and the
   * WebSocket server writes what it yields.
   */
  async *watchFrames(
    surface: WebuiBrowserSurface,
    signal?: AbortSignal,
  ): AsyncIterable<WebuiBrowserImageFrame> {
    const authorization = await this.readAuthorization();
    if (!isBrowserSurfaceUsable(authorization, surface)) {
      throw browserOperationError(
        "browser_surface_not_authorized",
        `Browser surface "${surface}" is not authorized.`,
      );
    }
    const provider = await this.#ensureProvider(surface);
    if (!provider) {
      throw browserOperationError(
        "browser_provider_unavailable",
        `Browser surface "${surface}" has no connected browser.`,
        true,
      );
    }
    const selected = this.#selected.get(surface);
    const targetId = selected?.targetId;
    if (!selected || !targetId) {
      throw browserOperationError(
        "browser_target_unknown",
        "No browser target is selected for this surface.",
      );
    }
    const queue: WebuiBrowserImageFrame[] = [];
    let notify: (() => void) | undefined;
    const deliver = (frame: WebuiBrowserImageFrame) => {
      queue.push(frame);
      notify?.();
    };
    const subscribers = this.#frameSubscribers.get(surface) ?? new Set();
    subscribers.add(deliver);
    this.#frameSubscribers.set(surface, subscribers);

    await provider.startImageStream(targetId, deliver);
    try {
      while (!signal?.aborted) {
        while (queue.length > 0) {
          const frame = queue.shift();
          if (!frame) continue;
          // A frame belongs to the panel only while it names the page the
          // panel is showing. A frame that arrives after the selection moved,
          // or after the page behind the target was replaced, would put a
          // different page on screen than the one the person chose.
          if (!this.#frameMatchesSelection(surface, frame)) continue;
          yield frame;
        }
        await Promise.race([
          new Promise<void>((resolve) => {
            notify = resolve;
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ]);
        notify = undefined;
      }
    } finally {
      subscribers.delete(deliver);
      // Cancelling the stream releases the provider-side resources it held:
      // the screencast is stopped, not merely ignored.
      await provider.stopImageStream(targetId).catch(() => undefined);
    }
  }

  /**
   * Whether a frame still describes the page the panel is showing.
   *
   * The comparison is against the *current* selection, not the one the stream
   * started with: the person can select another tab while the stream is
   * running, and a frame from the tab they left must not appear.
   */
  #frameMatchesSelection(
    surface: WebuiBrowserSurface,
    frame: WebuiBrowserImageFrame,
  ): boolean {
    const selected = this.#selected.get(surface);
    if (!selected) return false;
    return (
      selected.surface === frame.target.surface &&
      selected.browserId === frame.target.browserId &&
      selected.targetId === frame.target.targetId &&
      selected.generation === frame.target.generation
    );
  }

  /**
   * Runs one browser command.
   *
   * The gate is the whole point of this method: the surface must be
   * authorized, and the command must be either a restricted browser-tool
   * action or permitted by the Full CDP switch. A command that is neither is
   * refused with `browser_capability_denied` — it is never forwarded on the
   * chance that the provider would accept it.
   */
  async sendCommand(
    surface: WebuiBrowserSurface,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<{ readonly accepted: true; readonly result?: unknown }> {
    const authorization = await this.readAuthorization();
    if (!isBrowserSurfaceUsable(authorization, surface)) {
      throw browserOperationError(
        "browser_surface_not_authorized",
        `Browser surface "${surface}" is not authorized.`,
      );
    }
    if (!isBrowserCommandAllowed(authorization, command, WEBUI_BROWSER_RESTRICTED_COMMANDS)) {
      throw browserOperationError(
        "browser_capability_denied",
        `The command "${command}" needs Full CDP access, which is not authorized.`,
      );
    }
    const provider = await this.#ensureProvider(surface);
    if (!provider) {
      throw browserOperationError(
        "browser_provider_unavailable",
        `Browser surface "${surface}" has no connected browser.`,
        true,
      );
    }
    const result = await provider.sendCommand(command, params);
    return { accepted: true, result };
  }

  /** The capability matrix, as the surface can offer it right now. */
  async listCapabilities(): Promise<{
    readonly entries: readonly WebuiBrowserCapabilityEntry[];
  }> {
    const authorization = await this.readAuthorization();
    const entries: WebuiBrowserCapabilityEntry[] = [
      {
        surface: "isolated-chromium",
        bridged: false,
        liveImages: authorization.isolatedChromium,
        input: authorization.isolatedChromium,
        agentTools: authorization.isolatedChromium,
        fullCdpApplies: true,
      },
      {
        surface: "edge",
        bridged: true,
        liveImages: authorization.edge,
        input: authorization.edge,
        agentTools: authorization.edge,
        fullCdpApplies: true,
      },
      {
        surface: "chrome",
        bridged: true,
        liveImages: authorization.chrome,
        input: authorization.chrome,
        agentTools: authorization.chrome,
        fullCdpApplies: true,
      },
    ];
    return { entries };
  }

  /** Releases every provider this service started. */
  async close(): Promise<void> {
    for (const [surface, provider] of [...this.#providers]) {
      await this.#stopProvider(surface, provider);
    }
  }
}

/**
 * Reads the browser error a failed operation reports.
 *
 * The server's error envelope carries a code; a browser failure that reached
 * the envelope as a generic error would lose the distinction between "the
 * surface is off" and "the target moved on".
 */
export function browserErrorCode(error: unknown): string | undefined {
  return error instanceof WebuiBrowserOperationError ? error.code : undefined;
}
