// Two pages of one isolated Chromium.
//
// The provider holds one page per web tab. This suite proves the four things
// that follow from that, against a real browser:
//
//   * two pages can be driven, streamed and input into independently;
//   * a navigation on one page advances that page's generation and leaves the
//     other page's alone;
//   * a reference recorded against a page's previous generation is refused on
//     every page, not only on the one the browser was launched with;
//   * a frame is delivered to the page that asked for it and to no other.
//
// The frames are the sharpest of the four. A provider that stamped every
// screencast frame with its own target would still deliver *a* picture to
// every subscriber — the wrong one. Only the envelope's session id says which
// page a frame is about, so only a subscriber that receives its own page's
// frames proves the routing.
//
// The browser is optional: a machine without Chrome skips the suite rather
// than failing it, because "the browser is missing" is not a defect in the
// provider. The repository's `test:webui-browser` gate is the one that
// requires a browser.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WebuiIsolatedChromiumProvider } from "../../src/runtime/browser/isolated-chromium/provider.js";
import { WebuiBrowserService } from "../../src/runtime/browser/browser-service.js";
import type {
  WebuiBrowserAuthorization,
  WebuiBrowserImageFrame,
  WebuiBrowserTargetId,
} from "../../src/shared/contracts/browser.js";

/** A page with a field and a title, so two pages can be told apart. */
function pageHtml(title: string): string {
  return [
    `<!doctype html><title>${title}</title>`,
    "<input id='field' type='text'>",
    "<script>",
    "document.getElementById('field').addEventListener('input', (event) => {",
    "  document.title = 'text:' + event.target.value;",
    "});",
    "</script>",
  ].join("\n");
}

/** The data URL of a page with the given title. */
function pageUrl(title: string): string {
  return `data:text/html,${encodeURIComponent(pageHtml(title))}`;
}

/** How long a page is given to settle after a navigation. */
const SETTLE_MS = 750;

async function chromeIsAvailable(): Promise<boolean> {
  return (await resolveChromePath()) !== undefined;
}

async function resolveChromePath(): Promise<string | undefined> {
  const { access } = await import("node:fs/promises");
  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}

const available = await chromeIsAvailable();

describe.skipIf(!available)("the isolated Chromium, one page per web tab", () => {
  let dataDir: string;
  let provider: WebuiIsolatedChromiumProvider;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "webui-isolated-two-pages-"));
    provider = await WebuiIsolatedChromiumProvider.launch({ dataDir });
  }, 60_000);

  afterAll(async () => {
    await provider?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  /** The identity of the page the browser was launched with. */
  async function launchTarget(): Promise<WebuiBrowserTargetId> {
    const selected = (await provider.listTargets()).find((entry) => entry.selected);
    if (!selected) throw new Error("the provider reported no selected target");
    return selected.id;
  }

  /**
   * Opens a second page and returns its identity.
   *
   * The page is opened through the provider's own `open_tab`, so the test
   * exercises the same path the Agent's tool uses.
   */
  async function openPage(title: string): Promise<WebuiBrowserTargetId> {
    const opened = (await provider.sendCommand(await launchTarget(), "open_tab", {
      url: pageUrl(title),
    })) as { targetId?: string } | undefined;
    const targetId = opened?.targetId;
    if (!targetId) throw new Error("open_tab returned no target");
    // The page is created by the browser before the provider has registered
    // it, so the listing settles first.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const state = (await provider.listTargets()).find((entry) => entry.id.targetId === targetId);
    if (!state) throw new Error("the new page is not in the target list");
    return state.id;
  }

  /** The title the page behind the target is showing. */
  async function readTitle(target: WebuiBrowserTargetId): Promise<string> {
    const result = (await provider.sendCommand(target, "Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    })) as { result?: { value?: unknown } } | undefined;
    return typeof result?.result?.value === "string" ? result.result.value : "";
  }

  /** The value of the page's field. */
  async function readField(target: WebuiBrowserTargetId): Promise<string> {
    const result = (await provider.sendCommand(target, "Runtime.evaluate", {
      expression: "document.getElementById('field').value",
      returnByValue: true,
    })) as { result?: { value?: unknown } } | undefined;
    return typeof result?.result?.value === "string" ? result.result.value : "";
  }

  /** The field's centre, in page coordinates. */
  async function fieldCentre(target: WebuiBrowserTargetId): Promise<{ x: number; y: number }> {
    const result = (await provider.sendCommand(target, "Runtime.evaluate", {
      expression:
        "(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()",
      returnByValue: true,
    })) as { result?: { value?: unknown } } | undefined;
    const value = result?.result?.value as { x?: number; y?: number } | undefined;
    return { x: value?.x ?? 0, y: value?.y ?? 0 };
  }

  /** Clicks the page's field and types into it. */
  async function typeInto(target: WebuiBrowserTargetId, text: string): Promise<void> {
    // The field is emptied first: the launch page is shared by the cases in
    // this suite, and a field that still held the previous case's text would
    // make the assertion about the *new* text read as a failure.
    await provider.sendCommand(target, "Runtime.evaluate", {
      expression: "document.getElementById('field').value = ''",
    });
    const centre = await fieldCentre(target);
    await provider.sendInput({
      kind: "pointer",
      target,
      x: centre.x,
      y: centre.y,
      button: "left",
      clickCount: 1,
    });
    await provider.sendInput({ kind: "text", target, text });
  }

  it("drives, streams and inputs into two pages independently", async () => {
    const first = await launchTarget();
    const second = await openPage("second page");

    expect(second.targetId).not.toBe(first.targetId);

    // Each page is driven on its own. The navigation replaces the page behind
    // the tab, so the identity is read again afterwards: the one read before
    // the navigation is stale by then, and that is the point.
    await provider.sendCommand(first, "Page.navigate", { url: pageUrl("first page") });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const firstAfterNavigation = await launchTarget();
    expect(await readTitle(firstAfterNavigation)).toBe("first page");
    expect(await readTitle(second)).toBe("second page");

    // Each page is input into on its own.
    await typeInto(firstAfterNavigation, "alpha");
    await typeInto(second, "bravo");
    expect(await readField(firstAfterNavigation)).toBe("alpha");
    expect(await readField(second)).toBe("bravo");
  });

  it("advances one page's generation and leaves the other's alone", async () => {
    const first = await launchTarget();
    const second = await openPage("generation page");

    const before = new Map<string, number>();
    for (const target of await provider.listTargets()) {
      before.set(target.id.targetId, target.id.generation);
    }

    await provider.sendCommand(second, "Page.navigate", { url: pageUrl("navigated page") });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const after = new Map<string, number>();
    for (const target of await provider.listTargets()) {
      after.set(target.id.targetId, target.id.generation);
    }

    // The navigated page advanced.
    expect(after.get(second.targetId)).toBe((before.get(second.targetId) ?? 0) + 1);
    // The page that did not navigate did not.
    expect(after.get(first.targetId)).toBe(before.get(first.targetId));
  });

  it("refuses a stale reference on every page, not only the launch page", async () => {
    const first = await launchTarget();
    const second = await openPage("fenced page");

    const secondBefore = second.generation;
    await provider.sendCommand(second, "Page.navigate", { url: pageUrl("fenced page two") });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    // The stale identity of the page that was navigated.
    await expect(
      provider.sendInput({ kind: "text", target: second, text: "must not arrive" }),
    ).rejects.toMatchObject({ code: "browser_target_stale" });

    // The launch page's own current identity still works, so the fence did not
    // simply break every input.
    await typeInto(first, "still works");
    expect(await readField(first)).toBe("still works");
  });

  it("answers open_tab with the identity of the page it created", async () => {
    const launch = await launchTarget();

    const opened = (await provider.sendCommand(launch, "open_tab", {
      url: pageUrl("opened page"),
    })) as WebuiBrowserTargetId;

    // The answer names the page that was created: the surface, the browser,
    // the target and the generation.
    expect(opened.surface).toBe("isolated-chromium");
    expect(opened.browserId).toBe(provider.browserId);
    expect(typeof opened.targetId).toBe("string");
    expect(typeof opened.generation).toBe("number");

    // The page appears in the provider's target list under that identity.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const listed = (await provider.listTargets()).find(
      (entry) => entry.id.targetId === opened.targetId,
    );
    expect(listed?.id.surface).toBe(opened.surface);
    expect(listed?.id.browserId).toBe(opened.browserId);
    expect(listed?.id.targetId).toBe(opened.targetId);

    // The page the answer names is a page that can be driven. The generation
    // is read from the list rather than from the answer: a page that is still
    // loading is observed as a replaced page once its first load lands, and
    // that is the generation the provider holds afterwards.
    const current = listed!.id;
    await provider.sendCommand(current, "Page.navigate", { url: pageUrl("driven page") });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    expect(await readTitle(current)).toBe("driven page");
  });

  it("delivers a frame to the page that asked for it and to no other", async () => {
    const first = await launchTarget();
    const second = await openPage("streamed page");

    const firstFrames: WebuiBrowserImageFrame[] = [];
    const secondFrames: WebuiBrowserImageFrame[] = [];

    // Chrome renders the foregrounded tab and throttles the others, so the
    // provider brings the page it is streaming to the front. The first page is
    // streamed and driven first, and the second one after it, so each page's
    // frames are produced while that page is the one on screen.
    await provider.startImageStream(first.targetId, (frame) => firstFrames.push(frame));
    await typeInto(first, "one");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    await provider.startImageStream(second.targetId, (frame) => secondFrames.push(frame));
    await typeInto(second, "two");
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    expect(firstFrames.length).toBeGreaterThan(0);
    expect(secondFrames.length).toBeGreaterThan(0);

    // Every frame went to the page it belongs to, and to no other. This is
    // what the envelope's session id buys: a provider that stamped every
    // frame with its own target would still deliver a picture to both
    // subscribers — the wrong one.
    expect(firstFrames.every((frame) => frame.target.targetId === first.targetId)).toBe(true);
    expect(secondFrames.every((frame) => frame.target.targetId === second.targetId)).toBe(true);

    // A frame's sequence number counts that page's frames, not the browser's.
    expect(firstFrames.map((frame) => frame.sequence)).toEqual(
      firstFrames.map((_frame, index) => index + 1),
    );
    expect(secondFrames.map((frame) => frame.sequence)).toEqual(
      secondFrames.map((_frame, index) => index + 1),
    );

    await provider.stopImageStream(first.targetId);
    await provider.stopImageStream(second.targetId);
  });
});

/**
 * The service, streaming two pages of one real Chromium.
 *
 * The provider-level suite above proves the pages are independent. This one
 * proves the *streams* are: the client asks for the page it is showing, and
 * two streams open at once must not cross.
 */
describe.skipIf(!available)("the browser service, streaming two pages of one Chromium", () => {
  let dataDir: string;
  let service: WebuiBrowserService;

  const authorization: WebuiBrowserAuthorization = {
    isolatedChromium: true,
    edge: false,
    chrome: false,
    // The raw DevTools method below is how the test repaints a page, and the
    // Full CDP switch is what allows a raw method through.
    fullCdp: true,
  };

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "webui-two-page-streams-"));
    service = new WebuiBrowserService({
      authorization: {
        read: async () => authorization,
        write: async () => authorization,
      },
      dataDir,
    });
  }, 60_000);

  afterAll(async () => {
    await service?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  /** Repaints the page the run is on, which is what makes the screencast push. */
  async function repaint(): Promise<void> {
    await service.sendCommandToSelection("isolated-chromium", "run-1", "Runtime.evaluate", {
      expression: "document.body.style.background = 'rgb(12, 34, 56)'",
    });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  }

  it("gives two tabs their own pictures, and neither receives the other's frames", async () => {
    const list = await service.listTargets("isolated-chromium", "run-1");
    // The service marks the *run's* selection, and the run has not selected
    // anything yet, so the page to start from is found by asking the provider
    // which of the listed pages it can actually drive: the browser opens a
    // page of its own that the provider never attached to.
    let first: WebuiBrowserTargetId | undefined;
    for (const candidate of list.targets) {
      await service.selectTarget(candidate.id, "run-1");
      try {
        await service.sendCommandToSelection("isolated-chromium", "run-1", "Runtime.evaluate", {
          expression: "1",
        });
        first = candidate.id;
        break;
      } catch {
        // This page is not one the provider drives; try the next.
      }
    }
    expect(first).toBeDefined();

    // The run opens a second tab, so the session owns two pages.
    const opened = await service.sendCommandToSelection(
      "isolated-chromium",
      "run-1",
      "open_tab",
      { url: pageUrl("second page") },
    );
    const second = opened.result as WebuiBrowserTargetId;
    expect(second.targetId).not.toBe(first!.targetId);

    const firstFrames: WebuiBrowserImageFrame[] = [];
    const secondFrames: WebuiBrowserImageFrame[] = [];
    const controller = new AbortController();
    const firstStream = (async () => {
      for await (const frame of service.watchFrames(
        "isolated-chromium",
        first!,
        controller.signal,
      )) {
        firstFrames.push(frame);
      }
    })();
    const secondStream = (async () => {
      for await (const frame of service.watchFrames(
        "isolated-chromium",
        second,
        controller.signal,
      )) {
        secondFrames.push(frame);
      }
    })();

    // Chrome renders the page in front, so each page is repainted while its
    // own stream is the one watching.
    await repaint();
    await service.selectTarget(second, "run-1");
    await repaint();

    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    controller.abort();
    await Promise.allSettled([firstStream, secondStream]);

    expect(firstFrames.length).toBeGreaterThan(0);
    expect(secondFrames.length).toBeGreaterThan(0);
    // Neither stream received the other page's picture.
    expect(firstFrames.every((frame) => frame.target.targetId === first!.targetId)).toBe(true);
    expect(secondFrames.every((frame) => frame.target.targetId === second.targetId)).toBe(true);
  });
});
