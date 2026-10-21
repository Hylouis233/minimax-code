// The workspace panel's tab strip.
//
// What is pinned here is the contract that has to survive the strip's
// authors changing their minds later: tool tabs and web tabs render in
// one row, the per-tab close button stays on the strip, the new tab
// affordance opens the launcher tab rather than another tool tab, and the
// web tabs the strip shows come from the runtime's snapshot — never a
// parallel copy the client keeps.
//
// Rendered with `renderToStaticMarkup`, which runs no effects — so the
// subscription to `watchBrowserWebTabs` is exercised by the exported
// `webuiWorkspaceTabStripReconcile` helper, the same code the effect
// drives when a DOM is present.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  WebuiBrowserTargetId,
  WebuiBrowserWebTab,
  WebuiBrowserWebTabSnapshot,
} from "../../src/shared/contracts/browser.js";
import {
  WebuiWorkspaceTabStrip,
  webuiWorkspaceTabStripReconcile,
} from "../../src/client/features/workspace/ui/WebuiWorkspaceTabStrip.public.js";
import { WebuiPortSlicesProvider } from "../../src/client/bindings/port-slices-context.js";
import { createWebuiPortSlices } from "../../src/client/application/port-slices.js";
import {
  initialWorkspacePanelState,
  reduceWorkspacePanelState,
  type WorkspacePanelState,
} from "../../src/client/features/workspace/projection/workspace-panel-state.js";

function target(overrides: Partial<WebuiBrowserTargetId> = {}): WebuiBrowserTargetId {
  return {
    surface: "isolated-chromium",
    browserId: "browser-1",
    targetId: "tab-9",
    generation: 1,
    ...overrides,
  };
}

function webTab(overrides: Partial<WebuiBrowserWebTab> = {}): WebuiBrowserWebTab {
  return {
    id: `${overrides.target?.browserId ?? "browser-1"}/${overrides.target?.targetId ?? "tab-9"}`,
    target: target(),
    title: "Example",
    url: "https://example.test/",
    selected: false,
    ...overrides,
  };
}

function stateWithTabs(tabs: WorkspacePanelState["tabs"], activeTabId?: string): WorkspacePanelState {
  const merged = reduceWorkspacePanelState(initialWorkspacePanelState, {
    type: "open-tab",
    kind: "files",
    sessionId: "session-1",
    workspaceDir: "/work",
  });
  return { ...merged, tabs, activeTabId };
}

describe("the workspace panel's tab strip", () => {
  it("renders tool tabs and web tabs in one row", () => {
    const state = stateWithTabs([
      { id: "tab-1", content: { kind: "files", sessionId: "session-1", workspaceDir: "/work" } },
      {
        id: "tab-2",
        content: {
          kind: "web",
          target: target({ browserId: "browser-2", targetId: "tab-1" }),
          title: "Example",
          url: "https://example.test/",
        },
      },
    ], "tab-2");

    const markup = renderToStaticMarkup(
      <WebuiPortSlicesProvider slices={createWebuiPortSlices({})}>
        <WebuiWorkspaceTabStrip state={state} dispatch={() => undefined} />
      </WebuiPortSlicesProvider>,
    );

    expect(markup).toContain('data-tab-kind="files"');
    expect(markup).toContain('data-tab-kind="web"');
    expect(markup).toContain("Example");
  });

  it("labels a web tab by the page's title and shows a default glyph", () => {
    const state = stateWithTabs([
      {
        id: "tab-1",
        content: {
          kind: "web",
          target: target({ browserId: "browser-2", targetId: "tab-1" }),
          title: "Readme",
          url: "https://example.test/readme",
        },
      },
    ], "tab-1");

    const markup = renderToStaticMarkup(
      <WebuiPortSlicesProvider slices={createWebuiPortSlices({})}>
        <WebuiWorkspaceTabStrip state={state} dispatch={() => undefined} />
      </WebuiPortSlicesProvider>,
    );

    // The page's title is the runtime's; the strip never fetches a favicon.
    expect(markup).toContain("Readme");
    // A web tab carries the default glyph — a dot — not an icon, and certainly
    // no `<img>` of any kind.
    expect(markup).toContain("webui-workspace-web-glyph");
    expect(markup).not.toContain("<img");
  });

  it("owns the close button and the new tab affordance", () => {
    const state = stateWithTabs([
      { id: "tab-1", content: { kind: "files", sessionId: "session-1", workspaceDir: "/work" } },
    ], "tab-1");

    const markup = renderToStaticMarkup(
      <WebuiPortSlicesProvider slices={createWebuiPortSlices({})}>
        <WebuiWorkspaceTabStrip state={state} dispatch={() => undefined} />
      </WebuiPortSlicesProvider>,
    );

    expect(markup).toContain('data-testid="workspace-tab-tab-1-close"');
    expect(markup).toContain('data-testid="workspace-add-tab"');
  });

  it("opens the launcher tab when the new tab affordance is pressed", () => {
    const starting = stateWithTabs([], undefined);
    const after = reduceWorkspacePanelState(starting, { type: "open-new-tab" });
    expect(after.tabs).toHaveLength(1);
    expect(after.tabs[0]?.content.kind).toBe("launcher");
    expect(after.activeTabId).toBe(after.tabs[0]?.id);
  });

  it("keeps one launcher tab no matter how many times the affordance fires", () => {
    const starting = stateWithTabs([], undefined);
    const first = reduceWorkspacePanelState(starting, { type: "open-new-tab" });
    const second = reduceWorkspacePanelState(first, { type: "open-new-tab" });
    const launchers = second.tabs.filter((tab) => tab.content.kind === "launcher");
    expect(launchers).toHaveLength(1);
  });

  it("turns each published web tab into a panel tab through the existing open-web-tab command", () => {
    // The strip subscribes to `watchBrowserWebTabs`; when a snapshot lands it
    // dispatches an `open-web-tab` for every published target the reducer does
    // not already know about. The reducer's own rule (issue #206) keeps
    // duplicates out — the strip does not keep its own list.
    const commands = webuiWorkspaceTabStripReconcile([], {
      surface: "isolated-chromium",
      tabs: [
        webTab({ target: target({ browserId: "browser-2", targetId: "tab-1" }), title: "First" }),
        webTab({ target: target({ browserId: "browser-2", targetId: "tab-2" }), title: "Second" }),
      ],
    });

    expect(commands.map((entry) => entry.command)).toEqual([
      {
        type: "open-web-tab",
        target: target({ browserId: "browser-2", targetId: "tab-1" }),
        title: "First",
        url: "https://example.test/",
      },
      {
        type: "open-web-tab",
        target: target({ browserId: "browser-2", targetId: "tab-2" }),
        title: "Second",
        url: "https://example.test/",
      },
    ]);
  });

  it("dispatches when the page behind a web tab moved", () => {
    // A web tab shows the page's title, and the title moves when the page
    // navigates. The snapshot is how the panel hears about it.
    const existing: WorkspacePanelState["tabs"] = [
      {
        id: "tab-1",
        content: {
          kind: "web",
          target: target({ browserId: "browser-2", targetId: "tab-1" }),
          title: "First",
          url: "https://example.test/",
        },
      },
    ];

    const commands = webuiWorkspaceTabStripReconcile(existing, {
      surface: "isolated-chromium",
      tabs: [
        webTab({ target: target({ browserId: "browser-2", targetId: "tab-1" }), title: "Second" }),
      ],
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toMatchObject({ type: "open-web-tab", title: "Second" });
  });

  it("does not dispatch when the snapshot's tabs are already panel tabs", () => {
    // A snapshot that lands twice changes nothing: the strip's "for each
    // unknown target, dispatch" rule keeps the existing web tabs where they
    // are, so a re-publish is a no-op.
    const existing: WorkspacePanelState["tabs"] = [
      {
        id: "tab-1",
        content: {
          kind: "web",
          target: target({ browserId: "browser-2", targetId: "tab-1" }),
          title: "First",
          url: "https://example.test/",
        },
      },
    ];

    const commands = webuiWorkspaceTabStripReconcile(existing, {
      surface: "isolated-chromium",
      tabs: [webTab({ target: target({ browserId: "browser-2", targetId: "tab-1" }), title: "First" })],
    });

    expect(commands).toHaveLength(0);
  });
});
