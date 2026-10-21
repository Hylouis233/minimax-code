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
// `.public` because the workspace panel mounts it: the Browser business publishes
// the panel and the workspace business renders it. Nothing else in this directory
// is mounted from outside.

import {
  useCallback,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  WEBUI_BROWSER_SURFACES,
  isWebuiBrowserSurfaceAuthorized,
  type WebuiBrowserError,
  type WebuiBrowserInputCommand,
  type WebuiBrowserSurface,
  type WebuiBrowserTargetId,
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
  selectWebuiBrowserSelectedTarget,
  webuiBrowserFrameDataUrl,
} from "../projection/browser-state.js";

const SURFACE_LABELS: Readonly<Record<WebuiBrowserSurface, string>> = {
  "isolated-chromium": "隔离浏览器",
  edge: "Microsoft Edge",
  chrome: "Google Chrome",
};

const PANEL_COPY = {
  title: "浏览器",
  targetListLabel: "浏览器标签页",
  frameLabel: "浏览器画面",
  frameEmpty: "还没有画面。选择一个标签页，或等待浏览器推送第一帧。",
  frameNoTarget: "没有选中的标签页。",
  frameUnrenderable: "收到了一帧无法显示的画面数据，已忽略。",
  inputLabel: "浏览器输入区",
  inputHint: "点击画面后可在此输入文字。",
  textInputLabel: "发送到浏览器的文字",
  noTargets: "当前浏览器没有可显示的标签页。",
  unauthorized: "该浏览器未授权。请在设置的「浏览器」页中打开对应的浏览器开关。",
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
  readonly onSelectTarget?: (target: WebuiBrowserTargetId) => void;
  readonly onSurfaceChange?: (surface: WebuiBrowserSurface) => void;
  /** Receives only commands that passed validation and the generation binding. */
  readonly onSendInput?: (command: WebuiBrowserInputCommand) => void;
  /** Receives every refusal, so a gesture that went nowhere is visible. */
  readonly onRejected?: (error: WebuiBrowserError) => void;
}

export function BrowserPanel({
  port,
  state,
  capabilities,
  onSelectTarget,
  onSurfaceChange,
  onSendInput,
  onRejected,
}: BrowserPanelProps): ReactElement {
  const surface = state?.surface ?? "isolated-chromium";
  const frame = state ? selectWebuiBrowserFrame(state) : undefined;
  // `undefined` here means the frame must not be rendered at all — an
  // unrecognised format or a payload outside the base64 alphabet gets no
  // element, rather than an element whose `src` guesses what it was given.
  const frameSrc = webuiBrowserFrameDataUrl(frame);
  const selected = state ? selectWebuiBrowserSelectedTarget(state) : undefined;
  const authorized = state ? isWebuiBrowserSurfaceAuthorized(state.authorization, surface) : false;
  const capability = readWebuiCapability(capabilities, WEBUI_BROWSER_CAPABILITY_NAME);
  const inputEnabled = Boolean(selected) && authorized && Boolean(port?.sendBrowserInput);

  const submit = useCallback(
    (intent: WebuiBrowserInputIntent) => {
      if (!state) return;
      const result = prepareWebuiBrowserInputCommand(state, intent);
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

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!inputEnabled) return;
      // Measured against the input surface rather than the page, so the point the
      // user chose is the point the command carries.
      const rect = event.currentTarget.getBoundingClientRect();
      submit({
        kind: "pointer",
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
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

  const onTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const field = event.target;
      if (field.value.length === 0) return;
      submit({ kind: "text", text: field.value });
      // Cleared after sending, so the next insertion is a new one rather than an
      // append onto what the page already received.
      field.value = "";
    },
    [submit],
  );

  const targets = state?.targets ?? [];

  return (
    <section className="webui-browser-panel" data-testid="browser-panel" role="region" aria-label={PANEL_COPY.title}>
      <header className="webui-browser-panel-header">
        <h3 className="webui-browser-panel-title">{PANEL_COPY.title}</h3>
        <div className="webui-browser-surfaces" role="group" aria-label={PANEL_COPY.title}>
          {WEBUI_BROWSER_SURFACES.map((candidate) => {
            const allowed = state ? isWebuiBrowserSurfaceAuthorized(state.authorization, candidate) : false;
            return (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={candidate === surface}
                aria-label={SURFACE_LABELS[candidate]}
                data-testid={`browser-surface-${candidate}`}
                data-authorized={allowed ? "true" : "false"}
                className={candidate === surface ? "webui-browser-surface is-active" : "webui-browser-surface"}
                onClick={() => onSurfaceChange?.(candidate)}
              >
                {SURFACE_LABELS[candidate]}
              </button>
            );
          })}
        </div>
      </header>

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

      <div className="webui-browser-body">
        <div
          className="webui-browser-targets"
          role="group"
          aria-label={PANEL_COPY.targetListLabel}
          data-testid="browser-target-list"
        >
          {targets.length === 0 ? (
            <p className="webui-browser-empty" role="status" data-testid="browser-panel-no-targets">
              {PANEL_COPY.noTargets}
            </p>
          ) : (
            <ul className="webui-browser-target-list" data-testid="browser-target-items">
              {targets.map((target) => (
                <li key={`${target.id.browserId}:${target.id.targetId}:${target.id.generation}`}>
                  <button
                    type="button"
                    aria-current={target.selected ? "true" : undefined}
                    data-testid={`browser-target-${target.id.browserId}-${target.id.targetId}`}
                    data-target-generation={target.id.generation}
                    data-target-status={target.status}
                    className={target.selected ? "webui-browser-target is-active" : "webui-browser-target"}
                    onClick={() => onSelectTarget?.(target.id)}
                  >
                    <strong>{target.title || target.url}</strong>
                    <span className="webui-browser-target-url">{target.url}</span>
                    <span className="webui-browser-target-meta">
                      {`${SURFACE_LABELS[target.id.surface]} · 第 ${target.id.generation} 代 · ${target.status === "open" ? "已打开" : "已关闭"}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="webui-browser-stage">
          {frameSrc ? (
            <img
              className="webui-browser-frame"
              data-testid="browser-panel-frame"
              data-format={frame?.format}
              data-frame-sequence={frame?.sequence}
              data-target-generation={frame?.target.generation}
              src={frameSrc}
              alt={selected ? `${selected.title || selected.url} 的浏览器画面` : PANEL_COPY.frameLabel}
              draggable={false}
            />
          ) : (
            <p className="webui-browser-empty" role="status" data-testid="browser-panel-frame-empty">
              {frame ? PANEL_COPY.frameUnrenderable : selected ? PANEL_COPY.frameEmpty : PANEL_COPY.frameNoTarget}
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
            aria-describedby="browser-panel-input-hint"
            tabIndex={inputEnabled ? 0 : -1}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
          >
            <span id="browser-panel-input-hint" className="webui-browser-input-hint">
              {PANEL_COPY.inputHint}
            </span>
            <input
              type="text"
              className="webui-browser-text"
              data-testid="browser-panel-text-input"
              aria-label={PANEL_COPY.textInputLabel}
              disabled={!inputEnabled}
              onChange={onTextChange}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
