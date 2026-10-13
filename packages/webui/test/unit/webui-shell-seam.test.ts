// The shell's seam and its startup duties (ticket #75; §4.11, and A4-s5's exit condition
// re-verified at the boundary).
//
// §4.11 gives the foundation shell three jobs: render the supplied APIs, hold the routing/layout/startup
// duties, and construct no duplicate business owner. A4-s5's exit adds the seam condition — the shell
// forwards **zero** transport members — and Phase 2's slices are what satisfy it: each business reads
// its own slice and the shell passes slice-derived values, never `transport.X`.
//
// Source assertions, like the rest of the shell's structural coverage: the claim is about which
// expressions exist, and this package has no DOM to observe them in. A `transport.` read outside a
// comment, a second `createWebuiPortSlices` call, a second channel, or a boundary moved inside the
// shell each turns a case red.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const shell = read("../../src/client/components/WebuiClientFoundationApp.tsx");
const main = read("../../src/client/main.tsx");

describe("the shell forwards zero transport members", () => {
  it("never reads a member off the composed transport in code", () => {
    // The prop stays (SSR and the unit tests drive it, and its optionality is the not-wired mode the
    // exit condition preserves), and the type is imported for it. What must not exist is a *read*.
    const mentions = shell
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /transport\./u.test(line));
    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) {
      expect(line, `transport member read in code: ${line}`).toMatch(/^(?:\/\/|\*|\/\*|import)/u);
    }
  });

  it("builds the port slices once, taking the transport only as the fallback", () => {
    expect(shell).toContain("createWebuiPortSlices(transport ?? {})");
    expect(shell.match(/createWebuiPortSlices\(/gu) ?? []).toHaveLength(1);
  });
});

describe("the shell keeps its startup duties", () => {
  it("disposes exactly the application instance it constructed", () => {
    // An injected application belongs to its provider; only a self-built one is the shell's to stop.
    expect(shell).toContain("if (!providedApplication) application.dispose();");
  });

  it("opens one event channel", () => {
    expect(shell.match(/createWebuiOpenEventChannel\(/gu) ?? []).toHaveLength(1);
  });

  it("leaves the error boundary at the composition root", () => {
    // The boundary catches a render failure in the tree *above* the shell; placing it inside would
    // leave the shell's own render uncovered.
    expect(main).toContain("<WebuiErrorBoundary>");
    expect(shell).not.toContain("<WebuiErrorBoundary");
  });
});
