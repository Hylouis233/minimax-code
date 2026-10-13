# WebUI makes temporal ownership explicit across reads, delivery and settlement

**Status:** Accepted target; implementation pending.
**Date:** 2026-10-13.

The current generic query helper fences by request key while writing an independently named result field; distinct keys can both remain current and overwrite one selected answer. View-registered event routes also suppress a goal commit when no session handler exists. Adopt resource-keyed owners or explicitly fenced selected slots, with permanent application-installed domain routes and independent owner incarnations. A result may commit only to its own live identity/generation; an invalidation is repaired only by a result covering its freshness revision.

Session interest consists of selected-view, secondary-consumer, delivery-attempt and command-settlement leases. Navigation releases only its own view lease. Accepted delivery and mutation/invalidation obligations retain their rights until completion, supersession, explicit detach or recorded failure; purge/application disposal revoke browser commit rights. Delivery detach never implicitly aborts host execution. Dormant construction and explicit start/dispose make these lifetimes testable without React; disposed instances cannot restart.

The alternatives were a generic global cache/event bus, view-lifetime controllers and indiscriminate background attachment. They obscure identity or introduce new ordering/replay obligations. Small shared request mechanics plus explicit business policy are sufficient. Keep the existing wire topology and public stream semantics, including acknowledgement being acceptance rather than a subscription barrier.

The [Plan](../webui/PLAN-webui-architecture-review.md) §§4.1–4.6 and §5.5 specify the exact rules, including different Composer field transitions and review/terminal identities. Network service still receives client requests and returns responses/streams: delete only redundant in-process identity forwarding, retaining validation, optional-capability errors, receiver binding, projections and harness adaptation. [The decision record](../webui/webui-architecture-decisions.md) separates demonstrated offline mechanisms from outstanding integration acceptance.
