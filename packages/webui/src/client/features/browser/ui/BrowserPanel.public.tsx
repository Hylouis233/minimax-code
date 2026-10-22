// The Browser panel.
//
// **This is a live image stream, not an embedded page.** The target site is
// shown by pointing an `<img>` at a `data:` URL built from the frame the provider
// delivered — never an `iframe`, never `srcdoc`, never a blob URL, never
// `dangerouslySetInnerHTML`. An embedded document would run with the WebUI's own
// origin and would hand the target page's scripts the session token sitting on
// `window.__WEBUI_CONFIG__`; the repository's other preview surface
// (`WorkspaceHtmlPreview.tsx`) states the same rule from the other direction, and
// this one needs none of that isolation machinery because an image cannot execute
// anything. The bytes never become a string this component renders.
//
// The second thing it is not is a passive picture. Pointer, keyboard and text
// gestures become `WebuiBrowserInputCommand`s through
// `../application/browser-commands.js` and leave through `onSendInput`, bound to
// the target's generation — so a panel showing a stale page cannot deliver a
// click to whatever replaced it, and a malformed gesture is refused here rather
// than pushed at the provider.
//
// The port, the capability manifest and the state are injected, and every side
// effect is a callback the shell owns. That keeps this file a projection of state
// a pure reducer already decided, and it keeps the rule that matters — the page
// on screen and the page the Agent drives are the same page — in the state,
// where it can be asserted without a browser.
//
// The panel used to carry a surface switcher at the top of the body: three
// radios, one for each of the surfaces the service knows about. That switcher
// is gone now — Edge and Chrome are reached in the person's own windows, and
// the only surface the panel sees is the isolated Chromium. The tab strip
// decides what target is on screen, and this panel is that target's picture.
//
// `.public` because the workspace panel mounts it: the Browser business publishes
// the panel and the workspace business renders it. Nothing else in this directory
// is mounted from outside.

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  isWebuiBrowserSurfaceAuthorized,
  type WebuiBrowserError,
  type WebuiBrowserInputCommand,
} from "../../../../shared/contracts/browser.js";
import { readWebuiCapability, type WebuiCapabilityView } from "../../../../shared/capability-manifest.js";
import type { BrowserPort } from "../contracts/browser-port.js";
import {
  WEBUI_BROWSER_CAPABILITY_NAME,
  type WebuiBrowserInputIntent,
  type WebuiBrowserPanelState,
} from "../contracts/browser-panel.js";
import {
  prepareWebuiBrowserInputCommand,
  webuiBrowserModifierFlags,
  webuiBrowserPointerButton,
} from "../application/browser-commands.js";
import {
  selectWebuiBrowserFrame,
  selectWebuiBrowserViewedTarget,
  webuiBrowserFrameDataUrl,
} from "../projection/browser-state.js";
import { webuiBrowserPicturePoint } from "../application/browser-commands.js";

const PANEL_COPY = {
  title: "浏览器",
  frameLabel: "浏览器画面",
  frameEmpty: "还没有画面。选择一个标签页，或等待浏览器推送第一帧。",
  frameNoTarget: "没有选中的标签页。",
  frameUnrenderable: "收到了一帧无法显示的画面数据，已忽略。",
  inputLabel: "浏览器输入区",
  unauthorized: "隔离浏览器未授权。请在设置的「浏览器」页中打开对应的浏览器开关。",
  absent: "当前运行时没有浏览器能力，浏览器面板不可用。",
  notReady: "浏览器能力尚未就绪（例如扩展未连接），面板暂时无法显示页面。",
  unknown: "当前运行时没有报告浏览器能力，面板按未授权处理。",
  changed: (generation: number) =>
    `标签页已更新到第 ${generation} 代，之前的输入不再有效。`,
  dropped: (count: number) => `已丢弃 ${count} 帧过期画面。`,
} as const;

export interface BrowserPanelProps {
  /**
   * The browser capability port. Optional and every member optional, like every
   * port in this package; an absent member means the host does not wire that
   * operation, which the panel states rather than discovers by calling.
   */
  readonly port?: BrowserPort;
  /** The projected panel state. Absent is the "nothing loaded yet" panel. */
  readonly state?: WebuiBrowserPanelState;
  /** The handshake manifest, so the panel can say *why* a family is unusable. */
  readonly capabilities?: WebuiCapabilityView;
  /**
   * The size the page is shown at.
   *
   * The browser's window takes it, so the page is drawn at the size the panel
   * shows it rather than scaled down into it. It is reported once the size has
   * settled: a window being dragged reports a size a dozen times a second, and
   * the browser would follow every one of them.
   */
  readonly onSurfaceSize?: (size: { readonly width: number; readonly height: number }) => void;
  /** Receives only commands that passed validation and the generation binding. */
  readonly onSendInput?: (command: WebuiBrowserInputCommand) => void;
  /** Receives every refusal, so a gesture that went nowhere is visible. */
  readonly onRejected?: (error: WebuiBrowserError) => void;
}

export function BrowserPanel({
  port,
  state,
  capabilities,
  onSurfaceSize,
  onSendInput,
  onRejected,
}: BrowserPanelProps): ReactElement {
  const surface = state?.surface ?? "isolated-chromium";
  const frame = state ? selectWebuiBrowserFrame(state) : undefined;
  // `undefined` here means the frame must not be rendered at all — an
  // unrecognised format or a payload outside the base64 alphabet gets no
  // element, rather than an element whose `src` guesses what it was given.
  const frameSrc = webuiBrowserFrameDataUrl(frame);
  // The client's cell: the page this tab holds. Everything below — the picture, the
  // alt text, the input binding — follows it, and none of it reads the run's
  // selection, which is a different page and belongs to the Agent.
  const viewed = state ? selectWebuiBrowserViewedTarget(state) : undefined;
  const authorized = state ? isWebuiBrowserSurfaceAuthorized(state.authorization, surface) : false;
  const capability = readWebuiCapability(capabilities, WEBUI_BROWSER_CAPABILITY_NAME);
  const inputEnabled = Boolean(viewed) && authorized && Boolean(port?.sendBrowserInput);

  const submit = useCallback(
    (intent: WebuiBrowserInputIntent) => {
      // Bound to the page in front, at send time: a gesture typed while the strip
      // moved to another tab lands on the tab the person is looking at, or is
      // refused — it is never re-aimed at whatever the Agent is doing.
      const result = prepareWebuiBrowserInputCommand(state?.viewedPage, intent);
      // The refusal path is the one that matters: a gesture that could not be
      // aimed has to be visible, because the alternative is a click that appears
      // to do nothing.
      if (!result.ok) {
        onRejected?.(result.error);
        return;
      }
      onSendInput?.(result.command);
    },
    [onRejected, onSendInput, state],
  );

  // The picture's own size, which is the browser's viewport: a click is mapped
  // into it.
  const frameRef = useRef<HTMLImageElement | null>(null);

  // The size the page is shown at, reported once it has settled.
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !onSurfaceSize) return;
    if (typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const rect = stage.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        onSurfaceSize({ width: rect.width, height: rect.height });
      }, 250);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(stage);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [onSurfaceSize]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!inputEnabled) return;
      // Measured against the picture, not against the surface: the picture is
      // the browser's viewport drawn to fit, so a click on the surface is not
      // yet a point in the browser. The point is mapped into the picture's own
      // size, or the click lands somewhere the person never pointed at.
      const rect = event.currentTarget.getBoundingClientRect();
      const point = webuiBrowserPicturePoint(rect, frameRef.current ?? undefined, event.clientX, event.clientY);
      submit({
        kind: "pointer",
        x: point.x,
        y: point.y,
        button: webuiBrowserPointerButton(event.button),
        // `detail` is 0 on a press that is not yet a click sequence in some
        // engines, and the command's contract wants a count of at least one.
        clickCount: Math.max(1, Math.trunc(event.detail)),
      });
    },
    [inputEnabled, submit],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!inputEnabled) return;
      event.preventDefault();
      // A composition is not a key. The browser is given the text the input
      // method made, or a Chinese word never reaches the page -- and the panel
      // has no field of its own to type it into.
      const composed = webuiBrowserComposedText(event);
      if (composed) {
        submit({ kind: "text", text: composed });
        return;
      }
      submit({
        kind: "key",
        key: event.key,
        code: event.code,
        // Only a single character is text; named keys such as `Enter` carry none.
        text: event.key.length === 1 ? event.key : undefined,
        modifiers: webuiBrowserModifierFlags(event),
      });
    },
    [inputEnabled, submit],
  );

  return (
    <section className="webui-browser-panel" data-testid="browser-panel" role="region" aria-label={PANEL_COPY.title}>
      {capability === "absent" ? (
        <p className="webui-browser-notice" role="status" data-testid="browser-panel-absent">
          {PANEL_COPY.absent}
        </p>
      ) : null}
      {capability === "not-ready" ? (
        <p className="webui-browser-notice" role="status" data-testid="browser-panel-not-ready">
          {PANEL_COPY.notReady}
        </p>
      ) : null}
      {capability === "unknown" ? (
        <p className="webui-browser-notice" role="status" data-testid="browser-panel-unknown">
          {PANEL_COPY.unknown}
        </p>
      ) : null}

      {state?.targetChange ? (
        <p className="webui-browser-notice" role="alert" data-testid="browser-panel-target-changed">
          {PANEL_COPY.changed(state.targetChange.target.generation)}
        </p>
      ) : null}
      {state?.droppedFrameCount ? (
        <p className="webui-browser-notice" role="status" data-testid="browser-panel-dropped-frames">
          {PANEL_COPY.dropped(state.droppedFrameCount)}
        </p>
      ) : null}
      {state?.error ? (
        <p
          className="webui-browser-notice is-error"
          role="alert"
          data-testid="browser-panel-error"
          data-error-code={state.error.code}
        >
          {state.error.message}
        </p>
      ) : null}
      {/*
        The unauthorized notice is about the *surface*, not about whether a tab
        happens to be listed, so it appears from the first paint of a panel whose
        browser switch is off. A family the host does not have, or has but cannot
        yet serve, is a different message and gets its own notice instead.
      */}
      {capability !== "absent" && capability !== "not-ready" && !authorized ? (
        <p className="webui-browser-notice" role="status" data-testid="browser-panel-unauthorized">
          {PANEL_COPY.unauthorized}
        </p>
      ) : null}

      <div className="webui-browser-stage" ref={stageRef}>
        {frameSrc ? (
            <img
              ref={frameRef}
              className="webui-browser-frame"
              data-testid="browser-panel-frame"
              data-format={frame?.format}
              data-frame-sequence={frame?.sequence}
              data-target-generation={frame?.target.generation}
              src={frameSrc}
              alt={viewed ? `${viewed.title || viewed.url} 的浏览器画面` : PANEL_COPY.frameLabel}
              draggable={false}
        />
      ) : (
        <p className="webui-browser-empty" role="status" data-testid="browser-panel-frame-empty">
          {frame ? PANEL_COPY.frameUnrenderable : viewed ? PANEL_COPY.frameEmpty : PANEL_COPY.frameNoTarget}
        </p>
      )}
      {/* The input surface covers the picture rather than sitting beside it:
          the coordinates it sends are measured against this element, so a
          target drawn next to the frame would aim at the wrong place. */}
      <div
        className="webui-browser-input"
        data-testid="browser-panel-input"
        role="application"
        aria-label={PANEL_COPY.inputLabel}
        tabIndex={inputEnabled ? 0 : -1}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      </div>
    </section>
  );
}

/**
 * The text an input method made, when the key event carries one.
 *
 * A composed word is not a key: it has no `code` of its own, it is longer
 * than a character, and the browser is given the text rather than a
 * keystroke. The two placeholders an input method reports instead of a word
 * are not text and are left to the key path.
 */
function webuiBrowserComposedText(event: ReactKeyboardEvent<HTMLDivElement>): string {
  const key = event.key;
  if (!key || key === "Process" || key === "Unidentified") return "";
  if (key.length < 2) return "";
  // A named key has a code of its own; a composed word does not.
  if (event.code) return "";
  return key;
}
