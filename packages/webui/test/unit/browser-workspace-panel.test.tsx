// The browser tab in the workspace panel's registry.
//
// The Browser panel is implemented and gated, and the panel that should mount it
// (`features/workspace/ui/WorkspacePanels.tsx`) cannot: a browser tab's `addMenu`
// entry carries a `WorkspacePanelCommand`, and the published command's `open-tab`
// names only `files | canvas | terminal`
// (`features/workspace/contracts/panel-command.ts:43`). Nothing can open the tab
// until that union names `browser`, so what is pinned here is the half of the work
// that is real — the kind is declared, labelled and placed in the menu order — plus
// the two properties that must survive that change rather than be rewritten by it.
//
// The second group is the reason the panel is not mounted yet, stated as a test
// because it is the rule that would otherwise be rediscovered by running the
// dependency gate: the workspace panel is presentation, so it may read the browser
// business's contracts and its `.public` components, and nothing else. The browser
// state machine lives in that business's private projection, so the panel cannot
// drive it from here — the owner has to be published by the business that owns it.

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

describe("the browser tab kind", () => {
  it("is a declared kind with its own word", () => {
    expect(WEBUI_WORKSPACE_TAB_KINDS.browser.label).toBe("浏览器");
    // Built the way `open-tab` builds one: no path, no workspace directory, and
    // the optional instance fields the add menu sends with every such command.
    const tab: WorkspacePanelTab = { id: "browser:::", kind: "browser" };
    expect(webuiWorkspaceTabLabel(tab)).toBe("浏览器");
  });

  it("leads the file views in the add-menu order", () => {
    const order = WEBUI_WORKSPACE_ADD_MENU_ORDER;
    expect(order.indexOf("browser")).toBeGreaterThan(order.indexOf("terminal"));
    expect(order.indexOf("browser")).toBeLessThan(order.indexOf("files"));
    // Every kind is named once, and every name is a declared kind.
    expect(new Set(order).size).toBe(order.length);
    for (const kind of order) expect(WEBUI_WORKSPACE_TAB_KINDS[kind]).toBeDefined();
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
});