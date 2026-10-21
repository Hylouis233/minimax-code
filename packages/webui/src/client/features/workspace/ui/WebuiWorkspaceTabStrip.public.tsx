// The workspace panel's tab strip.
//
// The strip is the workspace's one row of tabs: tool tabs (files, review,
// canvas, terminal) and web tabs interleaved in the order they were opened.
// It owns three things:
//   - the per-tab close button,
//   - the single active tab,
//   - the "+" affordance that opens the launcher tab.
//
// The web tabs it shows come from the runtime's `watchBrowserWebTabs`
// snapshot, never a parallel copy the client keeps. The strip subscribes
// once and turns each published web tab into an `open-web-tab` panel
// command, so the workspace's own reducer is what holds the list — the
// reconciliation lives there, and a snapshot that lands twice changes
// nothing.
//
// `.public` because the Browser business's host renders the strip's
// active web tab: a foreign business's component renders the workspace's
// tabs, and reaching across the boundary from the other side is what the
// dependency rules allow.

import {
  useEffect,
  useRef,
  type ReactElement,
} from "react";

import {
  type WebuiBrowserWebTab,
  type WebuiBrowserWebTabSnapshot,
} from "../../../../shared/contracts/browser.js";
import { useWebuiPortSlice } from "../../../bindings/port-slices-context.js";
import {
  webuiWorkspaceTabLabel,
  type WorkspacePanelCommand,
  type WorkspacePanelState,
  type WorkspacePanelTab,
} from "../projection/workspace-panel-state.js";
import {
  WebuiIconClose,
  WebuiIconDiffFile,
  WebuiIconFile,
} from "../../../shell/icons.js";

const DESKTOP_COPY = {
  addTab: "新建标签页",
  fileClose: "关闭",
  tabsLabel: "工作区面板标签",
} as const;

/**
 * The strip's view of the panel.
 *
 * The strip is a presentation component over the workspace's reducer output:
 * the reducer holds the canonical list of tabs, and the strip diffs that
 * list against what the runtime just published through
 * `watchBrowserWebTabs`, dispatching an `open-web-tab` for each published
 * tab that has no panel tab yet.
 *
 * The strip does not keep its own list of web tabs. Two copies of "what is
 * open" disagree exactly when a tab is closed (issue #207), so the strip
 * owns the closing gesture only — knowing the tab is gone is the reducer's
 * job, and the strip's dispatch is what tells it.
 */
export interface WebuiWorkspaceTabStripProps {
  /** The panel's state, projected by the workspace's reducer. */
  readonly state: WorkspacePanelState;
  /** The dispatch the strip fires commands at. */
  readonly dispatch: (command: WorkspacePanelCommand) => void;
}

/**
 * The commands a published snapshot implies for the workspace.
 *
 * Exported for the test that exercises the reconciliation rule without a
 * DOM: a snapshot's tabs become `open-web-tab` commands for any target the
 * panel does not already have a tab for.
 */
export function webuiWorkspaceTabStripReconcile(
  tabs: readonly WorkspacePanelTab[],
  snapshot: WebuiBrowserWebTabSnapshot,
): readonly { readonly command: WorkspacePanelCommand; readonly target: WebuiBrowserWebTab["target"] }[] {
  const known = new Map(
    tabs
      .filter(
        (tab): tab is WorkspacePanelTab & { readonly content: Extract<WorkspacePanelTab["content"], { readonly kind: "web" }> } =>
          tab.content.kind === "web",
      )
      .map((tab) => [
        `${tab.content.target.browserId}/${tab.content.target.targetId}`,
        tab.content,
      ]),
  );
  return snapshot.tabs
    .filter((published) => {
      const current = known.get(`${published.target.browserId}/${published.target.targetId}`);
      // A web tab the panel does not have yet is new, and a web tab whose
      // title, url or generation moved is the same tab showing another page.
      // A snapshot that changes nothing produces no work.
      if (!current) return true;
      return (
        current.title !== published.title ||
        current.url !== published.url ||
        current.target.generation !== published.target.generation
      );
    })
    .map((published) => ({
      command: {
        type: "open-web-tab",
        target: published.target,
        title: published.title,
        url: published.url,
      },
      target: published.target,
    }));
}

/**
 * The glyph a tool tab carries.
 *
 * The registry carries the kinds, their words and how each opens; the glyphs
 * are the strip's, because a glyph is a rendering of the content rather than
 * a fact about it.
 */
function fileTabGlyph(item: WorkspacePanelTab): ReactElement | null {
  if (item.content.kind === "files") {
    return <WebuiIconFile className="webui-workspace-tab-file-icon" />;
  }
  if (item.content.kind !== "file-preview") return null;
  const extension = item.content.path.split(/[./\\]/u).at(-1)?.toLowerCase();
  if (extension === "md" || extension === "mdx") {
    return <span className="webui-workspace-filetype-badge is-markdown" aria-hidden="true">M↓</span>;
  }
  if (["js", "jsx", "mjs", "cjs"].includes(extension ?? "")) {
    return <span className="webui-workspace-filetype-badge is-javascript" aria-hidden="true">JS</span>;
  }
  if (["ts", "tsx", "mts", "cts"].includes(extension ?? "")) {
    return <span className="webui-workspace-filetype-badge is-typescript" aria-hidden="true">TS</span>;
  }
  if (extension === "json") {
    return <span className="webui-workspace-filetype-badge is-json" aria-hidden="true">{ }</span>;
  }
  return <WebuiIconDiffFile fileName={item.content.path} className="webui-workspace-tab-file-icon" />;
}

/**
 * The strip component.
 *
 * Mounted by `WorkspacePanels` above the body of the active tab. Each
 * published web tab in the runtime's snapshot is brought into the
 * workspace's reducer through an `open-web-tab` dispatch, the same shape
 * the Agent uses to open a tab (issue #206), so a snapshot that lands
 * twice turns into no work and a tab that closes is what the reducer
 * records in its place.
 */
export function WebuiWorkspaceTabStrip({
  state,
  dispatch,
}: WebuiWorkspaceTabStripProps): ReactElement {
  // The strip does not touch its own state. What it does is reconcile the
  // snapshot against the workspace's tabs: for each published web tab, dispatch
  // an `open-web-tab` if the panel does not already have one. The reducer's
  // existing-tab rule (issue #206) keeps duplicates out.
  const slice = useWebuiPortSlice("browser");
  const watchBrowserWebTabs = slice?.watchBrowserWebTabs;

  // A ref-stable handle on the latest published web tabs. The effect that
  // subscribes to `watchBrowserWebTabs` is recreated only when the slice's
  // identity changes — the strip keeps an up-to-date view of the tabs in
  // a ref, so a snapshot that lands between renders is reconciled against
  // the tabs the reducer holds now.
  const latestTabsRef = useRef<WorkspacePanelState["tabs"]>(state.tabs);
  latestTabsRef.current = state.tabs;

  // The strip owns the row, so it is the strip that brings a focused,
  // off-screen tab into view. The row scrolls, the panel does not.
  const tabListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabListRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.activeTabId]);

  // The strip subscribes once. When the slice's `watchBrowserWebTabs` changes
  // identity we close the previous subscription and open a new one for the
  // slice the strip is now wired to.
  const watchKey = watchBrowserWebTabs ?? null;
  useEffect(() => {
    if (!watchBrowserWebTabs) return;
    const stop = watchBrowserWebTabs(
      { surface: "isolated-chromium" },
      (snapshot: WebuiBrowserWebTabSnapshot) => {
        // The strip owns the closing gesture only; the reducer owns the
        // canonical list. Each published web tab that has no panel tab is
        // brought in through an `open-web-tab` dispatch — the same shape the
        // Agent uses to open a tab (issue #206). A snapshot that lands
        // twice turns into no work, because the target is the reducer's
        // identity for a web tab.
        for (const { command } of webuiWorkspaceTabStripReconcile(latestTabsRef.current, snapshot)) {
          dispatch(command);
        }
      },
    );
    return () => {
      stop();
    };
  }, [watchKey, dispatch]);

  return (
    <div className="webui-workspace-tab-list" data-testid="workspace-tab-strip" ref={tabListRef}>
      {state.tabs.map((item) => (
        <div
          key={item.id}
          className={`webui-workspace-tab ${state.activeTabId === item.id ? "is-active" : ""}`}
          role="presentation"
          data-testid={`workspace-tab-strip-item-${item.id}`}
          data-tab-kind={item.content.kind}
        >
          <button
            type="button"
            role="tab"
            aria-selected={state.activeTabId === item.id}
            data-testid={`workspace-tab-${item.id}`}
            onClick={() => dispatch({ type: "select-tab", tabId: item.id })}
          >
            {item.content.kind === "launcher" ? (
              <span className="webui-workspace-tab-glyph webui-workspace-launcher-glyph" aria-hidden="true">+</span>
            ) : item.content.kind === "web" ? (
              // A web tab's glyph is a default one. Fetching a site's icon is
              // a separate piece of work and is not part of this.
              <span className="webui-workspace-tab-glyph webui-workspace-web-glyph" aria-hidden="true">●</span>
            ) : (
              fileTabGlyph(item)
            )}
            <span className="webui-workspace-tab-label">{webuiWorkspaceTabLabel(item)}</span>
          </button>
          <button
            type="button"
            aria-label={`${webuiWorkspaceTabLabel(item)} ${DESKTOP_COPY.fileClose}`}
            data-testid={`workspace-tab-${item.id}-close`}
            onClick={() => dispatch({ type: "close-tab", tabId: item.id })}
          >
            <WebuiIconClose className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="webui-workspace-new-tab-trigger"
        aria-label={DESKTOP_COPY.addTab}
        data-testid="workspace-add-tab"
        onClick={() => dispatch({ type: "open-new-tab" })}
      >
        +
      </button>
    </div>
  );
}
