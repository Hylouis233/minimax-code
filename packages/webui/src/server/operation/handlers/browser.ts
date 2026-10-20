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
import {
  getBrowserAuthorizationOperation,
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
} from "../browser.js";
import type {
  WebuiOperationHandler,
  WebuiOperationRegistryEntry,
} from "../operation-contract.js";

type DedicatedHandler<Descriptor> = WebuiOperationHandler<unknown>;

export function createBrowserHandlerEntries(
  browser: WebuiBrowserPort,
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
    return {
      body: await browser.sendCommand(command.surface, command.command, command.params),
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

  const listBrowserCapabilities: DedicatedHandler<typeof listBrowserCapabilitiesOperation> =
    async () => ({
      body: await browser.listCapabilities(),
    });

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
      listBrowserCapabilitiesOperation.name,
      {
        operation: listBrowserCapabilitiesOperation,
        handle: listBrowserCapabilities as WebuiOperationHandler<unknown>,
      },
    ],
  ]);
}
