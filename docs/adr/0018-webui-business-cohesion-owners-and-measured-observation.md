# WebUI business cohesion: one owner per business, one submission path, one measured observation decision

**Status:** Accepted and implemented on `feat/webui-business-cohesion`.
**Date:** 2026-10-16.

The A1–A4 ownership findings are implemented. A session's creation, adoption and goal submission
decide inside one application-owned use case: all four creation origins (ordinary send, goal, plugin
session, rail) reach it, the shell consumes the committed navigation result instead of deciding it,
and no inline adoption remains. The execution substrate owns its command modules and the submission,
so Composer and Sessions no longer implement execution rules and the peer-factory cycle is retired;
the session binding reads the application's one conversation command set rather than assembling a
second. Where a business needs another's capability it is handed the published narrow contract rather
than reaching into the implementation — the interaction flow drives Turn's published phase intents,
built by the composition that holds the store.

The provider seam carries real shapes. Unary calls derive their request types from `OperationSpec`, so
a misspelled field cannot compile. The five write operations validate their actual bodies at ingress
and return the exact `invalidBody` outcome without invoking the runtime, and consumers read
`configRevision`/`headerNames`. Provider editing is encapsulated in a Models-owned editor that owns
candidate/test/save/discovery identity and pending/error semantics, so adding an editor field no
longer requires parent Settings state or setters, and the Usage page's source-tab reset/draft split is
preserved rather than replaced.

A5 is decided by execution, not by reading: [the observation decision](../webui/DECISION-webui-observation.md)
records a nine-scenario comparison against an always-online oracle and a probe of the frames a real
turn produced. **Keep the client's reconciliation approach.** A server snapshot-plus-deltas design
reaches consistency only by adding an epoch, a monotonic cursor and a session-scoped update channel
that this host does not have, and its obligations then exceed the client policies it would eliminate.
The prototype stays a scratch experiment: no production rollout, operation, event or flag is implied.
One bounded client defect is named there — a lease whose terminal was lost on both channels stays
`streaming` until the next turn's start resolves it — with its remediation specified and left to the
plan's validation matrix.

The programme preserves the retained invariants (I01–I09) and states its limits rather than claiming
them closed: `beginNewTask` is still unbound in the shell, the exit's "detached observer" and
per-path delivery-handle cases have no named test, and the real-host probe exercised one turn shape.
[The plan](../webui/PLAN-webui-business-cohesion.md) §7.0 is the authoritative carrier position table
and carries each carrier's commit; the earlier reorganization programme and its evidence remain
intact and are not restated here.
