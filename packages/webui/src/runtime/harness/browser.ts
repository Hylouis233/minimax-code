// The browser adapter.
//
// The WebUI does not own the browser: the runtime host does, and this adapter
// is the seam between the two. It reads and writes the four authorization
// switches through the host's configuration capability — so the switches
// survive a restart, which is what "the enabled state survives a WebUI
// restart" requires — and it owns the browser service that holds the
// providers.
//
// The adapter is created once per host and handed to the operation registry.
// When the host cannot answer the authorization at all, no adapter is
// returned and the browser operations stay unregistered: an operation that
// exists but cannot be answered is worse than one that is absent, because the
// surface offers a control the host would refuse forever.

import type {
  WebuiBrowserAuthorization,
  WebuiBrowserCapabilityEntry,
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
  WebuiBrowserTargetList,
  WebuiBrowserTargetState,
} from "../../shared/contracts/browser.js";
import {
  WebuiBrowserService,
  type WebuiBrowserServiceOptions,
} from "../browser/browser-service.js";
import type { WebuiBrowserSurfaceProvider } from "../browser/isolated-chromium/provider.js";
import type { WebuiBrowserPort } from "../port.js";
import type { WebuiRuntimeHostHandle } from "./host-contract.js";
import { requireCliService, requireDataDir } from "./requirements.js";

/**
 * The extension bridge the adapter is wired to.
 *
 * Declared structurally rather than imported from
 * `src/server/browser-bridge/server.ts`. The layer matrix classifies
 * `src/runtime/**` as `runtime`, which may reach `shared` and the runtime port
 * but NOT `server/`, and the bridge server lives under `src/server/`. Naming
 * its class here would be a forbidden edge, so the composition root — which
 * sits outside the layer system and is the one place both sides may meet —
 * assembles the bridge and hands it in. Structural typing is what lets the two
 * meet without an import in either direction.
 */
export interface WebuiBrowserBridge {
  /**
   * The provider for a live extension session, or `undefined` when no
   * extension of that kind is connected.
   *
   * The bridge is a server-side object and the runtime may not import it, so
   * the two meet structurally: the composition root hands the bridge in and
   * the adapter reads this member. The member is named after what the bridge
   * exposes, so the two cannot drift apart.
   */
  createProvider(
    surface: "edge" | "chrome",
  ): WebuiBrowserSurfaceProvider | undefined;
  /** Turns a surface's pairing on and mints its credential. */
  enableSurface?(surface: "edge" | "chrome"): Promise<void>;
  /**
   * Turns a surface's pairing off: the credential is revoked, the sessions are
   * closed and the old credential is refused from then on.
   */
  disableSurface?(surface: "edge" | "chrome"): Promise<void>;
}

/**
 * The browser adapter and the handle that releases it.
 *
 * The port and the release travel together because the composition root is
 * the only place that can guarantee the release happens: a browser process
 * that outlived its service would be a browser nobody can switch off.
 */
export interface WebuiBrowserAdapterBinding {
  readonly port: WebuiBrowserPort;
  /**
   * The bridge this adapter was wired to, when one was supplied.
   *
   * Surfaced so a composition root that assembled the bridge reads it back
   * from one place rather than keeping a second reference alongside this one.
   * The bridge's own lifetime belongs to whoever constructed it.
   */
  readonly browserBridge?: WebuiBrowserBridge;
  /**
   * Applies the persisted authorization to the bridge.
   *
   * The composition root calls this once, after the adapter is built and
   * before the service starts serving. Until it runs, the bridge's pairings do
   * not know which switches are on.
   */
  initialize(): Promise<void>;
  /** Releases every provider the browser service started. */
  close(): Promise<void>;
}

/**
 * Builds the browser adapter, or nothing when the host cannot answer it.
 *
 * "Nothing" is the honest answer for a host without the browser
 * configuration: the browser operations then stay unregistered and the
 * handshake reports the browser capability family as absent.
 *
 * The Edge and Chrome surfaces are the person's own browsers, reached through
 * the extension bridge. `bridge` is what makes them resolve: without it the
 * service has no way to reach them, and `createProvider` answering "nothing is
 * paired" is what keeps "you may not use this surface" distinguishable from
 * "the extension is not connected right now".
 */
export function createBrowserAdapter(
  host: WebuiRuntimeHostHandle,
  overrides: Partial<WebuiBrowserServiceOptions> = {},
  bridge?: WebuiBrowserBridge,
): WebuiBrowserAdapterBinding | undefined {
  const cliService = host.cliService;
  if (!cliService) return undefined;
  const { getBrowserAuthorization, setBrowserAuthorization } = cliService;
  if (!getBrowserAuthorization || !setBrowserAuthorization) return undefined;

  const service = new WebuiBrowserService({
    authorization: {
      read: () => getBrowserAuthorization.call(cliService),
      write: (input) => setBrowserAuthorization.call(cliService, input),
    },
    dataDir: host.dataDir ?? requireDataDir(host),
    ...(bridge
      ? {
          // The service asks asynchronously and the bridge answers
          // synchronously; the adapter is where the two meet.
          createBridgeProvider: async (surface: "edge" | "chrome") =>
            bridge.createProvider(surface),
          bridge: {
            enableSurface: bridge.enableSurface?.bind(bridge),
            disableSurface: bridge.disableSurface?.bind(bridge),
          },
        }
      : {}),
    ...overrides,
  });

  return {
    initialize: () => service.initialize(),
    port: {
      getAuthorization: () => service.readAuthorization(),
      setAuthorization: (input) => service.writeAuthorization(input),
      listTargets: (surface: WebuiBrowserSurface) => service.listTargets(surface),
      selectTarget: (target: WebuiBrowserTargetId) => service.selectTarget(target),
      sendInput: (command: WebuiBrowserInputCommand) => service.sendInput(command),
      sendCommand: (
        surface: WebuiBrowserSurface,
        command: string,
        params?: Record<string, unknown>,
      ) => service.sendCommand(surface, command, params ?? {}),
      watchFrames: (surface: WebuiBrowserSurface, signal?: AbortSignal) =>
        service.watchFrames(surface, signal),
      listCapabilities: () => service.listCapabilities(),
    },
    close: () => service.close(),
    ...(bridge ? { browserBridge: bridge } : {}),
  };
}

/**
 * The authorization the host reports, when it reports one.
 *
 * Used by the capability manifest to decide whether the browser family is
 * present at all.
 */
export async function readHostBrowserAuthorization(
  host: WebuiRuntimeHostHandle,
): Promise<WebuiBrowserAuthorization | undefined> {
  const cliService = host.cliService;
  if (!cliService?.getBrowserAuthorization) return undefined;
  return await cliService.getBrowserAuthorization();
}

export type {
  WebuiBrowserAuthorization,
  WebuiBrowserCapabilityEntry,
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserSurface,
  WebuiBrowserTargetId,
  WebuiBrowserTargetList,
  WebuiBrowserTargetState,
};
