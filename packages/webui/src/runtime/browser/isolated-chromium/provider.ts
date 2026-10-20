// The isolated Chromium provider.
//
// This is the browser the WebUI process launches and owns. It exists so that
// Browser Use has a browser whose lifetime this process controls: the person
// does not have to install anything, configure a debugging port or log in
// anywhere, and the profile is a temporary directory that belongs to this
// host.
//
// It speaks CDP directly over a `ws` WebSocket. There is no typed DevTools
// client in the dependency set, and the commands Browser Use needs are a
// small, well-understood set.
//
// Three behaviours here are not obvious and are the reason this file exists
// rather than a call into an existing provider:
//
//   * **The attachment race.** A capture issued immediately after a navigation
//     fails with `Not attached to an active page (-32000)` because the
//     renderer is still being swapped. Measured on Chrome 152; the same
//     capture issued a moment later succeeds. The provider therefore waits for
//     the page to be attached rather than assuming a command that failed once
//     will keep failing.
//   * **The generation follows the main frame.** A navigation replaces the page
//     behind the tab, so the target's generation is raised then — that is what
//     makes an element reference recorded before the navigation stale.
//   * **The image stream is a screencast.** `Page.startScreencast` pushes
//     frames as the page changes, which is what the panel needs; polling
//     `Page.captureScreenshot` would be a screenshot, not a live stream.

import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type {
  WebuiBrowserImageFrame,
  WebuiBrowserInputCommand,
  WebuiBrowserTargetState,
} from "../../../shared/contracts/browser.js";
import { WEBUI_BROWSER_RESTRICTED_COMMANDS } from "../../../shared/contracts/browser.js";
import { browserOperationError } from "../errors.js";
import {
  WebuiBrowserCdpConnection,
  type WebuiBrowserCdpEvent,
} from "./cdp-connection.js";

/** How long the browser may take to publish its DevTools endpoint. */
const STARTUP_TIMEOUT_MS = 30_000;
/** How often the endpoint file is polled while the browser starts. */
const STARTUP_POLL_INTERVAL_MS = 100;
/** How long a command is retried while the page is still being attached. */
const ATTACHMENT_RETRY_WINDOW_MS = 3_000;
/** The delay between attachment retries. */
const ATTACHMENT_RETRY_DELAY_MS = 100;

/** The options the provider is launched with. */
export interface WebuiIsolatedChromiumProviderOptions {
  /** The directory this host keeps its state in. The profile lives under it. */
  readonly dataDir: string;
  /** An explicit Chrome executable. Discovered from the platform when absent. */
  readonly chromePath?: string;
  /** The viewport the launched browser uses. */
  readonly viewport?: { readonly width: number; readonly height: number };
}

/**
 * One target's page was replaced.
 *
 * The provider is the only party that knows when the page behind a tab is
 * replaced, so it is the only party that can say so. Whoever holds the target
 * registry needs this to raise the generation, and until it does, an input
 * recorded against the previous page would still look current.
 */
export interface WebuiBrowserTargetChange {
  readonly targetId: string;
  readonly generation: number;
}

/** The surface every browser provider implements. */
export interface WebuiBrowserSurfaceProvider {
  readonly surface: "isolated-chromium";
  /**
   * The identity of this browser instance.
   *
   * It separates two instances of the same surface, so a target identity —
   * and therefore an input — can never be mistaken for one in another
   * browser.
   */
  readonly browserId: string;
  /** Every target this provider knows about. */
  listTargets(): Promise<readonly WebuiBrowserTargetState[]>;
  /**
   * Subscribes to "the page behind this target was replaced".
   *
   * The returned function unsubscribes. A provider that cannot observe the
   * change may omit this member; the registry then relies on the provider's own
   * refusal, which is why the provider checks the generation too.
   */
  onTargetChanged?(
    listener: (change: WebuiBrowserTargetChange) => void,
  ): () => void;
  /** Starts pushing the target's live images to the callback. */
  startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void>;
  /** Stops the live images and releases what the stream held. */
  stopImageStream(targetId: string): Promise<void>;
  /** Delivers one validated input command to the target. */
  sendInput(command: WebuiBrowserInputCommand): Promise<void>;
  /**
   * Runs one browser command.
   *
   * `command` is either a restricted browser-tool action (`navigate`, `reload`,
   * …) or, when the Full CDP switch is on, a raw DevTools method. The runtime
   * has already decided which kind is allowed; the provider only executes it,
   * and refuses explicitly when it cannot.
   */
  sendCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  /** Releases everything the provider holds. */
  close(): Promise<void>;
}

/**
 * The isolated Chromium provider.
 *
 * One instance owns one browser process and the pages inside it.
 */
export class WebuiIsolatedChromiumProvider implements WebuiBrowserSurfaceProvider {
  readonly surface = "isolated-chromium" as const;
  /** The identity of this browser instance. */
  readonly browserId: string;

  readonly #options: WebuiIsolatedChromiumProviderOptions;
  readonly #userDataDir: string;
  #child: ChildProcess | undefined;
  #connection: WebuiBrowserCdpConnection | undefined;
  /** The CDP session of the page the panel is showing. */
  #pageSessionId: string | undefined;
  #pageTargetId: string | undefined;
  #generation = 0;
  #frameSequence = 0;
  #streaming = false;
  #unsubscribe: (() => void) | undefined;

  private constructor(options: WebuiIsolatedChromiumProviderOptions) {
    this.#options = options;
    this.#userDataDir = join(options.dataDir, "browser", "isolated-chromium", "profile");
    this.browserId = `isolated-chromium-${randomSuffix()}`;
  }

  /**
   * Launches the browser and opens its first page.
   *
   * The profile is a fresh directory under this host's data directory: the
   * browser is isolated from the person's own browser and from any earlier
   * run, and nothing about it outlives the host.
   */
  static async launch(
    options: WebuiIsolatedChromiumProviderOptions,
  ): Promise<WebuiIsolatedChromiumProvider> {
    const provider = new WebuiIsolatedChromiumProvider(options);
    await provider.#start();
    return provider;
  }

  async #start(): Promise<void> {
    const chromePath = await resolveChromePath(this.#options.chromePath);
    await mkdir(this.#userDataDir, { recursive: true, mode: 0o700 });
    const activePortPath = join(this.#userDataDir, "DevToolsActivePort");
    await rm(activePortPath, { force: true });

    const viewport = this.#options.viewport ?? { width: 1280, height: 800 };
    const child = spawn(
      chromePath,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        `--user-data-dir=${this.#userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-features=Translate,MediaRouter",
        `--window-size=${viewport.width},${viewport.height}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    this.#child = child;

    let endpoint: string;
    try {
      endpoint = await waitForDevToolsEndpoint(child, activePortPath);
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }

    const connection = await WebuiBrowserCdpConnection.connect(endpoint);
    this.#connection = connection;
    this.#unsubscribe = connection.onEvent((event) => this.#onEvent(event));

    const created = await connection.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    const attached = await connection.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId: created.targetId,
      flatten: true,
    });
    this.#pageTargetId = created.targetId;
    this.#pageSessionId = attached.sessionId;
    this.#generation = 1;

    await connection.send("Page.enable", {}, this.#pageSessionId);
  }

  async listTargets(): Promise<readonly WebuiBrowserTargetState[]> {
    const connection = this.#connection;
    if (!connection) return [];
    const targets = await connection.send<{
      targetInfos?: readonly {
        targetId: string;
        title: string;
        url: string;
        type: string;
      }[];
    }>("Target.getTargets");
    const states: WebuiBrowserTargetState[] = [];
    for (const info of targets.targetInfos ?? []) {
      if (info.type !== "page") continue;
      states.push({
        id: {
          surface: this.surface,
          browserId: this.browserId,
          targetId: info.targetId,
          generation: info.targetId === this.#pageTargetId ? this.#generation : 1,
        },
        title: info.title,
        url: info.url,
        status: "open",
        selected: info.targetId === this.#pageTargetId,
      });
    }
    return states;
  }

  async startImageStream(
    targetId: string,
    onFrame: (frame: WebuiBrowserImageFrame) => void,
  ): Promise<void> {
    if (targetId !== this.#pageTargetId) {
      throw browserOperationError(
        "browser_target_unknown",
        "The isolated Chromium has no such target.",
      );
    }
    const connection = this.#connection;
    const sessionId = this.#pageSessionId;
    if (!connection || !sessionId) {
      throw browserOperationError(
        "browser_provider_unavailable",
        "The isolated Chromium is not running.",
        true,
      );
    }
    this.#frameHandler = onFrame;
    this.#streaming = true;
    await this.#withAttachmentRetry(() =>
      connection.send(
        "Page.startScreencast",
        { format: "jpeg", quality: 70, everyNthFrame: 1 },
        sessionId,
      ),
    );
  }

  async stopImageStream(targetId: string): Promise<void> {
    if (targetId !== this.#pageTargetId) return;
    this.#streaming = false;
    this.#frameHandler = undefined;
    const connection = this.#connection;
    const sessionId = this.#pageSessionId;
    if (!connection || !sessionId) return;
    try {
      await connection.send("Page.stopScreencast", {}, sessionId);
    } catch {
      // A browser that has already gone cannot be asked to stop; the resources
      // it held are gone with it.
    }
  }

  async sendInput(command: WebuiBrowserInputCommand): Promise<void> {
    const connection = this.#connection;
    const sessionId = this.#pageSessionId;
    if (!connection || !sessionId) {
      throw browserOperationError(
        "browser_provider_unavailable",
        "The isolated Chromium is not running.",
        true,
      );
    }
    if (command.target.browserId !== this.browserId || command.target.targetId !== this.#pageTargetId) {
      throw browserOperationError(
        "browser_target_unknown",
        "The isolated Chromium has no such target.",
      );
    }
    // The provider is the party that knows when the page behind the tab was
    // replaced, so it is the party that refuses an input recorded against the
    // previous page. The registry refuses the same input too, but the registry
    // learns about the replacement from this provider — so the check that
    // actually protects the page has to live here as well.
    if (command.target.generation !== this.#generation) {
      throw browserOperationError(
        "browser_target_stale",
        "The browser page was replaced; the input was not delivered.",
      );
    }
    switch (command.kind) {
      case "pointer":
        await this.#withAttachmentRetry(async () => {
          await connection.send(
            "Input.dispatchMouseEvent",
            {
              type: "mousePressed",
              x: command.x,
              y: command.y,
              button: command.button,
              clickCount: command.clickCount,
            },
            sessionId,
          );
          await connection.send(
            "Input.dispatchMouseEvent",
            {
              type: "mouseReleased",
              x: command.x,
              y: command.y,
              button: command.button,
              clickCount: command.clickCount,
            },
            sessionId,
          );
        });
        return;
      case "key": {
        const modifiers = command.modifiers.length;
        const base = {
          key: command.key,
          ...(command.code ? { code: command.code } : {}),
          modifiers,
        };
        await this.#withAttachmentRetry(async () => {
          await connection.send(
            "Input.dispatchKeyEvent",
            { type: command.text ? "keyDown" : "rawKeyDown", text: command.text ?? "", ...base },
            sessionId,
          );
          await connection.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
        });
        return;
      }
      case "text":
        await this.#withAttachmentRetry(() =>
          connection.send("Input.insertText", { text: command.text }, sessionId),
        );
        return;
      default: {
        const exhaustive: never = command;
        throw browserOperationError(
          "browser_command_invalid",
          `Unknown browser input command: ${JSON.stringify(exhaustive ?? null)}.`,
        );
      }
    }
  }

  /**
   * Runs one browser command.
   *
   * A restricted action is executed through the DevTools commands that
   * implement it. An action that needs an element map — the ones that act on
   * a specific element rather than on the page — is refused explicitly rather
   * than approximated: those belong to the browser-tools path, and guessing
   * where to click would be worse than refusing.
   *
   * A raw DevTools method is forwarded as-is. It reaches this method only
   * when the Full CDP switch is on; the runtime enforces that.
   */
  async sendCommand(
    command: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const connection = this.#connection;
    const sessionId = this.#pageSessionId;
    if (!connection || !sessionId) {
      throw browserOperationError(
        "browser_provider_unavailable",
        "The isolated Chromium is not running.",
        true,
      );
    }
    switch (command) {
      case "navigate": {
        const url = params.url;
        if (typeof url !== "string" || url.length === 0) {
          throw browserOperationError(
            "browser_command_invalid",
            "navigate needs a url.",
          );
        }
        return await this.#withAttachmentRetry(() =>
          connection.send("Page.navigate", { url }, sessionId),
        );
      }
      case "reload":
        return await this.#withAttachmentRetry(() =>
          connection.send("Page.reload", { ignoreCache: false }, sessionId),
        );
      case "back":
      case "forward": {
        const history = await connection.send<{
          entries?: readonly { id: number; url: string }[];
          currentIndex?: number;
        }>("Page.getNavigationHistory", {}, sessionId);
        const entries = history.entries ?? [];
        const index = history.currentIndex ?? 0;
        const next = command === "back" ? index - 1 : index + 1;
        const entry = entries[next];
        if (!entry) {
          throw browserOperationError(
            "browser_capability_denied",
            `There is nothing to ${command} in this page's history.`,
          );
        }
        return await this.#withAttachmentRetry(() =>
          connection.send("Page.navigateToHistoryEntry", { entryId: entry.id }, sessionId),
        );
      }
      case "screenshot": {
        return await this.#withAttachmentRetry(() =>
          connection.send("Page.captureScreenshot", { format: "png" }, sessionId),
        );
      }
      case "get_dom": {
        return await connection.send("DOM.getDocument", { depth: -1 }, sessionId);
      }
      case "open_tab": {
        const url = typeof params.url === "string" ? params.url : "about:blank";
        return await connection.send("Target.createTarget", { url });
      }
      default:
        break;
    }
    if (WEBUI_BROWSER_RESTRICTED_COMMANDS.includes(command as never)) {
      // A restricted action the isolated provider cannot execute without an
      // element map. Refusing is the honest answer: the page is not touched.
      throw browserOperationError(
        "browser_capability_denied",
        `The isolated Chromium cannot run the "${command}" action directly.`,
      );
    }
    // Not a restricted action: a raw DevTools method, which reaches this point
    // only when the Full CDP switch is on. The result is returned rather than
    // discarded: a command whose caller asked for a value — a runtime
    // evaluation, a document snapshot — would otherwise answer with nothing.
    return await this.#withAttachmentRetry(() =>
      connection.send(command, params, sessionId),
    );
  }

  async close(): Promise<void> {
    this.#streaming = false;
    this.#frameHandler = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#connection?.close();
    this.#connection = undefined;
    this.#child?.kill("SIGKILL");
    this.#child = undefined;
    await rm(this.#userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }

  #frameHandler: ((frame: WebuiBrowserImageFrame) => void) | undefined;
  readonly #targetChangeListeners = new Set<
    (change: WebuiBrowserTargetChange) => void
  >();

  /** Subscribes to "the page behind this target was replaced". */
  onTargetChanged(
    listener: (change: WebuiBrowserTargetChange) => void,
  ): () => void {
    this.#targetChangeListeners.add(listener);
    return () => {
      this.#targetChangeListeners.delete(listener);
    };
  }

  /**
   * Handles one CDP event.
   *
   * Only two matter here: the main frame navigating, which replaces the page
   * behind the target and raises its generation, and a screencast frame, which
   * is the panel's live image.
   */
  #onEvent(event: WebuiBrowserCdpEvent): void {
    if (event.method === "Page.frameNavigated" && event.sessionId === this.#pageSessionId) {
      const frame = event.params.frame as { parentId?: string } | undefined;
      // Only the main frame's navigation replaces the page. A subframe's
      // navigation leaves the page — and every reference recorded against it —
      // intact.
      if (frame && frame.parentId === undefined) {
        this.#generation += 1;
        this.#announceTargetChange();
      }
      return;
    }
    if (event.method === "Page.screencastFrame" && this.#streaming) {
      const data = event.params.data;
      const metadata = event.params.metadata as { deviceWidth?: number } | undefined;
      if (typeof data !== "string") return;
      const sessionId = event.params.sessionId;
      void this.#ackScreencastFrame(sessionId);
      this.#frameSequence += 1;
      this.#frameHandler?.({
        target: {
          surface: this.surface,
          browserId: this.browserId,
          targetId: this.#pageTargetId ?? "",
          generation: this.#generation,
        },
        data,
        format: "jpeg",
        sequence: this.#frameSequence,
      });
      void metadata;
      return;
    }
  }

  /**
   * Announces that the page behind the target was replaced.
   *
   * The target registry that lives above this provider cannot know about a
   * navigation on its own, so without this announcement an input recorded
   * against the previous page would still look current to it.
   */
  #announceTargetChange(): void {
    const targetId = this.#pageTargetId;
    if (!targetId) return;
    for (const listener of this.#targetChangeListeners) {
      try {
        listener({ targetId, generation: this.#generation });
      } catch {
        // A listener that throws must not take the browser down with it.
      }
    }
  }

  async #ackScreencastFrame(sessionId: unknown): Promise<void> {
    const connection = this.#connection;
    if (!connection || typeof sessionId !== "number") return;
    try {
      await connection.send("Page.screencastFrameAck", { sessionId });
    } catch {
      // An ack that fails means the browser stopped the stream; the stream's
      // own teardown reports it.
    }
  }

  /**
   * Runs a command, retrying while the page is not yet attached.
   *
   * The renderer is swapped during a navigation, and a command issued into
   * that window fails with `Not attached to an active page`. The failure is
   * transient and the retry window is bounded, so a genuinely broken page
   * still fails — it just fails with the original error rather than a timeout.
   */
  async #withAttachmentRetry<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + ATTACHMENT_RETRY_WINDOW_MS;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isAttachmentFailure(error)) throw error;
        await delay(ATTACHMENT_RETRY_DELAY_MS);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : browserOperationError("browser_provider_failed", "The browser page is not attached.");
  }
}

function isAttachmentFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof error.message === "string" &&
    error.message.includes("Not attached to an active page")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Finds a Chrome executable.
 *
 * The platform list is the same one the repository's own headless transport
 * uses, so the isolated browser and the runtime's browser behave the same on
 * a given machine.
 */
async function resolveChromePath(explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  for (const candidate of defaultChromeCandidates()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  throw browserOperationError(
    "browser_provider_unavailable",
    "No Chrome executable was found; set browser.chromePath to the browser to use.",
  );
}

function defaultChromeCandidates(): readonly string[] {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Chromium", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

/**
 * Waits for the browser to publish its DevTools endpoint.
 *
 * The endpoint is read from the `DevToolsActivePort` file the browser writes
 * rather than scraped from its output: the file is the browser's own
 * statement of where it is listening, and it avoids mistaking a log line for
 * an address.
 */
async function waitForDevToolsEndpoint(
  child: ChildProcess,
  activePortPath: string,
  timeoutMs = STARTUP_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw browserOperationError(
        "browser_provider_failed",
        `The browser exited during startup with code ${child.exitCode}.`,
      );
    }
    try {
      const endpoint = parseDevToolsActivePort(await readFile(activePortPath, "utf8"));
      if (endpoint) return endpoint;
    } catch {
      // The browser has not written the file yet.
    }
    await delay(STARTUP_POLL_INTERVAL_MS);
  }
  throw browserOperationError(
    "browser_operation_timeout",
    "The browser did not publish a DevTools endpoint in time.",
    true,
  );
}

function parseDevToolsActivePort(raw: string): string | undefined {
  const [port, path] = raw.trim().split("\n");
  if (!port || !path) return undefined;
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return `ws://127.0.0.1:${parsed}${path}`;
}
