// The browser bridge, against a real Chrome and a real Edge with the real
// extension.
//
// The external path has only ever been exercised against a synthetic peer. A
// synthetic peer proves the protocol; it does not prove that a browser can
// load the extension, run its service worker, hold a key in
// `chrome.storage.local` and answer a challenge with it.
//
// This spec does both halves against a real browser:
//
//   * the **happy path** — the extension loads, is provisioned, connects and
//     completes the handshake, and the host reports a connected surface;
//   * the **refusal** — the same extension without the installation key is
//     refused, and the host reports no connected surface.
//
// The refusal is the half that matters. A test that only proves the happy
// path would pass against a bridge that hands its credential to anybody.
//
// Each case writes an acceptance record — the browser version, the operating
// system, the settings that were in force and what was observed — because a
// matrix written by hand drifts from what the suite did.

import { rm } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { observeAcceptance } from "./acceptance-record.js";
import {
  browserVersionOf,
  buildExtension,
  launchWithExtension,
  provision,
  startBridge,
  waitForConnected,
} from "./real-browser-bridge.js";

/**
 * The browsers the extension is exercised against.
 *
 * Edge and Chrome are both installed on this machine, and the extension is one
 * package for both, so the acceptance runs against each. Each browser is
 * admitted on **its own** surface: an Edge-hosted extension proved on the
 * Chrome surface would say nothing about the Edge switch, the Edge credential
 * or the Edge routing.
 */
const BROWSERS = [
  { channel: "chromium", surface: "chrome" },
  { channel: "msedge", surface: "edge" },
] as const;

/** The record file this suite writes. */
const SUITE = "real-browser";

test.describe("the browser bridge, against a real browser", () => {
  test.beforeAll(async () => {
    await buildExtension();
  });

  for (const { channel, surface } of BROWSERS) {
    test(`the extension completes the handshake on the ${surface} surface in ${channel} once it can prove the installation key`, async () => {
      test.setTimeout(180_000);
      const { context, worker, extensionId, profileDir } = await launchWithExtension(channel);
      const started = await startBridge(extensionId, surface);
      const browserVersion = browserVersionOf(context);
      try {
        // The key belongs to the surface the browser is being admitted on.
        const view = await started.bridge.readInstallationKey(surface);
        expect(view).toBeDefined();

        await observeAcceptance(
          SUITE,
          {
            surface,
            browser: channel,
            browserVersion,
            entry: "development",
            case: "the extension completes the handshake once it can prove the installation key",
            settings: {
              isolatedChromium: false,
              edge: surface === "edge",
              chrome: surface === "chrome",
              fullCdp: false,
              allowlist: "development",
              build: "development",
              extensionId,
              installationKeyProved: true,
            },
            observed: "the handshake completed and the host reported the surface connected",
          },
          async () => {
            await provision(worker, context, extensionId, started.origin, view!.key);
            await waitForConnected(started.bridge, surface, true, worker);

            // The host is the authority: it is the host that decides a surface
            // is connected, not the extension's own belief that it connected.
            // The **matching** surface: an Edge-hosted extension has to be
            // admitted on the Edge surface, which is a separate switch, a
            // separate credential and a separate allowlist.
            expect(started.bridge.snapshot().surfaces[surface].connected).toBe(true);
            expect(started.bridge.snapshot().surfaces[surface].enabled).toBe(true);
          },
        );
      } finally {
        await started.close();
        await context.close();
        await rm(profileDir, { recursive: true, force: true });
      }
    });

    test(`an extension that cannot prove the installation key is refused on the ${surface} surface in ${channel}`, async () => {
      test.setTimeout(180_000);
      const { context, worker, extensionId, profileDir } = await launchWithExtension(channel);
      const started = await startBridge(extensionId, surface);
      const browserVersion = browserVersionOf(context);
      try {
        await observeAcceptance(
          SUITE,
          {
            surface,
            browser: channel,
            browserVersion,
            entry: "development",
            case: "an extension that cannot prove the installation key is refused",
            settings: {
              isolatedChromium: false,
              edge: surface === "edge",
              chrome: surface === "chrome",
              fullCdp: false,
              allowlist: "development",
              build: "development",
              extensionId,
              installationKeyProved: false,
            },
            observed: "the host refused the extension and reported no connected surface",
          },
          async () => {
            // The same extension, connected to the same host, but with no key.
            await provision(worker, context, extensionId, started.origin, undefined);
            await waitForConnected(started.bridge, surface, false, worker);

            // It must not have been admitted, and the host must not have handed
            // it a credential.
            expect(started.bridge.snapshot().surfaces[surface].connected).toBe(false);
          },
        );
      } finally {
        await started.close();
        await context.close();
        await rm(profileDir, { recursive: true, force: true });
      }
    });
  }
});
