# WebUI groups code by business and gives application work an explicit lifetime

**Status:** Accepted target; implementation pending. The role and public/private import checks now judge every home (see Consequences); the residual old-home population is carried by an explicit, owned exception ledger (`scripts/lib/webui-role-exceptions.json`) until T18, T19 and T21 move it.
**Date:** 2026-10-13.
**Supersedes:** ADR 0015's layer-first physical organization and classification of shell/turn as businesses. **Amends:** ADR 0014's browser-internal placement and binding responsibilities; preserves its browser/loopback/process-local harness boundaries and single-writer semantics.

The reviewed client already has named business directories and one event ingress, yet its shell assembles business owners and Composer installs session reconciliation handlers. Directory grouping therefore does not establish lifecycle ownership. Adopt business-first modules containing their contracts, owners, projections, React bindings and presentation; retain separate application composition, conversation substrate, browser IO and shared presentation. The application constructs dormant owners, hydrates initial selection and persisted state, installs authoritative routes, then starts ingress. Presentations subscribe and submit named commands; they neither create owners nor register business writers.

The operator delegated architectural convergence to the primary reviewer and Paseo Lead, approved business-first organization and then explicitly instructed preparing development specifications and tickets. The [architecture Plan](../webui/PLAN-webui-architecture-review.md), especially §§4–7, is the implementation authority. [The decision record](../webui/webui-architecture-decisions.md) preserves the actual questions, rejected options and R1/R2 resolutions.

## Tradeoffs

Keeping layer-first directories would improve technical-role scanning but leave one business spread across several roots. Moving everything into a single conversation business would simplify access while turning unrelated policies into a central dependency hub. Business-first organization is selected for coherent change context, with a bounded conversation substrate for genuinely shared turn/history invariants. Shared session storage does not grant shared write authority: goal and interaction owners receive narrow writers and retain their own fences.

Review and terminal have distinct internal ownership homes. Review keeps turn changesets and working-tree snapshots separate. Terminal process lifetime belongs to the WebUI service resource scope, while its browser delivery and presentation attachments can end independently. Shell is presentation composition; turn/history coordination is substrate behavior rather than a screen.

## Consequences

Role and public/private import checks recognize both dimensions during migration, and since A-004 they judge every home: whether a role edge is forbidden no longer depends on which of the two directory spellings the file uses. The residual old-home population is enumerated in `scripts/lib/webui-role-exceptions.json` — module pair, owner and exit condition per entry — and an entry whose edge is no longer measured fails the check, so the ledger shrinks as T18, T19 and T21 move the modules instead of standing in for the retirement. Each migration transfers one authoritative write path; no parallel production event writer, complete session store or feature flag is introduced. A pure move is proved separately from an ownership correction. The old ADR's historical implementation remains evidence, not an alternate target. This record authorizes the destination and its decomposition; this preparation task does not implement it.
