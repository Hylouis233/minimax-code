import type { ReactElement } from "react";
import type { WebuiPluginCatalogueRow } from "../projection/catalogue-view.js";
import type { WebuiPluginIntent } from "../contracts/plugin-actions.js";
import { readWebuiPluginRow as read } from "../contracts/plugin-rows.js";

const MARKET_PREVIEW_COUNT = 8;
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

export function PluginMarketplaceFilters({
  area,
  query,
  category,
  onQueryChange,
  onCategoryChange,
}: {
  readonly area: "plugins" | "skills";
  readonly query: string;
  readonly category: string;
  readonly onQueryChange: (query: string) => void;
  readonly onCategoryChange: (category: string) => void;
}): ReactElement {
  const noun = area === "skills" ? "技能" : "插件";
  return (
    <div className="webui-plugin-market-discovery">
      {area === "plugins" ? (
        <nav className="webui-plugin-category-filter" aria-label="市场分类">
          {categories.map((item) => (
            <button
              key={item.id}
              aria-pressed={category === item.id}
              onClick={() => onCategoryChange(item.id)}
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
          aria-label={`搜索${noun}`}
          placeholder={`搜索${noun}...`}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}
export function PluginMarketplace({
  area,
  rows,
  marketTotal,
  visibleMarketTotal,
  showAll,
  onToggleAll,
  onIntent,
}: {
  readonly area: "plugins" | "skills";
  readonly rows: readonly WebuiPluginCatalogueRow[];
  readonly marketTotal: number | null;
  readonly visibleMarketTotal: number;
  readonly showAll: boolean;
  readonly onToggleAll: () => void;
  readonly onIntent: (intent: WebuiPluginIntent) => void;
}): ReactElement {
  const noun = area === "skills" ? "技能" : "插件";
  return (
    <>
      {rows.length === 0 ? (
        <p className="webui-plugin-empty">暂无内容</p>
      ) : (
        <div className="webui-plugin-list webui-plugin-grid">
          {(showAll ? rows : rows.slice(0, MARKET_PREVIEW_COUNT)).map(
            (row, index) => {
              const item = row.source;
              const name = row.name || `item-${index}`;
              const pluginIntent = (
                kind: "installPlugin" | "enablePlugin" | "disablePlugin",
              ): WebuiPluginIntent => ({
                kind,
                pluginName: name,
                ...(row.pluginSource === undefined
                  ? {}
                  : { source: row.pluginSource }),
              });
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
                    ) : row.iconUrl ? (
                      <>
                        <img
                          src={row.iconUrl}
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
                    ) : (
                      "▦"
                    )}
                  </div>
                  <div className="webui-plugin-copy">
                    <h2>{read(item, "displayName", "display_name") || name}</h2>
                    <p>{row.description || read(item, "transport")}</p>
                  </div>
                  {area === "plugins" ? (
                    <button
                      type="button"
                      disabled={item.installed === true}
                      onClick={() => onIntent(pluginIntent("installPlugin"))}
                    >
                      {item.installed === true ? "已安装" : "安装"}
                    </button>
                  ) : (
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
                        onIntent({
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
                          ...(row.creatorInfo
                            ? { creatorInfo: row.creatorInfo }
                            : {}),
                        })
                      }
                    >
                      {item.added === true ? "已添加" : "添加"}
                    </button>
                  )}
                </article>
              );
            },
          )}
        </div>
      )}
      {visibleMarketTotal > MARKET_PREVIEW_COUNT ? (
        <button
          type="button"
          className="webui-plugin-show-all"
          onClick={onToggleAll}
        >
          {showAll
            ? `收起${noun}`
            : marketTotal === null
              ? `查看全部${noun}`
              : `查看全部 ${marketTotal} 个`}
        </button>
      ) : null}
    </>
  );
}
