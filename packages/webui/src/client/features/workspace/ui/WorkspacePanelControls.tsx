import type { ReactElement } from "react";
import { WebuiIconFolder, WebuiIconSidebarToggle } from "../../../shell/icons.js";

/** Entry controls for the independent workspace and progress panels. */
export function WebuiWorkspacePanelControls({ filePanelOpen, progressPanelOpen, onOpenFiles, onToggleProgressPanel }: {
  readonly filePanelOpen: boolean;
  readonly progressPanelOpen: boolean;
  readonly onOpenFiles: () => void;
  readonly onToggleProgressPanel: () => void;
}): ReactElement {
  return <div className="webui-workspace-panel-controls" data-testid="workspace-panel-controls">
    <button type="button" className={`webui-workspace-icon-button ${filePanelOpen ? "is-active" : ""}`} aria-label="工作区文件侧栏" title="工作区文件侧栏" aria-pressed={filePanelOpen} onClick={onOpenFiles}><WebuiIconFolder className="size-5" /></button>
    <button type="button" className={`webui-workspace-icon-button ${progressPanelOpen ? "is-active" : ""}`} aria-label="环境信息与进度" title="环境信息与进度" aria-pressed={progressPanelOpen} onClick={onToggleProgressPanel}><WebuiIconSidebarToggle className="size-5" /></button>
  </div>;
}
