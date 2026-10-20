// The browser panel's state transitions.
//
// These are the decisions the panel cannot make in a browser without a DOM:
// which frame survives, what happens when a tab navigates under it, and how much
// a live stream is allowed to accumulate. The view renders whatever this file
// returns, so every property asserted here is a property the panel has.

import { describe, expect, it } from "vitest";

import type {
  WebuiBrowserImageFrame,
  WebuiBrowserTargetId,
  WebuiBrowserTargetList,
} from "../../src/shared/contracts/browser.js";
import {
  initialWebuiBrowserPanelState,
  reduceWebuiBrowserPanelState,
  selectWebuiBrowserFrame,
  webuiBrowserFrameDataUrl,
} from "../../src/client/features/browser/projection/browser-state.js";
import {
  webuiBrowserFrameKey,
  type WebuiBrowserPanelState,
} from "../../src/client/features/browser/contracts/browser-panel.js";

function target(overrides: Partial<WebuiBrowserTargetId> = {}): WebuiBrowserTargetId {
  return {
    surface: "isolated-chromium",
    browserId: "chromium-1",
    targetId: "tab-1",
    generation: 3,
    ...overrides,
  };
}

function frame(overrides: Partial<WebuiBrowserImageFrame> = {}): WebuiBrowserImageFrame {
  return {
    target: target(),
    data: "AAAA",
    format: "png",
    sequence: 1,
    ...overrides,
  };
}

/** A panel showing `selected`, with one frame already delivered for it. */
function showingSelectedTarget(selected: WebuiBrowserTargetId = target()): WebuiBrowserPanelState {
  const withSelection = reduceWebuiBrowserPanelState(initialWebuiBrowserPanelState, {
    type: "target-selected",
    target: selected,
  });
  return reduceWebuiBrowserPanelState(withSelection, { type: "frame", frame: frame({ target: selected }) });
}

describe("the frame buffer", () => {
  it("keeps only the newest frame per target", () => {
    // A live stream pushes a frame per visual change, so an append-only buffer
    // would grow for as long as the panel is open. The bound is structural here:
    // one entry per target key, whatever arrives afterwards.
    let state = showingSelectedTarget();
    for (let sequence = 2; sequence <= 40; sequence += 1) {
      state = reduceWebuiBrowserPanelState(state, {
        type: "frame",
        frame: frame({ sequence, data: `QUJD${sequence}` }),
      });
    }

    expect(Object.keys(state.frames)).toHaveLength(1);
    expect(selectWebuiBrowserFrame(state)?.sequence).toBe(40);
    // Base64 alphabet only: the frame's bytes go into a `data:` URL verbatim, so
    // this is also the shape the panel is willing to render.
    expect(webuiBrowserFrameDataUrl(selectWebuiBrowserFrame(state))).toBe(
      "data:image/png;base64,QUJD40",
    );
  });

  it("holds one frame per target rather than one per target page", () => {
    // The key excludes the generation on purpose, so a tab that navigated
    // replaces its entry instead of adding a second one.
    const before = target({ generation: 3 });
    const after = target({ generation: 4 });
    let state = reduceWebuiBrowserPanelState(showingSelectedTarget(before), {
      type: "frame",
      frame: frame({ target: before, sequence: 5 }),
    });
    state = reduceWebuiBrowserPanelState(state, {
      type: "frame",
      frame: frame({ target: after, sequence: 1 }),
    });

    expect(webuiBrowserFrameKey(before)).toBe(webuiBrowserFrameKey(after));
    expect(Object.keys(state.frames)).toHaveLength(1);
    expect(selectWebuiBrowserFrame(state)?.target.generation).toBe(4);
  });
});

describe("generation awareness", () => {
  it("drops a frame older than the generation being shown", () => {
    // The panel moved to generation 4; a frame for generation 3 is a picture of
    // the page that has already been replaced. Displaying it is the exact
    // failure ADR 0019 names: the panel shows one page while the Agent drives
    // another.
    const shown = target({ generation: 4 });
    const state = reduceWebuiBrowserPanelState(showingSelectedTarget(shown), {
      type: "frame",
      frame: frame({ target: target({ generation: 3 }), sequence: 9 }),
    });

    expect(selectWebuiBrowserFrame(state)?.target.generation).toBe(4);
    expect(state.droppedFrameCount).toBe(1);
  });

  it("drops a reordered frame rather than going backwards in the stream", () => {
    const held = reduceWebuiBrowserPanelState(showingSelectedTarget(), {
      type: "frame",
      frame: frame({ sequence: 12 }),
    });
    const state = reduceWebuiBrowserPanelState(held, {
      type: "frame",
      frame: frame({ sequence: 11, data: "STALE" }),
    });

    expect(selectWebuiBrowserFrame(state)?.data).toBe("AAAA");
    expect(state.droppedFrameCount).toBe(1);
  });

  it("reports a newer generation from the target list as a changed target", () => {
    // The Agent's run navigated the tab. The panel must say so: the page the
    // person was clicking is not the page that is there now, so their previous
    // input is no longer valid and the buffered picture of it must go.
    const before = target({ generation: 3 });
    const after = target({ generation: 4 });
    const list: WebuiBrowserTargetList = {
      surface: "isolated-chromium",
      targets: [{ id: after, title: "Example", url: "https://example.test/", status: "open", selected: false }],
    };

    const state = reduceWebuiBrowserPanelState(showingSelectedTarget(before), {
      type: "targets-loaded",
      list,
    });

    expect(state.targetChange).toEqual({ target: after, previousGeneration: 3 });
    expect(state.selectedTarget).toEqual(after);
    // The buffered frame belonged to generation 3.
    expect(selectWebuiBrowserFrame(state)).toBeUndefined();
  });

  it("clears the selection rather than promoting another tab when the chosen one is gone", () => {
    // ADR 0019: never silently switch to another tab. An empty panel says what
    // happened; a different page would not.
    const other = target({ targetId: "tab-2" });
    const state = reduceWebuiBrowserPanelState(showingSelectedTarget(), {
      type: "targets-loaded",
      list: {
        surface: "isolated-chromium",
        targets: [{ id: other, title: "Other", url: "https://other.test/", status: "open", selected: false }],
      },
    });

    expect(state.selectedTarget).toBeUndefined();
    expect(selectWebuiBrowserFrame(state)).toBeUndefined();
    expect(state.targets[0]?.selected).toBe(false);
    expect(state.status).toBe("empty");
  });

  it("follows the active run's target and drops the frame it was showing", () => {
    const previous = target();
    const next = target({ targetId: "tab-2" });
    const state = reduceWebuiBrowserPanelState(showingSelectedTarget(previous), {
      type: "target-changed",
      target: next,
    });

    expect(state.selectedTarget).toEqual(next);
    expect(state.targetChange).toEqual({ target: next, previousGeneration: 3 });
    expect(selectWebuiBrowserFrame(state)).toBeUndefined();
  });
});

describe("the panel's status", () => {
  it("is ready only while the selected target holds a frame of that generation", () => {
    const selected = target({ generation: 2 });
    const empty = reduceWebuiBrowserPanelState(initialWebuiBrowserPanelState, {
      type: "target-selected",
      target: selected,
    });
    expect(empty.status).toBe("loading");

    const ready = showingSelectedTarget(selected);
    expect(ready.status).toBe("ready");
  });

  it("reports an empty surface rather than an empty frame", () => {
    const state = reduceWebuiBrowserPanelState(initialWebuiBrowserPanelState, {
      type: "targets-loaded",
      list: { surface: "edge", targets: [] },
    });

    expect(state.status).toBe("empty");
    expect(state.targets).toEqual([]);
  });

  it("carries the stable error code the panel branches on", () => {
    const state = reduceWebuiBrowserPanelState(initialWebuiBrowserPanelState, {
      type: "failed",
      error: { code: "browser_pairing_rejected", message: "配对被拒绝。", retryable: false },
    });

    expect(state.status).toBe("error");
    expect(state.error?.code).toBe("browser_pairing_rejected");
  });
});

describe("webuiBrowserFrameDataUrl", () => {
  it("builds a data URL for a frame it can render", () => {
    expect(webuiBrowserFrameDataUrl(frame({ data: "QUJD", format: "jpeg" }))).toBe(
      "data:image/jpeg;base64,QUJD",
    );
  });

  it("refuses a payload outside the base64 alphabet instead of handing it to src", () => {
    // A `data:` URL is built from the payload verbatim, so anything that is not
    // image bytes must not reach `src` at all.
    expect(webuiBrowserFrameDataUrl(frame({ data: "<svg onload=alert(1)>" }))).toBeUndefined();
    expect(webuiBrowserFrameDataUrl(frame({ data: "" }))).toBeUndefined();
  });

  it("refuses a format outside the two the contract allows", () => {
    const forged = { ...frame(), format: "svg+xml" } as unknown as WebuiBrowserImageFrame;
    expect(webuiBrowserFrameDataUrl(forged)).toBeUndefined();
  });
});
