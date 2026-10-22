import type { ReactElement } from "react";
import { IconBrowser, IconLayoutSidebarRightCollapse } from "@tabler/icons-react";

/** Entry controls for the independent workspace and progress panels. */
export function WebuiWorkspacePanelControls({ browserPanelOpen, progressPanelOpen, onOpenBrowser, onToggleProgressPanel }: {
  readonly browserPanelOpen: boolean;
  readonly progressPanelOpen: boolean;
  readonly onOpenBrowser: () => void;
  readonly onToggleProgressPanel: () => void;
}): ReactElement {
  return <div className="webui-workspace-panel-controls" data-testid="workspace-panel-controls">
    <button type="button" className={`webui-workspace-icon-button ${browserPanelOpen ? "is-active" : ""}`} aria-label="浏览器" title="浏览器" aria-pressed={browserPanelOpen} onClick={onOpenBrowser}><IconBrowser className="size-5" stroke={1.6} aria-hidden="true" /></button>
    <button type="button" className={`webui-workspace-icon-button ${progressPanelOpen ? "is-active" : ""}`} aria-label="环境信息与进度" title="环境信息与进度" aria-pressed={progressPanelOpen} onClick={onToggleProgressPanel}><IconLayoutSidebarRightCollapse className="size-5" stroke={1.6} aria-hidden="true" /></button>
  </div>;
}
