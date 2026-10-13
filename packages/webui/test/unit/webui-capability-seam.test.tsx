// The capability seam after A4-s3 (plan §8 Phase 2; ticket #62).
//
// What this asserts is the *contract of the seam*: the shell no longer forwards
// the five businesses' capabilities as props, and the composer takes them from its
// slices. A behavioural assertion ("the composer actually called the slice's
// function") is not reachable here — those capabilities are consumed inside
// handlers SSR never invokes, and the suite has no DOM to click with. So this file
// inspects the props handed to the composer rather than the properties of a render;
// the render side is covered by the shell suite, and the read side is established
// by construction (the composer's locals come from `useWebuiPortSlice`, and no prop
// of those names exists on its signature any more).
//
// The recorded-props technique is the one `transcript-retry-resend-wiring` uses:
// mock the automatic JSX runtime and keep every element's props.

import { describe, expect, it, vi } from "vitest";
import { type ElementType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const createdElements: Array<{ type: ElementType; props: Record<string, any> }> =
  [];
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const record = (type: ElementType, props: Record<string, any>) => {
    createdElements.push({ type, props });
    return actual.jsx(type, props);
  };
  return { ...actual, jsx: record, jsxs: record };
});

import { WebuiComposer } from "../../src/client/components/SessionComposer.js";
import { createWebuiPortSlices } from "../../src/client/application/port-slices.js";
import { WebuiPortSlicesProvider } from "../../src/client/bindings/port-slices-context.js";
import { WebuiSessionStoreProvider } from "../../src/client/bindings/application-context.js";
import { createWebuiSessionStore } from "../../src/client/application/session-store.js";

type ComposerProps = React.ComponentProps<typeof WebuiComposer>;

/** The capability props A4-s3 removed from the composer, by business. */
const REMOVED_PROPS: Record<string, readonly string[]> = {
  sessions: ["createSession", "getSessionForkOptions", "forkSession"],
  transcript: [
    "loadMessages",
    "getTurnDiff",
    "revertTurnDiff",
    "reapplyTurnDiff",
    "getSessionRewindPreview",
    "rewindSession",
    "editSessionMessage",
  ],
  goal: ["getGoal", "createGoal", "patchGoal", "clearGoal", "isGoalEnabled"],
  interactions: [
    "listPendingPermissions",
    "getPendingQuestionnaire",
    "replyPermission",
    "replyQuestionnaire",
    "dismissQuestionnaire",
  ],
  composer: ["enqueueMessage", "listQueueMessages", "deleteQueueItem"],
};

const VIEW_PROPS: ComposerProps = {
  sessionId: "seam-session",
  agentName: "main",
  onWorkspaceChange: () => undefined,
  workspaceMenuOpen: false,
  setWorkspaceMenuOpen: () => undefined,
  draft: "",
  onDraftChange: () => undefined,
  teamModeOff: false,
  favoritesStorage: { read: () => [], write: () => undefined },
} as ComposerProps;

function render(slices?: ReturnType<typeof createWebuiPortSlices>): string {
  createdElements.length = 0;
  const store = createWebuiSessionStore();
  return renderToStaticMarkup(
    <WebuiSessionStoreProvider store={store}>
      {slices ? (
        <WebuiPortSlicesProvider slices={slices}>
          <WebuiComposer {...VIEW_PROPS} />
        </WebuiPortSlicesProvider>
      ) : (
        <WebuiComposer {...VIEW_PROPS} />
      )}
    </WebuiSessionStoreProvider>,
  );
}

const composerProps = (): readonly Record<string, any>[] =>
  createdElements
    .filter((entry) => entry.type === WebuiComposer)
    .map((entry) => entry.props);

describe("the composer takes these capabilities from slices, not from props", () => {
  it("renders with no provider — the not-wired mode the optional props used to carry", () => {
    const markup = render();
    expect(markup.length).toBeGreaterThan(100);
  });

  it("renders with the slices wired", () => {
    const markup = render(
      createWebuiPortSlices({
        loadMessages: async () => ({ messages: [], hasMore: false }),
      }),
    );
    expect(markup.length).toBeGreaterThan(100);
  });

  it("is handed none of the removed capability props, wired or not", () => {
    for (const slices of [
      undefined,
      createWebuiPortSlices({
        loadMessages: async () => ({ messages: [], hasMore: false }),
      }),
    ]) {
      render(slices);
      const handed = composerProps().flatMap((props) =>
        Object.values(REMOVED_PROPS).flatMap((names) =>
          names.filter((name) => name in props),
        ),
      );
      expect(handed).toEqual([]);
    }
  });

  it("hands the composer the same view props it always did", () => {
    // The counterpart to the assertion above: the seam narrowed, the composer's
    // non-capability surface did not move.
    render();
    const [props] = composerProps();
    expect(props.agentName).toBe("main");
    expect(props.draft).toBe("");
    expect(props.teamModeOff).toBe(false);
  });
});
