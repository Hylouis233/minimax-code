// The context-usage indicator's behaviours and its write-free reading (ticket #77's acceptance
// criteria).
//
// The panel needs a DOM to open and hover, so the state, the listeners and the placement are asserted as
// the expressions that implement them. Two claims are load-bearing and both are negative ones: the
// indicator **writes nothing** — it reads usage, quota and the selected model and hands nothing back —
// and it is **not filed under `client/projection/`**, because §6.1 resolves a module's edges by its
// basename, so filing a stateful component there would silently reclassify them.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RELATIVE = "src/client/features/sessions/ui/ContextUsageIndicator.tsx";
const source = readFileSync(fileURLToPath(new URL("../../" + RELATIVE, import.meta.url)), "utf8");

describe("the indicator keeps its four pieces of state", () => {
  it("holds the opted-in flag, hover, open and the breakdown disclosure", () => {
    expect(source).toContain('const [enabled, setEnabled] = useState(() => storage.getItem("webui-context-window-usage") !== "false");');
    expect(source).toContain("const [open, setOpen] = useState(false);");
    expect(source).toContain("const [hovered, setHovered] = useState(false);");
    expect(source).toContain("const [breakdownOpen, setBreakdownOpen] = useState(false);");
  });

  it("publishes hover and the breakdown as render observables", () => {
    expect(source).toContain('data-webui-context-usage-label={hovered && !open ? "true" : "false"}');
    expect(source).toContain('data-webui-context-breakdown={breakdownOpen ? "open" : "closed"}');
  });
});

describe("the popover's placement keeps its listeners and its cleanup", () => {
  it("places from the ring through the shared arithmetic", () => {
    expect(source).toContain("positionContextUsagePopover({");
  });

  it("subscribes to scroll and resize in a layout effect and removes both", () => {
    expect(source).toContain('window.addEventListener("scroll", measurePanel, true);');
    expect(source).toContain('window.addEventListener("resize", measurePanel);');
    expect(source).toContain('window.removeEventListener("scroll", measurePanel, true);');
    expect(source).toContain('window.removeEventListener("resize", measurePanel);');
  });
});

describe("the indicator reads and writes nothing it does not own", () => {
  it("takes its inputs as props", () => {
    expect(source).toContain("function ContextUsageIndicator({ usage, usageQuota, planModel }");
  });

  it("calls no write command", () => {
    for (const write of ["setUserProfile", "setAgentMemory", "updateProvider", "purgeSlot", "applyGoal", "createSession("]) {
      expect(source, `${write} is a write`).not.toContain(write);
    }
  });

  it("is a component, not a projection", () => {
    // §6.1: a module's edges resolve by basename, so the home is part of the contract.
    expect(RELATIVE).toContain("src/client/features/sessions/ui/");
    expect(RELATIVE).not.toContain("src/client/projection/");
  });
});
