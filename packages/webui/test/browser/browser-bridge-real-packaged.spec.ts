// The packaged production entry, against a real browser with a real store build.
//
// The other suites admit an **unpacked** extension: its id is derived from the
// directory it was loaded from, so the id is a property of the machine rather
// than of the extension. A packaged build is different — it carries the
// store's public key, and its id is the one that key determines. That is the
// id a store issues, and the id the bridge has to validate.
//
// So this suite proves three things, in order:
//
//   1. the id the browser assigns to the store build is exactly the id the
//      public key determines — the identity the bridge validates is the
//      identity the browser assigns;
//   2. a **packaged** host admits that build, through the store allowlist;
//   3. the same packaged host **refuses** the same extension when the id is
//      named only in the development allowlist, because a packaged host must
//      not accept a development identity.
//
// The third one is the point of the whole distinction. A packaged host that
// fell back to the development allowlist would admit whatever unpacked
// extension happened to be present, which is the identity nobody can rely on.
//
// The key is generated here rather than checked in. It is a *public* key — the
// private half never leaves this process — and a fresh one per run means the
// test cannot pass against a hard-coded id.

import { createHash, generateKeyPairSync } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

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

/** The record file this suite writes. */
const SUITE = "real-packaged";

/** Where the store build is built. It is not `dist/`: the two cannot share. */
const storeDist = resolve(
  new URL("../../../browser-extension/dist-store-chrome", import.meta.url).pathname,
);

/**
 * The extension id the public key determines.
 *
 * This is the browser's own rule: the id is the first sixteen bytes of the
 * SHA-256 of the DER-encoded public key, with each nibble mapped to a letter
 * from `a`. The suite asserts the browser agrees, so the rule is checked
 * rather than assumed.
 */
function extensionIdOfPublicKey(publicKeyDer: Buffer): string {
  return createHash("sha256")
    .update(publicKeyDer)
    .digest()
    .subarray(0, 16)
    .toString("hex")
    .split("")
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(nibble, 16)))
    .join("");
}

test.describe("the packaged production entry, against a real browser", () => {
  test.setTimeout(240_000);

  test("the store build's identity is the one its public key determines, and only a packaged host admits it", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const publicKeyBase64 = publicKeyDer.toString("base64");
    const expectedId = extensionIdOfPublicKey(publicKeyDer);

    await buildExtension({
      store: "chrome",
      out: "dist-store-chrome",
      publicKey: publicKeyBase64,
    });

    const { context, worker, extensionId, profileDir } = await launchWithExtension("chromium", {
      dist: storeDist,
    });
    const browserVersion = browserVersionOf(context);
    try {
      await observeAcceptance(
        SUITE,
        {
          surface: "chrome",
          browser: "chromium",
          browserVersion,
          entry: "packaged",
          case: "the store build's identity is the one its public key determines",
          settings: {
            isolatedChromium: false,
            edge: false,
            chrome: true,
            fullCdp: false,
            allowlist: "store",
            build: "store",
            extensionId,
            installationKeyProved: true,
          },
          observed: `the browser assigned the extension the id the public key determines (${expectedId})`,
        },
        async () => {
          // The identity the browser assigned and the identity the key
          // determines are the same string.
          expect(extensionId).toBe(expectedId);
        },
      );

      // A packaged host, with the store allowlist: the build is admitted and
      // the handshake completes.
      const packaged = await startBridge(extensionId, "chrome", { packaged: true });
      try {
        await observeAcceptance(
          SUITE,
          {
            surface: "chrome",
            browser: "chromium",
            browserVersion,
            entry: "packaged",
            case: "a packaged host admits the store build through the store allowlist",
            settings: {
              isolatedChromium: false,
              edge: false,
              chrome: true,
              fullCdp: false,
              allowlist: "store",
              build: "store",
              extensionId,
              installationKeyProved: true,
            },
            observed: "the packaged host completed the handshake and reported the surface connected",
          },
          async () => {
            const view = await packaged.bridge.readInstallationKey("chrome");
            expect(view).toBeDefined();
            await provision(worker, context, extensionId, packaged.origin, view!.key);
            await waitForConnected(packaged.bridge, "chrome", true, worker);
            expect(packaged.bridge.snapshot().surfaces.chrome.connected).toBe(true);
          },
        );
      } finally {
        await packaged.close();
      }

      // The same packaged host, with the id named only in the *development*
      // allowlist: the extension is refused, and no credential is handed out.
      const refusing = await startBridge(extensionId, "chrome", {
        packaged: true,
        allowlist: "development",
      });
      try {
        await observeAcceptance(
          SUITE,
          {
            surface: "chrome",
            browser: "chromium",
            browserVersion,
            entry: "packaged",
            case: "a packaged host refuses an extension named only in the development allowlist",
            settings: {
              isolatedChromium: false,
              edge: false,
              chrome: true,
              fullCdp: false,
              allowlist: "development",
              build: "store",
              extensionId,
              installationKeyProved: true,
            },
            observed: "the packaged host refused the extension and reported no connected surface",
          },
          async () => {
            const view = await refusing.bridge.readInstallationKey("chrome");
            await provision(worker, context, extensionId, refusing.origin, view!.key);
            await waitForConnected(refusing.bridge, "chrome", false, worker);
            expect(refusing.bridge.snapshot().surfaces.chrome.connected).toBe(false);
          },
        );
      } finally {
        await refusing.close();
      }
    } finally {
      await context.close();
      await rm(profileDir, { recursive: true, force: true });
    }
  });
});
