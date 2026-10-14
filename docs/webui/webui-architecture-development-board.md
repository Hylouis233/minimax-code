# WebUI architecture development board

Status: published and ready for development.

Authority: [Plan](PLAN-webui-architecture-review.md), [Spec](SPEC-webui-architecture-redesign.md), [decisions](webui-architecture-decisions.md). This board is generated from `webui-architecture-tickets.json`; keep the manifest, issue bodies and native edges consistent.

## Counting and readiness rules

- Implementation tickets: **21**, counted by distinct ordinal T01–T21; the parent specification issue is excluded.
- Produced targets: **60**, counted by distinct target identifiers; each has exactly one producing carrier.
- User stories: **38**, counted by the Spec numbered list; coverage is a union, not an exclusive partition of stories.
- Work packages: **10**, W0–W9; a package may have several tickets and is not counted as a ticket.
- Large source files: **12**, files under the pinned product source tree with suffix `.ts`, `.tsx`, `.js` or `.css` and more than 800 newline-separated lines; assets/HTML excluded.
- All issues carry `ready-for-agent`; a fully specified blocked issue is not executable until its native open blockers close.
- Current initial frontier: **T01 only**. All tickets are open/unimplemented. After T01, application lifecycle, loopback operation bindings and runtime quota boundaries can proceed independently.

The operator instructed decomposition of the converged Plan. This is the approval basis for publishing the tickets; no fresh reviewer endorsement is substituted for operator authority. This preparation does not dispatch agents to implement the tickets.

## Ticket order, genuine blockers and deliverables

| Ticket | Title / issue | Blocked by | What it delivers | Source work |
| --- | --- | --- | --- | --- |
| T01 | [Establish WebUI migration conformance and role-aware prefactoring gates](https://github.com/mcode-webui/minimax-code/issues/127) | None | Developers can start the migration with reproducible behavior baselines and checks that recognize the accepted business/role homes without accepting duplicate ownership. | W0, W9; Plan §§1.1, 3 P5, 5.3, 8.1, 9 W0 |
| T02 | [Boot and dispose one explicitly assembled WebUI application](https://github.com/mcode-webui/minimax-code/issues/128) | T01 | Real browser boot and offline fixtures use one dormant assembly with correct selected-session unread hydration, one ingress and explicit cleanup. | W1; Plan §§3 P1, 4.1, 9 W1 |
| T03 | [Fence keyed queries through one Models owner and model selection path](https://github.com/mcode-webui/minimax-code/issues/129) | T02 | Model catalogues and selection remain correct across slow responses, session/provider changes and invalidation, with one business owner consumed by model presentation. | W4, W6; Plan §§3 P3, 3 P4, 4.5, 5.2 models, 6 ModelPicker |
| T04 | [Run headless turn delivery with retained scopes and coherent home adoption](https://github.com/mcode-webui/minimax-code/issues/130) | T02 | Send, attach, retry and stop work through the application's conversation API even when the initiating React surface changes or disappears. | W2; Plan §§4.2, 4.3, 4.6, 8.1, 9 W2 |
| T05 | [Commit and reconcile goals and interactions through permanent application routes](https://github.com/mcode-webui/minimax-code/issues/131) | T03, T04 | Recognized session facts and matching permission/questionnaire/goal operations update the right owners without requiring a mounted Composer. | W3, W6; Plan §§3 P2, 4.3, 4.4, 5.2 interactions, 5.2 goal, 5.5 |
| T06 | [Unify canonical history, context reads and transcript live handoff](https://github.com/mcode-webui/minimax-code/issues/132) | T03, T04, T05 | History pagination, live/settled display, context usage and feedback remain coherent through one canonical history interface without duplicate messages or conflicting readers. | W2, W4, W6; Plan §§2.2, 4.2, 4.5, 5.2 transcript, 6 SessionTranscript |
| T07 | [Own session catalogue, rail overlays and lifecycle commands in Sessions](https://github.com/mcode-webui/minimax-code/issues/133) | T04, T05, T06 | Session rail, archived settings and import/export entry surfaces use one Sessions owner whose successful mutations update every relevant view and purge deleted state coherently. | W4, W6; Plan §§5.2 sessions, 5.4, 6 SessionRail, 8.1 |
| T08 | [Serve plugin management and Composer catalogues through typed Plugins ownership](https://github.com/mcode-webui/minimax-code/issues/134) | T03 | Marketplace, installed plugins, skills, MCP and agent forms plus Composer catalogue readers use typed named intents and independent correct resource queries. | W4, W6; Plan §§2.5, 4.5, 5.2 plugins, 6 PluginCatalogue |
| T09 | [Make browser account status and login follow one Account lifetime](https://github.com/mcode-webui/minimax-code/issues/135) | T03 | Account login, status, check-in, sign-out and Composer credential-status readers agree across account/session switches while polling and stale callbacks clean up correctly. | W4, W6; Plan §§4.1, 4.5, 5.2 account, 8.1 |
| T10 | [Own turn changesets and workspace snapshots through distinct Review APIs](https://github.com/mcode-webui/minimax-code/issues/136) | T03, T06 | Transcript diff cards and workspace review share authoritative query/mutation ownership while turn changeset and working-tree snapshot identities stay distinct. | W5, W6; Plan §§4.5, 5.2 review, 6 workspace-queries, 8.1 |
| T11 | [Own workspace files, environment and panel use cases beyond React mounting](https://github.com/mcode-webui/minimax-code/issues/137) | T04, T10 | File/tree/environment/Git/canvas/preview/directory-browser behavior stays correct across workspace/tab switches through application owners and stable panel state. | W5, W6; Plan §§4.4, 4.5, 5.2 workspace, 6 workspace-queries, 8.1 |
| T12 | [Own permission preferences and compose settings pages from their actual businesses](https://github.com/mcode-webui/minimax-code/issues/138) | T03, T07, T09 | Instructions, memory, profile, permission preferences, providers, account and archived-session setting surfaces invoke the correct public business commands and coherent read models. | W4, W6; Plan §§5.2 settings, 5.3, 8.1 |
| T13 | [Drive Composer submission, queue and editor through composed business owners](https://github.com/mcode-webui/minimax-code/issues/139) | T03, T04, T05, T06, T07, T08, T09, T12 | Ordinary sends, enqueues, commands, goals, attachments and mention/skill menus use one composed Composer workflow while all accepted field transitions and keyboard behavior remain. | W4, W6; Plan §§5.2 composer, 5.5, 6 WebuiComposer, 8.1 |
| T14 | [Bind loopback operations without redundant service forwarding](https://github.com/mcode-webui/minimax-code/issues/140) | T01 | Clients still retrieve data and stream execution through the authenticated loopback server, with runtime methods bound once and semantic adapters retained. | W7; Plan §§3 P6, 4.6, 6 bind-handlers, 7 D10, 9 W7 |
| T15 | [Separate service-owned terminal processes from browser delivery and xterm attachments](https://github.com/mcode-webui/minimax-code/issues/141) | T11, T14 | Terminal creation/input/resize/watch and explicit disposal remain usable while hiding or closing a presentation attachment leaves the service-owned process intact. | W5, W6; Plan §§2.5, 4.6, 5.2 terminal, 8.1, 9 W5 |
| T16 | [Modernize archive parsing behind preserved workspace preview and extraction policy](https://github.com/mcode-webui/minimax-code/issues/142) | T01, T11 | Supported workspace archive listing/extraction uses a mature parser adapter while preserving path, expansion, truncation and write-safety contracts visible to the user. | W8; Plan §§3 P7, 6 workspace-archive, 8.1, 8.2, 9 W8 |
| T17 | [Separate quota requests and projections while retaining one runtime cache owner](https://github.com/mcode-webui/minimax-code/issues/143) | T01 | Quota/check-in/account consumers retain their established signed-in, refresh, failure and degradation outcomes while cloud request and pure payload projection become maintainable seams. | W8; Plan §§6 usage-quota, 8.1, 9 W8 |
| T18 | [Migrate remaining browser IO and generic presentation mechanics to their target homes](https://github.com/mcode-webui/minimax-code/issues/144) | T12, T13, T14, T15, T16, T17 | Completed businesses obtain IO through injected platform adapters and reusable presentation through a generic UI home, with no alternate technical-root homes left for those populations. | W6, W7; Plan §§5.1, 5.3, 6 additional seams, 9 W6 |
| T19 | [Finish the WebUI shell as layout and public business composition](https://github.com/mcode-webui/minimax-code/issues/145) | T02, T07, T08, T09, T11, T12, T13, T15, T18 | The shell displays rail, Composer, settings, catalogue and workspace through public business APIs while owning only layout/visibility/navigation presentation. | W6; Plan §§3 P1, 5.1, 6 WebuiClientFoundationApp, 9 W6 |
| T20 | [Co-locate feature styles while preserving the effective WebUI cascade](https://github.com/mcode-webui/minimax-code/issues/146) | T19 | Styles follow their business or generic shell/UI owner without changing effective layout, responsive behavior or shared design-token authority. | W6; Plan §§6 shell.css, 6 tokens.css, 8.1, 8.2 |
| T21 | [Retire migration forms and verify the complete WebUI architecture contract](https://github.com/mcode-webui/minimax-code/issues/147) | T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20 | Developers can use the complete target architecture with authoritative documentation, no alternate owner homes and verified behavior across declared application, protocol and browser boundaries. | W9; Plan §§5.3, 6, 8, 9 W9, 9.1, 9.2, 10 |

## Target partition: exactly one producer

Counting unit is a produced responsibility, not each file edited. Several carriers may integrate a published API or edit a shared composition file without reproducing its owner.

| Target | Producing carrier |
| --- | --- |
| `baseline-conformance-ledger` | T01 |
| `role-check-expansion` | T01 |
| `command-generator-source-mapping` | T01 |
| `application-assembly-lifecycle` | T02 |
| `unread-assembly-parity` | T02 |
| `opaque-identity-freshness-context` | T02 |
| `request-freshness-primitive` | T03 |
| `models-public-owner` | T03 |
| `model-picker-responsibility-cut` | T03 |
| `conversation-turn-commands` | T04 |
| `session-interest-lease-manager` | T04 |
| `home-adoption-transaction` | T04 |
| `delivery-disposer-registry` | T04 |
| `permanent-domain-event-routing` | T05 |
| `goal-session-owner` | T05 |
| `interaction-session-owner` | T05 |
| `retained-goal-view-reconciliation` | T05 |
| `conversation-history-interface` | T06 |
| `transcript-public-view-and-feedback` | T06 |
| `compatible-context-read-sharing` | T06 |
| `sessions-catalogue-and-overlays` | T07 |
| `session-lifecycle-and-transfer-commands` | T07 |
| `session-rail-responsibility-cut` | T07 |
| `plugins-typed-action-adapters` | T08 |
| `plugins-resource-owners` | T08 |
| `plugin-catalogue-form-cuts` | T08 |
| `composer-plugin-skill-catalogue-api` | T08 |
| `account-browser-owner-and-polling` | T09 |
| `account-presentation-and-status-api` | T09 |
| `turn-review-owner` | T10 |
| `workspace-review-owner` | T10 |
| `cross-family-review-invalidation` | T10 |
| `review-consumer-integration` | T10 |
| `workspace-files-environment-owners` | T11 |
| `workspace-panel-state` | T11 |
| `workspace-canvas-preview-directory-usecases` | T11 |
| `settings-owner-and-business-page-composition` | T12 |
| `settings-permission-preference-and-version-owner` | T12 |
| `composer-submission-and-queue-owner` | T13 |
| `composer-field-transition-controller` | T13 |
| `composer-editor-menu-toolbar-cut` | T13 |
| `network-registry-injection` | T14 |
| `domain-operation-binding-tables` | T14 |
| `semantic-forwarding-preservation` | T14 |
| `terminal-process-port-contract` | T14 |
| `terminal-runtime-service-scope` | T15 |
| `terminal-browser-owner-and-binding` | T15 |
| `archive-parser-conformance-and-adapter` | T16 |
| `archive-policy-and-extraction-workflow` | T16 |
| `runtime-quota-request-projection-boundary` | T17 |
| `platform-wire-domain-adapters` | T18 |
| `platform-browser-storage-file-dom-adapters` | T18 |
| `generic-ui-and-react-binding-mechanics` | T18 |
| `shell-layout-only-composition` | T19 |
| `shell-public-navigation-and-view-reactions` | T19 |
| `feature-css-ownership` | T20 |
| `shared-token-authority-keep-decision` | T20 |
| `migration-contract-retirement` | T21 |
| `final-generated-architecture-docs` | T21 |
| `complete-integration-acceptance-evidence` | T21 |

## Large-file responsibility coverage

| Current source file | Baseline lines | Carrier / partition |
| --- | --- | --- |
| `client/components/composer/WebuiComposer.tsx` | 2460 | T13 |
| `client/components/shell/WebuiClientFoundationApp.tsx` | 1644 | T19 |
| `client/components/sessions/SessionRail.tsx` | 1342 | T07 |
| `client/components/plugins/PluginCatalogue.tsx` | 1208 | T08 |
| `client/components/models/ModelPicker.tsx` | 1126 | T03 |
| `server/operation/bind-handlers.ts` | 1064 | T14 |
| `runtime/workspace-archive.ts` | 974 | T16 |
| `client/application/workspace/workspace-queries.ts` | 828 | T10, T11: review only in T10; files/environment only in T11 |
| `client/components/transcript/SessionTranscript.tsx` | 814 | T06 |
| `client/styles/shell.css` | 6455 | T20 |
| `client/styles/tokens.css` | 846 | T20 |
| `runtime/usage-quota.ts` | 805 | T17 |

## Population and sequencing rules

The mixed workspace query file has two disjoint produced responsibilities: T10 produces review queries, T11 produces files/environment queries. Large-file carrier describes completion of its responsibility cut, not exclusive edits; all producing targets above remain unique. T19 consumes factories/state moved by prior business tickets rather than producing them again. T18 moves only the platform/generic UI residual population.

T01 expands checks and baseline inputs. T02–T17 transfer concrete business/use-case authority and migrate that produced population to its target home. T18 is the remaining mechanical platform/generic UI migration batch; it cannot reclaim feature-owned modules. T19 completes the shell after its consumers moved; T20 moves styles after consumer homes settle. T21 contracts temporary forms only after every producing ticket completes.

The permanent process-event route transfer in T05 is one atomic unit; never run old view registrations and new owner writes in parallel. A temporary compatibility command form may delegate to the new owner but cannot create another owner/store/ingress. Pure moves and changed responsibilities carry different evidence.

## Required inputs already present

- Plan §§4–5: target roles, scope/identity/freshness contracts and public business ledger.
- Plan §5.5: Composer field transitions, including hide/remount, selection, adoption, submit and disposal.
- Decision record: D1–D12, R1/R2, testing frontier and correction ledger C1–C5.
- Spec: 38 user stories, 22 implementation decisions, test boundary and exclusions.
- T01 produces execution baseline fixtures/tool support. T16 performs conformance-based parser selection. These are declared task outputs, not ghost prerequisites asserted to exist now.

## Publication and execution contract

Parent specification: [126](https://github.com/mcode-webui/minimax-code/issues/126).

Authority snapshot: `486dc644838f403a1956786d1e821a5039702bcc` (pushed document branch; product source baseline remains unchanged).

Issues are child issues of the specification and use native blocking edges. Every body retains a readable Source and explicit textual blockers as an auditable mirror. Before dispatch, read the current issue body/dependencies and the cited authority; verify required producing-ticket outputs and do not rely on comments alone to discharge an edge.

No implementation issue is closed or claimed in this preparation. Repository product gates, live behavior and performance remain implementation acceptance, not evidence inferred from publication. Existing command-generator path drift is carried by T01.

## Execution state

Appended after publication; the publication contract and receipt above are unchanged, and the tracker issues remain the source of truth for per-ticket status and evidence. The machine-readable record is `executionState` in `webui-architecture-tickets.json`.

| As of | Branch | Commits | T01 | T02 | T03 | T04 | Frontier |
| --- | --- | --- | --- | --- | --- |
| 2026-10-14 | `feat/webui-t01-conformance-gates` | recorded commit-by-commit in `executionState.commits` (`webui-architecture-tickets.json`); latest `5288d99b` | closed; evidence on [#127](https://github.com/mcode-webui/minimax-code/issues/127) | closed; evidence on [#128](https://github.com/mcode-webui/minimax-code/issues/128) | closed; evidence on [#129](https://github.com/mcode-webui/minimax-code/issues/129) | closed; evidence on [#130](https://github.com/mcode-webui/minimax-code/issues/130) | closed; evidence on [#131](https://github.com/mcode-webui/minimax-code/issues/131) | closed; evidence on [#132](https://github.com/mcode-webui/minimax-code/issues/132) | T12, T17 |

The branch is local: no commit has been pushed. Closed: T01–T07, T09, T10, T11, T14, and now T06 (`566b2c03`) and T08 (`fbfa53e9`) with their behavioural gates run on `2a4036c7`. Moved but not closed, its behavioural gates deferred to T21: T10 (`5288d99b`). Still open with a target-home clause outstanding: T03, T05, T07, T09. Executable dependents: T12 (settings composition, unblocked by T03/T07/T09) and T17 (quota).