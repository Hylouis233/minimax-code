// RailViewTabs — extracted from `SessionRail.tsx` (T07's responsibility cut of the rail).
// The declaration body is verbatim; the `export` keyword, this header and the
// import specifiers are the only differences.

import { type WebuiRailView, type WebuiRailViewTab } from "../projection/rail-buckets.js";

/**
 * The rail's view strip (plan §16.10's three in-file regions: the rail-view strip).
 *
 * Markup and one callback: the active view stays `WebuiProjectList`'s, because the
 * shell may pass it in and an in-file cut must not change a lifetime. Both of that
 * component's render branches show this strip, which is the other reason it is one
 * declaration rather than two copies.
 */
export function RailViewTabs({
  tabs,
  activeView,
  onSelect,
}: {
  readonly tabs: readonly WebuiRailViewTab[];
  readonly activeView: WebuiRailView;
  readonly onSelect: (view: WebuiRailView) => void;
}) {
  return (
    <div className="webui-rail-view-tabs" role="tablist" data-webui-rail-view-tabs="true">
      {tabs.map((entry) => (
        <button
          key={entry.view}
          type="button"
          data-webui-rail-view={entry.view}
          role="tab"
          aria-selected={activeView === entry.view}
          className="webui-rail-view-tab"
          onClick={() => onSelect(entry.view)}
        >
          {entry.label}
          {entry.view === "projects" ? null : (
            <span className="webui-rail-view-count" data-webui-rail-view-count={entry.view}>
              {entry.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
