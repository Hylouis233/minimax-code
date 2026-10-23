import type { ReactElement, ReactNode } from "react";
import { WebuiIconBrand } from "./icons.js";
import { GreetingSkeleton } from "../features/transcript/ui/TranscriptSkeletons.js";
import { WebuiWorkspacePanelControls } from "../features/workspace/ui/WorkspacePanelControls.js";

/** Conversation column layout; Shell supplies already-owned feature surfaces and named navigation actions. */
export function ConversationSurface(props: {
  readonly home: boolean;
  readonly sessionId?: string;
  readonly title?: string;
  readonly greetingPending: boolean;
  readonly railCollapsed: boolean;
  readonly progressOpen: boolean;
  readonly onOpenBrowser: () => void;
  readonly onToggleProgress: () => void;
  readonly usageBanner?: ReactNode;
  readonly connectionStatus: ReactNode;
  readonly composerAndTranscript: ReactNode;
  readonly progressPanel: ReactNode;
  readonly workspacePanel?: ReactElement;
}): ReactElement {
  return <>
    {!props.home && !props.workspacePanel ? <WebuiWorkspacePanelControls
      browserPanelOpen={false}
      progressPanelOpen={props.progressOpen}
      onOpenBrowser={props.onOpenBrowser}
      onToggleProgressPanel={props.onToggleProgress}
    /> : null}
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="pointer-events-none absolute inset-x-0 top-6 z-[60] flex justify-center" data-webui-busy-banner-slot="true" />
      <div
        className={props.home
          ? "flex h-full min-h-0 w-full flex-col items-center relative overflow-hidden"
          : `flex h-full min-h-0 w-full flex-col items-center relative overflow-hidden pt-spacing_24 ${props.progressOpen ? "webui-session-has-progress-panel" : ""}`}
        data-webui-home-content={props.home ? "true" : "false"}
        data-webui-session-layout={!props.home ? "true" : undefined}
      >
        {props.home ? <div aria-hidden="true" className="h-[clamp(96px,24vh,240px)] w-full shrink" /> : null}
        <div className={props.home
          ? "flex w-full max-w-[743px] shrink-0 flex-col items-center gap-2 px-4"
          : "webui-session-layout relative flex h-full min-h-0 w-full flex-col items-center gap-2"}>
          {props.home ? (props.greetingPending ? <GreetingSkeleton /> : <div className="flex flex-col items-center gap-2 text-center [@media(max-height:300px)]:hidden">
            <div className="group/avatar relative size-16 flex-shrink-0"><div className="webui-hero-avatar relative h-full w-full overflow-visible rounded-full bg-bg_grouped_tertiary"><span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full"><WebuiIconBrand className="h-full w-full" /></span></div></div>
            <h1 className="text-[28px] font-medium leading-tight text-text_default_primary">MiniMax Code Web，让工作更简单。</h1>
          </div>) : <div className="webui-session-title-row flex w-full items-center gap-2" data-webui-rail-collapsed={props.railCollapsed || undefined}><span className="webui-session-title" data-webui-session-title="true">{props.title ?? ""}</span></div>}
          {props.usageBanner}
          {props.connectionStatus}
          <div className={props.home ? "contents" : "webui-session-scroll-viewport flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden"} data-webui-session-scroll={props.home ? undefined : "true"}>
            {props.composerAndTranscript}
            {!props.home ? <div className="webui-session-bottom-padding w-full shrink-0" data-testid="message-bottom-padding" data-webui-session-bottom-padding="true" /> : null}
          </div>
        </div>
      </div>
    </div>
    {!props.home ? props.progressPanel : null}
    {!props.home ? props.workspacePanel : null}
  </>;
}
