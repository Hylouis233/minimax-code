// The web tab kind in the workspace panel's registry.
//
// The browser tool tab is gone: the panel's tabs are web tabs, and a web tab
// is opened by typing a URL in the new tab page or by the Agent — not by an
// entry in the add menu. What is pinned here is the kind, its label, the fact
// that it has no menu entry of its own, and the property that must survive
// that change rather than be rewritten by it: the menu is the registry's rows
// that have an entry, so the menu never becomes a second list.
//
// The second group is stated as a test because it is the rule that would
// otherwise be rediscovered by running the dependency gate: the workspace
// panel is presentation, so it may read the browser business's contracts and
// its `.public` components, and nothing else. The browser state machine lives
// in that business's private projection, so the panel cannot drive it from
// here — the owner has to be published by the business that owns it.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  WEBUI_WORKSPACE_ADD_MENU_ORDER,
  WEBUI_WORKSPACE_TAB_KINDS,
  webuiWorkspaceAddMenu,
  webuiWorkspaceTabLabel,
  type WorkspacePanelTab,
} from "../../src/client/features/workspace/projection/workspace-panel-state.js";

const PANEL_SOURCE = new URL(
  "../../src/client/features/workspace/ui/WorkspacePanels.tsx",
  import.meta.url,
);

describe("the web tab kind", () => {
  it("is a declared kind, and a web tab is titled by its page", () => {
    expect(WEBUI_WORKSPACE_TAB_KINDS.web).toBeDefined();
    const tab: WorkspacePanelTab = {
      id: "tab-1",
      content: {
        kind: "web",
        target: {
          surface: "isolated-chromium",
          browserId: "browser-1",
          targetId: "tab-9",
          generation: 1,
        },
        title: "Example",
        url: "https://example.test/",
      },
    };
    expect(webuiWorkspaceTabLabel(tab)).toBe("Example");
  });

  it("has no add-menu entry of its own", () => {
    // A web tab is opened by typing a URL or by the Agent, so the add menu
    // does not offer it — and the browser tool tab it replaced is gone.
    expect(WEBUI_WORKSPACE_TAB_KINDS.web.addMenu).toBeNull();
    expect(WEBUI_WORKSPACE_ADD_MENU_ORDER).not.toContain("web");
    expect(WEBUI_WORKSPACE_TAB_KINDS).not.toHaveProperty("browser");
    expect(webuiWorkspaceAddMenu().some((entry) => entry.kind === "web")).toBe(false);
  });

  it("reaches the menu through the registry rather than a second list", () => {
    // Whatever a row's `addMenu` says, the menu is the rows that have one, in the
    // order list — so widening the command's `open-tab` union adds the entry
    // without this file or the component naming it.
    const expected = WEBUI_WORKSPACE_ADD_MENU_ORDER.filter(
      (kind) => WEBUI_WORKSPACE_TAB_KINDS[kind].addMenu !== null,
    );
    expect(webuiWorkspaceAddMenu().map((entry) => entry.kind)).toEqual(expected);
    for (const entry of webuiWorkspaceAddMenu()) {
      expect(entry.label).toBe(WEBUI_WORKSPACE_TAB_KINDS[entry.kind].label);
    }
  });
});

describe("the workspace panel reaches the browser business only through its published surface", () => {
  it("reads no private module of the business whose panel it would mount", () => {
    const source = readFileSync(PANEL_SOURCE, "utf8");

    // Contracts and `.public` components are the crossing; a reducer, a command
    // builder and the assembled slices are not, and reaching for any of them is
    // what the dependency gate reports as a private-peer or assembly import.
    expect(source).not.toContain("browser/projection/");
    expect(source).not.toContain("browser/application/");
    expect(source).not.toContain("application/port-slices");
  });

  it("mounts no browser tool tab", () => {
    // The browser tool tab is gone with the browser kind: the panel's tabs are
    // web tabs now, and the strip renders them from the runtime's snapshot.
    const source = readFileSync(PANEL_SOURCE, "utf8");
    expect(source).not.toContain("BrowserPanelHost");
  });
});
