// The provider form under `models`.
//
// **What the parent keeps, and why it is not a preference.** `UsageModelSettings` stays the
// parent and stays mounted, so it hosts the Models provider editor *above* the
// `sourceTab === "custom"` conditional. The draft, the tested flag and the operation
// state live in that editor, which is what keeps them alive across a sub-tab switch and what makes
// a connection test belong to the draft it tested rather than to whatever the fields hold later.
// The panel is rendered inside the same `sourceTab === "custom"` conditional it occupied before, so
// its own mount and unmount boundary is unchanged — which is also why
// `ProviderPresetPicker`'s `open`/`query` still reset when the form's subtree goes away. The
// session-keyed preload and both intervals stay in the parent; the OAuth surface stays
// there too, because it is `settings`' to render.
//
// This is a **controlled region**: it renders one editor's snapshot and forks no
// state of its own beyond the preset picker's open flag, so nothing here can disagree with what a
// write will actually send. The editor and its commands arrive as props — the provider CRUD
// is `models`' duty, not `settings`'.

import { useRef, useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { reorderModelIds } from "../projection/model-reorder.js";
import type {
  WebuiDiscoverUserModelsCandidateRequest,
  WebuiModelProviderModelEntry,
  WebuiModelProviderView,
  WebuiSaveUserModelProviderCandidateRequest,
  WebuiTestUserModelCandidateRequest,
} from "../../../../shared/contracts/models.js";
import type {
  WebuiProviderEditor,
  WebuiProviderEditorSnapshot,
} from "../contracts/provider-editor.js";
import {
  WEBUI_MODEL_ATTACHMENT_MODALITIES,
  WEBUI_MODEL_PROVIDER_APIS,
  type ProviderModelDraft,
  type ProviderModelPatch,
} from "../contracts/provider-editor.js";
import { textOf } from "../../../contracts/value-readers.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { CloseIcon, IconButton, RefreshIcon } from "../../../ui/form-atoms.js";

/** The attachment modalities, in Desktop's own words. */
const ATTACHMENT_LABELS: Readonly<
  Record<(typeof WEBUI_MODEL_ATTACHMENT_MODALITIES)[number], string>
> = {
  image: "图片",
  pdf: "PDF",
  video: "视频",
  audio: "音频",
};

/**
 * The provider commands this panel invokes. They are `models`' rather than
 * `settings`'; the parent hands over the workflows object's members, which is the wiring
 * boundary this panel declares and no longer owns around.
 */export interface WebuiProviderFormCommands {
  readonly canManageProviders: boolean;
  readonly loadProviders: () => Promise<void>;
  readonly loadPresets: () => Promise<void>;
  readonly revealApiKey: (providerId: string) => Promise<string>;
  readonly testModel: (body: { readonly providerId: string; readonly modelId: string }) => Promise<unknown>;
  readonly discoverCandidate: (
    body: WebuiDiscoverUserModelsCandidateRequest,
  ) => Promise<unknown>;
  readonly testCandidate: (body: WebuiTestUserModelCandidateRequest) => Promise<unknown>;
  readonly saveCandidate: (
    body: WebuiSaveUserModelProviderCandidateRequest,
  ) => Promise<unknown>;
  readonly deleteProvider: (providerId: string) => Promise<unknown>;
  /**
   * The two semantic mutations this panel asks for.
   *
   * Neither takes a model array: the panel says what the user meant, and the
   * Models owner resolves it against the list it currently holds. Replacing these
   * with a generic array update is what let a toggle send a list built from
   * rendered props over a list the owner had already changed.
   */
  readonly setProviderModelEnabled: (intent: {
    readonly providerId: string;
    readonly modelId: string;
    readonly enabled: boolean;
  }) => Promise<unknown>;
  readonly reorderProviderModels: (intent: {
    readonly providerId: string;
    readonly orderedModelIds: readonly string[];
  }) => Promise<unknown>;
}

/**
 * The drafts, the tested flag and the operation state belong to the Models editor, which
 * the parent hosts above the custom-tab conditional so a sub-tab switch does not lose them.
 * The panel is a view over that editor's snapshot and calls its commands; the delete
 * *confirmation* stays here, because asking before deleting is the list's question.
 */
export interface WebuiProviderFormPanelProps {
  readonly providers: readonly WebuiModelProviderView[];
  readonly presets: readonly Record<string, unknown>[];
  readonly commands: WebuiProviderFormCommands;
  /** The list-level error channel the parent owns, so a failed write lands where its retry is. */
  readonly setProviderActionError: (message?: string) => void;
  readonly editor: WebuiProviderEditor;
  readonly snapshot: WebuiProviderEditorSnapshot;
  readonly providerPendingDelete?: WebuiModelProviderView;
  readonly setProviderPendingDelete: Dispatch<SetStateAction<WebuiModelProviderView | undefined>>;
}

function providerModels(provider?: WebuiModelProviderView): readonly WebuiModelProviderModelEntry[] {
  return provider?.models ?? [];
}

/**
 * The provider picker.
 *
 * Desktop's own shape: one field that is both the selection and the search —
 * it shows the chosen provider, and typing in it filters the list. The suffix
 * icon says which of the two it is doing (a magnifier while the list is open,
 * a chevron while it is closed), and `其他` is pinned to the bottom of the list
 * behind a divider rather than scrolling with the presets.
 */
function ProviderPresetPicker({ presets, selected, selectedName, onSelect }: { readonly presets: readonly Record<string, unknown>[]; readonly selected: string; readonly selectedName: string; readonly onSelect: (preset?: Record<string, unknown>) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** The field's visible frame — the anchor the popup hangs off. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const visible = presets.filter((preset) => `${textOf(preset.name)} ${textOf(preset.providerId)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  // `其他` is the value the field carries once it is chosen, so the field has to
  // show the word and not the marker.
  const label = selected === "__other__" ? "其他" : selectedName;
  return <WebuiDropdown
    open={open}
    onOpen={() => { setOpen(true); setQuery(""); }}
    onClose={() => { setOpen(false); setQuery(""); }}
    role="listbox"
    ariaLabel="提供商列表"
    width="content"
    wrapperClassName="webui-provider-picker"
    className="webui-provider-picker-menu"
    testId="settings-provider-preset-picker"
    // The popup hangs off the FIELD'S FRAME, not off the text cursor inside
    // it: the frame is the box the reader sees, and it is what the list has
    // to line up with. The input keeps the skeleton's trigger ref, so Escape
    // returns the focus to the field the reader was typing in.
    anchorElementRef={frameRef}
    trigger={(triggerProps) => {
      const { ref, ...inputProps } = triggerProps;
      return <div ref={frameRef} className={`webui-provider-picker-trigger${open ? " webui-provider-picker-trigger-open" : ""}`}>
      <input
        {...inputProps}
        ref={ref}
        role="combobox"
        aria-label="提供商"
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="请选择提供商"
        value={open ? query || label : label}
        onFocus={(event) => {
          // The field shows the selection until it is typed into, so the first
          // keystroke replaces it rather than appending to it. Opening is the
          // trigger's own business: the skeleton toggles it on the click, and
          // opening it here as well would cancel that toggle.
          event.currentTarget.select();
        }}
        onKeyDown={(event) => {
          triggerProps.onKeyDown(event);
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setQuery("");
            }
          }
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
        }}
      />
      <span className="webui-provider-picker-suffix" data-state={open ? "search" : "arrow"}>
        {open
          ? <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          : <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
    </div>;
    }}
  >
    <div className="webui-provider-picker-options" onMouseDown={(event) => event.preventDefault()}>
      {visible.length ? visible.map((preset) => {
        const id = textOf(preset.providerId);
        const name = textOf(preset.name) || id;
        const iconUrl = textOf(preset.iconUrl);
        return <button key={id} type="button" role="option" aria-selected={selected === id} className="webui-provider-picker-option" onClick={() => { onSelect(preset); setOpen(false); setQuery(""); }}><span className="webui-provider-picker-icon">{iconUrl ? <img src={iconUrl} alt="" /> : name.slice(0, 1)}</span><span className="webui-provider-picker-option-name">{name}</span>{selected === id ? <span className="webui-provider-picker-check" aria-hidden="true">✓</span> : null}</button>;
      }) : <p className="webui-provider-picker-empty" role="status">没有匹配的提供商</p>}
    </div>
    <div className="webui-provider-picker-other">
      <button type="button" role="option" aria-selected={selected === "__other__"} data-testid="settings-provider-other-option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(); setOpen(false); setQuery(""); }}><span className="webui-provider-picker-other-icon" aria-hidden="true">＋</span><span>其他</span></button>
    </div>
  </WebuiDropdown>;
}

export function ProviderFormPanel({
  providers, presets, commands, setProviderActionError,
  editor, snapshot,
  providerPendingDelete, setProviderPendingDelete,
}: WebuiProviderFormPanelProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  // The markup below reads the editor's snapshot under the names it always used, so this stays a
  // view: every draft, the tested flag, the busy flag and the error come from the editor, and each
  // control calls one of its commands.
  const {
    open: showProviderForm, editingProviderId: editingProvider,
    name: draftName, baseUrl: draftBaseUrl, apiKey: draftApiKey,
    models: draftModels, apiFormat: draftApiFormat,
    headers: draftHeaders, tested: draftTested, skipConnectionTest: skipTest,
    busy: formBusy, error: formError,
  } = snapshot;
  const [selectedPresetId, setSelectedPresetId] = useState<string>();
  const [apiFormatOpen, setApiFormatOpen] = useState(false);
  // The API formats the runtime accepts, plus whatever a saved provider carries
  // if this build does not know it: an edit must not silently rewrite it.
  const apiFormatOptions = WEBUI_MODEL_PROVIDER_APIS.includes(
    draftApiFormat as (typeof WEBUI_MODEL_PROVIDER_APIS)[number],
  )
    ? WEBUI_MODEL_PROVIDER_APIS
    : [draftApiFormat, ...WEBUI_MODEL_PROVIDER_APIS];
  const hasModelId = draftModels.some((model) => model.modelId.trim().length > 0);

    // Opening is the editor's: it seeds the draft from the view (including the
    // header rows, which start blank over their persisted names because the read
    // carries names only) and reveals a saved key. The preset list is the list's,
    // so it is loaded here and its failure is reported on the list channel.
    const openProviderForm = async (provider?: WebuiModelProviderView) => {
      setSelectedPresetId(undefined);
      if (provider) await editor.openExisting(provider);
      else editor.openNew();
      try { await commands.loadPresets(); }
      catch (error) { setProviderActionError(error instanceof Error ? error.message : String(error)); }
    };
    // The dialog closes only on a successful delete; a refusal stays beside it,
    // in the editor's error channel.
    const confirmDeleteProvider = async () => {
      await editor.remove();
      if (!editor.getSnapshot().error) setProviderPendingDelete(undefined);
    };
    const toggleModel = async (providerId: string, model: WebuiModelProviderModelEntry, enabled: boolean) => {
      // The intent, not the array: the owner applies it to its own pending
      // projection and serializes the write per provider, so a toggle cannot
      // resurrect a list that a newer local change has already replaced.
      const outcome = await commands.setProviderModelEnabled({
        providerId,
        modelId: textOf(model.modelId),
        enabled,
      });
      if (outcome && typeof outcome === "object" && "status" in outcome && outcome.status === "failed") {
        const failure = outcome as { readonly error?: unknown };
        setProviderActionError(failure.error instanceof Error ? failure.error.message : String(failure.error));
      }
    };
  return <>
      {providers.length === 0 ? <p>暂未添加自定义模型</p> : providers.map((provider) => {
        const id = textOf(provider.providerId);
        const models = providerModels(provider);
        const ids = models.map((model, index) => textOf(model.modelId) || `${id}-${index}`);
        return <div key={id} className="flex w-full flex-col gap-2">
          <div className="flex h-6 items-center justify-between pl-4 pr-3">
            <div className="flex min-w-0 items-center gap-2"><span className="truncate text-[14px] font-medium leading-5 text-text_default_primary">{textOf(provider.name) || id}</span>{provider.kind === "oauth" ? <span className="rounded-[6px] bg-bg_interaction_tertiary_press px-1 text-[12px]">OAuth</span> : null}</div>
            <div className="flex items-center gap-2">
              <IconButton label="编辑提供商" onClick={() => void openProviderForm(provider)}><path d="M9.47052 2.9037C10.4714 1.9029 12.0945 1.90312 13.0955 2.9037C14.0963 3.9047 14.0964 5.52775 13.0955 6.5287L6.76935 12.8559C6.37727 13.2479 5.86805 13.5029 5.31915 13.5814L3.54767 13.8344C2.74184 13.9495 2.05079 13.2583 2.16583 12.4525L2.41876 10.681C2.49721 10.132 2.7522 9.623 3.14435 9.23085L9.47052 2.9037ZM3.92169 10.0092C3.69798 10.2329 3.55245 10.5231 3.50763 10.8363L3.2547 12.6078C3.24339 12.6875 3.31173 12.7566 3.39142 12.7455L5.1629 12.4926C5.47619 12.4478 5.76722 12.3023 5.99103 12.0785L10.9813 7.0873L8.91193 5.01796L3.92169 10.0092ZM12.3182 3.68202C11.7468 3.11062 10.8203 3.11066 10.2488 3.68202L9.68927 4.24062L11.7586 6.30995L12.3182 5.75136C12.8895 5.18001 12.8893 4.25345 12.3182 3.68202Z" /></IconButton>
              <IconButton label="删除" disabled={!commands.canManageProviders} onClick={() => { editor.clearError(); setProviderPendingDelete(provider); }}><path d="M9.80273 1.80527C10.605 1.80541 11.2549 2.45615 11.2549 3.2584V4.35606H14.666C14.9422 4.35606 15.166 4.57991 15.166 4.85606C15.1658 5.132 14.942 5.35606 14.666 5.35606H12.8096L12.7861 5.68027L12.3281 11.9645C12.2362 13.2214 11.1891 14.1948 9.92871 14.1949H5.99414C4.72231 14.1949 3.67 13.2045 3.59277 11.9352L3.21387 5.67442L3.19434 5.35606H1.33301C1.05715 5.3559 0.833241 5.1319 0.833008 4.85606C0.833008 4.58001 1.057 4.35622 1.33301 4.35606H4.74512V3.2584C4.74512 2.45607 5.39591 1.80527 6.19824 1.80527H9.80273ZM4.21191 5.61387L4.59082 11.8746C4.63603 12.6162 5.25109 13.1949 5.99414 13.1949H9.92871C10.6649 13.1948 11.2761 12.6263 11.3301 11.8922L11.7891 5.60801L11.8076 5.35606H4.19629L4.21191 5.61387ZM6.19824 2.80527C5.9482 2.80527 5.74512 3.00835 5.74512 3.2584V4.35606H10.2549V3.2584C10.2549 3.00844 10.0527 2.80541 9.80273 2.80527H6.19824Z" /></IconButton>
            </div>
          </div>
          {models.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={async (event: DragEndEvent) => {
            const over = event.over?.id; const active = event.active.id;
            if (!over || active === over) return;
            const orderedIds = reorderModelIds(ids, String(active), String(over));
            // Ordered identities again: the owner resolves them against what it
            // holds, so the row moves at once and the write carries the owner's
            // own view rather than this render's array.
            const outcome = await commands.reorderProviderModels({
              providerId: id,
              orderedModelIds: orderedIds,
            });
            if (outcome && typeof outcome === "object" && "status" in outcome && outcome.status === "failed") {
              const failure = outcome as { readonly error?: unknown };
              setProviderActionError(failure.error instanceof Error ? failure.error.message : String(failure.error));
            }
          }}><SortableContext items={ids} strategy={verticalListSortingStrategy}><div className="w-full rounded-[16px] bg-bg_grouped_tertiary p-1">{models.map((model, index) => <SortableModelRow key={ids[index]} id={ids[index]!} model={model} onTest={() => void commands.testModel({ providerId: id, modelId: textOf(model.modelId) })} onToggle={(enabled) => void toggleModel(id, model, enabled)} />)}</div></SortableContext></DndContext> : null}
        </div>;
      })}
      <button type="button" disabled={!commands.canManageProviders} className="h-9 w-fit rounded-[8px] px-3" onClick={() => void openProviderForm()}>添加模型</button>
      {showProviderForm && portalTarget ? createPortal(<div role="dialog" aria-modal="true" aria-label={editingProvider ? "编辑提供商" : "添加模型"} className="webui-provider-dialog-backdrop"><form className="webui-provider-form" onSubmit={(event) => { event.preventDefault(); void editor.save(); }}>
        <header className="webui-provider-form-header"><h3>{editingProvider ? "编辑提供商" : "添加模型"}</h3><button type="button" aria-label="关闭" onClick={() => editor.close()}><CloseIcon /></button></header>
        <div className="webui-provider-form-body">
          {!editingProvider ? <div className="webui-provider-form-provider-grid"><label className="webui-provider-form-field">提供商<ProviderPresetPicker presets={presets} selected={selectedPresetId ?? ""} selectedName={selectedPresetId && selectedPresetId !== "__other__" ? draftName : ""} onSelect={(preset) => { if (!preset) { setSelectedPresetId("__other__"); editor.changeField("name", ""); editor.changeField("baseUrl", ""); editor.changeField("apiFormat", "openai-completions"); editor.clearModels(); return; } setSelectedPresetId(textOf(preset.providerId)); editor.changeField("name", textOf(preset.name)); editor.changeField("baseUrl", textOf(preset.baseUrl)); editor.changeField("apiFormat", textOf(preset.apiFormat)); editor.clearModels(); }} /></label>{selectedPresetId === "__other__" ? <label className="webui-provider-form-field">提供商名称<input aria-label="提供商名称" value={draftName} onChange={(event) => editor.changeField("name", event.target.value)} required /></label> : null}</div> : null}
          {editingProvider ? <label className="webui-provider-form-field">提供商名称<input value={draftName} onChange={(event) => editor.changeField("name", event.target.value)} required /></label> : null}
          <div className="webui-provider-form-provider-grid"><div className="webui-provider-form-field"><span>API 格式</span><WebuiDropdown open={apiFormatOpen} onOpen={() => setApiFormatOpen(true)} onClose={() => setApiFormatOpen(false)} role="listbox" ariaLabel="API 格式" width="match" wrapperClassName="webui-provider-format" className="webui-provider-format-menu" trigger={(triggerProps) => { const buttonProps = triggerProps; return <button type="button" {...buttonProps} aria-label="API 格式" className="webui-provider-format-trigger"><span>{draftApiFormat}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>; }}>{apiFormatOptions.map((option) => <button key={option} type="button" role="option" aria-selected={draftApiFormat === option} className="webui-provider-format-option" onClick={() => { editor.changeField("apiFormat", option); setApiFormatOpen(false); }}>{option}</button>)}</WebuiDropdown></div><label className="webui-provider-form-field">接口地址<input aria-label="接口地址" placeholder="https://api.example.com/v1" value={draftBaseUrl} onChange={(event) => editor.changeField("baseUrl", event.target.value)} required /></label></div>
          <label className="webui-provider-form-field">API Key<input type="password" aria-label="API Key" placeholder={editingProvider ? "留空保留原值" : "请输入API Key"} value={draftApiKey} onChange={(event) => editor.changeField("apiKey", event.target.value)} required={!editingProvider} /></label>
          <div className="webui-provider-form-models">
            <div className="webui-provider-form-models-header"><span className="text-[14px] font-medium leading-5 text-text_default_primary">模型</span><div className="webui-provider-form-models-actions"><button type="button" className="webui-provider-form-add-model" onClick={() => editor.addModel()}>添加模型</button><button type="button" className="webui-provider-form-discover" disabled={!snapshot.canDiscover || formBusy} onClick={() => void editor.discover()}>自动获取</button></div></div>
            {draftModels.length ? draftModels.map((model, index) => <ProviderModelCard key={model.id} model={model} index={index} busy={formBusy} onChange={(patch) => editor.changeModel(model.id, patch)} onTest={() => void editor.testModel(model.id)} onRemove={() => editor.removeModel(model.id)} />) : <p className="webui-provider-form-models-empty">请至少添加一个模型</p>}
          </div>
          <div className="webui-provider-form-headers"><div className="text-[13px] font-medium leading-5 text-text_default_primary">自定义 Headers</div>{draftHeaders.map((header) => <div key={header.id} className="webui-provider-form-header-row"><input aria-label="Header 名称" placeholder="Header 名称" value={header.name} onChange={(event) => editor.setHeaders(draftHeaders.map((item) => item.id === header.id ? { ...item, name: event.target.value } : item))} /><input aria-label="Header 值" placeholder={header.persistedName ? "留空保留原值" : "Header 值"} value={header.value} onChange={(event) => editor.setHeaders(draftHeaders.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item))} /><IconButton label="移除 Header" onClick={() => editor.removeHeader(header.id)}><path d="M9.80273 1.80527C10.605 1.80541 11.2549 2.45615 11.2549 3.2584V4.35606H14.666C14.9422 4.35606 15.166 4.57991 15.166 4.85606C15.1658 5.132 14.942 5.35606 14.666 5.35606H12.8096L12.7861 5.68027L12.3281 11.9645C12.2362 13.2214 11.1891 14.1948 9.92871 14.1949H5.99414C4.72231 14.1949 3.67 13.2045 3.59277 11.9352L3.21387 5.67442L3.19434 5.35606H1.33301C1.05715 5.3559 0.833241 5.1319 0.833008 4.85606C0.833008 4.58001 1.057 4.35622 1.33301 4.35606H4.74512V3.2584C4.74512 2.45607 5.39591 1.80527 6.19824 1.80527H9.80273ZM4.21191 5.61387L4.59082 11.8746C4.63603 12.6162 5.25109 13.1949 5.99414 13.1949H9.92871C10.6649 13.1948 11.2761 12.6263 11.3301 11.8922L11.7891 5.60801L11.8076 5.35606H4.19629L4.21191 5.61387ZM6.19824 2.80527C5.9482 2.80527 5.74512 3.00835 5.74512 3.2584V4.35606H10.2549V3.2584C10.2549 3.00844 10.0527 2.80541 9.80273 2.80527H6.19824Z" /></IconButton></div>)}<button type="button" className="webui-provider-form-add-header" onClick={() => editor.addHeader()}>＋ 添加 Header</button></div>
          {formError ? <p role="alert" className="webui-provider-form-error">{formError}</p> : null}
        </div>
        <footer className="webui-provider-form-actions"><label><input type="checkbox" checked={skipTest} onChange={(event) => editor.setSkipConnectionTest(event.target.checked)} />跳过连通检测</label><span /><button type="button" disabled={formBusy || !hasModelId} onClick={() => void editor.test()}>连通检测</button><button type="button" disabled={formBusy} onClick={() => editor.close()}>取消</button><button type="submit" disabled={formBusy || (!draftTested && !skipTest)}>{formBusy ? "加载中…" : "保存"}</button></footer>
      </form></div>, portalTarget) : null}
      {providerPendingDelete ? <div role="dialog" aria-modal="true" aria-label={`删除供应商${textOf(providerPendingDelete.name)}`} className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.25)]"><div className="w-[480px] overflow-clip rounded-[20px] bg-bg_grouped_secondary p-6" style={{ boxShadow: "0 4px 10px 0 rgba(0,0,0,0.04)" }}><div className="flex flex-col gap-6"><div className="flex flex-col gap-4"><div className="flex items-center justify-between"><h3 className="text-[18px] font-medium leading-[26px] text-text_default_primary">删除供应商"{textOf(providerPendingDelete.name)}"吗？</h3><button type="button" aria-label="关闭" className="flex size-[22px] items-center justify-center text-icon_default_tertiary hover:text-icon_default_secondary" onClick={() => setProviderPendingDelete(undefined)}><CloseIcon /></button></div><p className="text-[14px] leading-5 text-text_default_secondary">删除后将移除该供应商下的所有模型选项。</p></div>{formError ? <p role="alert">{formError}</p> : null}<div className="flex justify-end gap-4"><button type="button" disabled={formBusy} className="h-9 min-w-[68px] rounded-[8px] px-4" onClick={() => setProviderPendingDelete(undefined)}>取消</button><button type="button" disabled={formBusy} className="h-9 min-w-[68px] rounded-[8px] bg-bg_status_error px-4" onClick={() => void confirmDeleteProvider()}>{formBusy ? "删除中…" : "删除"}</button></div></div></div></div> : null}
  </>;
}

/**
 * One model card: the model name, the limits, the reasoning levels and the
 * attachments it takes.
 *
 * Desktop's own card, transcribed: a header carrying the model's number and its
 * own connectivity probe, and a bordered body holding one field per row.
 */
function ProviderModelCard({ model, index, busy, onChange, onTest, onRemove }: { readonly model: ProviderModelDraft; readonly index: number; readonly busy: boolean; readonly onChange: (patch: ProviderModelPatch) => void; readonly onTest: () => void; readonly onRemove: () => void }): ReactElement {
  return <div className="webui-provider-form-model">
    <div className="webui-provider-form-model-header">
      <span className="text-[13px] font-medium leading-5 text-text_default_primary">模型 {String(index + 1).padStart(2, "0")}</span>
      <div className="webui-provider-form-model-tools">
        <IconButton label="测试模型连通性" disabled={busy || !model.modelId.trim()} onClick={onTest} viewBox="0 0 20 20" svgFill="none"><RefreshIcon /></IconButton>
        <IconButton label="移除模型" disabled={busy} onClick={onRemove}><path d="M9.80273 1.80527C10.605 1.80541 11.2549 2.45615 11.2549 3.2584V4.35606H14.666C14.9422 4.35606 15.166 4.57991 15.166 4.85606C15.1658 5.132 14.942 5.35606 14.666 5.35606H12.8096L12.7861 5.68027L12.3281 11.9645C12.2362 13.2214 11.1891 14.1948 9.92871 14.1949H5.99414C4.72231 14.1949 3.67 13.2045 3.59277 11.9352L3.21387 5.67442L3.19434 5.35606H1.33301C1.05715 5.3559 0.833241 5.1319 0.833008 4.85606C0.833008 4.58001 1.057 4.35622 1.33301 4.35606H4.74512V3.2584C4.74512 2.45607 5.39591 1.80527 6.19824 1.80527H9.80273ZM4.21191 5.61387L4.59082 11.8746C4.63603 12.6162 5.25109 13.1949 5.99414 13.1949H9.92871C10.6649 13.1948 11.2761 12.6263 11.3301 11.8922L11.7891 5.60801L11.8076 5.35606H4.19629L4.21191 5.61387ZM6.19824 2.80527C5.9482 2.80527 5.74512 3.00835 5.74512 3.2584V4.35606H10.2549V3.2584C10.2549 3.00844 10.0527 2.80541 9.80273 2.80527H6.19824Z" /></IconButton>
      </div>
    </div>
    <div className="webui-provider-form-model-body">
      <label className="webui-provider-form-field">模型名称<input aria-label="模型名称" value={model.modelId} onChange={(event) => onChange({ modelId: event.target.value })} /></label>
      <div className="webui-provider-form-provider-grid">
        <label className="webui-provider-form-field">上下文窗口<input aria-label="上下文窗口" inputMode="numeric" placeholder="留空按供应商默认值处理" value={model.contextLimit} onChange={(event) => onChange({ contextLimit: event.target.value })} /></label>
        <label className="webui-provider-form-field">最大输出 Token<input aria-label="最大输出 Token" inputMode="numeric" placeholder="留空按供应商默认值处理" value={model.maxOutputTokens} onChange={(event) => onChange({ maxOutputTokens: event.target.value })} /></label>
      </div>
      <div className="webui-provider-form-field">
        <span>推理等级</span>
        <EffortOptionsField value={model.effortOptions} onChange={(effortOptions) => onChange({ effortOptions })} />
        <p className="webui-provider-form-hint">请确保输入模型原生支持的推理等级，留空按供应商默认值处理。</p>
      </div>
      <div className="webui-provider-form-field">
        <span>支持的附件</span>
        <AttachmentField value={model.modalities} onChange={(modalities) => onChange({ modalities })} />
        <p className="webui-provider-form-hint">所选附件将默认直接发送给模型处理，请确保模型原生支持。其余类型由平台工具处理，需消耗平台积分。</p>
      </div>
      {model.error ? <p role="alert" className="webui-provider-form-error">{model.error}</p> : null}
    </div>
  </div>;
}

/**
 * The reasoning levels of one model, as Desktop's tag input: a level is
 * committed with Enter and appears as a chip that can be taken away again.
 */
function EffortOptionsField({ value, onChange }: { readonly value: readonly string[]; readonly onChange: (next: readonly string[]) => void }): ReactElement {
  const [text, setText] = useState("");
  const commit = () => {
    const level = text.trim();
    if (!level || value.includes(level)) {
      setText("");
      return;
    }
    onChange([...value, level]);
    setText("");
  };
  return <div className="webui-provider-form-effort">
    {value.map((level) => <span key={level} className="webui-provider-form-chip">{level}<button type="button" aria-label={`移除 ${level}`} onClick={() => onChange(value.filter((item) => item !== level))}>×</button></span>)}
    <input aria-label="推理等级" placeholder="输入档位后按 Enter，如 low、high、max" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} onBlur={commit} />
  </div>;
}

/** The attachment modalities one model takes, as Desktop's multiple selection. */
function AttachmentField({ value, onChange }: { readonly value: readonly string[]; readonly onChange: (next: readonly string[]) => void }): ReactElement {
  return <div className="webui-provider-form-attachments">
    {WEBUI_MODEL_ATTACHMENT_MODALITIES.map((modality) => <label key={modality} className="webui-provider-form-attachment"><input type="checkbox" checked={value.includes(modality)} onChange={(event) => onChange(event.target.checked ? [...value, modality] : value.filter((item) => item !== modality))} />{ATTACHMENT_LABELS[modality]}</label>)}
  </div>;
}

function SortableModelRow({ id, model, onTest, onToggle }: { readonly id: string; readonly model: WebuiModelProviderModelEntry; readonly onTest: () => void; readonly onToggle: (enabled: boolean) => void }): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const enabled = model.enabled !== false;
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : undefined, position: "relative", zIndex: isDragging ? 1 : undefined }} data-testid={`settings-custom-model-row-${textOf(model.modelId)}`}>
    <div className="flex items-center gap-3 overflow-hidden rounded-[12px] py-2 pl-3 pr-3">
      <button type="button" aria-label={`调整 ${textOf(model.displayName) || textOf(model.modelId)} 顺序`} className="flex size-4 shrink-0 touch-none cursor-grab items-center justify-center text-icon_default_tertiary hover:text-icon_interaction_tertiary_hover active:cursor-grabbing" {...attributes} {...listeners}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M3.3335 9C3.88552 9.00018 4.33332 9.44797 4.3335 10C4.3335 10.5522 3.88563 10.9998 3.3335 11C2.78121 11 2.3335 10.5523 2.3335 10C2.33367 9.44786 2.78132 9 3.3335 9ZM7.99951 9C8.55169 9 8.99934 9.44786 8.99951 10C8.99951 10.5523 8.5518 11 7.99951 11C7.44738 10.9998 6.99951 10.5522 6.99951 10C6.99968 9.44797 7.44749 9.00018 7.99951 9ZM12.6665 9C13.2187 9 13.6663 9.44786 13.6665 10C13.6665 10.5523 13.2188 11 12.6665 11C12.1142 11 11.6665 10.5523 11.6665 10C11.6667 9.44786 12.1143 9 12.6665 9ZM3.3335 5C3.88552 5.00018 4.33332 5.44797 4.3335 6C4.3335 6.55217 3.88563 6.99982 3.3335 7C2.78121 7 2.3335 6.55228 2.3335 6C2.33367 5.44786 2.78132 5 3.3335 5ZM7.99951 5C8.55169 5 8.99934 5.44786 8.99951 6C8.99951 6.55228 8.5518 7 7.99951 7C7.44738 6.99982 6.99951 6.55217 6.99951 6C6.99968 5.44797 7.44749 5.00018 7.99951 5ZM12.6665 5C13.2187 5 13.6663 5.44786 13.6665 6C13.6665 6.55228 13.2188 7 12.6665 7C12.1142 7 11.6665 6.55228 11.6665 6C11.6667 5.44786 12.1143 5 12.6665 5Z" fill="currentColor" /></svg></button>
      <span className={`min-w-0 flex-1 truncate text-[14px] leading-5 text-text_default_primary ${enabled ? "" : "opacity-50"}`}>{textOf(model.displayName) || textOf(model.modelId)}</span>
      <IconButton label="测试模型连通性" onClick={onTest} viewBox="0 0 20 20" svgFill="none"><RefreshIcon /></IconButton>
      <ToggleSwitch checked={enabled} label={`${enabled ? "禁用" : "启用"} ${textOf(model.displayName) || textOf(model.modelId)}`} onChange={onToggle} />
    </div>
  </div>;
}
