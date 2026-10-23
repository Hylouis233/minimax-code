# WebUI comprehensive test strategy implementation plan

**Status:** Active — implementation resumed 2026-10-23 after premature retirement. At resumption, Linux `pnpm verify` had failed at one browser clock test (173/174 passed), and its focused correction had not been followed by a fresh final full verify. The clock setup was corrected by installing a deterministic Playwright clock before navigation and pausing at a future instant; its focused 70-repeat run passed after rebuilding. The Plugins/Skills/MCP mounted create/import flows and Linux browser geometry/screenshots are now implemented and focused-green. Remaining work includes reconciling the full plan matrix and mutation evidence, completing durable documentation, and running final verification. Keep this plan active until every acceptance criterion below has current evidence and any remaining boundary is explicitly recorded. Phase 0 and per-case audit records are maintained outside the repository at `/home/fectivnfy/.codex/visualizations/2026/10/22/01a16408-54f2-7220-8e9c-f335d5a8b0b9/phase0-audit.md` and `integration-case-disposition.md`.
**Continuation status (2026-10-23):** Current Playwright collection is 174 tests in 34 specs, and all 174 now have case-level path/assertion/boundary/disposition entries in the external ledger. The 13 real-browser bridge cases passed on Chromium and Edge; three modified acceptance receipts were restored with matching SHA-256 hashes. The 22 architecture, picker, native-runtime, review, terminal and transcript-scroll cases plus the final 4 zone-recovery cases passed on Linux Chromium. A case-level Vitest audit has now covered 1,735 executed composer/submission, session/import/export/turn/transcript/retry/catalogue, plan-mode, browser-input, browser-service, browser-state, browser-tool-adapter, session-search/purge, account workflow, connection-health, model/provider, model-picker projection, composer-state, plugin, settings/personalization, transcript/error-rendering, context-usage, activity-indicator, goal-owner, operation/loopback, fork/adoption, interaction-owner, workspace-panel/browser, terminal, workspace-file-view, runtime-contract, overlay/interaction, provider-editor/form-panel, command/queue, goal-outcome, markdown-rendering and review/freshness cases in focused runs across 117 files. One session-release test was strengthened to deterministically wait for the real service subscription in its recording provider and reject a late frame after release. Session-import tests assert format refusal, request body/target construction, hostile identity isolation and server error mapping with synthetic files and an injected fetch stub; they do not prove the real upload route. Delivery-disposer tests exercise production application and turn-command ownership/release with injected event/turn/transport ports; the transport is a test double and does not prove host cancellation or a real socket lifecycle. HTTP transfer route tests run a real local `WebuiService` and TCP fetch request, asserting payload bytes, import/export compatibility, canonical snapshot lineage, authentication, exact route matching, status/error mapping and failed-import cleanup. Their `WebuiHarnessPort` is stubbed, so runtime persistence/replay still needs the separate real-host integration path. Download-button and URL/name tests assert production client helpers and route wiring, but do not automate a browser download gesture. Profile file tests perform actual read/write/delete operations in per-test temporary directories and assert profile marker parsing, size limits, traversal refusal, idempotent clearing and preservation after failed writes; these exercise production storage helpers but not the settings panel's browser UI or live runtime prompt assembly. The 11 operation-codec, real-host adapter and loopback-integration cases used a real local service/socket and isolated production host data directory; the loopback leaf harness is scripted and no online model/account service is called. The 21 runtime environment/event-catalogue/operation-typing tests use synthetic temporary auth data and compile-time/runtime contracts; they do not read real credentials or prove an external runtime event source. The 125 dropdown/outside-close/overlay geometry/rail-menu tests use production policy/placement/menu declarations, truth tables, source assertions and synthetic bounds; browser event dispatch/visual geometry is separately established only by built-client browser tests. The 29 provider editor/panel tests and 42 command/turn/queue/goal-outcome tests use production owners/components with injected fake ports and synthetic state; they do not alone prove real Agent delivery, browser event dispatch or host persistence. The 25 markdown/link/code-fence tests use production render projections with synthetic Markdown strings and SSR; syntax DOM output is asserted, while actual visual typography remains browser screenshot evidence. The 85 request-freshness/review tests use production owner/projection/component modules with deterministic synthetic reads and SSR; request epochs and visible diff/view state are asserted, but real Git/runtime review data is not fetched. Their path and boundary notes are in the external task record. This does not complete the full user-operation/state matrix or the item-by-item audit of all registered Vitest declarations; the full mutation ledger and a successful final `pnpm verify` are also still outstanding. Do not retire this plan until those acceptance conditions and the final single Linux verify are complete. See the external task record for exact evidence and limits.
**Continuation update (2026-10-23):** The current source-to-ledger filename cross-check found 212 Vitest paths registered in `test/vitest-suites.json`; 125 filenames appear in the case disposition ledger and 87 did not appear in that ledger's text search, so the remaining files still require actual audit rather than assuming absence means invalid. Focused runs added 166 passing cases across nine files: session import/disposers (24), session-transfer HTTP/download (53), profile storage (39), stream reducer/transport/transcript wiring (50); cumulative audited execution count is now 1,785 across 120 files. A stream-answer break-link mutation set the production reducer's mapped answer to empty; `webui-stream.test.ts` failed 7/19 with explicit answer mismatch. The source was restored, and that file passed 19/19. Red/green logs and case-level boundaries are in the external task record. The full surface map, remaining test audits, other critical mutations, and final verify are still outstanding.
**Continuation update (2026-10-23):** Eight additional registered shell/settings/slash/thinking/context/rail test files passed focused Vitest execution: `rail-pin-affordance`, `settings-modal`, `settings-workflows`, `shell-surface`, `slash-classification`, `slash-palette`, `thinking-control`, and `token-plan-model` (134/134). The running case-audit tally is 1,919 passed cases across 128 focused files; these tests primarily prove production policy/owners and SSR contracts with synthetic state, and do not replace built-browser pointer/keyboard geometry or the real account boundary. Their per-file cases and evidence limits are recorded in the external disposition ledger. The full 212-file audit, remaining operation/state map, full mutation ledger, and final Linux verify remain open.
**Continuation update (2026-10-23):** Twelve registered application ownership/submission test files passed 128/128 focused cases: adoption, bindings, commands, lifecycle, application coordination, event coordination/generation, identity epoch wiring, runtime lifecycle invariants, execution target, admission and transition. The running audited execution tally is now 2,047 passed cases across 140 files. These tests use production owners/coordinators with synthetic session state and injected ports; actual client/socket/runtime/persisted-result evidence must remain separately attributed to the browser and real-host tests. The source-to-ledger filename cross-check currently leaves 84 registered paths without a filename mention; detailed per-file review and the remainder of the matrix/mutation/final-verification work are still outstanding.
**Continuation update (2026-10-23):** The real-client/runtime integration path for runtime todo → progress panel received a controlled negative control. A first probe removed message-carried progress reduction but the integration still passed, showing that the scenario also has a separate live event route; that probe did not cut the observed path and is recorded as an ineffective probe, not a mutation success. A targeted render-boundary mutation then made `WebuiProgressPanel` map an empty todo slice; after building the mutated client, `agent-transcript.test.ts` failed because the runtime-produced todo row was absent. The render was restored, rebuilt, and the same production integration case passed. A source-restored run had a 5-second post-reload user-message visibility timeout failure; after increasing only that locator wait to 15 seconds, the complete focused integration passed. Expected text and subsequent `resumeSession`/cursor assertions remain unchanged. Two successful focused executions after the wait adjustment add to the prior tally (2,049 passing case executions across 140 unique focused files). Exact outputs and boundaries are in the external ledger. Other mutation edges, remaining registered test audits, complete surface reconciliation, and final verify remain open.
**Continuation update (2026-10-23):** Audited and executed 15 additional registered browser bridge/target/toolbar files (223/223): reconnect and retry contracts; pairing, key/credential isolation and secret redaction; upgrade admission including dev-mode refusal; live session lifecycle; registry routing and target-generation fences; adversarial frame/duplicate/revocation behavior; browser operation and toolbar target binding; and SSR panel branches. Server/upgrade/adversarial/credential-secrecy suites use a real loopback HTTP/WebSocket server, production bridge/WebSocket server, `ws` clients and an in-memory credential store; they do not launch an installed browser extension. Pairing/secure-store platform-command tests use an injected fake command runner (and isolated temp path for the Windows file-backed branch), so no real OS keychain or credential is accessed. Toolbar/panel tests use SSR, source bindings and synthetic target/frame state, not browser event dispatch. No `skipIf`/`describe.skip`/`it.skip` markers were found in these 15 files. Current cumulative focused passing execution count is 2,272 across 155 unique files. The registration-to-ledger filename cross-check has 57 paths not yet mentioned. Full browser surface and all registered test audits, remaining mutation edges and final Linux verify remain pending.

**Continuation update (2026-10-23):** The boundary/dependency gate and service/host/proxy batch passed 246/246 across six registered files. `webui-boundary-check` exercises clean and contaminating build-graph inputs, including temp-file checks for forbidden references; `webui-dependency-check` runs the real AST resolver/classifier against synthetic temp trees and the frozen metadata oracle. `webui-service` covers real loopback HTTP/WebSocket and the shipped client transport against production service code, with synthetic harness ports, deterministic socket clients and temp file fixtures; it is strong service/transport evidence but not a production runtime/session persistence journey. Host-contract derivation and host-shape invariants use source/contract fixtures; the dev-proxy suite exercises the proxy path with controlled local servers. All six files were registered and passed; no files were removed. Full registration disposition, remaining journey audits, required mutation checks and final Linux `pnpm verify` remain pending. See external task record `gate-service-focused-current.log` and the corresponding case-disposition section.

**Continuation update (2026-10-23):** The account/composer/connection/session workflow batch passed 316/316 across 22 registered files. It covered production account/login owners and panel states; composer intent, field, history, seed and submission admission; command/turn ownership and task/session adoption; fork/import/goal/session isolation; connection watcher health and visible status/activity states. These tests use synthetic state, injected local ports and in-memory storage; they do not call account/model services or themselves prove rendered browser geometry or persisted runtime sessions. Those evidence layers are tracked separately. Total focused passing executions recorded so far: 2,834; do not infer unique-file completion from this count. Full registered-file and behavior disposition, remaining mutations, final docs synchronization review and Linux verification remain pending. See external task record `workflow-audit-current.log` and case-disposition section.

**Continuation update (2026-10-23):** The model/catalogue/context/thinking batch passed 207/207 across 18 unique registered files. It exercised catalogue/provider owners, credential-change invalidation, typed mutation/reconciliation, credential-safe provider projections, usage/context ownership and plan projection, protocol/session-fact classification, connection channel health, model effort and thinking-choice wire projection. All provider and usage values were synthetic and all mutations used controlled local ports; no online provider/account call occurred. Total focused passing executions recorded so far: 3,041. Complete registered-file and user-operation dispositions, required mutation matrix, final documentation sync/review and Linux full verification remain pending. See external task record `model-context-current.log` and case-disposition section.

**Continuation update (2026-10-23):** Transcript/error/retry, session transfer and overlay batch passed 391/391 across 20 registered files. Unit cases use synthetic messages, diff results, transfer payloads and callback/geometry inputs; they establish production projection and component state, not persisted runtime behavior or Chromium geometry. The true transcript/client path and browser evidence remain separately scoped. Focused execution total is 3,432. Remaining registered suites, mutation controls, documentation reconciliation, plan retirement and final Linux verify are still outstanding. See external task record `transcript-overlay-current.log` and case-disposition section.

**Continuation update (2026-10-23):** Settings/provider/personalization/plugin batch passed 210/210 across 14 unique registered files. It covers settings layouts and workflow owners, validated global-instruction operations, provider/profile projections, plugin inventory/dialog/catalogue/status and operation wiring. Synthetic fixture data and injected local ports were used; no account, credential or marketplace service was called. Focused execution total is 3,642. Remaining registration and source-surface audits, mutation controls, final docs review, strategy plan retirement and final Linux verify remain pending. See external task record `settings-plugin-current.log` and case-disposition section.

**Continuation update (2026-10-23):** Workspace/review/queue/terminal batch passed 360/360 across 23 registered files. Production workspace tree/tab/archive/canvas/preview, review and queue owners, worktree and terminal contracts, freshness fencing and rail pin callback wiring were exercised using synthetic fixtures or controlled local ports. No actual workspace mutation, terminal process or Git change was created by these unit tests. Focused execution total is 4,002. Remaining suite audit, browser/integration completion, mutation controls, documentation/plan retirement and final Linux verify are pending. See external task record `workspace-review-current.log` and case-disposition section.

**Continuation update (2026-10-23):** The final registered-file batch passed 831/831 across 51 files, covering remaining package/source contracts, host/adaptor composition, store and stream reducers, auth/usage projections, shell/error-boundary rendering, browser frame validation, and worktree state/panels. No skip was reported by Vitest. Inputs are source/synthetic fixtures or controlled local ports; no account, provider, or user data was used. Cumulative focused executions logged: 4,833 (this is execution count, not unique assertions). The filename basename cross-check now has no unmentioned registered WebUI test files. Case-level descriptions remain in the external ledger. Remaining tasks are final integration recheck, mutation evidence reconciliation, package/source gates, final Linux verify once, and retiring the plan after acceptance review.

**Continuation update (2026-10-23):** Restored the plugin/Skills/MCP gap with 9 additional built-client browser cases across `plugin-catalogue-layout.spec.mjs` and `visual-baselines.spec.mjs`: marketplace install and expand/collapse; Skill marketplace install and composer menu insertion; Skill create/enable/delete; plugin enable/uninstall; MCP create/enable/edit/delete; visible success, idle, disabled, unavailable and error rows; and stale MCP detail/Git preview/import settlement. The first focused regression after the contrast fix passed 11/11. The focused Skill/MCP toggle and MCP edit test initially failed because its staged detail response did not match the production `getMcpServer` `{name, config, enabled}` shape; the fixture was corrected to match that observed contract and the test passed 1/1. A broader 13-case plugin/MCP focused rerun is in progress. Added four Linux Chromium screenshot baselines (10 total) for marketplace grids and Skill/MCP management rows; inspected the MCP baseline after fixing its failure-reason text from tertiary (`rgb(173, 173, 173)`) to secondary (`rgb(102, 102, 102)`). The red assertion reproduced the contrast defect before the style fix; the focused browser case passed afterward. Browser evidence remains fixture-backed and does not prove marketplace, installed-plugin filesystem, production runtime-plugin, or live MCP execution. The final `pnpm verify`, full Vitest item-by-item disposition reconciliation, mutation ledger reconciliation, and source inventory check after new snapshots remain pending.

**Premature retirement record (2026-10-23; superseded when this plan was restored):** The plan was removed from the source tree after a failed Linux `pnpm verify` at the browser gate, despite its acceptance criteria still being open. The retained external record preserves the then-current log and disposition work. The plan is active again; this historical entry is not a completion claim.
**Decision:** [ADR 0023](../../packages/webui/docs/adr/0023-webui-test-coverage-follows-user-workflows-and-evidence-levels.md)
**Scope:** `packages/webui` user-facing behavior, runtime integration, test suites and their operating documentation.

## Objective

Build a reliable, end-to-end test system for the complete user-reachable WebUI. It must verify
observable behavior through the correct evidence layer, expose drift and fake-green coverage, retain
valid existing tests, and repair reproducible failures discovered by the full WebUI Vitest and
built-browser gates.

The plan includes a complete existing-test audit, a surface-to-test coverage map, critical end-to-end
workflows, browser layout and interaction coverage, real-path local integration, gate organization,
documentation synchronization and repair of issues found during execution. No implementation work
starts until an independent MiniMax Code M3.1 review finds no scope drift, conflicting policy or
unresolved decision.

## Approved constraints

- Default tests are deterministic, local and isolated. Use synthetic files, temporary workspaces and
  session stores, local origins and local deterministic model stubs. Do not use real user data.
- Default gates do not call online model providers or account-backed APIs and do not consume model
  tokens. Live-provider, OAuth, paid, packaged-client, real Chrome/Edge and external bridge checks
  remain explicitly separate and environment-gated where applicable.
- The built-client browser suite uses Chromium, DOM outcomes, geometry and committed representative
  screenshot baselines for stable visual behavior. Generate and compare baselines on the Linux CI
  browser environment; keep them alongside browser tests and inventory them as source assets.
  Existing browser-generated tests remain and are reviewed for their actual evidence boundary.
- Integration tests must use real WebUI client/service/runtime and persisted harness-session paths
  for the behavior they claim to prove. Browser-local preferences (such as composer drafts) are a
  separate persistence contract. Stubbing model output is allowed; substituting demo UI data for the
  client-to-runtime path is not integration evidence.
- Include all reachable surfaces, controls and operations, not just the user-provided examples.
  Test applicable success, loading, empty/unavailable, refusal/error, cancellation/retry,
  concurrency/queue and refresh/session restoration states without exhaustive Cartesian products.
- Preserve existing tests by default. Keep, correct, strengthen, consolidate or replace each only
  after classifying its contract, path and assertions. Delete a test only if its behavior is retired
  or replacement coverage is demonstrated and documented.
- Fix reproducible product defects, test drift, false-green conditions and broken test infrastructure
  encountered in the full `pnpm test:webui` and `pnpm test:webui-browser` runs. Report environmental
  failures separately.
- Keep established test tier names and evidence boundaries aligned with
  `packages/webui/docs/verification/gates.md` and `browser-suite.md`.

## Current baseline to verify during execution

The current package declares four test areas: `test/unit`, `test/integration`, `test/browser` and
`test/gates`. `test/vitest-suites.json` explicitly registers Vitest files. The Playwright harness
runs the built client in Chromium, with deterministic in-page transport fixtures in most browser
specs; the native-runtime and real-browser integration cases exercise additional real boundaries.
Existing integration tests include loopback harness, agent transcript, production-host turn, real
browser navigation and workspace-browser-tab acceptance paths.

These are inventory starting points, not acceptance claims. The audit must read the current test,
harness and gate code and prove what each test executes. Prior task notes reported failures in
browser-workspace, questionnaire, rail-pin, CSS structure, workspace tab strip and shell suites at
one point; those results are historical leads only. Re-run current gates and classify each observed
failure from fresh output before treating it as a current defect.

## Coverage model

Every user-reachable operation gets an inventory row with: surface and entry point; user action;
observable expected result; owning business; relevant state branches; test file(s); evidence level;
real and stubbed boundaries; gate registration; and audit disposition. Evidence levels follow
`docs/verification/gates.md`: pure behavior, assembled application, real boundary, built browser,
live product. A test cannot claim a higher level than the path it actually executes.

| Surface / workflow family | Required behaviors and states | Primary evidence |
| --- | --- | --- |
| Composer and turn lifecycle | Text send, slash palette including `/plan`, `/goal`, `/compact`, plugin and skills entries, model/effort selection, attachments, `@` references, send/stop/retry, queued send during active stream, send errors, input clearing/retention, thinking/reasoning and ordered transcript | Main browser + real-path integration; focused unit tests for transitions |
| Agent interaction | Ask User prompt, answer submission and continuation in the same turn; refusal, cancellation, reconnect and pending states | Main integration flow + focused browser interaction |
| Transcript and review | User/assistant/tool/reasoning messages, streamed updates, reload/resume, session switch, message ordering and retention, diff/change card ownership and rendering, copy/share/feedback controls where available | Built browser + persisted harness-session integration + focused unit |
| Sessions and navigation rail | Create, select, copy/fork, rename, archive/unarchive, pin/unpin, search, transfer/import/export, delete/purge and navigation/adoption; empty/loading/error and stale selection states | Browser surface flows + persisted harness-session integration + unit/application tests |
| Goal and plan | Goal creation/submission, outcome, retention, session ownership, progress and restart behavior | Browser + integration for composer-to-runtime path + unit ownership tests |
| Environment/progress/todo | Runtime environment changes, todo creation/update/completion, progress events and panel selection/session linkage, empty/loading/error states | Real-path integration reflected in built browser; focused projection tests |
| Embedded browser/workspace panel | New tab/tool selection, navigation, back/forward/reload, input, close, multiple tabs/pages, browser authorization and unavailable state, Agent and user actions, concurrent todo updates; canvas, archive view, directory browser and panel controls | Built browser for controls/layout + real local-origin Chromium integration for service path |
| Files and workspace tools | File tree navigation, preview supported text/media/HTML, refresh, errors/unavailable content and tab lifecycle; workspace tabs and supported file types | Built browser + focused integration at file/runtime boundary where available |
| Terminal | Start, input, output, resize, stop/exit, cross-page/session behavior, unavailable PTY and shutdown | Local host integration + browser interaction; native evidence labeled per platform |
| Models and provider setup | Picker open/search/select, grouping and effort states; provider configuration validation, test/save/discovery and failure/pending behavior | Browser + application/contract tests; external provider invocation remains separately gated |
| Settings, personalization and account | Tabs/routes including coding, worktree and archived views, theme, instructions/preferences, usage/account states, loading, empty, error, save and navigation behavior; assert disabled tabs remain unavailable | Browser layout/interaction + focused application tests; no real account by default |
| Plugins and MCP | Catalogue, install/configuration/action workflows, status, permission/refusal, errors, empty and loading states | Built browser + local service/contract integration as applicable; external services excluded by default |
| Global interactions and shell | Menus/dialogs, keyboard shortcuts, dropdown dismissal/placement, connection status, startup errors/recovery, responsive or constrained geometry, focus and accessible operation | Built browser, representative screenshot baselines and focused pure/view tests |

The table is a coverage taxonomy, not the detailed operation checklist. Phase 0 expands it against
all feature UI, command registries, public actions, and `docs/known-gaps.md` / `docs/open-questions.md`.
That source-grounded checklist must explicitly include `/compact`; slash-palette plugin and skills
states (including runnable, inert-wired and intentionally unsupported entries); all 29 plugin
management actions; settings' coding, worktree and archived views plus disabled/unavailable tabs;
workspace canvas, archive view, directory browser and panel controls; and the currently shipped
terminal, file-preview, browser, session transfer and account flows. Unsupported states are tested
as unsupported/unavailable; the plan does not imply implementing missing features. No feature family
is complete solely because a family row exists.

## Mandatory end-to-end journeys

1. **Agent reply, refresh and resume.** From a fresh isolated session, send a composer message;
   stream reasoning and tool/activity events followed by a final response; verify message order,
   final content and review/diff card; refresh during a controlled active response and after
   completion; verify the resumed stream and persisted transcript do not drop or reorder messages.
2. **Plan, goal, reference and attachment.** Start `/plan` and `/goal` using the composer; choose an
   `@` file reference and add an attachment; verify selected identities and intended content
   metadata reach the runtime request, and verify resulting goal/plan state in the session.
3. **Queue and Ask User.** During a streamed response, send a second message and verify queue order
   and eventual delivery. In another turn, make the local model stub emit an Ask User event, answer
   in the UI, and prove the same runtime turn continues with that answer.
4. **Fork and session isolation.** Copy/fork a conversation; verify the new session has the intended
   transcript, an independent identity and independent subsequent messages. Switch between source
   and destination and verify each restore correctly.
5. **Progress and embedded browser together.** Emit environment/progress/todo events from the real
   local runtime path and assert the right panel updates for the correct session. While a response
   and todo update are active, operate the embedded browser's supported controls against a local HTTP
   origin; assert tab, page and progress states are correct and independent.
6. **Errors and recovery.** Exercise model/runtime refusal or failure, cancellation, reconnect,
   retry and session switching; assert visible recovery behavior and no duplicate, missing or
   cross-session messages.

The model stub controls only deterministic model output and timing. Browser input, WebUI transport,
service dispatch, runtime adapter, persisted harness session, stream persistence and rendering remain
the real application path for integration claims. Browser-local preferences and drafts are a
separate persistence contract. Every journey records its exact stub seam.

## Existing test audit and disposition policy

Create a complete, run-specific manifest from all registered Vitest files, all Playwright specs,
conditional or environment-gated suites, and package scripts. Keep the detailed manifest and
disposition ledger in the task's external review record, outside the repository; the user-requested
strategy plan in `.plan/` is the sole in-repository planning artifact. For every existing test record:

1. What behavior/contract it claims to protect.
2. Which user operation or state branch it covers.
3. Which code path actually runs (and which source files or owners it bypasses).
4. What is real versus synthetic, mocked, stubbed, skipped or environment-gated.
5. Whether assertions would fail if the behavior were broken; include observable outcomes rather than
   selector/test-id presence or fixture self-confirmation.
6. Whether it is registered in the correct gate and executes in CI as intended.
7. Its disposition: **keep**, **correct drift**, **strengthen**, **consolidate**, **replace**, or
   **retire**. Include evidence and replacement pointer for any consolidation/replacement/retirement.

Do not remove tests merely because new end-to-end coverage overlaps them: focused tests continue to
provide faster localization. Detect fake greens by running controlled break-link/mutation checks on
critical user-input → request, stream → transcript, persisted session → refresh, runtime todo → panel,
and browser control → browser service edges. Include a negative-control assertion so a mutation is
shown to fail the intended test. Prefer narrow, reviewable mutations and restore only the mutation
after recording results.

## Implementation phases

### Phase 0 — Baseline and inventory

- Record branch, working tree and available gate artifacts without disturbing unrelated changes.
- Inventory source surfaces, registered tests, browser specs, integration harnesses, scripts and CI
  gates; trace test calls to real boundaries.
- Run `pnpm verify` once at baseline on Linux and classify each gate as in-scope or unrelated
  before changes. It builds the client and includes `pnpm test:webui` and `pnpm test:webui-browser`;
  use those results as the baseline instead of rerunning the same gates separately. On non-Linux
  hosts, `pnpm verify` skips the browser gate, so run `pnpm test:webui-browser` once there if a local
  baseline is needed and label its platform. Save raw outcomes outside the repository in the task
  record. Reproduce individual failures narrowly before classifying them. A historical
  `.last-run.json` or an environment-skipped case is not current passing/failing execution evidence.
- Classify each full-verify gate before changes. This gives final verification a comparison point
  for repository-wide gates outside the two WebUI suites. Do not widen product fixes to unrelated
  failures without evidence they were caused by this work.
- Deliver the complete coverage manifest and existing-test disposition ledger in the external task
  record before adding or changing scenarios.

### Phase 1 — Critical real-path workflows

- Strengthen or add integration journeys for composer-to-Agent reply, reasoning and transcript
  order, refresh/resume, `/plan`, `/goal`, reference and attachment delivery, in-flight queue,
  Ask User continuation, fork/session isolation and todo/environment panel updates.
- Use the production WebUI client/service/runtime and persisted harness-session path with isolated
  temporary state. Browser-local preferences and drafts remain a separate persistence contract.
- Run critical journeys in the browser where actual user input/rendering is part of the behavior;
  keep a service-only integration claim separate from a UI end-to-end claim.

### Phase 2 — Surface and interaction completion

- Expand the operation/state matrix to every user-reachable control across the surface families.
- Add/strengthen built-client Chromium tests for interactions, navigation, empty/loading/error and
  cancellation/recovery branches.
- Verify actual geometry and stable representative screenshots for shell, transcript/composer,
  rail, settings, progress panel, embedded browser and representative overlays. Commit baselines
  generated in the Linux CI Chromium environment, inventory the binary files, and update a baseline
  only alongside an explained intended visual change. Generate/update with
  `pnpm exec playwright test packages/webui/test/browser --update-snapshots` on Linux matching CI;
  inspect the image diff before accepting it. Keep DOM and geometry assertions independent and use a
  documented pixel tolerance for renderer noise. Linux CI is authoritative for visual baselines; on
  other operating systems report visual comparisons as not run rather than treating cross-platform
  pixel drift as a product regression.
- Retain synthetic fixtures for deterministic client-only cases and label them accurately.

### Phase 3 — Reliability audit and failure repair

- Execute mutation/break-link probes for the critical seams and close fake-green gaps.
- Repair every reproducible product bug, drifted assertion, missing registration, brittle harness
  assumption and reproducible gate failure in scope. Do not weaken expected behavior to obtain green.
- After every file addition, move or deletion, regenerate `release/public-source.json` with
  `node scripts/source-inventory.mjs --write` and run `pnpm check:source`; Vitest additions must also
  be registered in the `webui` group of `test/vitest-suites.json`.
- Build with `pnpm build:webui` before `pnpm test:webui-browser`. Re-run after relevant source,
  fixture or screenshot-baseline changes.
- Re-run affected focused suites during repair. On Linux, make the final full-suite execution a
  single `pnpm verify` run: it includes `pnpm test:webui` and `pnpm test:webui-browser`, and its
  command output is the source for per-suite executed/skip details. Do not run those unchanged full
  suites a second time after verify. On non-Linux, run `pnpm test:webui-browser` once separately
  because verify skips that platform-gated step.
- Report each gate's executed, skipped and environment-blocked cases separately. A skip means the
  corresponding behavior was not proven in that run. Keep external/browser-platform/environment
  failures distinct from product failures and include exact evidence and the remaining boundary.

### Phase 4 — Durable documentation and gate alignment

- Synchronize `docs/verification/gates.md` and `docs/verification/browser-suite.md` with actual test
  tiers, model stub seam, screenshot baselines, suite registration, harness exceptions, skip
  accounting and live/external boundaries. Correct the real-browser bridge spec extension names in
  the docs if the source confirms the drift.
- Keep the user-requested strategy plan in `.plan/`; keep run-specific inventory, test dispositions,
  logs and verification reports outside the repository.
- Before closing the implementation, update this plan's status and acceptance summary so it no longer
  says implementation has not started. Retire the completed plan after its durable decisions and
  operational rules are represented by ADR 0023 and the verification docs; regenerate
  `release/public-source.json` and run `pnpm check:source` when the plan file is removed, following
  the repository's plan-retirement convention.
- Reconcile the external test disposition ledger, final surface map, CI gates and ADR 0023 before
  declaring the strategy implemented.

## Gate and test file rules

- Vitest test files are explicitly listed in the `webui` group of `test/vitest-suites.json`; verify
  each intended test is registered and each registered path runs. Every added, moved or removed
  package file must also be reflected in `release/public-source.json`: run
  `node scripts/source-inventory.mjs --write`, then `pnpm check:source`. This includes browser specs,
  screenshot binaries and documentation files.
- Deterministic fixture browser specs import `test` from `packages/webui/test/browser/harness.mjs`
  so the harness's run-id checks apply. Real-browser bridge specs use their own extension/browser
  lifecycle and are exempt from that fixture harness; audit their own server/build identity and
  report skips when the required browser is unavailable. Preserve these existing real-browser specs.
- Do not add jsdom, happy-dom or Testing Library, and do not change the shared `node` Vitest
  environment. Use pure transitions, SSR branch assertions, and real Playwright for behavior SSR
  cannot reach.
- Follow existing verification scripts rather than introducing a parallel gate inventory. Keep
  default deterministic gates separate from slow or environment-dependent gates according to the
  evidence boundary. Report all skips per gate; a skipped test does not count as passing evidence.
- Build with `pnpm build:webui` before `pnpm test:webui-browser`; baselines are committed and
  generated/compared using the Linux CI Chromium environment. Do not accept local cross-platform
  pixel drift as a baseline update without checking the declared CI environment. Use the documented
  baseline update command and inspect the diff; snapshots supplement but never replace observable
  DOM/geometry assertions. Screenshot comparison counts as executed only on Linux; report it as not
  run on other operating systems.
- After source changes, use appropriate typecheck/build/focused gates, then run `pnpm verify` on the
  final inputs before declaring implementation complete, as required by `packages/webui/AGENTS.md`.
  On Linux, its `test:webui` and `test:webui-browser` steps are the final full-suite runs; use their
  command output to record executed, skipped and environment-blocked cases instead of rerunning them.
  On non-Linux, run `pnpm test:webui-browser` once separately because verify skips it. Compare
  repository-wide gates with the Phase 0 baseline: every in-scope gate must pass; unrelated
  pre-existing failures must be identified by gate and reported as such, not attributed to this
  change or silently counted as a pass.

## Acceptance criteria

- Every user-reachable operation and material state branch appears in the source-grounded coverage
  manifest kept in the external task record and has a test at an appropriate evidence layer or an
  explicit, justified limitation.
- All six mandatory journeys prove their expected transitions and final persisted/rendered outcomes.
- Every test in the existing suite has an evidence-backed disposition; valid tests remain, and any
  consolidated/replaced/retired test has equivalent or intentionally superseding coverage recorded.
- Critical connection mutations fail the intended tests, demonstrating that assertions detect a
  broken connection rather than only confirming a fixture's own input.
- The test suite distinguishes built-client browser behavior, real local integration, native local
  behavior and live external service behavior without overstating any result.
- Screenshot baselines cover representative stable layouts, have documented viewport and update
  review rules, and are not used as the sole assertion for dynamic content.
- `pnpm build:webui` and `pnpm check:source` pass, and final `pnpm verify` executes on the final
  inputs. On Linux this final verify includes both full WebUI suites; on other platforms run the
  browser gate separately because verify skips it. All in-scope gates pass after reproducible defects
  are fixed. Compare unrelated full-verify gates with the Phase 0 baseline and report any pre-existing
  or environment-blocked failure by name; do not present it as caused by this work or as a pass.
  Report skips separately; a gate that completes with skips does not prove those skipped behaviors.
- `docs/verification/gates.md`, `docs/verification/browser-suite.md`, ADR 0023 and the test-suite
  registration agree with the implemented system.
- A final plan review confirms no remaining scope drift, contradictory policy or unresolved decision
  blocks implementation.

## Review checklist for MiniMax Code M3.1

Review this plan against the current repository source, `packages/webui/AGENTS.md`, verification docs,
test inventory, root AGENTS instructions and ADR 0023. Check:

- Does it include all source-grounded user-reachable surfaces and all user decisions?
- Does it distinguish synthetic browser behavior, real runtime integration and external/live tests
  precisely?
- Does it preserve valid existing tests and provide a defensible, observable audit for fake greens?
- Does any requirement conflict with the current gate architecture, package policy or file inventory?
- Are dependencies, execution order, evidence, failure handling and acceptance criteria complete?
- Are any decisions still required from the user before implementation can begin?

Return findings with exact plan section and repository evidence. Do not implement. The plan will be
revised and re-reviewed until the reviewer reports no blocking drift, conflict or unresolved decision.
