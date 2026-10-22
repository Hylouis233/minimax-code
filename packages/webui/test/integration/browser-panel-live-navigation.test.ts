// Real Chromium browser-panel flows across independent pages and origins.
//
// The local HTTP pages keep navigation deterministic while Chromium, CDP,
// pointer input, keyboard input, service target tracking and screencast frames
// all run for real. The browser-client surface itself is covered by
// browser-workspace.spec.mjs; this suite covers the runtime half behind it.

import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WebuiBrowserService } from "../../src/runtime/browser/browser-service.js";
import type {
  WebuiBrowserAuthorization,
  WebuiBrowserImageFrame,
  WebuiBrowserTargetId,
  WebuiBrowserWebTabSnapshot,
} from "../../src/shared/contracts/browser.js";

const TIMEOUT_MS = 30_000;
const POLL_MS = 50;

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

async function startPageServer(respond: (path: string) => string): Promise<{
  server: Server;
  origin: string;
}> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(respond(new URL(request.url ?? "/", "http://localhost").pathname));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test page server did not bind a TCP port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const chromeAvailable = (await resolveChromePath()) !== undefined;

describe.skipIf(!chromeAvailable)("the browser panel's real Chromium navigation flows", () => {
  let dataDir: string;
  let service: WebuiBrowserService;
  let homeServer: Server;
  let externalServer: Server;
  let homeOrigin: string;
  let externalOrigin: string;
  let streamController: AbortController | undefined;
  let streamTask: Promise<void> | undefined;

  const authorization: WebuiBrowserAuthorization = {
    isolatedChromium: true,
    edge: false,
    chrome: false,
    fullCdp: true,
  };

  beforeAll(async () => {
    const external = await startPageServer((path) => {
      if (path === "/new-tab") {
        return "<!doctype html><title>New tab destination</title><body>new-tab-destination</body>";
      }
      return "<!doctype html><title>External destination</title><body>external-destination</body>";
    });
    externalServer = external.server;
    externalOrigin = external.origin;

    const home = await startPageServer((path) => {
      if (path === "/next") {
        return `<!doctype html><title>Same-origin destination</title><body><a id="external" href="${externalOrigin}/external">Open external site</a><a id="new-tab" target="_blank" href="${externalOrigin}/new-tab">Open new tab</a></body>`;
      }
      return `<!doctype html><title>Browser panel start</title><body style="min-height:1800px"><input id="search" aria-label="Search"><button id="submit" onclick="document.title='Submitted '+document.querySelector('#search').value">Submit</button><a id="same-tab" href="/next">Open same-origin page</a><a id="external-direct" href="${externalOrigin}/external">Open external site</a><a id="new-tab-direct" target="_blank" href="${externalOrigin}/new-tab">Open external site in new tab</a><div style="height:1200px">scroll target</div></body>`;
    });
    homeServer = home.server;
    homeOrigin = home.origin;

    dataDir = await mkdtemp(join(tmpdir(), "webui-browser-panel-live-"));
    service = new WebuiBrowserService({
      authorization: {
        read: async () => authorization,
        write: async () => authorization,
      },
      dataDir,
    });
  }, 60_000);

  afterAll(async () => {
    streamController?.abort();
    await streamTask?.catch(() => undefined);
    await service?.close();
    await Promise.all(
      [homeServer, externalServer].filter(Boolean).map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    if (dataDir) {
      await rm(dataDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  async function openHome(): Promise<WebuiBrowserTargetId> {
    const opened = await service.openWebTab(undefined, { url: `${homeOrigin}/` }, undefined, "person");
    await waitFor(async () => (await readTitle(opened.target)) === "Browser panel start", "home page load");
    return currentTarget(opened.target);
  }

  async function currentTarget(target: WebuiBrowserTargetId): Promise<WebuiBrowserTargetId> {
    const list = await service.listTargets("isolated-chromium");
    const state = list.targets.find((candidate) => candidate.id.targetId === target.targetId);
    if (!state) throw new Error(`browser target ${target.targetId} disappeared`);
    return state.id;
  }

  async function readTitle(target: WebuiBrowserTargetId): Promise<string> {
    const result = await service.sendCommandToTarget(
      "isolated-chromium",
      target,
      "Runtime.evaluate",
      { expression: "document.title", returnByValue: true },
    );
    const value = (result.result as { result?: { value?: unknown } } | undefined)?.result?.value;
    return typeof value === "string" ? value : "";
  }

  async function evaluate(target: WebuiBrowserTargetId, expression: string): Promise<unknown> {
    const result = await service.sendCommandToTarget(
      "isolated-chromium",
      target,
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
    );
    return (result.result as { result?: { value?: unknown } } | undefined)?.result?.value;
  }

  async function elementCentre(target: WebuiBrowserTargetId, selector: string): Promise<{ x: number; y: number }> {
    const point = await evaluate(
      target,
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const rect = element.getBoundingClientRect(); return rect.width && rect.height ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null; })()`,
    );
    if (!point || typeof point !== "object") throw new Error(`visible element not found: ${selector}`);
    return point as { x: number; y: number };
  }

  async function click(target: WebuiBrowserTargetId, selector: string): Promise<void> {
    const point = await elementCentre(target, selector);
    await service.sendInput({ kind: "pointer", action: "press", target, ...point, button: "left" });
    await service.sendInput({ kind: "pointer", action: "release", target, ...point, button: "left" });
  }

  async function waitFor(condition: () => boolean | Promise<boolean>, description: string): Promise<void> {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`timed out waiting for ${description}`);
  }

  function watch(target: WebuiBrowserTargetId, frames: WebuiBrowserImageFrame[]): void {
    streamController = new AbortController();
    streamTask = (async () => {
      for await (const frame of service.watchFrames("isolated-chromium", target, streamController?.signal)) {
        frames.push(frame);
      }
    })();
  }

  it("opens the page, accepts pointer and keyboard input, submits, and scrolls", async () => {
    const target = await openHome();
    const frames: WebuiBrowserImageFrame[] = [];
    watch(target, frames);

    await click(target, "#search");
    await service.sendInput({ kind: "text", target, text: "browser panel test" });
    await waitFor(async () => (await evaluate(target, "document.querySelector('#search').value")) === "browser panel test", "typed text");
    await click(target, "#submit");
    await waitFor(async () => (await readTitle(target)) === "Submitted browser panel test", "button click");

    await service.sendInput({ kind: "pointer", action: "scroll", target, x: 500, y: 500, deltaX: 0, deltaY: 620 });
    await waitFor(async () => Number(await evaluate(target, "window.scrollY")) > 0, "page scroll");
    await waitFor(() => frames.length > 0, "live screencast frame");
    expect(frames.every((frame) => frame.target.targetId === target.targetId)).toBe(true);
  }, TIMEOUT_MS);

  it("follows same-tab and external-origin links, restores frames, and supports history and reload", async () => {
    let target = await openHome();
    const initialGeneration = target.generation;
    const frames: WebuiBrowserImageFrame[] = [];
    watch(target, frames);
    await click(target, "#same-tab");

    await waitFor(async () => (await readTitle(await currentTarget(target))) === "Same-origin destination", "same-origin link navigation");
    target = await currentTarget(target);
    expect(target.generation).toBeGreaterThan(initialGeneration);
    await click(target, "#external");
    await waitFor(async () => (await readTitle(await currentTarget(target))) === "External destination", "cross-origin external link navigation");
    target = await currentTarget(target);
    expect((await service.listTargets("isolated-chromium")).targets.some((entry) => entry.url.startsWith(`${externalOrigin}/external`))).toBe(true);

    const afterNavigation = frames.length;
    streamController?.abort();
    await streamTask?.catch(() => undefined);
    const resumedFrames: WebuiBrowserImageFrame[] = [];
    watch(target, resumedFrames);
    await service.sendCommandToTarget("isolated-chromium", target, "Runtime.evaluate", {
      expression: "document.body.style.background = 'rgb(12, 34, 56)'",
    });
    await waitFor(() => resumedFrames.length > 0, "screencast after navigation and resubscription");
    expect(resumedFrames.at(-1)?.target.generation).toBe(target.generation);
    expect(frames.length).toBeGreaterThanOrEqual(afterNavigation);

    await service.sendCommandToTarget("isolated-chromium", target, "back", {});
    await waitFor(async () => (await readTitle(await currentTarget(target))) === "Same-origin destination", "back navigation");
    target = await currentTarget(target);
    await service.sendCommandToTarget("isolated-chromium", target, "back", {});
    await waitFor(async () => (await readTitle(await currentTarget(target))) === "Browser panel start", "second back navigation");
    target = await currentTarget(target);
    await service.sendCommandToTarget("isolated-chromium", target, "forward", {});
    await waitFor(async () => (await readTitle(await currentTarget(target))) === "Same-origin destination", "forward navigation");
    target = await currentTarget(target);
    const generationBeforeReload = target.generation;
    await service.sendCommandToTarget("isolated-chromium", target, "reload", {});
    await waitFor(async () => (await currentTarget(target)).generation > generationBeforeReload, "reload generation");
  }, TIMEOUT_MS);

  it("opens a target-blank external link as a controllable streamed page", async () => {
    const target = await openHome();
    const webTabs = service.watchWebTabs("isolated-chromium")[Symbol.asyncIterator]();
    const initialTabs = await webTabs.next();
    const isPublished = (snapshot: WebuiBrowserWebTabSnapshot | undefined, targetId: string) =>
      snapshot?.tabs.some((tab) => tab.id === targetId) ?? false;
    expect(isPublished(initialTabs.value, target.targetId)).toBe(true);
    await click(target, "#new-tab-direct");

    let newTarget: WebuiBrowserTargetId | undefined;
    await waitFor(async () => {
      const list = await service.listTargets("isolated-chromium");
      newTarget = list.targets.find(
        (entry) => entry.id.targetId !== target.targetId && entry.url.startsWith(`${externalOrigin}/new-tab`),
      )?.id;
      return newTarget !== undefined;
    }, "new external web tab");

    try {
      const publishedTabs = await webTabs.next();
      expect(isPublished(publishedTabs.value, newTarget!.targetId)).toBe(true);
      expect(await readTitle(newTarget!)).toBe("New tab destination");
      const frames: WebuiBrowserImageFrame[] = [];
      watch(newTarget!, frames);
      await service.sendCommandToTarget("isolated-chromium", newTarget!, "Runtime.evaluate", {
        expression: "document.body.style.background = 'rgb(56, 34, 12)'",
      });
      await waitFor(() => frames.length > 0, "new tab screencast");
      expect(frames.every((frame) => frame.target.targetId === newTarget!.targetId)).toBe(true);
    } finally {
      await webTabs.return?.();
    }
  }, TIMEOUT_MS);
});
