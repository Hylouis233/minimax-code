# Phase 0 — the substrate matrix

**Status: accepted by the operator on 2026-10-12. Phase 0 is closed and Phase 1 may start.**
`PLAN-webui-business-reorganization.md` §8 Phase 0 requires this output to be accepted before
Phase 1 begins (§14.1 item 4); that acceptance was given, and `#57` is released by it.

## What Phase 0 owed

§8 Phase 0: re-derive `field 7` (substrate needs) for the three rows §4 marked `[to derive]` —
`sessions` (§4.1), `workspace` (§4.4), `models` (§4.7) — **from the props each business receives**
rather than from its own imports, because today's imports hide the value behind prop relay (§1.3).
Output: the completed eight-field table, and the enumeration of the substrate's consumers.

`field 7` is one of `read-model | in-flight-read | intents | self | none`, enumerated, never prose
(§4). It records **consumption**, so the substrate's consumers are enumerable.

## Method

Each value below was read from the source as it stands, not from §4's prose:

- **`sessions`** — `WebuiProjectList` and `WebuiSessionList` (`SessionRail.tsx:215`, `:1085`) receive
  `page`, `treePage`, `projectRecords`, `query`, `loading` and `error` (the session read model);
  `activity` and `now` (the live activity/unread state, which is event-hydration); and
  `onLoadMore`, `onProjectSelect`, `onCreateTaskInProject`, `onRenameProject`, `onArchiveProject`,
  `onRenameSession`, `onToggleSessionPin`, `onToggleSessionStar`, `onArchiveSession` (the intents).
  The rail imports **no** substrate hook today — every value arrives as a prop, which is why §4 could
  not decide the cell from imports. **Derived: `read-model, in-flight-read, intents`.**
- **`workspace`** — `WebuiEnvironmentPanel` (`WorkspacePanels.tsx:275`) receives `queries` (the
  workspace query owner), `workspaceEnvironment`, `workspaceDir`, `collapsed` and callbacks, and reads
  `useWebuiWorkspaceQueriesState()`; progress derives from the live stream plus history. Substrate turn
  intents reaching it: **0 occurrences** of `attachTurn`, `sendTurn`, `resumeSession`, `loadMessages`.
  **Derived: `read-model, in-flight-read`.**
- **`models`** — `ModelPicker.tsx` contains no `sessionId` and no session hook, so the picker is
  selection-only today. **Not derived: it turns on a decision.**

## The completed table — `field 7` for the twelve businesses

| # | business | `field 7` | how it was settled |
|---:|---|---|---|
| 1 | `sessions` | `read-model, in-flight-read, intents` | **derived** — from the props the rail receives (above) |
| 2 | `composer` | `read-model, in-flight-read, intents` | direct import (§4.2) |
| 3 | `transcript` | `read-model, in-flight-read` | direct import (§4.3) |
| 4 | `workspace` | `read-model, in-flight-read` | **derived** — from the props the panels receive (above) |
| 5 | `interactions` | `in-flight-read` | direct import; no intents — its four calls are stream-phase writers and the turn resumes through the substrate's own loop (§4.5) |
| 6 | `goal` | `in-flight-read` | direct import; not intents — nothing in the goal path calls `attachTurn` or `sendTurn` (§4.6) |
| 7 | `models` | `none` | **derived** — the session-scoping lives in its own catalogue query, not in a substrate read (below) |
| 8 | `plugins` | `none` | direct import (§4.8) |
| 9 | `settings` | `read-model` | direct import, corrected from `none` (§4.9) |
| 10 | `account` | `read-model` | direct import, corrected — the usage notice is session-scoped (§4.10) |
| 11 | `shell` | `none` | the shell **constructs** the substrate; construction is not consumption (§4.11) |
| 12 | `turn` | `self` | the substrate reads its own stream slice; no other business's read model (§4.12) |

## The substrate's consumer list

Derived from the table above, counting each capability's consumers:

| capability | consumers | count |
|---|---|---:|
| `read-model` | `sessions`, `composer`, `transcript`, `workspace`, `settings`, `account` | 6 |
| `in-flight-read` | `sessions`, `composer`, `transcript`, `workspace`, `interactions`, `goal` | 6 |
| `intents` | `sessions`, `composer` | 2 |
| `self` | `turn` | 1 |
| `none` | `plugins`, `shell`, `models` | 3 |

**All twelve businesses are counted.** The substrate's consumers are therefore: `read-model` 6,
`in-flight-read` 6, `intents` 2, `self` 1, and `none` 3 — twelve businesses, twelve values.

## The `models` cell — derived, not decided

§5.6 named this as one of two cells §4 leaves open, on the ground that the picker's session-awareness
would decide it. **The source settles it, so it is a derivation and not a decision.**

- The picker **already shows the session's current model**, and it does so without a substrate read.
  `SessionComposer.tsx:1264` resolves it as `models.find((model) => model.selected)` and passes it to
  the picker as `selected` (`:2460`); the chip is rendered inside the picker itself (`ModelPicker.tsx:925`).
- The list is **session-scoped at its own owner**: `SessionComposer.tsx:1157` loads it with
  `listModels?.({ sessionId })`, and `:867` clears it to `[]` when there is no session, with the comment
  that the previous session's model state must not bleed into the composer.
- So the picker consumes **no** substrate capability. Its session-awareness is a property of the
  `models` catalogue query — which is `models`' own state — and not of a read of `sessions` or of the
  substrate.

**Derived: `models` `field 7` = `none`.** Two consequences worth stating:

- §4.7's *does not own* list does **not** need a new cross-business read added for the picker: the
  picker never reads `sessions`' active model, it reads its own catalogue.
- The plan's open cell assumed the picker might need a session read. It does not. What the carve does
  change is **where the list lives**: today the composer holds it as its own `useState`
  (`SessionComposer.tsx:782`), and after the carve `models` owns the catalogue query while the picker
  keeps receiving the list from its owner. The `field 7` value is `none` on both sides of that change.

## Exit condition

§8 Phase 0's exit is *"every one of the twelve rows has an enumerated `field 7`, and the substrate's
consumer list is complete."*

- **All twelve rows are enumerated**, including `models`, which the source settles rather than a decision.
- **The consumer list is complete**: twelve businesses, twelve values, five capabilities.
- **The exit condition is met.** §14.1 item 4 is discharged: the operator accepted this output on
  2026-10-12, Phase 0 is closed, and Phase 1 (`#57`) may start.
