import { useEffect, useState, type ReactElement } from "react";
import { formatWebuiCredits, recordOf, textOf } from "../../value-readers.js";
import { useWebuiAccountWorkflows, useWebuiAccountWorkflowsState, useWebuiModelsWorkflows, useWebuiModelsWorkflowsState, useWebuiSettingsWorkflows, useWebuiSettingsWorkflowsState } from "../../bindings/use-query-state.js";
import { ToggleSwitch } from "../ToggleSwitch.js";
import { formatResetLabel, getActiveSourceBadge, type ProviderHeaderDraft } from "../../projection/usage-settings.js";
import { IconButton, RefreshIcon } from "./settings-glyphs.js";
import { ProviderFormPanel, type WebuiProviderFormCommands } from "../models/ProviderFormPanel.js";

type Props = {
  readonly sessionId?: string;
};

/** The provider form's commands when the owner is not wired yet. It disables what `models?.` used
 * to make unavailable and does nothing where `settings?.X()` used to call nothing, so the panel's
 * own code needs no optional-chaining of its own. */
const NO_PROVIDER_COMMANDS: WebuiProviderFormCommands = {
  canManageProviders: false,
  loadProviders: async () => {},
  loadPresets: async () => {},
  revealApiKey: async () => "",
  testModel: async () => undefined,
  discoverCandidate: async () => undefined,
  testCandidate: async () => undefined,
  saveCandidate: async () => undefined,
  deleteProvider: async () => undefined,
  updateProvider: async () => undefined,
  patchProviderModels: () => {},
};

export function UsageModelSettings({ sessionId }: Props): ReactElement {
  // The models/providers/api-key/model-source/codex answers come from the
  // settings owner and the usage quota from the account owner (ticket #52).
  // This panel submits commands and reads snapshots; every uncommitted form
  // field below stays local, and the one-second quota clock stays local too.
  //
  // The provider form is `models`' (plan §5.6): it lives in
  // `components/models/ProviderFormPanel.tsx` and is rendered below in the same
  // conditional branch it occupied when it was declared here. Its drafts stay
  // **here**, because a sub-tab switch unmounts that branch and the drafts have
  // to survive it (§5.7 LC-4).
  const settings = useWebuiSettingsWorkflows();
  const settingsState = useWebuiSettingsWorkflowsState();
  // The provider form and the model list are `models`' (plan §5.6, §5.7): its commands
  // and its snapshot come from that owner, not from the settings one.
  const models = useWebuiModelsWorkflows();
  const modelsState = useWebuiModelsWorkflowsState();
  const account = useWebuiAccountWorkflows();
  const accountState = useWebuiAccountWorkflowsState();
  const [sourceTab, setSourceTab] = useState<"token-plan" | "minimax-api" | "custom">("token-plan");
  const [apiKey, setApiKey] = useState("");
  const [quotaClock, setQuotaClock] = useState(() => Date.now());
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyResult, setKeyResult] = useState<string>();
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [providerActionError, setProviderActionError] = useState<string>();
  const [oauthError, setOauthError] = useState<string>();
  const [oauthLoginId, setOauthLoginId] = useState<string>();
  const [providerPendingDelete, setProviderPendingDelete] = useState<Record<string, unknown>>();
  const [draftName, setDraftName] = useState("");
  const [draftBaseUrl, setDraftBaseUrl] = useState("");
  const [draftApiKey, setDraftApiKey] = useState("");
  const [draftModelId, setDraftModelId] = useState("");
  const [draftApiFormat, setDraftApiFormat] = useState("openai-completions");
  const [draftHeaders, setDraftHeaders] = useState<readonly ProviderHeaderDraft[]>([]);
  const [draftTested, setDraftTested] = useState(false);
  const [skipTest, setSkipTest] = useState(false);

  // Committed read state, derived from the owner snapshots.
  const quota = accountState.usage.result;
  const quotaLoading = accountState.usage.status === "idle" || accountState.usage.status === "loading";
  const quotaError = accountState.usage.status === "error" ? accountState.usage.error : undefined;
  const apiStatus = settingsState.apiKeyStatus.value;
  const apiLoading = settingsState.apiKeyStatus.status === "idle" || settingsState.apiKeyStatus.status === "loading";
  const apiError = settingsState.apiKeyStatus.status === "error" ? settingsState.apiKeyStatus.error : undefined;
  const providers = modelsState.providers.value ?? [];
  const providerLoading = modelsState.providers.status === "idle" || modelsState.providers.status === "loading";
  const providerError = providerActionError ?? (modelsState.providers.status === "error" ? modelsState.providers.error : undefined);
  const presets = modelsState.presets.value ?? [];
  const oauth = settingsState.codexOAuth.value;
  const activeSource = settingsState.modelSource.value;
  const sourceLoaded = settingsState.modelSource.status === "ready";

  const loadQuota = () => { void account?.loadUsage(); };
  const loadApiStatus = () => { void settings?.loadApiKeyStatus(); };
  const loadProviders = () => { setProviderActionError(undefined); void models?.loadProviders(); };
  useEffect(() => {
    void account?.loadUsage(); void settings?.loadApiKeyStatus(); void models?.loadProviders();
    void settings?.loadModelSource(); void settings?.loadCodexOAuthStatus();
  // Owner objects are stable; the initial loads are keyed on the session as before.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  useEffect(() => {
    const timer = setInterval(() => setQuotaClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!oauthLoginId || !settings) return;
    const timer = setInterval(() => { void settings.loadCodexOAuthStatus(); }, 1000);
    return () => clearInterval(timer);
  }, [settings, oauthLoginId]);

  const chooseSource = async (source: "token_plan" | "minimax_api_key") => {
    setSourceTab(source === "token_plan" ? "token-plan" : "minimax-api");
    if (source === activeSource || !settings?.canSetModelSource) return;
    if (source === "minimax_api_key" && apiStatus?.valid !== true) return;
    try { await settings.setModelSource(source); }
    catch (error) { setKeyResult(error instanceof Error ? error.message : String(error)); }
  };
  const testKey = async () => {
    if ((!apiKey.trim() && !apiValid) || !models) return;
    setTestingKey(true); setKeyResult(undefined);
    try {
      const result = recordOf(await models.testProvider({ providerId: "minimax_api", ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }));
      setKeyResult(result.success === true ? "连接成功" : textOf(recordOf(result.status).lastErrorMessage) || "连接失败");
    } catch (error) { setKeyResult(error instanceof Error ? error.message : String(error)); }
    finally { setTestingKey(false); }
  };
  const saveKey = async () => {
    if (!apiKey.trim() || !models) return;
    setSavingKey(true); setKeyResult(undefined);
    try { await models.upsertApiKey({ apiKey: apiKey.trim(), saveAndUse: true }); void settings?.loadModelSource(); }
    catch (error) { setKeyResult(error instanceof Error ? error.message : String(error)); }
    finally { setSavingKey(false); }
  };
  const beginCodexLogin = async () => {
    if (!settings?.canStartCodexOAuth) return;
    const popup = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    setOauthError(undefined);
    try {
      const result = recordOf(await settings.startCodexOAuth({}));
      const loginId = textOf(result.loginId);
      const authUrl = textOf(result.authUrl);
      if (loginId) setOauthLoginId(loginId);
      if (authUrl && popup) popup.location.replace(authUrl);
      else if (popup) popup.close();
    } catch (error) {
      popup?.close();
      setOauthError(error instanceof Error ? error.message : String(error));
    }
  };
  const cancelCodexLogin = async () => {
    if (!oauthLoginId || !settings) return;
    try { await settings.cancelCodexOAuth(oauthLoginId); setOauthLoginId(undefined); }
    catch (error) { setOauthError(error instanceof Error ? error.message : String(error)); }
  };
  const quotaView = quota?.signedIn ? quota : undefined;
  const quotaData = quotaView && "quota" in quotaView ? quotaView.quota : undefined;
  const apiValid = apiStatus?.valid === true;
  const resetLabel = (resetAtMs?: number) => formatResetLabel(resetAtMs, quotaClock);
  const sourceLabel = sourceTab === "token-plan" ? "Token Plan" : "MiniMax API";
  const sourceBadge = getActiveSourceBadge(sourceLoaded, activeSource, quotaView?.hasTokenPlan === true);


  return <div className="mx-auto flex min-h-0 w-full max-w-[704px] flex-1 flex-col gap-4" data-testid="settings-usage-model">
    <div className="flex h-8 items-center gap-3">
      <div className="relative">
      <div className={`flex h-8 items-center overflow-hidden rounded-[8px] text-[14px] font-medium leading-5 transition-colors ${sourceTab !== "custom" ? "bg-bg_interaction_tertiary_hover text-text_default_primary" : "text-text_default_secondary hover:bg-bg_interaction_tertiary_hover"}`}>
        <button type="button" data-testid="settings-usage-source-tab" className="flex h-full pl-3 pr-1 items-center" onClick={() => setSourceMenuOpen((open) => !open)}>{sourceLabel}{sourceBadge ? <span className={`rounded-[6px] px-1 py-0.5 text-[12px] leading-4 ${sourceBadge === "使用中" ? "bg-bg_status_positive text-icon_status_success" : "bg-[rgba(10,10,10,0.04)] text-[#666]"}`}>{sourceBadge}</span> : null}</button>
        <button type="button" aria-label="选择模型来源" className="flex h-full w-7 items-center justify-center hover:bg-bg_interaction_tertiary_hover" onClick={() => setSourceMenuOpen((open) => !open)}><ChevronDownIcon /></button>
      </div>
      {sourceMenuOpen ? <div className="absolute left-0 top-full z-10 mt-1 flex min-w-[180px] flex-col rounded-[12px] bg-bg_default_primary p-1.5 shadow-lg"><button type="button" className="flex h-[30px] items-center rounded-[8px] px-3 text-left text-sm hover:bg-bg_interaction_tertiary_hover" onClick={() => { setSourceMenuOpen(false); void chooseSource("token_plan"); }}>Token Plan</button><button type="button" className="flex h-[30px] items-center rounded-[8px] px-3 text-left text-sm hover:bg-bg_interaction_tertiary_hover" onClick={() => { setSourceMenuOpen(false); void chooseSource("minimax_api_key"); }}>MiniMax API</button></div> : null}
      </div>
      <div className="h-3 w-[0.5px] bg-border_default" />
      <button type="button" className={`h-8 rounded-[8px] px-3 text-[14px] font-medium leading-5 transition-colors ${sourceTab === "custom" ? "bg-bg_interaction_tertiary_hover text-text_default_primary" : "text-text_default_secondary hover:bg-bg_interaction_tertiary_hover"}`} onClick={() => setSourceTab("custom")}>自定义模型</button>
    </div>

    {sourceTab === "token-plan" ? <section className="flex w-full flex-col gap-4" data-testid="settings-usage-token-plan">
      {quotaLoading ? <p>加载中…</p> : quotaError ? <div role="alert" className="flex items-center gap-3"><span>加载失败</span><button type="button" onClick={() => void loadQuota()}>重试</button></div> : !quotaView ? <p>登录后查看用量</p> : <>
        <section className="flex w-full flex-col gap-2" data-testid="settings-usage-plan">
          <h3 className="px-4 text-[14px] font-medium leading-5">当前套餐</h3>
          <div className="flex w-full flex-col rounded-[16px] bg-bg_grouped_tertiary p-1">
            <div className="flex min-h-[64px] w-full items-center gap-6 overflow-hidden rounded-[12px] py-2 pl-3 pr-2"><div className="min-w-0"><span className="block text-[14px] leading-5">{quotaView.tokenPlanTier || (quotaView.hasTokenPlan ? "Token Plan" : "未订阅 Token Plan")}</span>{quotaView.tokenPlanExpiresAt ? <span className="mt-1 block text-[12px] leading-4 text-text_default_secondary">{new Date(quotaView.tokenPlanExpiresAt < 1e12 ? quotaView.tokenPlanExpiresAt * 1000 : quotaView.tokenPlanExpiresAt).toLocaleDateString("sv-SE").replaceAll("-", ".")}{quotaView.willRenewal ? " 自动续费" : ""}</span> : null}</div></div>
            <div className="h-[0.5px] bg-border_default" />
            <div className="flex min-h-[64px] w-full items-center gap-6 overflow-hidden rounded-[12px] py-2 pl-3 pr-2"><div><span className="block text-[14px] leading-5">积分</span><span className="mt-1 block text-[12px] leading-4 text-text_default_secondary">剩余 {quotaView.purchasedCredits !== undefined && quotaView.freeCredits !== undefined ? `${formatWebuiCredits(quotaView.purchasedCredits)} + ${formatWebuiCredits(quotaView.freeCredits)}` : formatWebuiCredits(quotaView.creditBalance)}</span></div></div>
          </div>
        </section>
        {quotaData ? <section className="flex w-full flex-col gap-2" data-testid="settings-usage-limits"><h3 className="px-4 text-[14px] font-medium leading-5">用量</h3><div className="flex w-full flex-col rounded-[16px] bg-bg_grouped_tertiary p-1">{([["5 小时限额", quotaData.fiveHour], ["周限额", quotaData.weekly], ...(quotaData.video ? [["视频限额", quotaData.video] as const] : [])] as const).map(([label, window]) => { const value = recordOf(window); const usedPercent = typeof value.usedPercent === "number" ? value.usedPercent : undefined; const usedCount = typeof value.usedCount === "number" ? value.usedCount : undefined; const totalCount = typeof value.totalCount === "number" ? value.totalCount : undefined; const percent = Math.round(usedPercent ?? (totalCount ? (usedCount ?? 0) / totalCount * 100 : 0)); const resetAtMs = typeof value.resetAtMs === "number" ? value.resetAtMs : undefined; const reset = resetLabel(resetAtMs); return <div key={label} className="flex min-h-[72px] flex-col justify-center gap-2 overflow-hidden rounded-[12px] py-2 pl-3 pr-2"><div className="flex items-center justify-between gap-3"><span className="text-[14px] font-normal leading-5 text-text_default_primary">{label}</span><span className="shrink-0 text-[13px] leading-5 text-text_default_secondary">{window.unlimited ? "无限制" : usedCount !== undefined ? `${usedCount}/${totalCount ?? 0}` : `${usedPercent ?? 0}% / 100%`}</span></div><div className="h-1 w-full overflow-hidden rounded-full bg-bg_interaction_tertiary_press"><div className="h-full rounded-full bg-text_default_primary" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>{reset ? <span className="text-[12px] font-normal leading-4 text-text_default_secondary">{reset}</span> : null}</div>; })}</div></section> : null}
        <section className="flex w-full flex-col gap-2" data-testid="settings-usage-points"><h3 className="flex items-center gap-2 px-4 text-[14px] font-medium leading-5">积分 <InfoIcon /></h3><div className="flex min-h-[48px] w-full items-center justify-between gap-4 rounded-[16px] bg-bg_grouped_tertiary px-4 py-2"><span>开启后，可以在对话中消耗你的积分（含赠予积分）。</span><ToggleSwitch checked={false} label="消耗积分" disabled title="Disabled (not yet wired)" className="shrink-0 disabled:opacity-60" /></div></section>
      </>}
    </section> : null}

    {sourceTab === "minimax-api" ? <section className="flex w-full flex-col gap-2 pt-1" data-testid="settings-minimax-api-panel">
      <div className="flex items-center gap-2"><label className="text-[14px] font-medium leading-5 text-text_default_primary">API Key</label><span className={`rounded-[6px] px-1 py-0.5 text-[12px] leading-4 ${apiValid ? "bg-bg_status_positive text-icon_status_success" : "bg-[rgba(10,10,10,0.04)] text-[#666]"}`}>{apiValid ? "使用中" : "未启用"}</span></div>
      {apiLoading ? <p>加载中…</p> : apiError ? <div role="alert" className="flex items-center gap-3"><span>{apiError}</span><button type="button" onClick={() => void loadApiStatus()}>重试</button></div> : <>
        <div className="flex items-center gap-3"><input aria-label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiValid ? textOf(apiStatus?.maskedApiKey) : "请输入API Key"} className="min-w-0 flex-[1_0_0] rounded-[8px] border border-border_default bg-bg_default_primary px-3 py-2 text-[14px]" /><IconButton label="测试连通性" disabled={testingKey || (!apiKey.trim() && !apiValid)} onClick={() => void testKey()} viewBox="0 0 20 20" svgFill="none"><RefreshIcon /></IconButton></div>
        {keyResult ? <p role="status">{keyResult}</p> : null}<button type="button" disabled={!apiKey.trim() || savingKey} className="mt-1 h-9 w-[116px] rounded-[8px] bg-bg_interaction_tertiary_hover px-3 text-[14px] disabled:opacity-60" onClick={() => void saveKey()}>{savingKey ? "保存中…" : "保存并使用"}</button>
      </>}
    </section> : null}

    {sourceTab === "custom" ? <section className="flex min-h-0 flex-1 flex-col gap-3" data-testid="settings-custom-models-panel">
      {providerLoading ? <p>模型加载中...</p> : providerError ? <div role="alert"><span>{providerError}</span><button type="button" onClick={() => void loadProviders()}>重试</button></div> : <>
        <ProviderFormPanel
          providers={providers}
          presets={presets}
          commands={models ?? NO_PROVIDER_COMMANDS}
          setProviderActionError={setProviderActionError}
          draftName={draftName}
          setDraftName={setDraftName}
          draftBaseUrl={draftBaseUrl}
          setDraftBaseUrl={setDraftBaseUrl}
          draftApiKey={draftApiKey}
          setDraftApiKey={setDraftApiKey}
          draftModelId={draftModelId}
          setDraftModelId={setDraftModelId}
          draftApiFormat={draftApiFormat}
          setDraftApiFormat={setDraftApiFormat}
          draftHeaders={draftHeaders}
          setDraftHeaders={setDraftHeaders}
          draftTested={draftTested}
          setDraftTested={setDraftTested}
          skipTest={skipTest}
          setSkipTest={setSkipTest}
          providerPendingDelete={providerPendingDelete}
          setProviderPendingDelete={setProviderPendingDelete}
        />
        {oauthError ? <p role="alert">{oauthError}</p> : oauth?.state === "connected" ? <div className="flex items-center gap-3"><span>Codex OAuth 已连接</span><button type="button" disabled={!models?.canManageProviders} onClick={() => void models?.refreshModels?.()}>获取模型列表</button></div> : <div className="flex items-center gap-2"><button type="button" disabled={!settings?.canStartCodexOAuth || Boolean(oauthLoginId)} onClick={() => void beginCodexLogin()}>{oauthLoginId ? "正在连接 Codex OAuth" : "连接 Codex OAuth"}</button>{oauthLoginId ? <button type="button" disabled={!settings?.canStartCodexOAuth} onClick={() => void cancelCodexLogin()}>取消</button> : null}</div>}
      </>}
    </section> : null}
  </div>;
}

export function DisabledBillingActions(): ReactElement {
  const unavailable = "Disabled (not yet wired)";
  const disabledProps = { disabled: true, "aria-disabled": "true" as const, title: unavailable };
  return <div className="flex w-full flex-col rounded-[16px] bg-bg_grouped_tertiary p-1" aria-label={unavailable}>
    <div className="flex w-full items-center justify-end gap-2 overflow-hidden rounded-[12px] py-2 pl-3 pr-2">
      <DesktopGrayAction label="升级" {...disabledProps} />
      <DesktopGrayAction label="管理" dropdown {...disabledProps} />
      <DesktopGrayAction label="开启自动续费" {...disabledProps} />
    </div>
    <div className="flex w-full items-center justify-center px-3 py-1.5"><div className="h-px w-full bg-border_light" /></div>
    <div className="flex w-full items-center justify-end gap-2 overflow-hidden rounded-[12px] py-2 pl-3 pr-2">
      <DesktopGrayAction label="去充值" {...disabledProps} />
      <DesktopGrayAction label="管理" dropdown {...disabledProps} />
      <DesktopGrayAction label="明细" {...disabledProps} />
      <ToggleSwitch checked={false} label={unavailable} className="disabled:opacity-60" {...disabledProps} />
    </div>
    <div className="flex w-full items-center justify-center px-3 py-1.5"><div className="h-px w-full bg-border_light" /></div>
    <div className="flex w-full items-center justify-end gap-2 overflow-hidden rounded-[12px] py-2 pl-3 pr-2"><DesktopGrayAction label="申请" external {...disabledProps} /></div>
  </div>;
}

function InfoIcon(): ReactElement {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-icon_default_secondary"><circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1" /><path d="M8 7.25v3.5M8 5.25h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>;
}

function DesktopGrayAction({ label, dropdown = false, external = false, disabled = true, title, "aria-disabled": ariaDisabled = "true" }: { readonly label: string; readonly dropdown?: boolean; readonly external?: boolean; readonly disabled?: boolean; readonly title?: string; readonly "aria-disabled"?: "true" }): ReactElement {
  return <button type="button" disabled={disabled} aria-disabled={ariaDisabled} title={title} className="h-8 shrink-0 !px-3 !py-0 !font-medium !leading-5 text-[14px] text-text_default_primary disabled:opacity-60"><span className="flex items-center justify-center gap-1">{label}{dropdown ? <ChevronDownIcon className="size-4 text-icon_default_secondary" /> : external ? <ExternalArrowIcon /> : null}</span></button>;
}

function ChevronDownIcon({ className = "" }: { readonly className?: string }): ReactElement {
  return <svg aria-hidden="true" className={className} width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 6L8 10L4 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ExternalArrowIcon(): ReactElement {
  return <svg aria-hidden="true" className="h-4 w-4" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6.40497 4.24121C6.12883 4.24121 5.90497 4.46507 5.90497 4.74121C5.90497 5.01735 6.12883 5.24121 6.40497 5.24121H10.196L4.64618 10.791C4.45124 10.9862 4.45124 11.3028 4.64618 11.498C4.84144 11.6933 5.15893 11.6933 5.35419 11.498L10.905 5.94629V9.74121C10.905 10.0174 11.1288 10.2412 11.405 10.2412C11.6811 10.2412 11.905 10.0174 11.905 9.74121V4.94141C11.905 4.55481 11.5914 4.24121 11.2048 4.24121H6.40497Z" /></svg>;
}
