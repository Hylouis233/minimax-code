# Phase 0 — the substrate matrix

**Status: output produced, one cell pending the operator's decision, not yet accepted.**
`PLAN-webui-business-reorganization.md` §8 Phase 0 requires this output to be accepted before
Phase 1 begins (§14.1 item 4). Until then Phase 1 does not start.

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
| 7 | `models` | **pending** | **the picker decision — see below** |
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
| `none` | `plugins`, `shell` | 2 |

**`models` is excluded from these counts until its cell is decided.** If it resolves to `none` the
`none` row becomes 3 and no other row changes; if it resolves to `read-model` the `read-model` row
becomes 7. **No other cell moves either way**, which is why the decision is separable.

## The one pending cell

**Does the `models` picker have to show the session's active model?**

- **Today: no.** `ModelPicker.tsx` has no `sessionId` and no session hook; it is selection-only.
- **If no** → `models` `field 7` = `none`. The picker neither reads the substrate nor issues intents.
- **If yes** → `models` `field 7` = `read-model`, and the picker gains a cross-business read of
  `sessions`' active model that §4.7's *does not own* list does not currently declare. That read would
  have to be declared there, and the picker would stop being purely selection-only.

§5.6 names this as one of the two cells §4 leaves open and that must be decided before its phase.

## Exit condition

§8 Phase 0's exit is *"every one of the twelve rows has an enumerated `field 7`, and the substrate's
consumer list is complete."*

- **Eleven of twelve rows are enumerated**; the twelfth is `models`, pending the decision above.
- **The consumer list is complete for those eleven**, and the twelfth's two possible outcomes are both
  stated, so the list closes the moment the cell is decided.
- **The exit is therefore not met yet**, and this document is not accepted yet. Deciding `models`
  completes the table; accepting this document closes Phase 0 and unblocks Phase 1.
