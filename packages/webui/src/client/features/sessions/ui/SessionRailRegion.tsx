import type { ChangeEvent, ComponentProps, ReactElement, ReactNode, RefObject } from "react";
import { WebuiProjectList } from "./SessionRail.js";
import { RailRow } from "./RailRow.js";
import { WebuiIconContextExport, WebuiIconNewTask, WebuiIconPlugins, WebuiIconRemote, WebuiIconSites } from "../../../components/shell/icons.js";

type ProjectListProps = ComponentProps<typeof WebuiProjectList>;

/** Rail content composed from session presentation state and named navigation commands. */
export function SessionRailRegion(props: {
  readonly collapsed: boolean;
  readonly homeMode: boolean;
  readonly pluginManagementOpen: boolean;
  readonly startNewTask: () => void;
  readonly importInputRef: RefObject<HTMLInputElement>;
  readonly openImportPicker: () => void;
  readonly importBusy: boolean;
  readonly onImportPicked: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly searchOpen: boolean;
  readonly searchQuery: string;
  readonly searchInputRef: RefObject<HTMLInputElement>;
  readonly setSearchQuery: (query: string) => void;
  readonly closeSearch: () => void;
  readonly openPlugins: () => void;
  readonly projectList: ProjectListProps;
  readonly hasSearchResults: boolean;
  readonly footer?: ReactNode;
}): ReactElement {
  return (
    <aside
      aria-label="Primary navigation"
      data-webui-shell-region="rail"
      data-webui-rail-width={props.collapsed ? "64" : "240"}
      className={`webui-rail relative z-50 flex h-full select-none flex-col overflow-visible ${props.collapsed ? "w-[64px] bg-transparent" : "w-[240px] bg-bg_default_scrim"}`}
    >
      <div className="h-[50px] flex-shrink-0" aria-hidden="true" />
      {!props.collapsed ? <>
        <div className="flex-shrink-0 px-4 pb-px" data-webui-rail-fixed-row="true">
          <RailRow label="新建任务" icon={<WebuiIconNewTask className="flex-shrink-0" />} active={props.homeMode && !props.pluginManagementOpen} onSelect={props.startNewTask} />
          <input ref={props.importInputRef} type="file" accept=".json,application/json" data-webui-session-import-input="true" aria-label="导入会话文件" className="webui-composer-hidden-file-input" onChange={props.onImportPicked} />
          <RailRow label="导入会话" icon={<WebuiIconContextExport className="flex-shrink-0" />} active={false} inert={props.importBusy} onSelect={props.openImportPicker} />
        </div>
        {props.searchOpen ? <div className="flex-shrink-0 px-4 pb-px pt-1" data-webui-rail-fixed-row="true">
          <input
            id="webui-rail-search" ref={props.searchInputRef} type="text" role="searchbox"
            data-webui-rail-search-input="true" aria-label="搜索会话" placeholder="搜索会话"
            value={props.searchQuery} onChange={(event) => props.setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key !== "Escape") return; event.preventDefault(); props.closeSearch(); }}
            className="w-full rounded-[8px] border border-stroke_default bg-bg_default_primary px-2 py-1 text-sm text-text_default_primary outline-none placeholder:text-text_default_tertiary focus:border-stroke_strong"
          />
        </div> : null}
        <div className="relative min-h-0 flex-1">
          <div className="webui-rail-scroll h-full overflow-x-hidden overflow-y-auto px-4">
            <div className="space-y-px pb-2">
              <RailRow label="插件" icon={<WebuiIconPlugins />} active={props.pluginManagementOpen} onSelect={props.openPlugins} />
              <RailRow label="网站" icon={<WebuiIconSites />} inert />
              <RailRow label="远程" icon={<WebuiIconRemote />} inert />
            </div>
            <WebuiProjectList {...props.projectList} />
            {props.searchQuery.trim() && !props.hasSearchResults ? <p data-webui-rail-search-empty="true" className="px-2 py-3 text-sm text-text_default_tertiary">没有匹配的会话</p> : null}
          </div>
          <div className="webui-scroll-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6" aria-hidden="true" data-webui-scroll-fade="true" />
        </div>
      </> : null}
      {props.footer}
    </aside>
  );
}
