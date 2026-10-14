import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  InstalledPluginSource,
  MarketplaceCategory,
} from "@mavis/protocol/local";
import {
  useWebuiPluginWorkflows,
  useWebuiPluginWorkflowsState,
} from "../../../bindings/use-query-state.js";
import { WebuiIconAgent } from "../../../components/shell/icons.js";
import { ToggleSwitch } from "../../../components/shared/ToggleSwitch.js";
import { readWebuiPluginRow as read, type WebuiPluginRow as Row } from "../contracts/plugin-rows.js";
import { PluginImportDialog } from "./PluginImportDialog.js";
import { PluginItemDialog } from "./PluginItemDialog.js";
import { describeWebuiMcpServerStatus } from "../projection/mcp-status.js";
import type {
  WebuiPluginGithubSource,
  WebuiPluginIntent,
} from "../contracts/plugin-actions.js";

type Area = "plugins" | "skills" | "apps" | "mcp" | "agents";
type PluginCatalogueSelection = {
  readonly area: Area;
  readonly view: "market" | "personal";
  readonly query: string;
  readonly category: string;
};
const sameSelection = (
  left: PluginCatalogueSelection,
  right: PluginCatalogueSelection,
): boolean =>
  left.area === right.area &&
  left.view === right.view &&
  left.query === right.query &&
  left.category === right.category;

const CATEGORIES: readonly { id: Area; label: string }[] = [
  { id: "plugins", label: "插件" },
  { id: "skills", label: "技能" },
  { id: "apps", label: "应用" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
];
const categories: readonly { id: string; label: string }[] = [
  { id: "", label: "全部" },
  { id: "office", label: "办公" },
  { id: "creative", label: "创作" },
  { id: "design_and_sites", label: "设计与网站" },
  { id: "code", label: "代码" },
  { id: "business", label: "商业" },
  { id: "sales", label: "销售" },
  { id: "productivity", label: "效率" },
  { id: "science_and_healthcare", label: "科学与医疗" },
  { id: "education", label: "教育" },
  { id: "other", label: "其他" },
];
/** Number of cards shown after the user explicitly collapses a catalogue. */
const MARKET_PREVIEW_COUNT = 8;
const MARKETPLACE_CATEGORY: Readonly<Record<string, number>> = {
  other: MarketplaceCategory.OTHER,
  office: MarketplaceCategory.OFFICE,
  creative: MarketplaceCategory.STUDIO,
  design_and_sites: MarketplaceCategory.DESIGN_AND_SITES,
  code: MarketplaceCategory.CODE,
  business: MarketplaceCategory.BUSINESS,
  sales: MarketplaceCategory.SALES,
  productivity: MarketplaceCategory.PRODUCTIVITY,
  science_and_healthcare: MarketplaceCategory.SCIENCE_AND_HEALTHCARE,
  education: MarketplaceCategory.EDUCATION,
};
const rows = (value: unknown, key: string): Row[] => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.filter(
      (item): item is Row => !!item && typeof item === "object",
    );
  const found = (value as Row)[key];
  return Array.isArray(found)
    ? found.filter((item): item is Row => !!item && typeof item === "object")
    : [];
};

export function PluginCatalogue({
  initialArea = "plugins",
  onChatWithAgent,
}: {
  readonly initialArea?: Area;
  readonly onChatWithAgent?: (name: string) => Promise<void>;
}): ReactElement {
  const [area, setArea] = useState<Area>(initialArea);
  const [view, setView] = useState<"market" | "personal">("market");
  const [managementOpen, setManagementOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const selectionRef = useRef<PluginCatalogueSelection>({
    area,
    view,
    query,
    category,
  });
  selectionRef.current = { area, view, query, category };
  const reloadRequestRef = useRef(0);
  const [showAllCatalogue, setShowAllCatalogue] = useState(true);
  /* Local form-level messages only. A load or mutation failure belongs to the
   * application plugin owner (ticket #52) and is read from its snapshot. */
  const [localError, setLocalError] = useState("");
  const [dialog, setDialog] = useState<"mcp" | "agent" | "skill" | null>(null);
  const [editing, setEditing] = useState<Row | undefined>();
  const [selectedAgent, setSelectedAgent] = useState<Row | undefined>();
  const selectedAgentRef = useRef<Row | undefined>();
  selectedAgentRef.current = selectedAgent;
  const [pluginUrl, setPluginUrl] = useState("");
  const [pluginPreview, setPluginPreview] = useState<Row | undefined>();
  const [pluginImportDialog, setPluginImportDialog] = useState(false);

  // The plugin manager's listings and mutations belong to the application
  // plugin owner (ticket #52). This component submits commands and reads the
  // snapshot; it holds no transport method and no request-generation counter —
  // the owner drops an answer for a selection it has left.
  const workflows = useWebuiPluginWorkflows();
  const snapshot = useWebuiPluginWorkflowsState();
  const listing = snapshot.listing;
  const data = listing.rows;
  const marketPluginTotal = listing.pluginTotal ?? 0;
  /* The skill hub reports `hasMore`/`nextCursor` where the plugin marketplace
   * reports a `pluginTotal`, so a skill count is only known to be exact when the
   * listing came back complete. `null` means "the total is not knowable from
   * this response" and the label falls back to a bare 「查看全部技能」. */
  const marketSkillTotal = listing.skillTotal ?? null;
  const busy = listing.loading || snapshot.mutating;
  const error = localError || snapshot.mutationError || listing.error || "";
  const reload = async (): Promise<void> => {
    await workflows?.loadListing({ area, view, query, category });
  };
  useEffect(() => {
    void workflows?.loadListing({ area, view, query, category });
  }, [area, view, query, category, workflows]);
  const filtered = useMemo(
    () =>
      data.filter(
        (item) =>
          !query ||
          `${read(item, "name", "displayName", "display_name")} ${read(item, "description")}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
      ),
    [data, query],
  );
  /* Plugins and skills are two catalogues rendered by one page, so they share
   * every layout decision. `isMarketCatalogue` is the single condition that
   * says "this is the marketplace page rather than a management list" — the
   * two-column card grid, the shared 768px measure and the 「查看全部」 preview
   * are all keyed off it, which is what keeps 技能 laid out exactly like 插件. */
  const isMarketCatalogue =
    (area === "plugins" || area === "skills") && view === "market";
  const marketNoun = area === "skills" ? "技能" : "插件";
  const marketTotal =
    area === "skills" ? marketSkillTotal : marketPluginTotal;
  // When the total is unknown the affordance is still offered once the fetched
  // page itself overflows the preview, so the control is never gated on a
  // number this response could not supply.
  const visibleMarketTotal = marketTotal ?? filtered.length;
  /**
   * The narrow set of intents this component can express.
   *
   * It used to take any of the 29 wire actions plus an untyped row, and switch on
   * the verb at runtime. Typing the parameter as the whole union is what that
   * shape cost: `mutate("installPlugin", someRow)` compiled even though a row has
   * no `pluginName`, and nothing said so until the server rejected it. Each
   * intent carries the fields its own command declares, so the compiler checks
   * the payload against the command it will actually reach (T08).
   */
  const runIntent = async (intent: WebuiPluginIntent): Promise<unknown> => {
    if (!workflows)
      throw new Error("Plugin management is not connected to the runtime");
    switch (intent.kind) {
      case "installPlugin": return workflows.installPlugin({ pluginName: intent.pluginName, ...(intent.source === undefined ? {} : { source: intent.source }) });
      case "uninstallPlugin": return workflows.uninstallPlugin({ pluginName: intent.pluginName, ...(intent.source === undefined ? {} : { source: intent.source }) });
      case "enablePlugin": return workflows.enablePlugin({ pluginName: intent.pluginName, ...(intent.source === undefined ? {} : { source: intent.source }) });
      case "disablePlugin": return workflows.disablePlugin({ pluginName: intent.pluginName, ...(intent.source === undefined ? {} : { source: intent.source }) });
      case "importGithubPlugin": return workflows.importGithubPlugin({ source: intent.source });
      case "installSkill": return workflows.installSkill({ url: intent.url });
      case "createSkill": return workflows.createSkill({ name: intent.name, description: intent.description, content: intent.content });
      case "setSkillEnabled": return workflows.setSkillEnabled({ skillName: intent.skillName, enabled: intent.enabled, ...(intent.locationUri === undefined ? {} : { locationUri: intent.locationUri }) });
      case "deleteSkill": return workflows.deleteSkill({ skillName: intent.skillName, ...(intent.locationUri === undefined ? {} : { locationUri: intent.locationUri }) });
      case "createMcpServer": return workflows.createMcpServer({ name: intent.name, config: intent.config, ...(intent.enabled === undefined ? {} : { enabled: intent.enabled }) });
      case "updateMcpServer": return workflows.updateMcpServer({ name: intent.name, config: intent.config });
      case "deleteMcpServer": return workflows.deleteMcpServer({ name: intent.name });
      case "setMcpServerEnabled": return workflows.setMcpServerEnabled({ name: intent.name, enabled: intent.enabled });
      case "testMcpServer": return workflows.testMcpServer({ name: intent.name });
      case "createAgent": return workflows.createAgent({ name: intent.name, ...(intent.displayName === undefined ? {} : { displayName: intent.displayName }), ...(intent.description === undefined ? {} : { description: intent.description }), ...(intent.systemPrompt === undefined ? {} : { systemPrompt: intent.systemPrompt }), ...(intent.initialDefinition === undefined ? {} : { initialDefinition: intent.initialDefinition }) });
      case "updateAgent": return workflows.updateAgent({ name: intent.name, ...(intent.displayName === undefined ? {} : { displayName: intent.displayName }), ...(intent.description === undefined ? {} : { description: intent.description }), ...(intent.systemPrompt === undefined ? {} : { systemPrompt: intent.systemPrompt }) });
      case "deleteAgent": return workflows.deleteAgent({ name: intent.name });
      default: throw new Error(`未支持的操作：${(intent as { readonly kind: string }).kind}`);
    }
  };
  const mutate = async (intent: WebuiPluginIntent): Promise<boolean> => {
    try {
      await runIntent(intent);
      return true;
    } catch {
      // The owner records the failure and reloads; this only reports it.
      return false;
    }
  };
  const confirmMutation = (label: string, intent: WebuiPluginIntent) => {
    if (window.confirm(`确定${label}？此操作会立即影响本地配置。`))
      void mutate(intent);
  };
  const nameOf = (item: Row) =>
    read(
      item,
      "name",
      "pluginName",
      "plugin_name",
      "pluginId",
      "displayName",
      "display_name",
    );
  /** The structured creator info, if the row carries any, as a record. */
  const creatorInfoOf = (item: Row): Record<string, unknown> | undefined => {
    const found = item.creatorInfo ?? item.creator_info;
    return found && typeof found === "object" && !Array.isArray(found)
      ? (found as Record<string, unknown>)
      : undefined;
  };
  /** A row's `locationUri`, narrowed: the rows are untyped and the command is not. */
  const locationUriOf = (item: Row): string | undefined =>
    typeof item.locationUri === "string" ? item.locationUri : undefined;
  const pluginSource = (item: Row) =>
    typeof item.source === "number" ? item.source : undefined;
  const enabled = (item: Row) =>
    item.enabled === true ||
    item.isEnabled === true ||
    item.is_enabled === true;
  const appStatus = (item: Row) => {
    const runtime =
      item.runtime && typeof item.runtime === "object"
        ? (item.runtime as Row)
        : {};
    const status = read(runtime, "status");
    return status === "running"
      ? "运行中"
      : status === "starting"
        ? "启动中"
        : status === "stopping"
          ? "停止中"
          : status === "failed"
            ? "启动失败"
            : status === "stopped"
              ? "已停止"
              : "未知状态";
  };

  const chatWithAgent = async (agent: Row) => {
    if (!onChatWithAgent) return;
    try {
      await onChatWithAgent(nameOf(agent));
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  /**
   * Open the MCP form for one server.
   *
   * The row's list entry carries a summary; the form needs the server's full
   * config, so a detail read runs first. A failed read is reported and the form
   * stays closed — showing a half-populated form would look like the server has
   * no command or url.
   */
  const prepareMcp = async (item: Row) => {
    try {
      const detail = await workflows?.getMcpServer(nameOf(item));
      setEditing((detail && typeof detail === "object" ? detail : item) as Row);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setDialog("mcp");
  };
  const previewPlugin = async () => {
    try {
      setLocalError("");
      const result = await workflows?.previewGithubPlugin({
        url: pluginUrl.trim(),
      });
      setPluginPreview(result as Row);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importPlugin = async () => {
    const source = pluginPreview?.source;
    if (!source || typeof source !== "object") return;
    if (await mutate({ kind: "importGithubPlugin", source: source as WebuiPluginGithubSource })) {
      setPluginImportDialog(false);
      setPluginPreview(undefined);
    }
  };

  // Switching the marketplace catalogue. The plugin category filter belongs to
  // the plugin list, so it is cleared with the switch rather than left applied
  // to a list it cannot narrow.
  const selectMarketCatalog = (catalog: "plugins" | "skills") => {
    setArea(catalog);
    setView("market");
    setCategory("");
    setShowAllCatalogue(true);
  };

  const openCreate = (target: Area) => {
    setArea(target);
    setView("personal");
    setManagementOpen(true);
    setCreateMenuOpen(false);
    // Opening a form is now just: no item, show this form. The drafts seed
    // themselves from `editing`, so there is nothing to clear here beyond the
    // item the previous form may have been editing.
    setEditing(undefined);
    setDialog(target === "mcp" ? "mcp" : target === "agents" ? "agent" : "skill");
  };

  return (
    <section
      className={`webui-plugin-management ${managementOpen ? "is-managing" : "is-marketplace"}`}
      data-testid="plugin-management"
    >
      {/* Two elements because the bar is pinned: the header is the sticky,
       * full-bleed, opaque surface, and the row inside it keeps the width the
       * content is laid out against. */}
      <header className="webui-plugin-header">
        {managementOpen ? (
          <button
            type="button"
            className="webui-plugin-management-back"
            onClick={() => {
              setManagementOpen(false);
              setArea("plugins");
              setView("market");
            }}
            aria-label="返回"
          >
            ‹ 插件
          </button>
        ) : null}
        <div className="webui-plugin-header-inner">
        {managementOpen ? (
          <>
            <h1>管理</h1>
            <div className="webui-plugin-create-anchor webui-plugin-management-create-anchor">
              <button
                type="button"
                className="webui-plugin-create-trigger"
                aria-expanded={createMenuOpen}
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                ＋ 创建
              </button>
              {createMenuOpen ? (
                <div className="webui-plugin-create-menu">
                  <button
                    onClick={() => {
                      setPluginImportDialog(true);
                      setCreateMenuOpen(false);
                      setPluginUrl("");
                      setPluginPreview(undefined);
                    }}
                  >
                    从 Git 仓库导入插件
                  </button>
                  <button onClick={() => openCreate("skills")}>录入技能</button>
                  <button onClick={() => openCreate("mcp")}>
                    添加 MCP server
                  </button>
                  <button onClick={() => openCreate("agents")}>
                    创建 Agent
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {/* The marketplace is a catalogue of two kinds of thing, so the
             * header picks one: plugins, or skills. They used to share a single
             * page with the skills appended below the plugin grid, which meant
             * one list to scroll and one search box claiming to cover both.
             * What is installed is no longer the 个人 half of a 市场/个人 pair —
             * that pair is gone. The 管理 button in the same button group opens
             * the management view, which is where installed plugins live. */}
            <div className="webui-plugin-header-tabs" aria-label="插件与技能">
              <button
                aria-pressed={area === "plugins"}
                onClick={() => selectMarketCatalog("plugins")}
              >
                插件
              </button>
              <button
                aria-pressed={area === "skills"}
                onClick={() => selectMarketCatalog("skills")}
              >
                技能
              </button>
            </div>
            <div className="webui-plugin-create-anchor">
              <button
                type="button"
                aria-label="刷新插件市场"
                onClick={() => void reload()}
              >
                ⟳
              </button>
              <button
                type="button"
                className="webui-plugin-manage-trigger"
                onClick={() => {
                  setManagementOpen(true);
                  setView("personal");
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7.1 2.8h5.8l4.3 4.3v5.8l-4.3 4.3H7.1l-4.3-4.3V7.1z" />
                  <circle cx="10" cy="10" r="2.2" />
                </svg>
                管理
              </button>
            </div>
          </>
        )}
        </div>
        {isMarketCatalogue ? (
          <div className="webui-plugin-market-discovery">
            {/* Plugin categories do not apply to the skill hub, so the nav is
             * the plugin catalogue's alone. The search box is shared. */}
            {area === "plugins" ? (
              <nav className="webui-plugin-category-filter" aria-label="市场分类">
                {categories.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            ) : null}
            <label className="webui-plugin-market-search">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.8" cy="8.8" r="5.8" />
                <path d="m13.2 13.2 4 4" />
              </svg>
              <input
                aria-label={area === "skills" ? "搜索技能" : "搜索插件"}
                placeholder={area === "skills" ? "搜索技能..." : "搜索插件..."}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
        {managementOpen ? (
          <div className="webui-plugin-market-discovery webui-plugin-management-discovery">
            <nav className="webui-plugin-category-filter" aria-label="插件管理分类">
              {CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={area === item.id}
                  onClick={() => {
                    setLocalError("");
                    setArea(item.id);
                    setView("personal");
                  }}
                >
                  <span>{item.label}</span>
                  {area === item.id ? (
                    <span className="webui-plugin-count">{data.length}</span>
                  ) : null}
                </button>
              ))}
            </nav>
            <label className="webui-plugin-market-search">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.8" cy="8.8" r="5.8" />
                <path d="m13.2 13.2 4 4" />
              </svg>
              <input
                aria-label={`搜索${area === "mcp" ? "MCP" : area === "skills" ? "技能" : area === "agents" ? "Agent" : area === "apps" ? "应用" : "插件"}`}
                placeholder={`搜索${area === "mcp" ? "MCP" : area === "skills" ? "技能" : area === "agents" ? "Agent" : area === "apps" ? "应用" : "插件"}...`}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
      </header>
      {isMarketCatalogue ? (
        <h2 className="webui-plugin-market-heading">{marketNoun}</h2>
      ) : null}
      {area === "plugins" && view === "personal" && !managementOpen ? (
        <h2 className="webui-plugin-market-heading">插件</h2>
      ) : null}
      {error ? (
        <p role="alert" className="webui-plugin-error">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="webui-plugin-empty" role="status">
          加载中…
        </p>
      ) : area === "agents" ? (
        <div className="webui-agent-editor">
          <div className="webui-agent-list">
            <div className="webui-agent-list-heading">全部 Agent</div>
            {filtered.map((item) => (
              <button
                key={nameOf(item)}
                aria-pressed={selectedAgent === item}
                onClick={() => { setEditing(item); setSelectedAgent(item); setDialog("agent"); }}
              >
                <span className="webui-agent-avatar webui-agent-avatar--small">
                  {read(item, "avatarDataUrl").startsWith("data:image/") ? (
                    <img src={read(item, "avatarDataUrl")} alt="" />
                  ) : (
                    <WebuiIconAgent className="webui-agent-avatar-icon webui-agent-avatar-icon--small" />
                  )}
                </span>
                <span>{read(item, "displayName", "display_name") || nameOf(item)}</span>
              </button>
            ))}
            <button
              className="webui-agent-create"
              type="button"
              onClick={() => { setEditing(undefined); setDialog("agent"); }}
            >
              <span aria-hidden="true">＋</span> 创建 Agent
            </button>
          </div>
          {/*
            The agent detail is a view, not a second editor. It used to carry
            its own name/model/prompt fields — a second copy of the same draft
            the dialog owns — and the two could disagree, because saving one left
            the other showing stale values. What it shows now it reads from the
            row; the draft lives in `AgentForm`, once (T08).
          */}
          <div className="webui-agent-detail">
            <div className="webui-agent-fields">
              <label className="webui-agent-avatar-field">
                头像
                <span className="webui-agent-avatar webui-agent-avatar--large">
                  {read(selectedAgent ?? {}, "avatarDataUrl").startsWith("data:image/") ? (
                    <img src={read(selectedAgent ?? {}, "avatarDataUrl")} alt="Agent 头像" />
                  ) : (
                    <WebuiIconAgent className="webui-agent-avatar-icon webui-agent-avatar-icon--large" />
                  )}
                </span>
              </label>
              <label>
                名称
                <span data-testid="webui-agent-detail-name">
                  {read(selectedAgent ?? {}, "name", "displayName", "display_name")}
                </span>
              </label>
              <label className="webui-agent-model-field">
                模型
                <span data-testid="webui-agent-detail-model">
                  {read(selectedAgent ?? {}, "model") || "—"}
                </span>
              </label>
              <label>
                描述
                <span data-testid="webui-agent-detail-description">
                  {read(selectedAgent ?? {}, "description") || "—"}
                </span>
              </label>
              <label>
                系统提示词
                <span data-testid="webui-agent-detail-prompt">
                  {read(selectedAgent ?? {}, "systemPrompt", "system_prompt")}
                </span>
              </label>
              <div className="webui-agent-actions">
                {selectedAgent ? (
                  <button
                    type="button"
                    className="webui-agent-delete"
                    onClick={() =>
                      confirmMutation("删除 Agent", {
                        kind: "deleteAgent",
                        name: nameOf(selectedAgent),
                      })
                    }
                  >
                    删除
                  </button>
                ) : <span />}
                <button
                  type="button"
                  className="webui-agent-save"
                  disabled={busy || !selectedAgent}
                  onClick={() => {
                    setEditing(selectedAgent);
                    setDialog("agent");
                  }}
                >
                  编辑
                </button>
                {selectedAgent && onChatWithAgent ? (
                  <button
                    type="button"
                    className="webui-agent-chat"
                    disabled={busy}
                    onClick={() => void chatWithAgent(selectedAgent)}
                  >
                    和他对话
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="webui-plugin-empty">暂无内容</p>
      ) : (
        <div
          className={`webui-plugin-list ${isMarketCatalogue ? "webui-plugin-grid" : ""}`}
        >
          {(isMarketCatalogue && !showAllCatalogue
            ? filtered.slice(0, MARKET_PREVIEW_COUNT)
            : filtered
          ).map((item, index) => {
            const name = nameOf(item) || `item-${index}`;
            const isOn = enabled(item);
            const description = read(item, "description", "summary");
            // Computed for every row, read only in the mcp branch: the loose
            // read is side-effect-free, and narrowing `area` inside the JSX
            // below cannot narrow this binding.
            const mcpStatus = describeWebuiMcpServerStatus(item);
            // The button's intent, built with the fields its own command
            // declares. It used to be a bare verb here and a payload at the call
            // site three hundred lines away, so the two could disagree about
            // which command ran (T08).
            const pluginIntent = (kind: "installPlugin" | "enablePlugin" | "disablePlugin"): WebuiPluginIntent => ({
              kind,
              pluginName: name,
              ...(pluginSource(item) === undefined ? {} : { source: pluginSource(item) }),
            });
            const iconUrl = read(item, "iconUrl", "icon_url");
            return (
              <article className="webui-plugin-row" key={`${area}-${name}`}>
                <div
                  className={`webui-plugin-icon${area === "skills" ? " webui-plugin-icon--skill" : ""}`}
                  aria-hidden="true"
                >
                  {area === "skills" ? (
                    <span className="webui-plugin-skill-icon-tile">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M9 4.25h7.25L19.5 7.5v11.25A1.75 1.75 0 0 1 17.75 20.5H9A2 2 0 0 1 7 18.5v-12.25a2 2 0 0 1 2-2Z" />
                        <path d="M16 4.5v3.25h3.25M11 11h5.5M11 14h5.5M11 17h3.25" />
                        <path d="M7 7H5.75A1.75 1.75 0 0 0 4 8.75v9.5A1.75 1.75 0 0 0 5.75 20H9" />
                      </svg>
                    </span>
                  ) : iconUrl ? (
                    <>
                      <img
                        src={iconUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                          event.currentTarget.nextElementSibling?.removeAttribute(
                            "hidden",
                          );
                        }}
                      />
                      <span hidden>▦</span>
                    </>
                  ) : area === "plugins" ? (
                    "▦"
                  ) : (
                    "◇"
                  )}
                </div>
                <div className="webui-plugin-copy">
                  <h2>{read(item, "displayName", "display_name") || name}</h2>
                  <p>{description || read(item, "transport")}</p>
                </div>
                {area === "plugins" && view === "market" ? (
                  <button
                    type="button"
                    disabled={item.installed === true}
                    onClick={() =>
                      void mutate(
                        pluginIntent(view === "market" ? "installPlugin" : isOn ? "disablePlugin" : "enablePlugin"),
                      )
                    }
                  >
                    {item.installed === true ? "已安装" : "安装"}
                  </button>
                ) : area === "skills" && view === "market" ? (
                  <button
                    type="button"
                    disabled={
                      item.added === true ||
                      !read(
                        item,
                        "url",
                        "sourceUrl",
                        "source_url",
                        "gitUrl",
                        "git_url",
                      )
                    }
                    onClick={() =>
                      void mutate({
                        kind: "installSkill",
                        url:
                          read(item, "url", "sourceUrl", "source_url") ||
                          read(item, "gitUrl", "git_url"),
                        displayName:
                          read(item, "displayName", "display_name") ||
                          undefined,
                        publisherSourceType:
                          typeof item.publisherSourceType === "number"
                            ? item.publisherSourceType
                            : typeof item.source_type === "number"
                              ? item.source_type
                              : undefined,
                        isFromGit:
                          item.isFromGit === true || item.is_from_git === true,
                        // Narrowed to a record, not merely "an object": the
                        // command declares a structured `creatorInfo`, and the
                        // row is untyped, so the check has to be the real one.
                        ...(creatorInfoOf(item) ? { creatorInfo: creatorInfoOf(item) } : {}),
                      })
                    }
                  >
                    {item.added === true ? "已添加" : "添加"}
                  </button>
                ) : area === "apps" ? (
                  <span className="text-text_default_tertiary">
                    {appStatus(item)}
                  </span>
                ) : area === "mcp" ? (
                  <>
                    {/* The status the runtime already knows, on the row
                     * itself: a server that cannot connect is labelled
                     * 连接失败 with its own reason inline — visible text, not
                     * a tooltip, because nobody hovers a row they believe
                     * is healthy. Mirrors the apps area's status slot. */}
                    <div className="webui-plugin-mcp-status">
                      <span
                        className={`text-size_12 ${mcpStatus.tone}`}
                        data-webui-mcp-status={mcpStatus.key}
                      >
                        {mcpStatus.label}
                      </span>
                      {mcpStatus.reason ? (
                        <small
                          className="text-size_12 text-text_default_tertiary"
                          data-webui-mcp-status-reason={mcpStatus.key}
                          title={mcpStatus.reason}
                        >
                          {mcpStatus.reason}
                        </small>
                      ) : null}
                    </div>
                    <div className="webui-plugin-actions">
                    <button onClick={() => void prepareMcp(item)}>编辑</button>
                    <button
                      onClick={() =>
                        confirmMutation("删除 MCP server", {
                          kind: "deleteMcpServer",
                          name,
                        })
                      }
                    >
                      删除
                    </button>
                    <ToggleSwitch
                      checked={isOn}
                      label={`启用 ${name}`}
                      onChange={() =>
                        void mutate({ kind: "setMcpServerEnabled", name, enabled: !isOn })
                      }
                    />
                  </div>
                  </>
                ) : (
                  <div className="webui-plugin-actions">
                    <ToggleSwitch
                      checked={isOn}
                      label={`启用 ${name}`}
                      onChange={() =>
                        void mutate(
                          area === "plugins"
                            ? pluginIntent(view === "market" ? "installPlugin" : isOn ? "disablePlugin" : "enablePlugin")
                            : {
                                kind: "setSkillEnabled",
                                skillName: name,
                                enabled: !isOn,
                                ...(locationUriOf(item) ? { locationUri: locationUriOf(item) } : {}),
                              },
                        )
                      }
                    />
                    {area === "plugins" ? (
                      <button
                        onClick={() =>
                          confirmMutation("卸载插件", {
                            kind: "uninstallPlugin",
                            pluginName: name,
                            ...(pluginSource(item) === undefined
                              ? {}
                              : { source: pluginSource(item) }),
                          })
                        }
                      >
                        卸载
                      </button>
                    ) : area === "skills" ? (
                      <button
                        onClick={() =>
                          confirmMutation("删除技能", {
                            kind: "deleteSkill",
                            skillName: name,
                            ...(locationUriOf(item)
                              ? { locationUri: locationUriOf(item) }
                              : {}),
                          })
                        }
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {!busy && isMarketCatalogue && visibleMarketTotal > MARKET_PREVIEW_COUNT ? (
        <button
          type="button"
          className="webui-plugin-show-all"
          onClick={() => setShowAllCatalogue((value) => !value)}
        >
          {showAllCatalogue
            ? `收起${marketNoun}`
            : marketTotal === null
              ? `查看全部${marketNoun}`
              : `查看全部 ${marketTotal} 个`}
        </button>
      ) : null}
      {dialog ? (
        <PluginItemDialog
          dialog={dialog}
          editing={editing}
          onSubmit={mutate}
          {...(onChatWithAgent ? { onChatWithAgent } : {})}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {pluginImportDialog ? (
        <PluginImportDialog
          url={pluginUrl}
          onUrlChange={(value) => {
            setPluginUrl(value);
            setPluginPreview(undefined);
          }}
          preview={pluginPreview}
          error={error}
          busy={busy}
          onPreview={() => void previewPlugin()}
          onImport={() => void importPlugin()}
          onClose={() => setPluginImportDialog(false)}
        />
      ) : null}
    </section>
  );
}
