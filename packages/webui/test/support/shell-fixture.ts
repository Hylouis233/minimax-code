// The shell element a host must render: the assembled application wrapping it.
//
// The shell renders what the assembly built and constructs nothing of its own
// (plan §4.1), so a markup fixture has to hand it an application the same way
// production does. `sessionStore` in the properties is consumed as the
// *assembly's* store rather than passed down — the shell reads the store off the
// application it was given, so a fixture that seeds a store seeds the assembly.

import { createElement } from "react";
import type { ReactElement } from "react";

import { WebuiApplicationProvider } from "../../src/client/bindings/application-context.js";
import { WebuiClientFoundationApp } from "../../src/client/components/shell/WebuiClientFoundationApp.js";
import type { WebuiSessionStore } from "../../src/client/application/session-store.js";
import { createWebuiApplicationFixture } from "./application-fixture.js";
import type { ApplicationFixtureOptions } from "./application-fixture.js";

export function shellElement(
  properties: Record<string, unknown>,
  options: ApplicationFixtureOptions = {},
): ReactElement {
  const { sessionStore, ...rest } = properties as {
    readonly sessionStore?: WebuiSessionStore;
    readonly [key: string]: unknown;
  };
  const store = sessionStore ?? options.store;
  return createElement(WebuiApplicationProvider, {
    application: createWebuiApplicationFixture({
      ...options,
      ...(store ? { store } : {}),
    }),
    children: createElement(WebuiClientFoundationApp, rest as never),
  });
}
