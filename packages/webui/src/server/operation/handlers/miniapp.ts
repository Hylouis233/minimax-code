// Dedicated handlers: the Mini App surface.
//
// None of the three can be a plain binding. `openMiniApp` shapes its response —
// the client is handed the loopback proxy's URL, never the Mini App's own origin
// or the credential its guard demands — and `stopMiniApp` owns the other half of
// that proxy's lifetime. `listMiniApps` keeps their company rather than becoming a
// lone binding because the three answer one capability: a host either has Mini
// Apps or it has none, and the refusal has to be the same message whichever of the
// three is asked first.
//
// One listener per plugin, held in this closure. The proxy's port is derived from
// the plugin id, so a second listener for the same plugin would either fail to
// bind or serve the page from a second origin and silently discard the page's own
// storage. `open` therefore replaces the listener it finds, and `stop` closes it.
import { WebuiCapabilityUnavailableError } from "../../../shared/envelope.js";
import { MINIAPP_CAPABILITY_ABSENT } from "../../../runtime/port.js";
import type { WebuiOperationPort } from "../bind-handlers.js";
import {
  listMiniAppsOperation,
  openMiniAppOperation,
  stopMiniAppOperation,
} from "../miniapp.js";
import {
  startMiniAppProxy,
  type MiniAppProxy,
  type MiniAppProxyTarget,
} from "../../miniapp/proxy.js";
import type {
  WebuiOperationContext,
  WebuiOperationHandler,
  WebuiOperationRegistryEntry,
  WebuiOperationValidation,
} from "../operation-contract.js";

type BodyOf<Descriptor> = Descriptor extends {
  readonly validate: (body: unknown) => WebuiOperationValidation<infer Body>;
}
  ? Body
  : never;

type DedicatedHandler<Descriptor> = WebuiOperationHandler<BodyOf<Descriptor>, unknown>;

/** The capability as one object, or the refusal that replaces it. */
interface MiniAppCapability {
  readonly list: NonNullable<WebuiOperationPort["listMiniApps"]>;
  readonly open: NonNullable<WebuiOperationPort["openMiniApp"]>;
  readonly stop: NonNullable<WebuiOperationPort["stopMiniApp"]>;
}

/**
 * The capability, or `capability_unavailable`.
 *
 * A host composed without the Mini App cell has no member here at all. Answering
 * that with an empty catalogue would tell the person the feature exists and has
 * nothing in it, which is the one answer that leads nowhere; the refusal names the
 * missing capability and carries the code a client can branch on.
 *
 * A member that is present but not callable counts as absent, because the three
 * are one capability: the runtime's facade composes all of them from the same
 * application cell, so a port with two of them is broken rather than partial, and
 * "this host cannot answer" is the honest thing to say about it.
 */
function requireMiniApps(port: WebuiOperationPort): MiniAppCapability {
  const { listMiniApps, openMiniApp, stopMiniApp } = port;
  if (
    typeof listMiniApps !== "function" ||
    typeof openMiniApp !== "function" ||
    typeof stopMiniApp !== "function"
  )
    throw new WebuiCapabilityUnavailableError(MINIAPP_CAPABILITY_ABSENT);
  // The port members are called with the port as receiver, exactly as
  // `executeBinding` does: a capability that reads `this` must see the object it
  // was taken from, not this wrapper.
  return { list: listMiniApps, open: openMiniApp, stop: stopMiniApp };
}

export interface MiniAppHandlerOptions {
  /**
   * Starts one plugin's loopback listener. Defaults to the real proxy.
   *
   * A test substitutes a wrapper over the real one to observe which target a
   * launch produced and whether the previous listener was closed, without owning
   * the port a plugin's URL is derived from.
   */
  readonly startProxy?: typeof startMiniAppProxy;
}

export function createMiniAppHandlerEntries(
  port: WebuiOperationPort,
  options: MiniAppHandlerOptions = {},
): ReadonlyMap<string, WebuiOperationRegistryEntry> {
  const startProxy = options.startProxy ?? startMiniAppProxy;
  /** The live listener per plugin. */
  const proxies = new Map<string, MiniAppProxy>();
  /**
   * The last call per plugin, so two calls cannot interleave.
   *
   * Run concurrently, a second `open` would find the derived port still bound by
   * the first and fail to bind — and a failed open stops the runtime, so the race
   * would shut down the app the first call had just started. Serialised per plugin
   * (not globally: two different Mini Apps have no reason to wait for each other)
   * the second call sees the first one's listener and replaces it.
   */
  const inFlight = new Map<string, Promise<void>>();

  function serialised<T>(pluginId: string, work: () => Promise<T>): Promise<T> {
    const tail = inFlight.get(pluginId) ?? Promise.resolve();
    const run = tail.then(work, work);
    // The tail must settle without rejecting: the next caller awaits it, and this
    // call's own failure already has a receiver.
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    inFlight.set(pluginId, settled);
    void settled.then(() => {
      if (inFlight.get(pluginId) === settled) inFlight.delete(pluginId);
    });
    return run;
  }

  /** Replaces the plugin's listener, closing the old one before binding the new. */
  async function replaceProxy(target: MiniAppProxyTarget): Promise<MiniAppProxy> {
    const existing = proxies.get(target.pluginId);
    if (existing) {
      proxies.delete(target.pluginId);
      await existing.close();
    }
    const proxy = await startProxy({ target });
    proxies.set(target.pluginId, proxy);
    return proxy;
  }

  async function closeProxy(pluginId: string): Promise<void> {
    const proxy = proxies.get(pluginId);
    if (!proxy) return;
    proxies.delete(pluginId);
    await proxy.close();
  }

  const listMiniApps: DedicatedHandler<typeof listMiniAppsOperation> = async () => ({
    body: await requireMiniApps(port).list.call(port),
  });

  const openMiniApp: DedicatedHandler<typeof openMiniAppOperation> = async (
    context: WebuiOperationContext,
    body,
  ) => {
    const miniApps = requireMiniApps(port);
    return serialised(body.pluginId, async () => {
      const launch = await miniApps.open.call(port, {
        pluginId: body.pluginId,
        signal: context.signal,
      });
      try {
        const proxy = await replaceProxy({
          pluginId: launch.miniApp.pluginId,
          upstreamOrigin: launch.launch.origin,
          credential: launch.launch.credential,
          credentialHeader: launch.launch.credentialHeader,
        });
        // The response is the proxy's URL and the plugin it belongs to. The
        // runtime's origin, surface path and credential stay in this frame of
        // reference — no field of `launch` is copied out.
        return { body: { pluginId: launch.miniApp.pluginId, viewUrl: proxy.viewUrl } };
      } catch (error) {
        // The runtime started something the client cannot reach. Stopping it is
        // better than leaving a process running with no way into it, and the
        // original failure is what the caller needs to see.
        await miniApps.stop
          .call(port, { pluginId: body.pluginId, signal: context.signal })
          .catch(() => undefined);
        throw error;
      }
    });
  };

  const stopMiniApp: DedicatedHandler<typeof stopMiniAppOperation> = async (
    context: WebuiOperationContext,
    body,
  ) => {
    const miniApps = requireMiniApps(port);
    return serialised(body.pluginId, async () => {
      // The runtime first: a proxy closed under a live app would leave the app
      // running with nothing pointing at it, and a stop that throws leaves the
      // listener where it was so a retry has something to close.
      await miniApps.stop.call(port, {
        pluginId: body.pluginId,
        signal: context.signal,
      });
      await closeProxy(body.pluginId);
      return { body: { success: true as const } };
    });
  };

  return new Map([
    [
      listMiniAppsOperation.name,
      {
        operation: listMiniAppsOperation,
        handle: listMiniApps as WebuiOperationHandler<unknown>,
      },
    ],
    [
      openMiniAppOperation.name,
      {
        operation: openMiniAppOperation,
        handle: openMiniApp as WebuiOperationHandler<unknown>,
      },
    ],
    [
      stopMiniAppOperation.name,
      {
        operation: stopMiniAppOperation,
        handle: stopMiniApp as WebuiOperationHandler<unknown>,
      },
    ],
  ]);
}
