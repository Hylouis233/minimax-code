// Unit tests for the Phase-6 TurnNavigator transcription.
//
// Each test asserts against the desktop's exact `data-testid` values, the
// `data-turn-id` / `data-state` attributes the desktop emits, and the
// `data-mode` / `data-hidden` flags the parent uses to drive the strip
// visibility. The brief lists 17 testids; this file covers them all.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TurnNavigator } from "../../src/client/features/transcript/ui/TurnNavigator.js";

const baseTurns = [
  { id: "turn-1", state: "default" as const },
  { id: "turn-2", state: "active" as const },
  { id: "turn-3", state: "running" as const },
  { id: "turn-4", state: "error" as const },
];

describe("TurnNavigator", () => {
  it("emits the root, strip, and tick testids", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, { turns: baseTurns }),
    );
    expect(html).toContain('data-testid="message-turn-navigator"');
    expect(html).toContain('data-testid="message-turn-navigator-strip"');
    expect(html).toContain('data-testid="message-turn-navigator-tick"');
    expect(html).toContain('data-testid="message-turn-navigator-tick-hit-target"');
    expect(html).toContain('data-mode="default"');
    expect(html).toContain('data-hidden="false"');
  });

  it("reflects each turn's state on the corresponding tick", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, { turns: baseTurns }),
    );
    for (const turn of baseTurns) {
      const re = new RegExp(`data-turn-id="${turn.id}"[^>]*data-state="${turn.state}"`);
      expect(html).toMatch(re);
    }
  });

  it("renders the top/bottom mask when no preview disables them", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, { turns: baseTurns }),
    );
    expect(html).toContain('data-testid="message-turn-navigator-mask-top"');
    expect(html).toContain('data-testid="message-turn-navigator-mask-bottom"');
  });

  it("renders the preview card with every desktop testid", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, {
        turns: baseTurns,
        preview: {
          title: "总结标题",
          time: "12:34",
          previousQuery: "上一个问题",
          nextQuery: "下一个问题",
          response: "回复片段",
          artefacts: [
            { id: "a1", label: "alpha", icon: "X" },
            { id: "a2", label: "beta" },
          ],
          fileChangeCount: { additions: 12, deletions: 4 },
        },
      }),
    );
    expect(html).toContain('data-testid="message-turn-navigator-preview"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-title"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-time"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-previous-query"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-next-query"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-response"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-divider"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-artifacts"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-file-change-count"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-artifact-icon"');
    expect(html).toContain('data-testid="message-turn-navigator-preview-artifact-label"');
    expect(html).toContain("总结标题");
    expect(html).toContain("+12 / -4");
  });

  it("omits the preview block when preview is null", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, { turns: baseTurns, preview: null }),
    );
    expect(html).not.toContain('data-testid="message-turn-navigator-preview"');
  });

  it("reflects the hidden flag on the root element", () => {
    const html = renderToStaticMarkup(
      createElement(TurnNavigator, { turns: baseTurns, hidden: true }),
    );
    expect(html).toContain('data-hidden="true"');
  });
});
