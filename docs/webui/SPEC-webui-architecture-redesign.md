# Spec — WebUI business ownership and application lifecycle redesign

Status: accepted for development decomposition, 2026-10-13. Product implementation has not started. Source authority: [architecture Plan](PLAN-webui-architecture-review.md), [decision record](webui-architecture-decisions.md), ADR 0016 and ADR 0017. The operator explicitly requested turning the converged Plan into a specification and executable development tasks.

## Problem Statement

Developers cannot reliably find and change one WebUI business without understanding several technical directory trees and a large shell or Composer. Business queries, owner construction and reconciliation still follow presentation mounting, so source-level architecture checks can pass while production assembly differs from fixtures and shared resources have inconsistent freshness rules. Large components reflect these ownership mixtures. A maintainable WebUI needs clear homes and lifetimes while users retain the sessions, turns, interactions, workspace tools and visible behavior they already rely on.

## Solution

Organize each business around its public commands, read models, resource identity and implementation. Assemble owners once through an explicit application lifetime, with one authoritative process-event ingress and permanent domain routes. Keep a bounded conversation substrate for turn delivery and canonical history. Share request mechanics while assigning each resource to one owner; distinguish resource caches from selected slots. Preserve browser-to-loopback communication and process-local harness integration, removing only redundant in-process identity forwarding. Reorganize oversized modules by these boundaries and retain cohesive declarations/tokens where splitting gives no ownership benefit.

## User Stories

1. As a WebUI developer, I want one clear home for a business's contracts, rules and presentation, so that I can make changes without tracing unrelated technical roots.
2. As a WebUI developer, I want documented public business interfaces, so that I can collaborate without importing another business's private implementation.
3. As a WebUI developer, I want a bounded conversation substrate, so that shared turn/history invariants do not swallow goals, providers or workspace policies.
4. As a WebUI user, I want the initial selected session recognized before unread persistence, so that opening a session does not restore an incorrect unread state.
5. As a WebUI user, I want refresh and remount to create one valid application lifetime, so that I do not receive duplicated events or abandoned timers.
6. As a test author, I want production and offline fixtures to use the same assembly, so that fixture success exercises the real wiring shape.
7. As a WebUI user, I want recognized session facts committed while a surface is hidden, so that returning to it displays coherent state.
8. As a WebUI user, I want reconnect to reconcile authoritative state, so that missed process events do not leave the current turn or interactions stale.
9. As a WebUI user, I want inactive sessions marked dirty without attaching every stream, so that background state remains recoverable without unnecessary work.
10. As a WebUI user, I want navigation to release only view interest, so that accepted turns and commands can still settle correctly.
11. As a WebUI user, I want explicit stop distinct from delivery detach, so that hiding a view does not abort harness execution.
12. As a WebUI user, I want superseded stream attempts fenced, so that old delivery cannot overwrite the current turn.
13. As a WebUI user, I want the first home send to adopt one session identity coherently, so that draft, history and stream do not split across sessions.
14. As a WebUI user, I want session deletion to prevent late resurrection, so that deleted sessions and drafts remain removed.
15. As a WebUI user, I want slow reads for an earlier selection rejected at the selected destination, so that the new selection does not display the earlier answer.
16. As a WebUI user, I want invalidation repaired by a sufficiently fresh answer, so that a stale in-flight request does not erase a newer dirty state.
17. As a WebUI developer, I want matching readers to share an owning query, so that catalogue/context data has one freshness policy.
18. As a WebUI user, I want model and provider selection to have one owner, so that Composer and settings agree after changes.
19. As a WebUI user, I want plugin and runtime-skill catalogue readers to use distinct correct identities, so that management and mention menus do not overwrite one another.
20. As a WebUI user, I want catalogue forms and mutation failures to remain recoverable, so that unavailable capabilities are not confused with failed operations.
21. As a WebUI user, I want login, account status, check-in and quota views to follow one browser owner, so that account changes invalidate obsolete answers and polling.
22. As a WebUI user, I want account credentials and leases to remain runtime-owned, so that browser state never becomes a second credential authority.
23. As a WebUI user, I want transcript history and live delivery to hand off once, so that messages are not duplicated or omitted.
24. As a WebUI user, I want older-page and context reads to retain their different meanings, so that deduplication does not corrupt pagination or recovery.
25. As a WebUI user, I want permission and questionnaire responses to settle the matching request, so that a late response cannot resume an unrelated or completed interaction.
26. As a WebUI user, I want goal facts, steering reads and command outcomes to share one fence, so that an old read cannot resurrect a cleared objective.
27. As a WebUI user, I want Composer's fields to keep their established individual transitions, so that goal mode, plan mode, attachments and retry do not change behavior during restructuring.
28. As a WebUI user, I want successful enqueue and direct-send transitions to preserve their existing draft/attachment rules, so that failed commands do not unexpectedly consume input.
29. As a WebUI user, I want turn changeset review and workspace snapshot review to stay distinct, so that revert, reapply and search act on the intended resource.
30. As a WebUI user, I want file, environment, canvas and preview work owned outside React rendering, so that tab and workspace switches reject obsolete results.
31. As a WebUI user, I want terminal processes to survive browser tab/surface changes until explicit process disposal, so that presentation cleanup does not kill my shell.
32. As a WebUI user, I want terminal watch and xterm cleanup to release delivery independently, so that hidden views do not retain active presentation resources.
33. As a WebUI user, I want supported archive preview/extraction to retain safety and truncation behavior, so that parser modernization preserves trustworthy file operations.
34. As a WebUI user, I want instructions, memory, profile and settings pages to invoke their actual business owners, so that a settings surface does not become a second owner of models or sessions.
35. As a WebUI user, I want the loopback server to keep authentication, validation and response/stream delivery, so that removal of redundant forwarding leaves client data access intact.
36. As a WebUI user, I want current copy, layout, keyboard, focus and scrolling preserved, so that internal restructuring does not redesign the interface.
37. As a WebUI developer, I want role, public API and generated-source checks to follow the new homes, so that architecture enforcement detects real violations and stale source mappings.
38. As a reviewer, I want one producing ticket per target with readable authority and explicit blockers, so that no part of the accepted destination is omitted or implemented twice.

## Implementation Decisions

1. One framework-free application assembly constructs dormant owners. Start receives initial selection, hydrates browser storage before ingress, and installs permanent routes; dispose is idempotent. Disposed instances cannot restart.
2. Browser application, loopback network service, WebUI runtime and harness remain distinct execution/responsibility boundaries. Harness calls remain in-process. The network service continues receiving requests and returning responses/streams.
3. Businesses are physically aggregated, with local role boundaries and explicit public APIs. Application composition, conversation substrate, browser IO, shell composition and generic presentation retain separate responsibilities.
4. One application-owned session-record repository supplies narrow owner writers. Conversation does not import the aggregate feature-record type; goal and interaction policies/fences stay independent.
5. Session scope retains selected-view, secondary-consumer, delivery and command-settlement leases. Accepted attempts and invalidation obligations survive navigation until defined settlement; purge/dispose revoke browser commit rights.
6. Every asynchronous commit checks resource identity, owner incarnation and request generation. Reconciliation additionally covers freshness revision; selected destinations additionally check selected identity/generation.
7. Permanent domain routes commit recognized data-bearing events without view registration. Read-required inactive events retain dirty markers; interested resources reconcile through the same selection/reconnect seam. Unknown event compatibility remains explicit.
8. Resource query storage is keyed by all response-affecting inputs and opaque credential/config generations. Selected slots have independent generations. Only equivalent identity/freshness/incarnation reads coalesce.
9. Models, plugins, account and compatible history/context readers use their owning query path. Preserve distinct global/session catalogue, runtime-skill, pagination, recovery and detail identities.
10. Composer controller survives view hiding. Its field transitions follow the accepted matrix: persisted per-slot draft/history, staging carryover, goal-mode reset/reconciliation, explicit plan-mode changes, selected queue mirror, session-gated retry and owner-held mention range.
11. Home adoption and successful delete are application-coordinated transitions that batch relevant notifications and do not expose mixed identities or resurrect purged records.
12. Review publishes separate turn changeset and working-tree snapshot families. Applicable mutations invalidate affected families as part of settlement; presentation expansion/search is not canonical query state.
13. One terminal process manager remains scoped to each WebUI service even when its implementation moves into WebUI runtime. Browser attachment/watch and xterm lifetimes are separate from process disposal.
14. Workspace owns files/environment/tab behavior and composes review/terminal public APIs. Canvas, archive, preview and directory-browser use cases obtain their own identity and outcome policy without transport calls in presentation.
15. Network registry assembly is injected. Remove identity relay only; retain explicit allowlisting, validators, optional-capability errors, method receivers, result projections, deterministic operation order and dedicated stream/terminal/sign-out behavior.
16. Browser transport exposes unary, finite-stream, process-event and terminal-watch lifetimes through adapters. Local cancellation closes delivery resources without invoking host stop. Current topology and wire semantics remain.
17. Mature archive parsers are evaluated and selected within the existing supported format/safety contract. Keep policy/path/budget validation distinct from parsing; dependency/license impact and adversarial conformance are evidence for the selection.
18. Account-quota request/projection internals may separate, retaining one cache/identity owner and existing TTL, force-refresh, signing/auth rejection and accepted degradation.
19. Oversized files split only along accepted owners and coherent UI contracts. Explicit operation tables and shared token authority can remain whole; file length is not a success metric.
20. Role/public-private checks expand before migration, allowing old/new physical homes while forbidding duplicate live owners. Each behavior transfer removes its previous authoritative path atomically. Contract retirement waits for all consumer migrations.
21. The correction ledger already identifies assembly parity, unmounted fact commits, result ownership, retained-goal presentation and stale command-generation mapping. Characterize and correct those invariants under assigned tickets; new product/operation/protocol semantics stay outside scope.
22. Work is partitioned by produced responsibility, not by every file touched. The board's coverage ledger assigns each target one carrier; consuming tickets only integrate published read/command APIs.

## Testing Decisions

The primary seam is the assembled WebUI application's public commands and installed event ingress, with its published read models, outcomes, capability-call traces and actual cleanup. This is the highest shared business seam already established in the Plan. The operator delegated these technical choices; the primary reviewer and Lead check the seam against the accepted requirements without a new user interview.

Use deterministic injected capabilities/storage/channels to schedule stale responses, invalidation and session switches. These establish application behavior only. Assert positive event/frame counts, externally visible results and forbidden stale commits; do not test private implementation layout, mirror production with a second expected implementation, or claim success from empty traces. Existing application event-effect, query, goal fence, turn-substrate, workspace/model workflow and transcript fixtures provide prior art.

Frozen protocol comparisons cover validators, ordered byte frames, call arguments, errors and signals. Real loopback-harness integration covers startup, send/resume, event delivery and shutdown. Built-client browser scenarios cover interactions, keyboard/focus/scroll and effective CSS/screenshots. Native terminal, cloud account and cross-platform acceptance are labeled separately; synthetic paths do not prove those boundaries.

Baseline tests precede responsibility changes. Moved bodies can use AST equivalence; changed ownership needs adversarial public-behavior regression. Every implementation ticket runs the applicable repository-declared gates and records unrun boundaries. The final contract ticket executes the complete applicable verifier on the reviewed committed integration state, without editing the frozen oracle or suppressing a failing gate.

## Out of Scope

- Implementing any business refactor during specification/ticket preparation.
- New WebUI features, redesigned product interaction/reset behavior, new public operations or altered successful wire contracts.
- Replacing the process-local harness with a remote service, CLI execution or ACP integration.
- A global business cache, generic internal event bus, all-session automatic stream attachment or parallel production writers/stores.
- Changing transport multiplexing/topology, slow-consumer semantics or introducing new eviction UX without separate measured scope.
- Splitting cohesive declarations/tokens solely to meet a line count.
- Editing the historical execution record or frozen compatibility oracle to make new behavior appear equivalent.

## Further Notes

The canonical [decision record](webui-architecture-decisions.md) closes D1–D12, R1/R2 and the testing frontier. The [development board](webui-architecture-development-board.md) is a dependency-ordered partition, with one producing carrier per target and explicit counts. Tracker is the configured fork; all issues carry `ready-for-agent`. Blocked issues are fully specified but cannot execute until their native blockers close.

Source baseline is the reviewed clean product revision `5d89bff9c2e25fb79e1278ec276d1fbf17c0882f`; preparation commits add authority artifacts only. The command-surface generator already fails at that baseline because it names a pre-move module. Repair belongs the first prefactoring ticket; documentation readiness is not a claim that product gates pass. Archive selection and integration characterization are assigned executable work, not missing operator decisions.
