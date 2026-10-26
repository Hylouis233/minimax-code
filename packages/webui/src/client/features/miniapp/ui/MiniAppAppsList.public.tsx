// The plugin catalogue's apps area, as the Mini App business publishes it.
//
// ADR 0020 gives this surface the list and the lifecycle and gives the Mini App
// business the state: the catalogue mounts this component and holds nothing of
// its own. That is why the component takes no rows, no loading flag and no error
// — it reads them from its own owner, and a row's runtime state is the same read
// the launcher's picker makes.
//
// "Install" is the one action a row cannot carry: a Mini App *is* a plugin, and
// installing one is installing its package from the marketplace. The area keeps
// the affordance and hands it to the catalogue, which owns switching to that
// view; what this component does not do is invent an install that installs
// something already installed.

import { useEffect, type ReactElement } from "react";

import {
  useWebuiMiniAppWorkflows,
  useWebuiMiniAppWorkflowsState,
} from "../bindings/use-miniapp-workflows.js";
import { webuiMiniAppRefusalText } from "../projection/miniapp-view.js";

export interface MiniAppAppsListProps {
  /** Offered when the catalogue can switch to the plugin marketplace. */
  readonly onInstallRequest?: () => void;
}

export function MiniAppAppsList({ onInstallRequest }: MiniAppAppsListProps): ReactElement {
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const { rows, loading, error } = state.listing;

  useEffect(() => {
    void workflows?.loadListing();
  }, [workflows]);

  if (state.unavailable) return <p className="webui-plugin-empty">{state.unavailable}</p>;
  if (loading && rows.length === 0) {
    return (
      <p className="webui-plugin-empty" role="status">
        加载中…
      </p>
    );
  }

  return (
    <div className="webui-miniapp-apps" data-testid="miniapp-apps">
      {onInstallRequest ? (
        <div className="webui-miniapp-apps-toolbar">
          <button type="button" onClick={onInstallRequest}>
            安装 Mini App
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="webui-plugin-error" role="alert">
          {error}
        </p>
      ) : null}
      {rows.length === 0 ? <p className="webui-plugin-empty">暂无已安装的 Mini App</p> : null}
      <div className="webui-plugin-list">
        {rows.map((row) => {
          const refusal = state.refusals[row.pluginId];
          return (
            <article className="webui-plugin-row" key={`apps-${row.pluginId}`} data-testid={`miniapp-app-${row.pluginId}`}>
              <div className="webui-plugin-icon" aria-hidden="true">
                {row.iconUrl ? <img src={row.iconUrl} alt="" loading="lazy" /> : "◇"}
              </div>
              <div className="webui-plugin-copy">
                <h2>{row.name}</h2>
                <p>{row.description || row.pluginId}</p>
                {refusal ? (
                  <p className="webui-plugin-error" role="alert" data-testid={`miniapp-app-refusal-${row.pluginId}`}>
                    {webuiMiniAppRefusalText({
                      code: refusal.code,
                      message: refusal.message,
                      rows,
                    })}
                  </p>
                ) : null}
              </div>
              <span
                className="text-text_default_tertiary"
                data-testid={`miniapp-app-status-${row.pluginId}`}
                data-status={row.status}
              >
                {row.statusLabel}
                {row.errorCode ? `（${row.errorCode}）` : ""}
              </span>
              <div className="webui-plugin-actions">
                {row.enabled ? (<>
                <button
                  type="button"
                  disabled={state.opening === row.pluginId}
                  onClick={() => void workflows?.open(row.pluginId)}
                >
                  打开
                </button>
                {state.presentations[row.pluginId]?.kind === "open" ? (
                  <button
                    type="button"
                    onClick={() => {
                      // Already started by the click above, so this is a plain
                      // gesture and the browser opens the page rather than
                      // blocking it. The catalogue has no workspace panel, so the
                      // started page is shown in its own browser tab — the
                      // standalone presentation in its simplest form. The
                      // deep-linked client tab is ADR 0020's later ticket.
                      const opened = state.presentations[row.pluginId];
                      if (opened?.kind === "open") window.open(opened.viewUrl, "_blank", "noopener");
                    }}
                  >
                    查看
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!row.running && row.status !== "starting"}
                  onClick={() => void workflows?.stop(row.pluginId)}
                >
                  停止
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`确定卸载 ${row.name}？`)) void workflows?.uninstall(row.pluginId);
                  }}
                >
                  卸载
                </button>
                <button type="button" onClick={() => void workflows?.setPluginEnabled(row.pluginId, false)}>
                  停用
                </button>
                </>) : (
                  // A disabled package has nothing to start or stop; the one
                  // action it has is the one that makes it startable again.
                  <button type="button" onClick={() => void workflows?.setPluginEnabled(row.pluginId, true)}>
                    启用
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
