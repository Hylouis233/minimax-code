// The one shared test-side assembly for hosts that render the shell.
//
// The shell renders an application the composition root assembled; it no longer
// builds a fallback of its own (plan §4.1). A fixture that renders the shell
// therefore has to hand it an application built the same way production builds
// one — through `createWebuiApplication` — rather than a second composition with
// different inputs. This helper is that construction, in one place:
//
//   * a no-op event channel, so a markup fixture opens nothing;
//   * the caller's store when it seeds a catalogue, otherwise a fresh one;
//   * no unread storage unless the fixture asks for it, so a fixture that wants
//     restore/persist behaviour supplies the adapter it means to measure.
//
// It returns a **dormant** application: constructing performs no IO. A fixture
// that needs the ingress, hydration or the lifecycle states calls `start()`.

import { createWebuiApplication } from "../../src/client/application/create-application.js";
import type {
  WebuiApplication,
  WebuiApplicationStart,
} from "../../src/client/application/create-application.js";
import type { WebuiEventEffects } from "../../src/client/application/turn/event-coordinator.js";
import type { WebuiSessionStore } from "../../src/client/application/session-store.js";

/** A channel that accepts one listener and never emits: SSR-shaped hosts. */
export const inertEventChannel = () => ({ subscribe: () => () => undefined });

export interface ApplicationFixtureOptions {
  readonly store?: WebuiSessionStore;
  readonly effects?: WebuiEventEffects;
  readonly unreadStorage?: {
    readonly read?: () => Readonly<Record<string, number>>;
    readonly write?: (counts: Readonly<Record<string, number>>) => void;
  };
  readonly loadMessages?: (args: { readonly sessionId: string }) => Promise<unknown>;
}

/** Builds a dormant application for a host that renders the shell. */
export function createWebuiApplicationFixture(
  options: ApplicationFixtureOptions = {},
): WebuiApplication {
  return createWebuiApplication({
    openEventChannel: inertEventChannel,
    ...(options.store ? { store: options.store } : {}),
    ...(options.effects ? { effects: options.effects } : {}),
    ...(options.unreadStorage ? { unreadStorage: options.unreadStorage } : {}),
    turns: { resumeSession: async () => {} },
  });
}

/** Builds and starts one, for a fixture that needs the ingress or hydration. */
export function startWebuiApplicationFixture(
  options: ApplicationFixtureOptions = {},
  start?: WebuiApplicationStart,
): WebuiApplication {
  const application = createWebuiApplicationFixture(options);
  application.start(start);
  return application;
}
