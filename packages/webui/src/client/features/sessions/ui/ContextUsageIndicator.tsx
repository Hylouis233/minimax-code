// The context-usage indicator.
//
// The composer's context gauge and its popover: the ring, the five-hour and weekly windows, the
// token-plan figures when the selected model is a plan model, the breakdown rows, and the placement
// arithmetic that keeps the popover inside the viewport. Its opted-in flag, hover and breakdown state
// live here; the composer passes the usage it read, the quota, and the selected model in.

import type { WebuiModelEntry } from "../../../../shared/contracts/models.js";
import type { WebuiUsageQuotaResult } from "../../../../shared/contracts/usage-quota.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { breakdownSegmentPercent, breakdownShareLabel, breakdownSwatchStyle, contextBreakdownRows, drawableBreakdownRows } from "../../../features/composer/projection/context-breakdown.js";
import {
  contextUsagePopoverStyle,
  positionContextUsagePopover,
  sameContextUsagePlacement,
  type ContextUsagePlacement,
} from "../../../features/composer/projection/context-usage-popover.js";
import { readUsageNumber } from "../../transcript/contracts/message-stream.js";
import { isTokenPlanModel } from "../../models/projection/token-plan-model.js";
import { formatUsageResetLabel } from "../../account/projection/usage.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

export function ContextUsageIndicator({ usage, usageQuota, planModel }: {
  readonly usage?: Record<string, unknown>;
  readonly usageQuota?: WebuiUsageQuotaResult;
  /** The selected model, for deciding whether the plan figures describe it. */
  readonly planModel?: WebuiModelEntry;
}): ReactElement | null {
  const { dom, storage } = useWebuiBrowserCapabilities();
  const [enabled, setEnabled] = useState(() => storage.getItem("webui-context-window-usage") !== "false");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Folded every time the panel opens, including on a re-open. The split is a
  // reading task the user opted into last time; carrying the state across
  // openings would make a glance at the panel land on six rows of percentages
  // because of something they did a minute ago.
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<ContextUsagePlacement | undefined>(undefined);
  /**
   * Place the panel from the ring's rectangle rather than from CSS offsets.
   *
   * It was `position: absolute` with `right: -4px` and `bottom: calc(100% + 8px)`,
   * which reads as "anchored to the ring" and is not. Those offsets resolve
   * against the nearest POSITIONED ancestor, and the session column above the
   * composer is `overflow: hidden` — so a 480px panel right-aligned to a ring
   * about a third of the way across that column reaches past the column's own
   * left edge and the clip silently takes the rest. On a 240px rail that is a
   * panel missing its heading, its figures and the label of every plan meter.
   *
   * `fixed` is the fix for THAT, and it is the same fix `flyout-position.ts`
   * gives the model fly-out for the same reason: an overlay has to escape the
   * surface that happens to contain it. It is not the whole fix — the composer
   * also sits inside a stacking context that the rail outranks, which no amount
   * of measuring from here can reach. See the overlay's own rule in the sheet.
   *
   * Measured on every render while open, because the panel is its own worst
   * witness: opening the disclosure adds six rows and a taller panel, which moves
   * the top edge and can push the last row off screen if the placement was frozen
   * at the closed height. `sameContextUsagePlacement` is what makes measuring
   * that often free.
   */
  const measurePanel = useCallback(() => {
    const anchor = anchorRef.current;
    const surface = surfaceRef.current;
    if (!anchor || !surface) return;
    const rect = surface.getBoundingClientRect();
    setPlacement((current) => {
      const next = positionContextUsagePopover({
        anchor: anchor.getBoundingClientRect(),
        surface: { width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      return sameContextUsagePlacement(current, next) ? current : next;
    });
  }, []);
  useLayoutEffect(() => {
    if (open) measurePanel();
  });
  useEffect(() => {
    if (!open) return undefined;
    // The ring is in a column that scrolls, and the panel is fixed, so without
    // this it would stay put while the composer moved out from under it.
    window.addEventListener("scroll", measurePanel, true);
    window.addEventListener("resize", measurePanel);
    return () => {
      window.removeEventListener("scroll", measurePanel, true);
      window.removeEventListener("resize", measurePanel);
    };
  }, [open, measurePanel]);
  useEffect(() => {
    const refresh = () => setEnabled(storage.getItem("webui-context-window-usage") !== "false");
    const stopStorage = dom.listenForStorageChange(refresh);
    const stopPreferenceChange = dom.listenForContextWindowUsageChange(refresh);
    return () => {
      stopStorage();
      stopPreferenceChange();
    };
  }, [dom, storage]);
  // The panel is a CLICK surface, not a hover one. It holds six breakdown rows
  // and a set of plan meters, and opening all of that under a pointer means
  // every pass across the composer — including the one en route to the send
  // button — throws a full panel over the transcript and then takes it away
  // again. A pointer crossing the ring now gets the ring's NAME and nothing
  // else, which is the only question a pointer can usefully ask about a
  // progress ring, and the click is what says "show me the numbers".
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    // `pointerdown` rather than `click` so the press that lands outside also
    // dismisses the panel instead of being swallowed by whatever is underneath.
    return dom.listenForPointerDown(onPointerDown, true);
  }, [dom, open]);
  if (!enabled || !usage) return null;
  // The runtime protocol's names, not invented ones — see
  // `server/projections/context-snapshot.ts`, which is the other half of this
  // read. The snake_case spellings are the wire's, so they are the primary
  // keys; the camelCase ones stay accepted because `WebuiUsageQuotaResult` and
  // the quota rows already publish that vocabulary, and a readout that renders
  // from one shape and not the other is a readout that half the time is blank.
  const used = readUsageNumber(usage, "total_tokens", "usedTokens", "used_tokens");
  const limit = readUsageNumber(
    usage,
    "context_window",
    "contextWindowTokens",
    "context_window_tokens",
  );
  if (used === undefined || used < 0 || limit === undefined || limit <= 0) return null;
  const percent = Math.min(100, Math.max(0, Math.round(used / limit * 100)));
  const circumference = 2 * Math.PI * 7;
  const label = `${percent}% · ${formatContextTokens(used)} / ${formatContextTokens(limit)} tokens`;
  // Always all six categories, in the reference's fixed order, with a dash for
  // whatever the engine did not report. See `features/composer/projection/context-breakdown.ts`
  // for why a missing category is a dash and not `0.0%`.
  const breakdownRows = contextBreakdownRows(usage.components, used);
  const drawableRows = drawableBreakdownRows(breakdownRows);
  // Whether the engine accounted for ANY of the used tokens, which is the only
  // thing this decides: with nothing to subdivide, the bar draws as one solid
  // fill of the window instead of as segments. It is not the bar's denominator
  // — that is the window, and the two being confused is what made a 43% session
  // draw a full bar.
  const componentsTotal = drawableRows.reduce(
    (total, row) => total + (row.tokens ?? 0),
    0,
  );
  // The plan meters describe the ACCOUNT's subscription, so they only belong
  // here when the selected model is one that subscription pays for. Beside
  // anyone else's model they were a claim about a plan that provider does not
  // sell — the same numbers, under the wrong heading, for the wrong bill.
  const quotaResult = usageQuota?.signedIn && isTokenPlanModel(planModel) ? usageQuota : undefined;
  const quota = quotaResult?.quota;
  const planLabel = quotaResult?.tokenPlanTier ?? (quotaResult?.hasTokenPlan ? "Token Plan" : "未订阅 Token Plan");
  const quotaRows = quota ? [
    { label: "5 小时限额", window: quota.fiveHour },
    { label: "周限额", window: quota.weekly },
    ...(quota.video ? [{ label: "视频限额", window: quota.video }] : []),
  ] : [];
  return (
    <div
      ref={anchorRef}
      className="webui-context-usage-anchor"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="webui-context-usage-trigger"
        aria-label={`上下文窗口使用 ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`上下文窗口 ${label}`}
        data-testid="composer-context-usage"
        onClick={() => {
          setOpen((value) => !value);
          setBreakdownOpen(false);
        }}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true">
          <circle className="webui-context-usage-track" cx="9" cy="9" r="7" />
          <circle
            className="webui-context-usage-value"
            cx="9"
            cy="9"
            r="7"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: circumference * (1 - percent / 100),
            }}
          />
        </svg>
      </button>
      {/*
        The hover label, and it is the WHOLE of what hovering produces. A ring
        with no name is the one control in the toolbar that says nothing about
        what it measures; naming it costs one line, and the alternative — the
        full panel under the pointer — costs a panel over the transcript on
        every pass towards the send button.

        The name only, not the percentage: the panel is one click away and
        already opens on this control, so a tooltip carrying figures would be a
        second readout of the same ring at a different size. `aria-hidden`
        because the button's own label already announces it, and a bubble that
        duplicates what assistive technology was just told is read twice.
      */}
      <span
        className="webui-context-usage-label"
        aria-hidden="true"
        data-webui-context-usage-label={hovered && !open ? "true" : "false"}
      >
        上下文窗口
      </span>
      <div
        ref={surfaceRef}
        className={`webui-context-usage-popover${open ? " is-open" : ""}`}
        role="dialog"
        aria-label="上下文窗口使用情况"
        aria-hidden={!open}
        style={placement ? contextUsagePopoverStyle(placement) : undefined}
      >
          {/*
            The heading is the panel's own disclosure control. The panel opens
            showing how full the window is and how much of the plan is left —
            the two things a glance is for — and the six-category split stays
            folded until asked for, because six rows of percentages is a reading
            task, not a glance, and the user who wants it is already looking at
            a panel they opened on purpose.

            The chevron is the whole affordance. A caret beside a number is the
            convention for "there is more under this", and adding
            a separate "详情" control next to it would be two controls for one
            section.
          */}
          <button
            type="button"
            className="webui-context-usage-heading webui-context-usage-disclosure"
            aria-expanded={breakdownOpen}
            aria-controls="webui-context-usage-breakdown"
            data-webui-context-disclosure={breakdownOpen ? "open" : "closed"}
            onClick={() => setBreakdownOpen((value) => !value)}
          >
            <span>上下文窗口</span>
            <span className="webui-context-usage-heading-value">
              {percent}%
              <span
                aria-hidden="true"
                className={`webui-context-usage-chevron${breakdownOpen ? " is-open" : ""}`}
              >
                <svg viewBox="0 0 16 16">
                  <path d="M4 6.5 8 10.5 12 6.5" />
                </svg>
              </span>
            </span>
          </button>
          <div
            className="webui-context-usage-bar"
            role="progressbar"
            aria-label="上下文窗口使用量"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            {componentsTotal > 0 ? drawableRows.map((row) => (
              <span
                key={row.kind}
                className="webui-context-usage-bar-segment"
                style={{ width: `${breakdownSegmentPercent(row, limit)}%`, ...breakdownSwatchStyle(row) }}
              />
            )) : <span style={{ width: `${percent}%` }} />}
          </div>
          <div className="webui-context-usage-tokens">{formatContextTokens(used)} / {formatContextTokens(limit)} tokens</div>
          {/*
            Hidden rather than unmounted, so the bar's segment widths above and
            the panel's height do not both jump on the first open. `hidden` is
            also what keeps the six rows out of the tab order and out of the
            accessibility tree while they are folded.
          */}
          <div
            id="webui-context-usage-breakdown"
            className="webui-context-usage-components"
            aria-label="上下文构成"
            data-webui-context-breakdown={breakdownOpen ? "open" : "closed"}
            hidden={!breakdownOpen}
          >
            {breakdownRows.map((row) => (
              <div
                className="webui-context-usage-component"
                key={row.kind}
                data-webui-context-category={row.kind}
                data-webui-context-reported={row.tokens === null ? "false" : "true"}
              >
                <span className="webui-context-usage-component-label">
                  <span
                    className="webui-context-usage-swatch"
                    style={breakdownSwatchStyle(row)}
                  />
                  {row.label}
                </span>
                <span>{breakdownShareLabel(row)}</span>
              </div>
            ))}
          </div>
          {quotaResult ? (
            <>
              <div className="webui-context-usage-divider" />
              <div className="webui-context-usage-plan">套餐用量 · {planLabel}</div>
              {quotaRows.length > 0 ? quotaRows.map(({ label: quotaLabel, window }) => {
                const usedPercent = "usedPercent" in window ? window.usedPercent : undefined;
                const totalPercent = "totalPercent" in window ? window.totalPercent : undefined;
                const videoUsed = "usedCount" in window ? window.usedCount : undefined;
                const videoTotal = "totalCount" in window ? window.totalCount : undefined;
                const progress = usedPercent ?? (videoUsed !== undefined && videoTotal ? videoUsed / videoTotal * 100 : undefined);
                const value = window.unlimited
                  ? "无限制"
                  : usedPercent !== undefined
                    ? `${usedPercent}% / ${totalPercent ?? 100}%`
                    : videoUsed !== undefined && videoTotal !== undefined
                      ? `${videoUsed} / ${videoTotal}`
                      : "—";
                const reset = formatUsageResetLabel(window.resetAtMs);
                return (
                  <div className="webui-context-usage-quota" key={quotaLabel}>
                    <div className="webui-context-usage-heading"><span>{quotaLabel}</span><span>{value}</span></div>
                    <div className="webui-context-usage-quota-bar"><span style={{ width: `${Math.max(0, Math.min(100, progress ?? 0))}%` }} /></div>
                    {reset ? <div className="webui-context-usage-reset">{reset}</div> : null}
                  </div>
                );
              }) : <div className="webui-context-usage-tokens">当前套餐没有可显示的限额</div>}
            </>
          ) : null}
      </div>
    </div>
  );
}

function formatContextTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}
