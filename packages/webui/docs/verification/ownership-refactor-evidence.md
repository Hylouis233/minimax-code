# Acceptance evidence — ownership refactor

Issue #167 closes the sweep across tickets #154–#166. This file records **what was
run** and **what each run proves**, for every acceptance row `V01`–`V45`.

It is deliberately not a list of passing tests. A row whose only evidence is
"the suite is green" has not been discharged, and saying so here is the point:
the reader should be able to tell which rows rest on an assertion they can open,
and which rest on a gate that reads the source rather than behaviour.

Read [`gates.md`](gates.md) for what each gate proves and what it does not. The
evidence levels below are that document's.

## What was run

All from the repository root, on `refactor/webui-ownership`, after
`node scripts/source-inventory.mjs --write`:

| Command | Result | Establishes |
| --- | --- | --- |
| `pnpm test:webui` | 172 files, 2811 tests passed | Behaviour under the seams each row names |
| `pnpm typecheck:webui` | clean | Every source **and every test** file compiles under `strict` (see below) |
| `pnpm check:webui-dependency` | 0 direction, 0 cycle, 0 role, 0 publication violations | Layer, role, authority and publication-surface rules |
| `pnpm build:webui` | 423 inputs | The sources actually build |
| `pnpm check:webui-boundary` | passed (after the build) | Nothing outside the allowed entries entered the build graph |
| `npx playwright test test/webui-browser/terminal-cross-page.spec.mjs test/webui-browser/zone-error-recovery.spec.mjs --reporter=line` | 3 passed | Built-browser behavior for V04/V08, through the synthetic in-page bridge |
| `pnpm check:source` | 5164 files | The inventory matches the tree |
| `pnpm verify` | see "Known flake" below | The full CI set, in order |

The focused built-browser cases for V04 and V08 were run after rebuilding the
client. They exercise the rendered application and its in-page fixture, not a
real terminal service. See the row notes below for that boundary.

## Two findings the sweep produced

**Type coverage was four test files out of 174.** `pnpm typecheck:webui` ran a
program whose `include` named four files in `test/unit/`. The rest were not
checked by any gate in the standard sequence, and a test can pass the wrong
arity or a string where a union is expected without failing: Vitest's transform
strips types without checking them. The complete program existed as
`typecheck:webui-full`, which is why this is easy to miss — an author running the
ordinary gate got green on a package it had barely read. 64 strict-mode errors
had accumulated across thirteen tickets. `tsconfig.test.json` now carries the
full program; `tsconfig.test-full.json` and both `*-full` scripts are deleted
rather than kept as a second name for the same thing. Coverage is verified by
listing the program's files against the filesystem: every `.ts`/`.tsx` under
`src/` and `test/`, plus `vite.config.ts`, nothing omitted.

**A type error was hiding a vacuous assertion.** Including `test/integration/`
— which no program had ever covered — surfaced
`once<number>(watcher, "close")` in the loopback suite. `node:events`' `once`
resolves to the event's *argument array*, so
`expect(await watcherClosed).not.toBe(1000)` compared `[1000]` against `1000`:
always unequal, always passing. The suite claimed the server does not close the
socket cleanly and never read the code. It now destructures the array; the
assertion holds for the right reason.

**A malformed transcript row escaped the zone and retry needed a fresh read.**
The null history row exposed a render failure that reached the root boundary.
Transcript projection now drops rows without a valid message identity, and the
transcript zone retries by refreshing its own history before remounting. The
browser acceptance injects a malformed tool record inside the transcript zone,
then repairs the fixture answer and confirms retry restores the transcript
without losing the composer draft.

## Row-by-row

| Row | Established by | Level |
| --- | --- | --- |
| V01 | `webui-application-lifecycle.test.ts` — *dispose is terminal and idempotent* / *a fresh instance is a fresh lifecycle* | 2 |
| V02 | `webui-application-lifecycle.test.ts` — *reads resolve after the application is disposed* | 2 |
| V03 | `webui-application-lifecycle.test.ts` — *one owner's cleanup failing does not strand the others* | 2 |
| V04 | `terminal-cross-page.spec.mjs` — page A creates and uses the terminal; page B lists and watches it; closing B detaches B while the process remains live for A | 2 |
| V05 | `terminal-owner.test.ts` — *returns a real disposer that releases its watch exactly once* / *detaches every watch without touching a single process* | 2 |
| V06 | `terminal-owner.test.ts` — *V06 · only the application ends the process, and only once* | 2 |
| V07 | `webui-session-purge.test.ts` — *fences late completions* / *revokes every interest in the session it deletes* | 2 |
| V08 | `zone-error-recovery.spec.mjs` — a malformed transcript tool record fails inside the transcript zone; retry refreshes that zone and preserves the composer draft | 2 |
| V09 | `request-freshness.test.ts` — *a key is injective over its declared domain* | 1 |
| V10 | `request-freshness.test.ts` — *a keyed resource stores identity as identity* | 1 |
| V11 | `request-freshness.test.ts` — *rejects an answer that was in flight when the key was invalidated* | 1 |
| V12 | `request-freshness.test.ts` — *a selected slot belongs to one identity at a time* | 1 |
| V13 | `webui-event-coordinator.test.ts` — *V36 · routes every lifecycle event to the sessions owner* | 2 |
| V14 | `webui-application.test.ts` — *stage 4 — reaches the workspace owner on a workspace-git event with nothing mounted* | 2 |
| V15 | `webui-session-purge.test.ts` — *V15 · a confirmed deletion settles through one teardown* | 2 |
| V16 | `session-scope.test.ts` — *releases only the selected-view lease when the selection moves* | 1 |
| V17 | `webui-wire-envelope.test.ts` / `webui-transport-wire.test.ts` — *the service judges an inbound frame* | 2 |
| V18 | `webui-shell-seam.test.ts` — *the shell forwards zero transport members* | 2 |
| V19 | `models-workflows.test.ts` — *a provider operation answers with a typed outcome* | 2 |
| V20 | `request-freshness.test.ts` — *a read reports what its own request produced* | 1 |
| V21 | `models-workflows.test.ts` + `webui-candidate-wire-compatibility.test.ts` | 2 |
| V22 | `webui-submission-transition.test.ts` — *is available before the work finishes, carrying the admission it decided* | 1 |
| V23 | `webui-application-lifecycle.test.ts` — *a fresh instance is a fresh lifecycle* | 2 |
| V24 | `webui-port-slices.test.ts` — *every slice carries exactly the members its key list names* | 1 |
| V25 | `webui-dependency-check.test.ts` — *V25 · what a published surface may contain* (7 negative fixtures) | gate + 1 |
| V26 | `terminal-owner.test.ts` — *V26 · a PTY whose creating page unmounted before the create answered is still adoptable* | 2 |
| V27 | `turn-review-owner.test.ts` — *a refused mutation announces nothing* | 2 |
| V28 | `session-rail-search.test.ts` — *V28 · searching the rail observes, it does not probe* | 2 |
| V29 | `terminal-owner.test.ts` — *V29 · an absent bridge and an incompatible one are different failures* | 2 |
| V30 | `webui-ownership-acceptance.test.ts` — *V30 · publication replaced the ledger* | gate + 1 |
| V31 | `webui-session-purge.test.ts` — *a session delete invokes the composer's purge command* | 2 |
| V32 | `request-freshness.test.ts` — *an epoch binding retires only the keys it covers* | 1 |
| V33 | `settings-workflows.test.ts` — *a settings read reports its own request outcome* | 2 |
| V34 | `workspace-panel-state.test.ts` — *does not paint an empty roster before the first answer lands* | 1 |
| V35 | `workspace-panel-state.test.ts` — *drops a roster read that a later read has superseded* | 1 |
| V36 | `webui-event-coordinator.test.ts` + `webui-session-purge.test.ts` — *this page can act on a session fact another client published* | 2 |
| V37 | `webui-role-check.test.ts` — *the role classifier* | gate + 1 |
| V38 | `request-freshness.test.ts` — the inlined reproduction of the query-store defect; the module no longer exists | 1 |
| V39 | `session-single-source.test.ts` — *the session state source is single* | 2 |
| V40 | `webui-submission-transition.test.ts` — *never rejects, even when the attempt throws where nothing expected it* | 1 |
| V41 | `webui-ownership-acceptance.test.ts` — *V41 · the delivery mechanism imports nothing from Turn* | gate + 1 |
| V42 | `webui-dependency-check.test.ts` — *V42 · the path metadata refactor changed no verdict* | gate + 1 |
| V43 | `webui-ownership-acceptance.test.ts` — *V43 · composer's input rules live with the composer, not with the shell* | gate + 1 |
| V44 | `request-freshness.test.ts` — *refuses a token minted by another owner incarnation* | 1 |
| V45 | `webui-personalization-wiring.test.ts` — *does not report a port method it never received as a working read* | 2 |

Every row is discharged by a named case. Rows marked `gate + 1` are established
by reading the source and the tree, which is what the row asks about: a claim
about *which module owns a rule* cannot be established by an owner test that only
exercises the owner.

V04's acceptance seam asks for an actual terminal bridge. The browser fixture
uses a synthetic catalogue shared through same-origin local storage and an
in-page WebSocket replacement. The test establishes multi-page WebUI ownership
and watch behavior at level 2, but it does not establish a real PTY bridge or
level-4 live product behavior. That portion of the plan row remains unverified.
The repository's [evidence-level definition](gates.md) reserves level 4 for a
real agent process, cloud account, native terminal or cross-platform run, so the
built-browser results here are recorded at level 2.

## Document checks versus implementation checks

The evidence above is implementation evidence. The following are **document**
checks and prove nothing about runtime behaviour — they are listed so a reader
does not mistake one for the other:

| Statement | Established by | What it does *not* prove |
| --- | --- | --- |
| A reader can locate business logic versus presentation derivation from the documentation | `docs/architecture/boundaries.md`, § *Telling business logic from presentation derivation* | That any given file follows the guidance |
| The ledger is described accurately | `docs/architecture/boundaries.md`, `docs/adr/0016-…` | That the gate enforces it — `webui-ownership-acceptance.test.ts` and the dependency check do |
| The gates table describes what each gate proves | `docs/verification/gates.md` | That the gates pass — the run table above does |

## Known flake, observed and not caused by this refactor

One `pnpm verify` run failed at `test:webui` on
`test/integration/real-host-model-turn.test.ts` with
`ENOTEMPTY: directory not empty, rmdir '/tmp/webui-real-host-turn-*'`. The suite
closes the host and then removes its data directory, and the runtime's background
flush can still be writing there. The file is untouched by this refactor (its
last change predates the baseline), it passes in isolation on repeated runs, and
the next full run passed 172/172. It is recorded here rather than suppressed: a
cleanup race that lost a `pnpm verify` is worth the next person knowing about,
and this round claims no measurement of how often it happens.

## What this does not claim

No performance claim of any kind. Nothing here measured rendering time, latency,
request count or resource use, and nothing in this round's commits asserts
otherwise. The one behaviour the rail deliberately does *not* do — issue a probe
per keystroke (V28) — is a correctness row about observation not owning process
lifetime, not a performance result.

No claim above rests on a live agent process, a cloud account, a native terminal
or a cross-platform run. The reproducible ceiling remains level 3, as
[`gates.md`](gates.md) states.
