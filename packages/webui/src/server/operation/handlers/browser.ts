// Dedicated handlers: the browser operations.
//
// The browser operations cannot be plain bindings: they drive a real second
// surface — the browser — rather than a harness port method, and one of them
// is a stream. The adapter is only supplied by the service, and when it is
// absent these operations stay unregistered (see `operations.ts`) rather than
// becoming registered operations that fail with a missing-capability error.
//
// A browser failure keeps its own code. The service's error envelope carries a
// code, and a browser failure that reached the envelope as a generic error
// would lose the distinction between "the surface is switched off" and "the
// target moved on" — two failures that need opposite responses from the
// person using the panel.

import type { WebuiBrowserPort } from "../../../runtime/port.js";
import type { WebuiBridgeBrowserSurface } from "../../../shared/contracts/browser.js";
import type { WebuiBrowserBridgeInstallationKeyView } from "../../../shared/contracts/browser-bridge.js";
import {
  getBrowserAuthorizationOperation,
  getBrowserInstallationKeyOperation,
  listBrowserCapabilitiesOperation,
  listBrowserTargetsOperation,
  readBrowserCommand,
  readBrowserInputCommand,
  readBrowserRunId,
  readBrowserSurface,
  readBrowserTarget,
  selectBrowserTargetOperation,
  sendBrowserCommandOperation,
  sendBrowserInputOperation,
  setBrowserAuthorizationOperation,
  watchBrowserFramesOperation,
  watchBrowserWebTabsOperation,
} from "../browser.js";
import type {
  WebuiOperationHandler,
  WebuiOperationRegistryEntry,
} from "../operation-contract.js";

type DedicatedHandler<Descriptor> = WebuiOperationHandler<unknown>;

/**
 * Reads one surface's installation key out of the bridge.
 *
 * A narrow structural interface rather than a `BrowserBridgeServer` type, for
 * two reasons: the handler layer must not depend on the bridge's WebSocket
 * server to answer a question about a stored secret, and a structural seam
 * keeps the composition root free to pass whatever object actually owns the
 * pairing.
 */
export interface WebuiBrowserBridgeInstallationKeySource {
  readInstallationKey(
    surface: WebuiBridgeBrowserSurface,
  ): Promise<WebuiBrowserBridgeInstallationKeyView | undefined>;
}

export function createBrowserHandlerEntries(
  browser: WebuiBrowserPort,
  installationKeys?: WebuiBrowserBridgeInstallationKeySource,
): ReadonlyMap<string, WebuiOperationRegistryEntry> {
  const getBrowserAuthorization: DedicatedHandler<typeof getBrowserAuthorizationOperation> =
    async () => ({
      body: await browser.getAuthorization(),
    });

  const setBrowserAuthorization: DedicatedHandler<typeof setBrowserAuthorizationOperation> =
    async (_context, body) => ({
      body: await browser.setAuthorization(
        body as Partial<{
          isolatedChromium: boolean;
          edge: boolean;
          chrome: boolean;
          fullCdp: boolean;
        }>,
      ),
    });

  const listBrowserTargets: DedicatedHandler<typeof listBrowserTargetsOperation> = async (
    _context,
    body,
  ) => ({
    body: await browser.listTargets(
      readBrowserSurface(body as Record<string, unknown>),
      readBrowserRunId(body as Record<string, unknown>),
    ),
  });

  const selectBrowserTarget: DedicatedHandler<typeof selectBrowserTargetOperation> = async (
    _context,
    body,
  ) => ({
    body: await browser.selectTarget(
      readBrowserTarget(body as Record<string, unknown>),
      readBrowserRunId(body as Record<string, unknown>),
    ),
  });

  const sendBrowserInput: DedicatedHandler<typeof sendBrowserInputOperation> = async (
    _context,
    body,
  ) => ({
    body: await browser.sendInput(
      readBrowserInputCommand(body as Record<string, unknown>),
      readBrowserRunId(body as Record<string, unknown>),
    ),
  });

  const sendBrowserCommand: DedicatedHandler<typeof sendBrowserCommandOperation> = async (
    _context,
    body,
  ) => {
    const command = readBrowserCommand(body as Record<string, unknown>);
    // A command that names a run acts on that run's page. One that does not
    // acts on the no-run selection — the one the panel makes when no Agent run
    // is active.
    return {
      body: command.runId
        ? await browser.sendCommandToSelection(
            command.surface,
            command.runId,
            command.command,
            command.params,
          )
        : await browser.sendCommand(command.surface, command.command, command.params),
    };
  };

  const watchBrowserFrames: DedicatedHandler<typeof watchBrowserFramesOperation> = (
    context,
    body,
  ) => ({
    stream: {
      ok: true,
      // The stream envelope is typed over the message and event streams; a
      // browser frame is a third kind of payload with the same envelope. The
      // cast is the same one the terminal watcher makes.
      source: browser.watchFrames(
        readBrowserSurface(body as Record<string, unknown>),
        readBrowserRunId(body as Record<string, unknown>),
        context.signal,
      ) as unknown as AsyncIterable<Record<string, unknown>>,
    },
  });

  const watchBrowserWebTabs: DedicatedHandler<typeof watchBrowserWebTabsOperation> = (
    context,
    body,
  ) => ({
    stream: {
      ok: true,
      // The same envelope as the frame stream: a snapshot is a third kind of
      // payload with the same shape.
      source: browser.watchWebTabs(
        readBrowserSurface(body as Record<string, unknown>),
        readBrowserRunId(body as Record<string, unknown>),
        context.signal,
      ) as unknown as AsyncIterable<Record<string, unknown>>,
    },
  });

  const listBrowserCapabilities: DedicatedHandler<typeof listBrowserCapabilitiesOperation> =
    async () => ({
      body: await browser.listCapabilities(),
    });

  /**
   * Hands the person their surface's installation key so they can paste it
   * into the extension.
   *
   * The one place the key leaves the OS secure store, so it answers only for a
   * surface that was actually provisioned and says `not_provisioned` otherwise —
   * an empty string here would be something the person could paste and be
   * refused for. When no bridge is wired at all the operation refuses rather
   * than reporting a key nobody can use.
   */
  const getBrowserInstallationKey: DedicatedHandler<typeof getBrowserInstallationKeyOperation> =
    async (_context, body) => {
      const surface = readBrowserSurface(body as Record<string, unknown>) as WebuiBridgeBrowserSurface;
      const view = await installationKeys?.readInstallationKey(surface);
      return {
        body: view
          ? {
              present: true as const,
              surface: view.surface,
              keyId: view.keyId,
              key: view.key,
              fingerprint: view.fingerprint,
            }
          : {
              present: false as const,
              surface,
              reason: "not_provisioned" as const,
            },
      };
    };

  return new Map([
    [
      getBrowserAuthorizationOperation.name,
      {
        operation: getBrowserAuthorizationOperation,
        handle: getBrowserAuthorization as WebuiOperationHandler<unknown>,
      },
    ],
    [
      setBrowserAuthorizationOperation.name,
      {
        operation: setBrowserAuthorizationOperation,
        handle: setBrowserAuthorization as WebuiOperationHandler<unknown>,
      },
    ],
    [
      listBrowserTargetsOperation.name,
      {
        operation: listBrowserTargetsOperation,
        handle: listBrowserTargets as WebuiOperationHandler<unknown>,
      },
    ],
    [
      selectBrowserTargetOperation.name,
      {
        operation: selectBrowserTargetOperation,
        handle: selectBrowserTarget as WebuiOperationHandler<unknown>,
      },
    ],
    [
      sendBrowserInputOperation.name,
      {
        operation: sendBrowserInputOperation,
        handle: sendBrowserInput as WebuiOperationHandler<unknown>,
      },
    ],
    [
      sendBrowserCommandOperation.name,
      {
        operation: sendBrowserCommandOperation,
        handle: sendBrowserCommand as WebuiOperationHandler<unknown>,
      },
    ],
    [
      watchBrowserFramesOperation.name,
      {
        operation: watchBrowserFramesOperation,
        handle: watchBrowserFrames as WebuiOperationHandler<unknown>,
      },
    ],
    [
      watchBrowserWebTabsOperation.name,
      {
        operation: watchBrowserWebTabsOperation,
        handle: watchBrowserWebTabs as WebuiOperationHandler<unknown>,
      },
    ],
    [
      listBrowserCapabilitiesOperation.name,
      {
        operation: listBrowserCapabilitiesOperation,
        handle: listBrowserCapabilities as WebuiOperationHandler<unknown>,
      },
    ],
    [
      getBrowserInstallationKeyOperation.name,
      {
        operation: getBrowserInstallationKeyOperation,
        handle: getBrowserInstallationKey as WebuiOperationHandler<unknown>,
      },
    ],
  ]);
}
