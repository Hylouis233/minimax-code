# WebUI architecture decision record

Status: accepted for specification and development decomposition, 2026-10-13. Implementation has not started. Authority: [architecture Plan](PLAN-webui-architecture-review.md). The operator delegated architectural grilling to the primary reviewer and Paseo Lead, confirmed behavior preservation and business-first organization, and explicitly requested the decisions, specification and executable tickets. This record closes design questions; implementation investigations below are assigned work, not unanswered operator questions.

## Decision tree and resolved frontier

The tree proceeds from process boundaries to application lifetime, state/resource identity, business ownership, then physical organization and file cuts. A decision lower in the tree must satisfy its settled ancestors. Reviewer identity: Paseo `coding-team-lead`, `codex/gpt-6.1-sol`, agent `7998fd4a-1910-45e2-87aa-4cd951a3382f`. The primary reviewer executed source probes; Lead independently traced source and reviewed the resulting rules. The final architecture review accepted the revised design, not its implementation.

| Decision | Question / counterexample | Resolution | Authority |
| --- | --- | --- | --- |
| D1 | Does business-first placement fix ownership by itself? | No; transfer actual owner construction, reconciliation and query truth before treating placement as complete. | Plan §§3,5; ADR 0016 |
| D2 | Do render-created coordinators necessarily reset fences? | No; current application-held cells survive render. Change lifecycle authority, not a fabricated fence-reset bug. | Plan P1,§7.2 |
| D3 | Does one event channel guarantee facts commit for unmounted sessions? | No; permanent routes replace view registration and optional-callback fallback selection. Data facts commit; inactive read-required resources retain dirty revisions. | Plan P2,§4.4 |
| D4 | Should goals/interactions become conversation policies? | No; one storage substrate with independent feature policy/fences and narrow writers. Aggregate types belong application composition. | Plan §4.2; ADR 0016 |
| D5 | Should every background session attach a stream? | No; explicit interest and outstanding-work leases govern attachment. Cheap record updates do not cause all-session IO. | Plan §4.3 |
| D6 | Does per-key fencing protect an independent singleton destination? | No; choose keyed resource storage or a selected slot with independent identity/generation. Coalescing also matches freshness and owner incarnation. | Plan P3,§4.5; ADR 0017 |
| D7 | Are turn review and workspace review one cache? | No; separate changeset/snapshot families behind public Review APIs and targeted invalidation. | Plan §§4.5,5.2 |
| D8 | Should terminal process lifetime follow tab unmount? | No; WebUI service-scoped process ownership is separate from delivery attachment and xterm lifetime. | Plan §§4.6,5.2 |
| D9 | Is a generic capability-slice hook an ownership/security boundary? | No; slices narrow values but any caller can request another slice. Presentation receives named commands/read models; real network security remains. | Plan P5,§5.3 |
| D10 | Can service forwarding be deleted wholesale? | No; remove identity relay while preserving network ingress, operation validation, optional errors, receiver binding, result projections and host adaptation. | Plan P6,§4.6 |
| D11 | Should Composer live fields all have one reset policy? | No; application-owned active controller, disposable view attachment and field-specific transitions. | Plan §5.5 |
| D12 | Should every file above 800 lines split? | No; cuts follow independent responsibilities and lifetimes. Cohesive declaration/token authorities may remain. | Plan §6 |

## Review corrections that are now part of the authority

**R1 — Composer scope:** rejected the blanket claim that staging/modes are view-mount state or all carry across selection. The canonical transition table in Plan §5.5 distinguishes goal reset/reconciliation, plan commands, staging carryover, selected queue mirror, persisted draft/history and session-gated retry. Hiding the view does not destroy the application-owned controller.

**R2 — outstanding obligations:** navigation releases only selected-view interest. Delivery and accepted mutation/invalidation settlement retain separate leases. Purge/disposal revoke commit rights; owner recreation cannot reset fences while eligible work remains. The four-lease contract is Plan §4.3.

**Startup:** pass initial selection to unread hydration before its first persistence write. Construct dormant owners, install routes, then start ingress. A disposed instance cannot restart; fresh lifecycles have fresh epochs.

**Query repair:** a pre-invalidation request cannot clear a later dirty revision. Structured resource keys cover response-affecting parameters and opaque credential/config generations; selected-slot identity is an additional check. History must become a keyed multi-reader seam, not merely a moved singleton.

**Review/terminal/service:** keep review identities distinct, include affected invalidation in command settlement, keep terminal manager per WebUI service resource scope, and preserve semantic adapters when removing service forwarding. The browser still requests and receives data through the loopback server; no direct browser-to-harness connection is introduced.

## Testing frontier: settled expectation

The highest reusable business seam is the **assembled WebUI application's public commands and installed event ingress**, observing published read models, outcomes, IO traces and cleanup. Use injected deterministic capabilities/storage/channel at this seam for adversarial scheduling; they prove application behavior only. Complement it with frozen wire/call/error/signal comparisons, real loopback-harness paths, and the built-client browser interactions/screenshots for network and visible compatibility. This follows the operator's already-delegated technical decision authority and Plan §9.1, rather than creating another architecture interview.

Tests assert external outcomes, not internal factory count alone or a second expected implementation. Count emitted events/frames as well as comparing them. Code moves use AST equivalence where applicable; new ownership rules require their actual failure scenario and public-behavior regression. Offline success never substitutes for cloud, native terminal or cross-platform acceptance.

## Existing behavior corrections already within the accepted destination

This is the W0 correction ledger. It replaces the vague future operator-approved-list checkpoint. It does not authorize new product features or changing successful documented behavior.

| Correction | Established evidence | Required invariant | Implementation carrier |
| --- | --- | --- | --- |
| C1 | Production root omits unread storage injected by fallback assembly. Source evidence only for the assembled browser path. | Same assembly inputs and selected-session hydration/persistence rules for real boot and fixtures. | T02 |
| C2 | Direct-module probe: registry supplies `setGoal`, suppresses fallback, then drops an unregistered-session compatibility event. | Recognized facts commit through live owners regardless of view registration; integration checks emitter coverage and timing. | T05 |
| C3 | Direct-module probe: distinct query keys can overwrite one result field out of order. | Resource identity equals storage identity, or selected slot checks selection identity/generation. | T03 |
| C4 | Goal selection effect clears canonical goal while resetting view mode; source already distinguishes owner state and input mode. | Preserve banner/loading/reset presentation without destroying retained owner truth; characterize the exact transient difference and test it. | T05, with T13 consuming the published result |
| C5 | Current and pinned generator source both reference the old turn-capability home; command-surface check fails ENOENT. | Restore tool/source mapping without altering published commands or the frozen protocol oracle. | T01 |

A newly discovered violation of these established invariants is characterized and corrected under its assigned ticket, with evidence. A change to a successful product contract, new capability or public protocol semantics is outside this board and requires a separate scope decision; only that affected extension waits. No such unanswered product question currently blocks decomposition.

## Implementation choices with owners, not open design questions

Archive parser selection belongs T16: evaluate mature implementations against the preserved format/safety contract, document the chosen library and dependency/license impact, and integrate only a conforming adapter. Slow-consumer topology/flow-control changes and new eviction policies are outside this migration; T21 measures/reports risks without inventing a replacement protocol or retention UX. T01 records the baseline and measurable gates; exact filenames and private helper granularity are implementation choices within the Plan's fixed homes.

The development-seam review accepted the assembled application seam and identified concrete carrier inputs rather than reopening architecture. T02 produces opaque identity/freshness context and real owner reconciliation adapters. T12 owns Settings permission-preference commands and existing runtime-version reads; T09 owns credential/API-key/OAuth status, including reads formerly hosted by Settings. T13 Composer depends on their public commands. T14 produces the terminal-process port and uses the current manager; T15 later migrates its implementation, so network binding does not wait for native relocation. T05's permanent routes call real existing application owners until their producing carriers migrate them; absent handlers cannot be replaced with no-op placeholders.

## Decision authority and status

[ADR 0016](../adr/0016-webui-business-first-modules-and-application-owned-lifetimes.md) supersedes ADR 0015's future organization; [ADR 0017](../adr/0017-webui-fences-resource-results-and-separates-delivery-from-execution.md) records temporal ownership. `CONTEXT.md` remains the single project glossary. The specification describes accepted outcomes; the development board partitions work and its native blocking edges. None of these artifacts says that implementation gates already pass.
