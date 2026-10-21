// The web-tab snapshot operation, and the six places it has to be registered.
//
// A new operation is not registered by adding a name. The browser family's
// readiness is declared in the capability manifest, the name reaches the
// operation-name constants, the operation registry, the server's handler
// table, the port and its binding, and the transport's request table — and
// every one of those is a place where a change that is forgotten shows up as
// a missing capability rather than as an error.
//
// So this file is the executable form of that list: it names every site and
// asserts the operation is there. A site that loses the operation fails
// here rather than in a panel that quietly shows no tabs.

import { describe, expect, it } from "vitest";

import { createWebuiTransport } from "../../src/client/platform/transport.js";
import { createWebuiPortSlices } from "../../src/client/application/port-slices.js";
import { WEBUI_CAPABILITY_REGISTRY_PROOFS } from "../../src/shared/capability-manifest.js";
import {
  WATCH_BROWSER_WEB_TABS_OPERATION_NAME,
  WEBUI_STREAM_OPERATION_NAMES,
} from "../../src/shared/operation-names.js";
import { watchBrowserWebTabsOperation } from "../../src/server/operation/browser.js";
import { createBrowserHandlerEntries } from "../../src/server/operation/handlers/browser.js";
import { createOperationRegistry } from "../../src/server/operation/operations.js";
import { WebuiBrowserService } from "../../src/runtime/browser/browser-service.js";
import type { WebuiBrowserPort } from "../../src/runtime/port.js";
import type { WebuiBrowserAuthorization } from "../../src/shared/contracts/browser.js";

/** A port that answers nothing; the registry only asks whether it is wired. */
const inertBrowserPort = {} as unknown as WebuiBrowserPort;

const AUTHORIZATION_OFF: WebuiBrowserAuthorization = {
  isolatedChromium: false,
  edge: false,
  chrome: false,
  fullCdp: false,
};

describe("the web-tab snapshot operation", () => {
  it("is named in the operation-name constants", () => {
    expect(WATCH_BROWSER_WEB_TABS_OPERATION_NAME).toBe("watchBrowserWebTabs");
  });

  it("is a stream, and not a unary operation", () => {
    expect(WEBUI_STREAM_OPERATION_NAMES).toContain(WATCH_BROWSER_WEB_TABS_OPERATION_NAME);
  });

  it("is on the browser family's ready list in the capability manifest", () => {
    // The ready list is what the handshake derives from: an operation that is
    // not wired makes the whole browser family `not-ready` rather than absent,
    // so putting it here is a promise the other sites have to keep.
    expect(WEBUI_CAPABILITY_REGISTRY_PROOFS.browser.ready).toContain(
      WATCH_BROWSER_WEB_TABS_OPERATION_NAME,
    );
  });

  it("is registered in the operation registry", () => {
    const registry = createOperationRegistry(
      {} as never,
      undefined,
      inertBrowserPort,
    );
    expect(registry.has(WATCH_BROWSER_WEB_TABS_OPERATION_NAME)).toBe(true);
  });

  it("is in the server's handler table", () => {
    const entries = createBrowserHandlerEntries(inertBrowserPort);
    expect(entries.has(watchBrowserWebTabsOperation.name)).toBe(true);
  });

  it("is a member of the browser port, and of the service behind it", () => {
    // A compile-time assertion: a member that is not on `WebuiBrowserPort`
    // cannot be bound, so this line is the proof that the port carries the
    // operation. The runtime check is that the service behind the port
    // answers it.
    const portCarriesTheOperation: "watchWebTabs" extends keyof WebuiBrowserPort
      ? true
      : false = true;
    expect(portCarriesTheOperation).toBe(true);

    const service = new WebuiBrowserService({
      authorization: {
        read: async () => AUTHORIZATION_OFF,
        write: async () => AUTHORIZATION_OFF,
      },
      dataDir: "/tmp/webui-web-tabs-operation-test",
    });
    expect(typeof service.watchWebTabs).toBe("function");
  });

  it("is in the transport's request table", () => {
    const transport = createWebuiTransport({
      websocketUrl: "ws://127.0.0.1:1",
      token: "test-token",
      webSocket: { send: () => undefined, close: () => undefined } as never,
    });
    expect(typeof transport.watchBrowserWebTabs).toBe("function");
  });

  it("reaches the browser slice of the client's port", () => {
    const slices = createWebuiPortSlices({
      watchBrowserWebTabs: () => () => undefined,
    } as never);
    expect(typeof slices.browser?.watchBrowserWebTabs).toBe("function");
  });
});
