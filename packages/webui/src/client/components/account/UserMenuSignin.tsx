// The daily check-in panel (ticket #74; §15.1's `UserMenuSignin.tsx` row).
//
// It is the menu's check-in surface: the artwork, the streak progress, the credits row and the claim
// button, plus the three copy helpers that turn the owner's answers into the panel's strings. It holds
// no open/closed state and submits nothing itself — the menu owns both, because §5.7 LC-7/LC-8 make
// the two panels mutually exclusive and dismissed together, and that bookkeeping is the menu's.

import { Fragment, useState, type ReactElement } from "react";
import {
  SigninDayStatus,
  getCurrentSigninStreak,
  isSigninPanelClaimable,
  isSigninPanelClaimedToday,
} from "@mavis/shared/daily-signin";
import type { WebuiSigninPanelView } from "../../../shared/contracts/account.js";

export interface SigninState {
  readonly loading: boolean;
  readonly panel?: WebuiSigninPanelView;
  readonly claiming: boolean;
  readonly error?: string;
}

/** zh copy, verbatim from the desktop i18n dictionary's `signin.*` keys. */
export const SIGNIN = {
  title: "每日签到",
  subtitle: "连续签到得更多积分",
  streakBefore: "本轮已连续签到 ",
  streakAfter: " 天",
  claimEarn: "签到得",
  bonusPrefix: "额外",
  claiming: "签到中…",
  claimedToday: "今日已签到",
  unavailable: "暂不可签到",
  error: "签到暂时不可用，请稍后重试",
  invalidResponse: "签到数据暂不可用",
  retry: "重试",
  progress: "签到进度",
  creditsInfo: "签到积分 30 天有效，仅限 MiniMax Code 使用。",
  creditsLink: "查看用量",
  creditsAria: "关于签到积分",
} as const;

function signinStatusText(status: number): string {
  return status === SigninDayStatus.Claimed
    ? "已签到"
    : status === SigninDayStatus.Claimable
      ? "今日可签到"
      : status === SigninDayStatus.Disabled
        ? "不可签到"
        : "未到签到日";
}

function formatSigninPoints(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatSigninError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid sign-in/iu.test(message) ? SIGNIN.invalidResponse : SIGNIN.error;
}

function SigninInfoIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 1.5C11.5899 1.5 14.5 4.41015 14.5 8C14.5 11.5899 11.5899 14.5 8 14.5C4.41016 14.5 1.5 11.5898 1.5 8C1.5 4.41016 4.41016 1.50002 8 1.5ZM8 2.5C4.96245 2.50002 2.5 4.96244 2.5 8C2.5 11.0376 4.96245 13.5 8 13.5C11.0376 13.5 13.5 11.0376 13.5 8C13.5 4.96243 11.0376 2.5 8 2.5ZM8 7.5C8.27614 7.5 8.5 7.72386 8.5 8V10.667C8.49982 10.943 8.27603 11.167 8 11.167C7.72397 11.167 7.50018 10.943 7.5 10.667V8C7.5 7.72386 7.72386 7.5 8 7.5ZM8.00684 4.83301C8.28279 4.8331 8.50666 5.05707 8.50684 5.33301C8.50684 5.60909 8.2829 5.83292 8.00684 5.83301H8C7.72386 5.83301 7.5 5.60915 7.5 5.33301C7.50018 5.05702 7.72397 4.83301 8 4.83301H8.00684Z" fill="currentColor" />
    </svg>
  );
}

/** Check mark inside a day dot (desktop `L.cvi`, size 14). */
function SigninCheckIcon(): ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" className="signin-day-check" aria-hidden="true">
      <path d="M3.125 9.11857L8.0609 16.1699L16.875 3.83011" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Credits glyph in the claim button / bonus tag (desktop `L.J8f`). */
function SigninCreditsIcon({ size }: { readonly size: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M7.96545 1.35282C11.5553 1.35282 14.4654 4.26303 14.4655 7.85282C14.4655 11.4427 11.5553 14.3528 7.96545 14.3528C4.37566 14.3528 1.46545 11.4426 1.46545 7.85282C1.46553 4.26307 4.3757 1.35288 7.96545 1.35282ZM7.96545 2.35282C4.92799 2.35288 2.46553 4.81535 2.46545 7.85282C2.46545 10.8903 4.92794 13.3528 7.96545 13.3528C11.003 13.3528 13.4655 10.8904 13.4655 7.85282C13.4654 4.81531 11.003 2.35282 7.96545 2.35282ZM7.30042 4.30497C7.61361 3.7846 8.38548 3.7848 8.69885 4.30497L8.75842 4.42508L9.54163 6.34501L11.4625 7.12918C12.1426 7.40684 12.1426 8.36911 11.4625 8.64676L9.54163 9.42997L8.75842 11.3509C8.48077 12.0309 7.5185 12.0309 7.24084 11.3509L6.45667 9.42997L4.53674 8.64676C3.85714 8.36894 3.85705 7.40692 4.53674 7.12918L6.45667 6.34501L7.24084 4.42508L7.30042 4.30497ZM7.35413 6.79325C7.27083 6.9971 7.10875 7.15917 6.90491 7.24247L5.32288 7.88797L6.90491 8.53348C7.08319 8.60633 7.22941 8.73993 7.31897 8.90848L7.35413 8.9827L7.99963 10.5638L8.64514 8.9827C8.7284 8.77895 8.89064 8.6168 9.09436 8.53348L10.6754 7.88797L9.09436 7.24247C8.89069 7.15913 8.72838 6.99697 8.64514 6.79325L7.99963 5.21122L7.35413 6.79325Z" fill="currentColor" />
    </svg>
  );
}

/** Dotted connector between day dots (desktop `eK`). */
function SigninConnector({ className = "" }: { readonly className?: string }): ReactElement {
  return (
    <svg aria-hidden="true" focusable="false" className={`signin-connector ${className}`}>
      <line x1="0" y1="0.6" x2="100%" y2="0.6" stroke="currentColor" strokeWidth="1.2" strokeDasharray="0 2" strokeLinecap="round" />
    </svg>
  );
}

/** Light/dark artwork pair (desktop `eH`). */
function SigninArtwork({
  lightUrl,
  darkUrl,
  className,
}: {
  readonly lightUrl: string;
  readonly darkUrl: string;
  readonly className?: string;
}): ReactElement {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const dark = darkUrl ?? lightUrl;
  return (
    <div className={className} aria-hidden="true">
      {([["light", lightUrl], ["dark", dark]] as const).map(([mode, url]) =>
        !failed.includes(url) ? (
          <img
            key={`${mode}:${url}`}
            src={url}
            alt=""
            draggable={false}
            className={mode === "light" ? "block dark:hidden" : "hidden dark:block"}
            onError={() => setFailed((list) => [...list, url])}
          />
        ) : null,
      )}
    </div>
  );
}

function SigninSkeleton(): ReactElement {
  return (
    <div data-testid="signin-card-skeleton" className="relative animate-pulse">
      <div className="ml-1 h-5 w-28 rounded bg-bg_default_tertiary" />
      <div className="ml-1 mt-1 h-4 w-36 rounded bg-bg_default_tertiary" />
      <div className="signin-progress mt-8">
        {Array.from({ length: 7 }, (_, index) => (
          <Fragment key={index}>
            {index > 0 ? <SigninConnector /> : null}
            <div className="signin-day">
              <div className="size-[22px] rounded-full bg-bg_default_tertiary" />
              <div className="h-[14px] w-6 rounded bg-bg_default_tertiary" />
            </div>
          </Fragment>
        ))}
      </div>
      <div className="mt-7 h-8 rounded-lg bg-bg_default_tertiary" />
    </div>
  );
}

/** Seven-day progress row (desktop `eY`). */
function SigninProgress({
  days,
  animatedDay,
}: {
  readonly days: WebuiSigninPanelView["days"];
  readonly animatedDay: number | null;
}): ReactElement {
  const sorted = [...days].sort((left, right) => left.day_no - right.day_no);
  return (
    <div className="signin-progress-scroll">
      <div role="list" aria-label={SIGNIN.progress} className="signin-progress">
        {sorted.map((day, index) => {
          const claimed = day.status === SigninDayStatus.Claimed;
          const claimable = day.status === SigninDayStatus.Claimable;
          const previous = index > 0 ? sorted[index - 1] : undefined;
          const connectorActive =
            previous?.status === SigninDayStatus.Claimed && (claimed || claimable);
          return (
            <Fragment key={day.day_no}>
              {index > 0 ? (
                <SigninConnector
                  className={connectorActive ? "text-text_default_accent opacity-50" : "text-border_default"}
                />
              ) : null}
              <div
                role="listitem"
                data-testid={`signin-day-${day.day_no}`}
                data-status={day.status}
                aria-label={`第 ${day.day_no} 天，${signinStatusText(day.status)}，${formatSigninPoints(day.points)} 积分`}
                aria-current={day.is_today ? "date" : undefined}
                className={`signin-day ${claimed ? "text-text_default_accent opacity-50" : claimable ? "text-text_default_accent" : "text-text_default_tertiary"}`}
              >
                <span
                  aria-hidden="true"
                  className={`signin-day-dot ${claimable ? "bg-text_default_accent text-text_default_inverted_static" : ""} ${claimed && animatedDay === day.day_no ? "signin-day-claimed-animation" : ""}`}
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 22 22"
                    fill="none"
                    className={`signin-day-ring ${claimed || claimable ? "stroke-border_accent" : "stroke-border_default"}`}
                  >
                    <circle cx="11" cy="11" r="10.4" strokeWidth="1.2" />
                  </svg>
                  {claimed || claimable ? <SigninCheckIcon /> : null}
                </span>
                <span
                  aria-hidden="true"
                  data-testid={`signin-day-reward-${day.day_no}`}
                  className="signin-day-points"
                >
                  {formatSigninPoints(day.points)}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Title row with the credits-info tooltip trigger (desktop `eU` + h2 row). */
function SigninCreditsInfo({ onNavigateToUsage }: { readonly onNavigateToUsage: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span className="webui-signin-credits-anchor">
      <button
        type="button"
        aria-label={SIGNIN.creditsAria}
        className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-icon_default_tertiary transition-colors hover:text-icon_default_primary focus-visible:outline-none focus-visible:text-icon_default_primary"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <SigninInfoIcon />
      </button>
      {open ? (
        <span role="tooltip" className="webui-signin-credits-tooltip">
          <span className="text-xs leading-[18px]">
            <span>{SIGNIN.creditsInfo} </span>
            <button
              type="button"
              className="webui-signin-credits-link"
              onClick={() => {
                setOpen(false);
                onNavigateToUsage();
              }}
            >
              {SIGNIN.creditsLink}
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The daily check-in card: DOM, classes and copy ported from the desktop's
 * `signin-card` (menu context: `showCloseButton=false`,
 * `autoDismissAfterClaim=false`, `trackView=false`).
 */
export function SigninCard({
  panel,
  loading,
  claiming,
  error,
  animatedDay,
  onClaim,
  onRetry,
  onNavigateToUsage,
}: {
  readonly panel?: WebuiSigninPanelView;
  readonly loading: boolean;
  readonly claiming: boolean;
  readonly error?: string;
  readonly animatedDay: number | null;
  readonly onClaim: () => void;
  readonly onRetry: () => void;
  readonly onNavigateToUsage: () => void;
}): ReactElement {
  const streak = panel ? getCurrentSigninStreak(panel.days) : 0;
  const today = panel?.days.find((day) => day.is_today);
  const claimableDay =
    panel?.days.find((day) => day.is_today && day.status === SigninDayStatus.Claimable) ??
    panel?.days.find((day) => day.status === SigninDayStatus.Claimable);
  const claimable = panel ? isSigninPanelClaimable(panel) : false;
  const claimedToday = panel ? isSigninPanelClaimedToday(panel) : false;
  const bonus = today?.bonus_points ?? 0;
  const points = formatSigninPoints(claimableDay?.points ?? 0);
  const buttonLabel = claiming
    ? SIGNIN.claiming
    : claimedToday
      ? SIGNIN.claimedToday
      : panel && !claimable
        ? SIGNIN.unavailable
        : `${SIGNIN.claimEarn} ${points}`;

  return (
    <section data-testid="signin-card" aria-label={SIGNIN.title} className="signin-card-container">
      <div className="signin-card-surface relative rounded-2xl border-[0.5px] border-border_default bg-bg_grouped_secondary p-3 text-text_default_primary">
        <div className="signin-corner-clip" aria-hidden="true">
          <SigninArtwork
            lightUrl="/assets/img/corner-light.svg"
            darkUrl="/assets/img/corner-dark.svg"
            className="signin-corner-default"
          />
        </div>
        {loading && !panel ? (
          <SigninSkeleton />
        ) : panel ? (
          <>
            <div className="relative min-h-10 pl-1">
              <div className="flex min-h-5 items-start gap-1 pr-20">
                <h2 className="m-0 min-w-0 text-sm font-medium leading-5 break-words">
                  {SIGNIN.title}
                </h2>
                <SigninCreditsInfo onNavigateToUsage={onNavigateToUsage} />
              </div>
              {streak > 0 ? (
                <p data-testid="signin-streak" className="mb-0 mt-1 text-xs leading-4 text-text_default_secondary">
                  {SIGNIN.streakBefore}
                  <span className="text-text_default_accent">{streak}</span>
                  {SIGNIN.streakAfter}
                </p>
              ) : (
                <p className="mb-0 mt-1 text-xs leading-4 text-text_default_secondary">
                  {SIGNIN.subtitle}
                </p>
              )}
            </div>
            <div className="relative mt-8">
              <SigninProgress days={panel.days} animatedDay={animatedDay} />
              <div className="relative mt-7">
                {claimable ? (
                  <button
                    type="button"
                    className="signin-claim-button mavis-button black h-8 w-full rounded-lg text-sm font-medium"
                    disabled={claiming}
                    aria-label={buttonLabel}
                    onClick={onClaim}
                  >
                    {claiming ? (
                      <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-0.5">
                        <span className="webui-signin-claim-spinner" aria-hidden="true" />
                        <span className="truncate">{SIGNIN.claiming}</span>
                      </span>
                    ) : (
                      <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-0.5">
                        <span className="truncate">{SIGNIN.claimEarn}</span>
                        <span aria-hidden="true" className="inline-flex shrink-0">
                          <SigninCreditsIcon size={16} />
                        </span>
                        <span className="shrink-0">{points}</span>
                      </span>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-label={buttonLabel}
                    className="h-8 w-full cursor-default rounded-lg border-0 bg-bg_interaction_primary_inactive p-0 text-sm font-medium text-text_label_primary_inactive"
                  >
                    {buttonLabel}
                  </button>
                )}
                {bonus > 0 ? (
                  <span
                    data-testid="signin-bonus"
                    className="signin-bonus-tag absolute right-0 top-[-9.5px] inline-flex max-w-full items-center gap-0.5 rounded-t-xl rounded-bl-xl bg-bg_interaction_accent_focus_blue px-2 py-0.5 text-xs font-medium leading-4 text-text_default_inverted_static"
                  >
                    <span className="truncate">{SIGNIN.bonusPrefix}</span>
                    <span aria-hidden="true" className="inline-flex shrink-0">
                      <SigninCreditsIcon size={12} />
                    </span>
                    <span className="shrink-0">{formatSigninPoints(bonus)}</span>
                  </span>
                ) : null}
              </div>
            </div>
            {error ? (
              <p role="alert" className="mb-0 mt-2 text-xs text-text_default_secondary">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <div
            data-testid="signin-card-error"
            role="alert"
            className="relative mt-8 flex min-h-[104px] flex-col items-center justify-center gap-2 px-4 text-center"
          >
            <p className="m-0 text-xs leading-4 text-text_default_secondary">
              {error ?? SIGNIN.error}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="border-0 bg-transparent p-0 text-xs font-medium text-text_default_accent hover:underline"
            >
              {SIGNIN.retry}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
