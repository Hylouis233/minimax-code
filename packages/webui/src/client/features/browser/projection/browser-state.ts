// The browser panel's state transitions.
//
// Pure: state in, state out. No effects, no timers, no port, no `fetch`. The
// panel's view and the owner that drives the port both reduce through here, so
// "what the panel shows" is one function that can be asserted without a DOM.
//
// Two decisions carry most of the weight.
//
// **The frame buffer is a record, keyed by tab.** A live stream pushes a frame
// per visual change; an append-only list would grow for as long as the session
// ran. Keeping one entry per key makes the bound structural rather than a
// trimming policy someone has to remember.
//
// **A frame that is older than what the panel is showing is dropped.** The frame
// carries its target's generation, and a page that navigated keeps its tab id but
// gets a new generation — so a frame from the previous page is a picture of
// something the user has already moved away from. Displaying it would show one
// page while the Agent drives another, which is the failure this whole business
// exists to prevent (ADR 0019). Dropping is counted rather than silent, because a
// panel that quietly stops updating and a panel that is dropping frames look
// identical from the outside.

import {
  WEBUI_BROWSER_AUTHORIZATION_DEFAULT,
  isSameWebuiBrowserTarget,
  isWebuiBrowserSurfaceAuthorized,
  type WebuiBrowserImageFrame,
  type WebuiBrowserSurface,
  type WebuiBrowserTargetId,
  type WebuiBrowserTargetList,
  type WebuiBrowserTargetState,
} from "../../../../shared/contracts/browser.js";
import {
  isSameWebuiBrowserTargetSlot,
  isUsableWebuiBrowserTargetId,
  webuiBrowserFrameKey,
  type WebuiBrowserPanelEvent,
  type WebuiBrowserPanelState,
  type WebuiBrowserPanelStatus,
} from "../contracts/browser-panel.js";

export const initialWebuiBrowserPanelState: WebuiBrowserPanelState = {
  authorization: WEBUI_BROWSER_AUTHORIZATION_DEFAULT,
  surface: "isolated-chromium",
  targets: [],
  frames: {},
  status: "idle",
  droppedFrameCount: 0,
};

function frameHeld(state: WebuiBrowserPanelState, key: string): boolean {
  return Object.hasOwn(state.frames, key);
}

/**
 * Drops one buffered frame, by identity rather than by value.
 *
 * A no-op when the key is absent, so the reducers can call it unconditionally
 * instead of branching on whether the move they are reacting to dropped anything.
 */
function withoutFrame(
  state: WebuiBrowserPanelState,
  target: WebuiBrowserTargetId,
): WebuiBrowserPanelState["frames"] {
  const key = webuiBrowserFrameKey(target);
  if (!Object.hasOwn(state.frames, key)) return state.frames;
  const frames: Record<string, WebuiBrowserImageFrame> = { ...state.frames };
  delete frames[key];
  return frames;
}

/**
 * The status the state implies.
 *
 * Derived rather than stored on each branch so "ready" means one thing: the
 * selected target currently has a frame that belongs to the generation being
 * shown. Anything else that claims `ready` is a panel displaying a stale page.
 */
function deriveStatus(state: WebuiBrowserPanelState): WebuiBrowserPanelStatus {
  if (state.error) return "error";
  const selected = state.selectedTarget;
  if (!selected) {
    if (state.status === "loading") return "loading";
    return state.targets.length === 0 ? state.status : "empty";
  }
  return frameHeld(state, webuiBrowserFrameKey(selected)) ? "ready" : "loading";
}

function markSelection(
  targets: readonly WebuiBrowserTargetState[],
  selected: WebuiBrowserTargetId | undefined,
): readonly WebuiBrowserTargetState[] {
  return targets.map((target) => ({
    ...target,
    selected: selected ? isSameWebuiBrowserTarget(target.id, selected) : false,
  }));
}

export function reduceWebuiBrowserPanelState(
  state: WebuiBrowserPanelState,
  event: WebuiBrowserPanelEvent,
): WebuiBrowserPanelState {
  switch (event.type) {
    case "authorization-loaded":
      return { ...state, authorization: event.authorization };

    case "capabilities-loaded":
      return { ...state, capabilities: event.entries };

    case "surface-changed":
      return state.surface === event.surface
        ? state
        : { ...state, surface: event.surface, targets: [], selectedTarget: undefined, frames: {}, status: "idle" };

    case "targets-requested":
      return { ...state, status: "loading", error: undefined };

    case "targets-loaded": {
      const surfaceChanged = event.list.surface !== state.surface;
      // A new list for the same surface keeps the selection across refreshes; a
      // list for a different surface starts over, because a target id from one
      // surface means nothing in another.
      let selected = surfaceChanged ? event.selected : (event.selected ?? state.selectedTarget);
      let frames = surfaceChanged ? {} : state.frames;
      let targetChange = surfaceChanged ? undefined : state.targetChange;

      const listed = selected
        ? event.list.targets.find(
            (candidate) => webuiBrowserFrameKey(candidate.id) === webuiBrowserFrameKey(selected as WebuiBrowserTargetId),
          )
        : undefined;

      if (selected && listed && listed.id.generation > selected.generation) {
        // The tab is the same one, on a newer page. The buffered picture is of
        // the page that is gone, so it goes with it, and the panel says so
        // instead of pretending the old page is still there.
        targetChange = { target: listed.id, previousGeneration: selected.generation };
        frames = withoutFrame({ ...state, frames }, listed.id);
        selected = listed.id;
      } else if (selected && !listed && !surfaceChanged) {
        // The selected tab is no longer in the list. The selection is cleared
        // rather than moved: silently promoting another tab is exactly the
        // fallback the ADR forbids, and an empty panel says what happened where
        // a different page would not.
        frames = withoutFrame({ ...state, frames }, selected);
        selected = undefined;
        targetChange = undefined;
      }

      const next: WebuiBrowserPanelState = {
        ...state,
        surface: event.list.surface,
        targets: markSelection(event.list.targets, selected),
        selectedTarget: selected,
        frames,
        status: event.list.targets.length === 0 ? "empty" : state.status,
        error: undefined,
        ...(targetChange ? { targetChange } : {}),
      };
      return { ...next, status: deriveStatus(next) };
    }

    case "target-selected": {
      if (!isUsableWebuiBrowserTargetId(event.target)) return state;
      const next: WebuiBrowserPanelState = {
        ...state,
        selectedTarget: event.target,
        targetChange: undefined,
        error: undefined,
        targets: markSelection(state.targets, event.target),
      };
      // Derived rather than set, so selecting a tab the panel has no frame for
      // reads as "waiting for the first frame" rather than as "ready".
      return { ...next, status: deriveStatus(next) };
    }

    case "target-changed": {
      // The active Agent run moved its own target (ADR decision 4). The panel
      // follows it; it does not negotiate.
      const target = event.target;
      if (!isUsableWebuiBrowserTargetId(target)) return state;
      const previous = state.selectedTarget;
      const next: WebuiBrowserPanelState = {
        ...state,
        surface: target.surface,
        selectedTarget: target,
        error: undefined,
        ...(previous
          ? {
              targetChange: { target, previousGeneration: previous.generation },
              frames: isSameWebuiBrowserTargetSlot(previous, target)
                ? previous.generation === target.generation
                  ? state.frames
                  : withoutFrame(state, target)
                : withoutFrame(state, previous),
            }
          : {}),
      };
      return { ...next, status: deriveStatus(next) };
    }

    case "run-changed": {
      // A run's selection is that run's. When the active run changes, the panel
      // stops claiming to show the previous run's target: the frames stay
      // buffered per tab (so a new run that picks the same tab shows it at
      // once), but the selection, the marked tabs and the "what moved on" note
      // are cleared and wait for the new run's own answer.
      if (state.selectedTarget === undefined && state.targetChange === undefined) return state;
      const next: WebuiBrowserPanelState = {
        ...state,
        selectedTarget: undefined,
        targetChange: undefined,
        targets: markSelection(state.targets, undefined),
      };
      return { ...next, status: deriveStatus(next) };
    }

    case "frame": {
      const frame = event.frame;
      if (!isUsableWebuiBrowserTargetId(frame.target)) return dropped(state);
      const key = webuiBrowserFrameKey(frame.target);
      const shown = state.selectedTarget;
      // The panel is showing a newer generation of this very tab: the frame is a
      // picture of a page that no longer exists.
      if (shown && webuiBrowserFrameKey(shown) === key && frame.target.generation < shown.generation) {
        return dropped(state);
      }
      const held = frameHeld(state, key) ? state.frames[key] : undefined;
      if (held && held.target.generation > frame.target.generation) return dropped(state);
      // Sequence is monotonic per stream, so a lower one is a reordered frame
      // rather than a newer picture.
      if (held && held.target.generation === frame.target.generation && held.sequence > frame.sequence) {
        return dropped(state);
      }
      const next: WebuiBrowserPanelState = { ...state, frames: { ...state.frames, [key]: frame } };
      return { ...next, status: deriveStatus(next) };
    }

    case "failed":
      return { ...state, error: event.error, status: "error" };

    case "error-dismissed":
      return state.error ? { ...state, error: undefined, status: deriveStatus({ ...state, error: undefined }) } : state;

    case "closed":
      return initialWebuiBrowserPanelState;
  }
}

function dropped(state: WebuiBrowserPanelState): WebuiBrowserPanelState {
  return { ...state, droppedFrameCount: state.droppedFrameCount + 1 };
}

// ---------------------------------------------------------------------------
// Selectors. Derived from the state, so a view never recomputes them inline.
// ---------------------------------------------------------------------------

/** The frame the panel should display, or `undefined` when there is none to show. */
export function selectWebuiBrowserFrame(
  state: WebuiBrowserPanelState,
): WebuiBrowserPanelState["frames"][string] | undefined {
  const selected = state.selectedTarget;
  if (!selected) return undefined;
  const key = webuiBrowserFrameKey(selected);
  return frameHeld(state, key) ? state.frames[key] : undefined;
}

export function selectWebuiBrowserSelectedTarget(
  state: WebuiBrowserPanelState,
): WebuiBrowserTargetState | undefined {
  const selected = state.selectedTarget;
  if (!selected) return undefined;
  return state.targets.find((candidate) => isSameWebuiBrowserTarget(candidate.id, selected));
}

/**
 * The target a run has selected, as the host's target list reports it.
 *
 * The service marks exactly one target per run, so this is how the panel learns
 * which page the *active run* is driving without the run having to announce it —
 * and `undefined` when that run has selected nothing, which is the answer for a
 * panel that is showing a browser with no run behind it. Reading the flag
 * instead of the panel's own selection is what makes the panel follow the run
 * rather than keep showing whatever it happened to be showing.
 */
export function selectedWebuiBrowserRunTarget(
  list: WebuiBrowserTargetList,
): WebuiBrowserTargetId | undefined {
  return list.targets.find((target) => target.selected)?.id;
}

/** Whether the surface the panel is showing is authorized to be shown at all. */
export function selectWebuiBrowserSurfaceAuthorized(state: WebuiBrowserPanelState): boolean {
  return isWebuiBrowserSurfaceAuthorized(state.authorization, state.surface);
}

/** Every surface with its switch, so the view renders the list from one derivation. */
export function selectWebuiBrowserSurfaceAuthorization(
  state: WebuiBrowserPanelState,
  surface: WebuiBrowserSurface,
): boolean {
  return isWebuiBrowserSurfaceAuthorized(state.authorization, surface);
}

/**
 * The `data:` URL a frame renders through, or `undefined` when it must not be
 * rendered at all.
 *
 * The panel is a live *image* stream, never an embedded document: an iframe,
 * `srcdoc` or a blob URL would give the target page the WebUI's own origin and
 * put its scripts next to the session token. An `<img>` over a `data:` URL cannot
 * execute anything, and the payload is checked against the base64 alphabet and
 * the two formats the contract allows before it reaches `src` — a host that sent
 * something else gets no element rather than an element that guesses.
 */
export function webuiBrowserFrameDataUrl(
  frame: WebuiBrowserPanelState["frames"][string] | undefined,
): string | undefined {
  if (!frame) return undefined;
  if (frame.format !== "png" && frame.format !== "jpeg") return undefined;
  if (typeof frame.data !== "string" || frame.data.length === 0) return undefined;
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(frame.data)) return undefined;
  return `data:image/${frame.format};base64,${frame.data}`;
}
