// No browser is involved here: the protocol module is pure, and everything below
// runs on Node's own Web Crypto.

import { describe, expect, it } from "vitest";

import {
  isWebuiBrowserBridgeInputCommand,
  parseWebuiBrowserBridgeHostFrame,
  verifyWebuiBrowserBridgeProof,
  webuiBrowserBridgeProofMaterial,
  webuiBrowserBridgeUrl,
  WEBUI_BROWSER_BRIDGE_PATH,
  WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM,
  signWebuiBrowserBridgeProof,
  type WebuiBrowserBridgeProof,
} from "../src/protocol.js";

/**
 * The cross-implementation vector.
 *
 * The host asserts this exact string in its own suite. A change to the material,
 * the algorithm or the encoding on either side therefore breaks exactly one
 * suite, which is the only thing keeping two hand-written copies of this
 * protocol in step.
 */
const TEST_SECRET = new TextEncoder().encode("webui-browser-bridge-test-secret");
const TEST_SIGNATURE = "xb7/GT5s+ScVsaiLkh+eRRndKi5oPQwqQMqU3aX8Znc=";

describe("browser bridge protocol", () => {
  it("signs the shared test vector", async () => {
    await expect(signWebuiBrowserBridgeProof(TEST_SECRET, "nonce-abc", "key-1")).resolves.toBe(
      TEST_SIGNATURE,
    );
  });

  it("signs the nonce and key id joined by exactly one space", () => {
    expect(webuiBrowserBridgeProofMaterial("nonce-abc", "key-1")).toBe("nonce-abc key-1");
    expect(WEBUI_BROWSER_BRIDGE_SIGNATURE_ALGORITHM).toBe("HMAC-SHA256");
    expect(WEBUI_BROWSER_BRIDGE_PATH).toBe("/browser-bridge");
  });

  it("accepts a proof that answers the exact challenge", async () => {
    const proof: WebuiBrowserBridgeProof = {
      kind: "proof",
      keyId: "key-1",
      nonce: "nonce-abc",
      signature: TEST_SIGNATURE,
    };
    await expect(verifyWebuiBrowserBridgeProof(TEST_SECRET, proof, "nonce-abc", "key-1")).resolves.toBe(
      true,
    );
  });

  it("rejects a proof whose nonce is not the challenge it answers", async () => {
    const proof: WebuiBrowserBridgeProof = {
      kind: "proof",
      keyId: "key-1",
      nonce: "nonce-xyz",
      signature: TEST_SIGNATURE,
    };
    await expect(verifyWebuiBrowserBridgeProof(TEST_SECRET, proof, "nonce-abc", "key-1")).resolves.toBe(
      false,
    );
  });

  it("rejects a proof for a different key id", async () => {
    const proof: WebuiBrowserBridgeProof = {
      kind: "proof",
      keyId: "key-2",
      nonce: "nonce-abc",
      signature: TEST_SIGNATURE,
    };
    await expect(verifyWebuiBrowserBridgeProof(TEST_SECRET, proof, "nonce-abc", "key-1")).resolves.toBe(
      false,
    );
  });

  it("rejects a tampered signature and one of the wrong length", async () => {
    const tampered: WebuiBrowserBridgeProof = {
      kind: "proof",
      keyId: "key-1",
      nonce: "nonce-abc",
      signature: `xb7/GT5s+ScVsaiLkh+eRRndKi5oPQwqQMqU3aX8Znd=`,
    };
    await expect(verifyWebuiBrowserBridgeProof(TEST_SECRET, tampered, "nonce-abc", "key-1")).resolves.toBe(
      false,
    );
    const short: WebuiBrowserBridgeProof = { ...tampered, signature: "xb7" };
    await expect(verifyWebuiBrowserBridgeProof(TEST_SECRET, short, "nonce-abc", "key-1")).resolves.toBe(false);
  });

  it("refuses to build a bridge URL off loopback", () => {
    expect(webuiBrowserBridgeUrl("http://127.0.0.1:7777")).toBe("http://127.0.0.1:7777/browser-bridge");
    expect(webuiBrowserBridgeUrl("http://localhost:4319")).toBe("http://localhost:4319/browser-bridge");
    expect(() => webuiBrowserBridgeUrl("https://127.0.0.1:7777")).toThrow(/protocol/);
    expect(() => webuiBrowserBridgeUrl("http://example.com")).toThrow(/loopback/);
  });
});

describe("host frame parsing", () => {
  it("parses each declared host frame", () => {
    expect(parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "ready", sessionId: "s-1" }))).toEqual({
      ok: true,
      frame: { kind: "ready", sessionId: "s-1" },
    });
    expect(
      parseWebuiBrowserBridgeHostFrame(
        JSON.stringify({
          kind: "challenge",
          nonce: "n-1",
          algorithm: "HMAC-SHA256",
          keyId: "key-1",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "ping", nonce: "p-1" }))).toMatchObject({
      ok: true,
    });
    expect(parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "closed", reason: "revoked" }))).toMatchObject({
      ok: true,
    });
  });

  it("reports an unusable frame instead of guessing", () => {
    expect(parseWebuiBrowserBridgeHostFrame("not json")).toEqual({
      ok: false,
      reason: "frame is not valid JSON",
    });
    expect(parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "surprise" }))).toEqual({
      ok: false,
      reason: "unknown frame kind surprise",
    });
    expect(
      parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "challenge", nonce: "n", keyId: "k", algorithm: "none" })),
    ).toMatchObject({ ok: false });
    expect(parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "challenge", keyId: "k" }))).toMatchObject({
      ok: false,
    });
    expect(
      parseWebuiBrowserBridgeHostFrame(JSON.stringify({ kind: "input", commandId: "c-1" })),
    ).toMatchObject({ ok: false, reason: "input carries an invalid command" });
  });

  it("requires an input command to name a target and a generation", () => {
    expect(
      isWebuiBrowserBridgeInputCommand({ kind: "pointer", targetId: "tab-7", generation: 2, x: 1, y: 2, button: "left", clickCount: 1 }),
    ).toBe(true);
    expect(
      isWebuiBrowserBridgeInputCommand({ kind: "text", targetId: "tab-7", generation: 2, text: "hi" }),
    ).toBe(true);
    expect(isWebuiBrowserBridgeInputCommand({ kind: "text", targetId: "tab-7", text: "hi" })).toBe(false);
    expect(isWebuiBrowserBridgeInputCommand({ kind: "text", targetId: "", generation: 2, text: "hi" })).toBe(false);
    expect(isWebuiBrowserBridgeInputCommand({ kind: "scroll", targetId: "tab-7", generation: 2 })).toBe(false);
  });
});