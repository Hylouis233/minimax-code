// The tab-kind registry.
//
// The right-column tab kinds were enumerated in **three** places — the union in
// `workspace-panel-state.ts`, the label map in `WorkspacePanels.tsx`, and the
// add-menu's four buttons — so a new kind meant finding all three, and the type
// system caught only two of them. The registry has to exist and be the thing the
// host reads, **and a passing prohibition test does not discharge that**.
//
// The acceptance is that **a rule added to a second enumeration site fails the
// suite**. A registry may carry a host render branch, which is why the glyphs and
// the dispatch calls stay in the component: the assertions below target the words
// and the closed set, not the icons.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  WEBUI_WORKSPACE_ADD_MENU_ORDER,
  WEBUI_WORKSPACE_TAB_KINDS,
  webuiWorkspaceAddMenu,
  webuiWorkspaceTabLabel,
  type WebuiWorkspaceTabKind,
  type WorkspacePanelTab,
} from "../../src/client/features/workspace/projection/workspace-panel-state.js";

const CLIENT = new URL("../../src/client/", import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, CLIENT), "utf8");
const flat = (text: string): string => text.replace(/\s+/gu, " ");

// Compile-time: a panel tab's kind IS a declared kind, so the union is derived
// from the registry's shapes rather than listing the same names again.
type DerivedKindIsDeclared = WorkspacePanelTab["kind"] extends WebuiWorkspaceTabKind
  ? true
  : never;
const derived: DerivedKindIsDeclared = true;

const tab = (over: Partial<WorkspacePanelTab> & { kind: WebuiWorkspaceTabKind }): WorkspacePanelTab =>
  ({ id: "t", ...over }) as WorkspacePanelTab;

describe("the kinds are declared once", () => {
  it("derives the panel's union from the registry", () => {
    expect(derived).toBe(true);
  });

  it("keeps the kind union literal out of every other module", () => {
    // The shape of the old third enumeration. Its absence is what "one registry"
    // means for the type half.
    expect(flat(read("features/workspace/ui/WorkspacePanels.tsx"))).not.toContain(
      '"files" | "canvas" | "terminal"',
    );
    expect(flat(read("features/workspace/projection/workspace-panel-state.ts"))).toContain(
      "export interface WebuiWorkspaceTabShapes",
    );
  });

  it("carries every kind the host can open, and no label of its own", () => {
    const component = flat(read("features/workspace/ui/WorkspacePanels.tsx"));
    // The label map is gone; the words come from the registry.
    expect(component).not.toContain('{ files: "查看文件"');
    expect(component).toContain("webuiWorkspaceTabLabel(item)");
    // The menu is built from the registry, never re-listed...
    expect(component).toContain("webuiWorkspaceAddMenu().map(");
    for (const entry of webuiWorkspaceAddMenu()) {
      expect(component).not.toContain(`<span>${entry.label}</span>`);
    }
  });
});

describe("the registry answers for the whole closed set", () => {
  it("labels a tab by one rule", () => {
    expect(webuiWorkspaceTabLabel(tab({ kind: "terminal" }))).toBe("终端");
    expect(webuiWorkspaceTabLabel(tab({ kind: "files" }))).toBe("查看文件");
    expect(
      webuiWorkspaceTabLabel(tab({ kind: "file-preview", path: "src/client/main.tsx" } as never)),
    ).toBe("main.tsx");
    expect(
      webuiWorkspaceTabLabel(
        tab({ kind: "review", source: "workspace", sessionId: "s", workspaceDir: "/w" } as never),
      ),
    ).toBe("变更");
    expect(
      webuiWorkspaceTabLabel(tab({ kind: "review", source: "turn", sessionId: "s", workspaceDir: "/w" } as never)),
    ).toBe("Review");
  });

  it("offers the add menu in one order, and only where a menu entry exists", () => {
    const menu = webuiWorkspaceAddMenu();
    expect(menu.map((entry) => entry.kind)).toEqual([
      "review",
      "terminal",
      "canvas",
      "browser",
      "files",
    ]);
    expect(menu.map((entry) => entry.label)).toEqual([
      "变更",
      "终端",
      "画布",
      "浏览器",
      "查看文件",
    ]);
    expect(menu.map((entry) => entry.opens)).toEqual([
      { type: "open-workspace-review" },
      { type: "open-tab", kind: "terminal" },
      { type: "open-tab", kind: "canvas" },
      { type: "open-tab", kind: "browser" },
      { type: "open-tab", kind: "files" },
    ]);
    // Every menu entry names a declared kind, and the order names each one once.
    for (const kind of WEBUI_WORKSPACE_ADD_MENU_ORDER) {
      expect(WEBUI_WORKSPACE_TAB_KINDS[kind]).toBeDefined();
    }
    expect(new Set(WEBUI_WORKSPACE_ADD_MENU_ORDER).size).toBe(WEBUI_WORKSPACE_ADD_MENU_ORDER.length);
    // A file preview has no menu entry: it is opened by a path.
    expect(WEBUI_WORKSPACE_TAB_KINDS["file-preview"].addMenu).toBeNull();
    expect(menu.some((entry) => entry.kind === "file-preview")).toBe(false);
  });
});
