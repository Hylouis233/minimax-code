# WebUI architecture migration baseline and conformance ledger

Status: produced by **T01 / #127** (`baseline-conformance-ledger`). This is a measurement of the starting state and the evidence behind it — not a design authority and not a claim that the target architecture exists. The authorities are the [Plan](PLAN-webui-architecture-review.md), the [decision record](webui-architecture-decisions.md) and the [Spec](SPEC-webui-architecture-redesign.md); the [development board](webui-architecture-development-board.md) assigns the work.

Every number below was produced by running the recorded command on the pinned tree. Where something was not run, it says so; where a finding is read from source rather than executed, it says that too. T21 supersedes this document with the final architecture evidence.

## 1. Pinned baseline

| Item | Value |
| --- | --- |
| Product source baseline | `5d89bff9c2e25fb79e1278ec276d1fbf17c0882f` (`webui`) — unchanged by T01 |
| Architecture/Spec authority snapshot | `486dc644838f403a1956786d1e821a5039702bcc` |
| Publication receipt (T01 branch base) | `4affbc0478d02cc4294946e0dba7f3c25789eb26` |
| T01 development commit | `138ea4fc` |
| Tracker | `mcode-webui/minimax-code`; parent Spec #126, tickets #127–#147 |

Product code is byte-identical to the source baseline: T01 changed tooling, generated records and tests only. The commits between the source baseline and the receipt are the business-reorganization Phase 5 completion (`5d89bff9`) and two authority-document preparations.

## 2. Canonical resources and their owner

One row per authoritative resource, read from the source at the pinned baseline. "Owner" is the module that owns the write path; "seam" is how everything else is meant to reach it.

| Resource | Owner | Seam |
| --- | --- | --- |
| Per-session record (stream, sending, permissions, questionnaire, goal, transcript) and the home record | `client/application/session-store.ts` | `createSessionWriter` / `createInteractionWriter` for slices; `readSession` + `subscribe` for reads; `migrateSession`, `purgeSession` for lifetime |
| Activity / unread overlays | `client/application/session-store.ts` (`updateActivity`) with reduction in `client/application/sessions/unread.ts` | `unread.recordEvent`, `markRead`, `seed`, `hydrate`, `probeActiveTurns` |
| Session catalogue | `client/application/session-store.ts` (`updateCatalog`) with workflows in `client/application/sessions/{session-catalog,session-workflows}.ts` | catalogue workflows; `updateCatalog` is the single slice writer |
| Process-event ingress | `client/application/create-application.ts` opens exactly one channel per instance | sole consumer `client/features/turn/application/event-coordinator.ts`; per-session effects via `client/features/turn/application/event-effects-registry.ts` |
| Turn / delivery attempt | `client/features/turn/application/{turn-commands,turn-coordinator,stream-lease-controller,queue-command,active-turn-probe}.ts` with the lease algorithm in `client/mechanisms/{stream-lease,stream-loop}.ts` | turn commands + `WebuiStreamPhaseCommands` / `WebuiTurnLifecycleCommands` (`client/application/sessions/session-commands.ts`) |
| Canonical history | `client/application/transcript/transcript-history.ts` | page loads through the transcript port |
| Composer draft/history/modes/queue/staging/retry/mention range | `client/application/composer/composer-store.ts` | store commands; one snapshot subscription per view |
| Cached reads through the shared primitive | `client/application/query-store.ts` — consumers: `client/application/models/models-workflows.ts`, `client/application/settings/settings-workflows.ts` | `readInto(field, key, fetch)` |
| Owner-local cached reads (not on the shared primitive) | `client/application/workspace/workspace-queries.ts`, `client/application/account/account-workflows.ts` both keep their own version maps | business-specific today; Plan P3/§4.5 makes these the T03/T11 seam |
| Goal | `client/application/goal/goal-coordinator.ts` (+ `client/application/version-cell.ts` fence) | `createGoal` / `patchGoal` / `clearGoal` / `refreshGoal` / `applyGoal` |
| Interactions | `client/application/interactions/interaction-coordinator.ts` (own fence cell) | `replyPermission` / `answerQuestionnaire` / `dismissQuestionnaire` / `refresh` |
| Models | `client/application/models/models-workflows.ts` | provider CRUD + selection |
| Plugins | `client/application/plugins/plugin-workflows.ts` | plugin management operations |
| Workspace files / environment / review | `client/application/workspace/workspace-queries.ts` | workspace queries, snapshot guards |
| Account | `client/application/account/account-workflows.ts` | login/check-in/quota/credential status |
| Server operation registry | `server/operation/operations.ts` (single `registerOperation` site) | dispatch in `server/operation/operation-dispatch.ts` |

**Known duplicate readers, recorded not fixed here.** The shell constructs the settings, models, plugins and workspace owners and the composer constructs the interaction and goal coordinators (`components/shell/WebuiClientFoundationApp.tsx:338–430`, `components/composer/WebuiComposer.tsx:497,520`); the composer keeps its own `listModels` / account-status / plugin reads (`:964,1064`). These are Plan P1/P4, owned by T02, T03, T05, T13 and T19. They are recorded here so a later ticket can show they are gone; T01 changes none of them.

## 3. Public command surface

| Surface | Size | Record |
| --- | --- | --- |
| Wire operations | 99 (86 binding entries + 13 dedicated handlers) | `shared/operation-names.ts`; pinned by `test/unit/webui-operation-binding.test.ts` and `test/unit/webui-host-shape-invariant.test.ts` |
| Browser capability ports | 13, joined by `client/contracts/transport.ts` (every method optional) | one directory per business under `client/contracts/` |
| Published command declarations | 73 member rows across 4 businesses (turn, interactions, composer, goal) | generated `docs/webui/command-surface.md` |

The generated surface is regenerated by `node scripts/webui-command-surface.mjs --write` and checked by `pnpm check:webui-commands`; it was repaired in T01 (§5 C5).

## 4. Verified baseline scenario results

All runs on `138ea4fc` with `TMPDIR=/tmp` (the policy suite is `TMPDIR`-sensitive; see `CONTRIBUTOR` notes in `AGENTS.md`).

| Scenario | Command | Result |
| --- | --- | --- |
| Source inventory | `node scripts/source-inventory.mjs --write`, `pnpm check:source` | PASS — 5,034 paths |
| Generated path maps | `pnpm check:tsconfig` | PASS — both maps match 128 package exports |
| Dependency direction + roles | `pnpm check:webui-dependency` | PASS — 303 files, 1,099 in-package references, 0 direction violations, 0 role violations, 1 declared structural allowance |
| Published command surface | `pnpm check:webui-commands` | PASS (was ENOENT; repaired in T01) |
| Business navigation | `pnpm check:webui-business-navigation` | PASS — table matches the delivered tree |
| Client/server build | `pnpm build:webui` | PASS — 287 inputs (65 server, 224 client) |
| Build boundary | `pnpm check:webui-boundary` | PASS — 287 inputs, 6 rules |
| Types | `pnpm typecheck:webui` | PASS (server, client, test) |
| Application suite | `pnpm test:webui` | PASS — 145 files, 2,365 tests |
| Loopback → server → harness (inside the suite) | `packages/webui/test/integration/loopback-harness-path.test.ts` | PASS — real `WebuiService` on a real loopback port: unauthenticated connection refused, a real request through envelope/dispatch/registry lands on the harness port method, `watchEvents` delivers a live event, client reconnects, and a post-`close()` connection is refused. The leaf host is a scripted port, not a live `CliService` |
| Built-client browser | `pnpm test:webui-browser` | PASS — 97 tests in 14 spec files, 1.1 min, headless Chromium against the built client and the suite's real HTTP server on `127.0.0.1:4179` |

Not run in T01, and therefore not established by it: `pnpm typecheck:webui-full`, `test:artifact`, `test:capabilities`, `test:smoke`, `test:byok`, `test:policy`, `test:sandbox`, the Windows profile, the full `pnpm verify` pipeline, live cloud/account, native PTY behaviour, cross-platform acceptance, and performance/throughput. Runtime adapters were not exercised against a live harness host beyond the scripted port above.

Observed but not investigated here: every browser page logs `Failed to load resource: 404` to the console. The suite does not fail on it, and it predates T01; it is recorded so a later ticket does not mistake it for a regression.

## 5. Correction ledger: corrections, not equivalence

C1–C5 are the accepted corrections from the decision record. Each is listed with what was *established*, how, and which ticket owns the fix. None of them is a moves-only equivalence claim, and T01 corrects only C5.

| Id | Finding | Evidence in this baseline | Status | Carrier |
| --- | --- | --- | --- | --- |
| C1 | The production boot omits the unread storage the fallback assembly injects, so boot does not persist or restore unread counts | Source-anchored: `client/main.tsx:85–106` calls `createWebuiApplication` without `unreadStorage`; `client/components/shell/WebuiClientFoundationApp.tsx:1049–1064` injects `browserStorage.readUnreadCounts` / `writeUnreadCounts`. The fallback path is the one SSR and unit-test hosts take; production always supplies an application, so the injected adapter is never used in a real boot | Open — not driven in a browser (no unread scenario in the browser suite) | T02 (`unread-assembly-parity`) |
| C2 | A recognized data-bearing event is dropped when no view has registered an effect set for the named session | Executed probe, `w0-baseline/corrections-probe.mts`: one scripted `thread_goal.updated` for session `session-under-probe`, single channel listener. Bare application → `goalCommitted: true` (`goal-1`). Application wired to an empty effects registry → `goalCommitted: false`. The registry always supplies `setGoal`, which suppresses the store fallback, and then routes to a session with no registration | Reproduced against the current tree | T05 (`permanent-domain-event-routing`) |
| C3 | Two query keys writing one destination field can overwrite each other out of order | Executed probe, same script: `readInto("models", "key-A", …)` held pending, `readInto("models", "key-B", …)` resolves → field is `"B"`; the late key-A answer then resolves and the field becomes `"A"` | Reproduced against the current tree | T03 (`request-freshness-primitive`) |
| C4 | The goal selection effect clears the canonical goal while it resets view mode, so the retained goal is briefly destroyed on every session switch | Source-anchored: `client/components/composer/WebuiComposer.tsx:946–961` runs on every `sessionId` / `goalEnabled` change, calls `applyGoal(undefined)` and `setGoalMode(false)`, then re-reads through `goalCoordinator.refreshGoal()`. The exact transient is not driven — it needs a mounted React tree, and the repository has no DOM test framework | Open — characterized from source | T05 (`retained-goal-view-reconciliation`), consumed by T13 |
| C5 | The command-surface generator pointed at a pre-move module, so the gate failed before it compared anything | Before: `pnpm check:webui-commands` → `ENOENT … client/application/turn-capabilities.ts`. Two stale entries existed, not one: `application/turn-capabilities.ts` → `features/turn/application/turn-capabilities.ts` and `application/goal-coordinator.ts` → `application/goal/goal-coordinator.ts` | **Fixed in T01.** After: PASS; the regenerated table differs only in its "Declared in" column, so the published business/declaration/member surface and the frozen protocol oracle are untouched | T01 |

Structural equivalence is not claimed for any of C1–C4: the fixes are behaviour changes and each needs its own regression evidence in its carrier ticket.

## 6. Absent-capability baseline

Today's supported "nothing wired" state, read from source and exercised by the suites above:

- `createWebuiApplication` requires `turns`; `store`, `readActiveSessionId`, `composer`, `unreadStorage`, `loadMessages` and `turnCapabilities` are optional. An absent `turnCapabilities` is the documented supported state for SSR and unit tests (`client/application/create-application.ts:59–96`).
- With no transport, `main.tsx` and the shell both substitute a no-op channel factory (`subscribe` returns a no-op unsubscriber), so the application exists and opens nothing.
- `client/contracts/transport.ts` keeps every method optional, and `undefined` means "this operation is not wired" — the panels gate on it.
- `WebuiQueryStore.unavailable(field, error)` is the recorded path for "the runtime cannot answer this at all", distinct from a failed read.

What is *not* established at the assembly seam today: that an absent declared capability always surfaces as availability plus a typed unavailable outcome rather than a silent success. `client/application/query-store.ts` has the primitive, and the browser suite covers real availability gating for the surfaces it drives, but no assembly-level test asserts the invariant for every operation. Plan §4.1 makes that an acceptance obligation of T02/T03 (assembly error for a missing required production owner; typed unavailable outcome for an absent declared capability).

## 7. Role gate added by T01

`classifyRole` (in `scripts/lib/webui-dependency-rules.mjs`) adds the ownership dimension beside the layer matrix, recognizing both the current technical homes and the target business-first homes — so a file is judged the same way before, during and after it moves. `roleRule` enforces:

1. **duplicate live owner** — one business may hold one role in one home; a migration that leaves the previous copy behind fails. Holds in every home, so it is the gate that governs the migration itself.
2. **role-forbidden import** — the conversation substrate reaching feature implementation, the assembly or the platform adapters; presentation and shell reaching the assembly or the platform adapters; the generic `client/ui/` home reaching any business.
3. **unapproved peer import** — a feature reaching another business's private role, with reviewed exceptions in `scripts/lib/webui-peer-imports.json` (empty at T01) and a stale or deleted entry failing the check.

The current tree reports zero role violations, and T01 adds no baseline entry: the migration's starting state is not re-reported as a defect. Judgements 2 and 3 begin to bite as each business reaches a target home; judgement 1 bites immediately if a move is left half-done. `isPresentationRole` replaces the `client/components/` prefix in the capability-call rule, so `client/features/<business>/ui/` cannot escape it.

## 8. How downstream tickets use this

- Each ticket records its own execution receipt (commands, results, unverified boundaries) in its issue. This ledger is the T01 snapshot, not a running log; T21 replaces it with the final architecture evidence.
- The preservation obligations are Plan §8.1; this document records evidence, and does not restate them.
- Passing this baseline proves the starting state, not the target: an empty role-violation count here means no migrated code exists yet, not that the ownership rules are satisfied.
