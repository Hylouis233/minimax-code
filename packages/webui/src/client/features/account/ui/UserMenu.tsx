// The rail's account menu and the shell around its two panels.
//
// This file is what is left after the check-in panel and the quota popover moved out: the menu button,
// the popover's four items, the account/usage/check-in snapshot reads, and the effect that loads
// the account when the menu opens.
//
// **The open/closed flags and the mutual exclusion stay here**: `loadUsage` opens
// usage and closes check-in (and `loadSignin` the reverse), every close — the outside pointer,
// Escape, or the trigger — takes both panels down together,
// and neither panel can be dismissed from inside itself. The panels load on hover, focus or
// click — never on mount — and this file keeps those handlers. Each panel owns only its own
// presentation.
//
// The menu's own surface is the shared dropdown skeleton: it owns the popup's placement, its
// motion and its dismissal, so the outside-pointer and Escape listeners this file used to carry
// are gone. What is left here is the open state and the two panels.

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { WebuiIconBell, WebuiIconBrand, WebuiIconCommandUsage } from "../../../shell/icons.js";
import { SigninClaimResult } from "@mavis/shared/daily-signin";
import { SettingsModal } from "../../settings/ui/SettingsModal.public.js";
import { AccountLoginDialog } from "./AccountLoginDialog.js";
import type { MemoryHandoff } from "../../settings/contracts/memory-handoff.js";
import type { WebuiVersionInfo } from "../../../../shared/contracts/version.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { useWebuiAccountWorkflows, useWebuiAccountWorkflowsState } from "../bindings/use-account-workflows.public.js";
import { SIGNIN, SigninCard, formatSigninError, type SigninState } from "./UserMenuSignin.js";
import { UsagePanel, type UsageState } from "./UserMenuUsage.js";

type AccountStatus = Record<string, unknown>;

interface UserMenuProps {
  readonly collapsed: boolean;
  readonly hostLabel?: string;
  readonly dataDir?: string;
  readonly version?: WebuiVersionInfo;
  readonly sessionId?: string;
  /** Forwarded to the settings modal so the code-review page knows which
   *  workspace to read a change set from. */
  readonly workspaceDir?: string;
  /** Forwarded to the settings modal. The review page turns a diff line into
   *  a real editor jump through it. */
  readonly onOpenFileLine?: (path: string, line: number) => void;
  /** Forwarded to the settings modal, which owns 记忆摘要's 「在会话中创建」.
   *  The menu neither interprets nor stores it. */
  readonly onCreateMemorySession?: (input: MemoryHandoff) => void;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function accountString(account: AccountStatus | undefined, key: string): string | undefined {
  const candidates = [
    account?.[key],
    objectValue(account?.account)?.[key],
    objectValue(account?.user)?.[key],
    objectValue(account?.profile)?.[key],
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function UsageGlyph({ kind }: { readonly kind: "settings" | "signin" }): ReactElement {
  const path = kind === "settings"
    ? "M10 2.5 11.2 4.1 13.1 3.8 13.8 5.6 15.6 6.3 15.3 8.2 16.9 9.4 15.8 11 16.2 12.9 14.4 13.6 13.7 15.4 11.8 15.1 10.6 16.7 9 15.6 7.1 16 6.4 14.2 4.6 13.5 4.9 11.6 3.3 10.4 4.4 8.8 4 6.9 5.8 6.2 6.5 4.4 8.4 4.7 9.6 3.1Z M10.1 8.1A1.9 1.9 0 1 0 10.1 11.9A1.9 1.9 0 0 0 10.1 8.1Z"
    : "M10 2.8 11.1 5.6 14 6.7 11.1 7.8 10 10.6 8.9 7.8 6 6.7 8.9 5.6 10 2.8ZM15.1 10.7 15.8 12.4 17.5 13.1 15.8 13.8 15.1 15.5 14.4 13.8 12.7 13.1 14.4 12.4 15.1 10.7ZM5 11.2 5.7 12.9 7.4 13.6 5.7 14.3 5 16 4.3 14.3 2.6 13.6 4.3 12.9 5 11.2Z";
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={path} fill="currentColor" fillRule="evenodd" clipRule="evenodd" /></svg>;
}

function Chevron(): ReactElement {
  return <svg className="webui-user-menu-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MenuDivider(): ReactElement {
  return <div className="webui-user-menu-divider" role="separator" />;
}

/* ------------------------------------------------------------------ *
 * Daily check-in card — the card's DOM, classes and copy, with inline svgs.
 * ------------------------------------------------------------------ */

/** Info circle beside the card title, size 14. */

export function UserMenu({
  collapsed,
  hostLabel,
  dataDir,
  sessionId,
  version,
  workspaceDir,
  onOpenFileLine,
  onCreateMemorySession,
}: UserMenuProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  // The account, usage, check-in and login answers all come from the one
  // application owner. This component submits commands and reads the snapshot;
  // it holds no transport method for them.
  const accountWorkflows = useWebuiAccountWorkflows();
  const accountSnapshot = useWebuiAccountWorkflowsState();
  // The settings modal is the menu's own state, so the menu is also the only
  // thing that can dismiss it. Handing the memory to a conversation moves the
  // user off this surface entirely; leaving the modal parked over the home
  // composer would hide the very composer the hand-off just filled.
  const handleCreateMemorySession = useCallback((input: MemoryHandoff) => {
    setSettingsOpen(false);
    onCreateMemorySession?.(input);
  }, [onCreateMemorySession]);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [signinOpen, setSigninOpen] = useState(false);
  const [animatedDay, setAnimatedDay] = useState<number | null>(null);
  // Derived from the one owner's snapshot rather than held locally: the menu
  // and the login dialog read the same answer, and neither writes it.
  const account: AccountStatus | undefined = accountSnapshot.account.value;
  const usage: UsageState =
    accountSnapshot.usage.status === "ready"
      ? { status: "ready", result: accountSnapshot.usage.result }
      : accountSnapshot.usage.status === "error"
        ? { status: "error", errorMessage: accountSnapshot.usage.error }
        : { status: accountSnapshot.usage.status };
  const signin: SigninState = {
    loading: accountSnapshot.signin.loading,
    claiming: accountSnapshot.signin.claiming,
    ...(accountSnapshot.signin.panel ? { panel: accountSnapshot.signin.panel } : {}),
    // The owner stores the raw failure; the two copy strings are the menu's,
    // exactly as they were when the menu owned the request.
    ...(accountSnapshot.signin.error !== undefined
      ? { error: formatSigninError(accountSnapshot.signin.error) }
      : {}),
  };
  // The claim result drives the day animation once per claim. The owner keeps
  // the result; the menu only turns it into the animation's day number.
  const claimedDay =
    accountSnapshot.signin.claim?.claim_result === SigninClaimResult.Claimed
      ? accountSnapshot.signin.claim.day_no
      : undefined;
  useEffect(() => {
    if (claimedDay === undefined) return;
    setAnimatedDay(claimedDay);
  }, [claimedDay]);

  const closePanels = () => {
    setUsageOpen(false);
    setSigninOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    void accountWorkflows?.loadAccount(sessionId);
  }, [accountWorkflows, open, sessionId]);

  const loadUsage = (forceRefresh = false) => {
    setUsageOpen(true);
    setSigninOpen(false);
    void accountWorkflows?.loadUsage(forceRefresh);
  };

  const loadSignin = () => {
    setSigninOpen(true);
    setUsageOpen(false);
    void accountWorkflows?.loadSigninPanel();
  };

  const claim = () => {
    void accountWorkflows?.claimSignin();
  };

  const nickname = accountString(account, "nickname") ?? accountString(account, "name") ?? "MiniMax Code";
  const plan = accountString(account, "plan") ?? accountString(account, "planName") ?? (hostLabel ? `本地 · ${hostLabel}` : "本地");
  const identity = objectValue(account?.identity);
  const auth = objectValue(account?.auth);
  const uid =
    accountString(account, "uid") ??
    accountString(account, "userId") ??
    accountString(account, "id") ??
    accountString(identity, "uid") ??
    accountString(identity, "realUserID") ??
    accountString(auth, "realUserID");

  const portalTarget = dom.portalTarget();
  return <>
    <div className={`webui-user-menu-anchor ${collapsed ? "webui-user-menu-anchor-collapsed" : ""}`} data-webui-rail-identity="true">
      <WebuiDropdown
        open={open}
        onOpen={() => { setOpen(true); closePanels(); }}
        onClose={() => { setOpen(false); closePanels(); }}
        role="menu"
        side="top"
        align="start"
        className="webui-user-menu-popover"
        trigger={(triggerProps) => {
          // Every trigger prop is spread onto the button: they are all DOM
          // attributes, or the ref the skeleton focuses when Escape closes
          // the menu.
          const buttonProps = triggerProps;
          return collapsed
            ? <button type="button" {...buttonProps} className="webui-user-menu-trigger-rail" data-testid="sidebar-user-menu-trigger-rail" aria-label="打开用户菜单"><WebuiIconBrand /></button>
            : <button type="button" {...buttonProps} className="webui-user-menu-trigger" data-testid="sidebar-user-menu-trigger" aria-label="打开用户菜单">
              <span className="webui-user-menu-avatar"><WebuiIconBrand /></span>
              <span className="webui-user-menu-identity"><span>{nickname}</span><small>{plan}</small></span>
              <span className="webui-user-menu-bell" aria-hidden="true"><WebuiIconBell /></span>
            </button>;
        }}
      >
        <div className="webui-user-menu-uid" aria-label="用户 ID">UID : {uid ?? "—"}</div>
        <div className="webui-user-menu-list">
          <button type="button" className="webui-user-menu-item" role="menuitem" data-testid="user-menu-settings" onClick={() => { setOpen(false); setSettingsOpen(true); }}><UsageGlyph kind="settings" /><span>设置</span><span className="webui-user-menu-shortcut">Ctrl+,</span></button>
          <button type="button" className="webui-user-menu-item" role="menuitem" data-testid="user-menu-account-login" onClick={() => { setOpen(false); setLoginOpen(true); }}><UsageGlyph kind="signin" /><span>账号与登录</span></button>
          <MenuDivider />
          <div className="webui-user-menu-signin-anchor" onMouseEnter={() => loadSignin()} onFocus={() => loadSignin()} onClick={(event) => { event.stopPropagation(); if (!signinOpen) loadSignin(); }}>
            <button type="button" className="webui-user-menu-item" role="menuitem" aria-haspopup="dialog" aria-expanded={signinOpen} data-testid="user-menu-signin"><UsageGlyph kind="signin" /><span>每日签到</span><Chevron /></button>
            {signinOpen ? (
              <div className="webui-user-menu-signin-panel" role="dialog" aria-label={SIGNIN.title}>
                <SigninCard
                  panel={signin.panel}
                  loading={signin.loading}
                  claiming={signin.claiming}
                  error={signin.error}
                  animatedDay={animatedDay}
                  onClaim={claim}
                  onRetry={loadSignin}
                  onNavigateToUsage={() => {
                    setSigninOpen(false);
                    loadUsage();
                  }}
                />
              </div>
            ) : null}
          </div>
          <div className="webui-user-menu-usage-anchor" onMouseEnter={() => loadUsage()} onFocus={() => loadUsage()}>
            <button type="button" className="webui-user-menu-item" role="menuitem" aria-haspopup="dialog" aria-expanded={usageOpen} data-testid="user-menu-usage" onClick={() => loadUsage()}><WebuiIconCommandUsage /><span>用量</span><Chevron /></button>
            {usageOpen ? <UsagePanel state={usage} onRetry={() => loadUsage(true)} onLogin={() => { setOpen(false); setLoginOpen(true); }} /> : null}
          </div>
        </div>
      </WebuiDropdown>
    </div>
    <AccountLoginDialog
      open={loginOpen}
      onClose={() => setLoginOpen(false)}
      onAuthenticated={() => {
        loadUsage(true);
      }}
    />
    {portalTarget ? createPortal(<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} dataDir={dataDir} version={version} sessionId={sessionId} workspaceDir={workspaceDir} onOpenFileLine={onOpenFileLine} {...(onCreateMemorySession ? { onCreateMemorySession: handleCreateMemorySession } : {})} />, portalTarget) : <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} dataDir={dataDir} version={version} sessionId={sessionId} workspaceDir={workspaceDir} onOpenFileLine={onOpenFileLine} {...(onCreateMemorySession ? { onCreateMemorySession: handleCreateMemorySession } : {})} />}
  </>;
}
