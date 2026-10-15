# Decision — WebUI observation architecture (A5)

Status: **decided** by execution under P06 of
[the business-cohesion plan](PLAN-webui-business-cohesion.md). Outcome: **keep the client's
reconciliation approach**. A server snapshot-plus-deltas design is **not** promoted, and one bounded
client defect is specified as a follow-up rather than fixed here.

## What was executed

Two artifacts, both run from the repository root, both outside the repository except this document:

| Artifact | What it does | Result |
| --- | --- | --- |
| `~/…/business-cohesion-20261015/p06/probe-real-host.mts` | Boots the **real** production chain (real assembly, real port, real registry, real `WebuiService` on a loopback socket, real `ws` clients) and inspects the frames a real turn actually produced. Only the external model service is a local stub. | exit 0; `results/real-host.json` |
| `~/…/business-cohesion-20261015/p06/run-traces.mts` | The plan's seven traces (nine scenarios: the terminal-loss row split into one-channel and both-channels, plus one that exercises the repair for the defect found) against an always-online oracle and three designs. Arm A drives the **repository's own** reconciliation functions; frame loss is injected independently on each channel. | exit 0; `results/traces.json` |

```sh
TMPDIR=/tmp/wbc-p06 NODE_OPTIONS=--max-old-space-size=6144 \
  npx tsx --tsconfig tsconfig.standalone.json <artifact>
```

No production operation, public event, feature flag or host API was added. The Arm B prototypes exist
only in the scratch harness.

## Arm A — the client's own policy, as it stands

Arm A is not a re-implementation. The harness drives `decideWebuiSessionStart`,
`claimWebuiLease`, `releaseWebuiSubscription`, `recheckWebuiSubscription`,
`recoverMissedWebuiTurn`, `resolveWebuiSubscriptionRecheck`,
`isWebuiSubscriptionProbeCurrent`, `matchesWebuiTerminalTurn`, `recogniseWebuiStreamPayload`,
`reduceWebuiStreamFrame` and `applyFrameCursor` from `packages/webui/src/client`.

**8 of 9 scenarios converge on the oracle**, with 1–3 authoritative reads per scenario and at most two
retained messages.

## Arm B0 — snapshot plus deltas on what the host offers today

A `getMessages` snapshot and a `watchEvents` subscription, with no invented contract. **1 of 9**
converges — and only in the scenario where it happens to resnapshot after the fact.

## Arm B1 — B0 plus an invented epoch, cursor and update channel

**9 of 9** converge. Every one of those convergences comes from a capability the harness supplies and
the host does not have:

| Invented capability | Evidence that the host lacks it |
| --- | --- |
| a server epoch | the real-host probe found **no** ordering-candidate field on any event frame and none shared with the stream channel |
| a monotonic update cursor | the only cursor on the wire is the stream cursor, which addresses one turn's frame buffer |
| a session-scoped update channel carrying every logical update | the real event channel carried only `session.created`, `session.start`, `session.finish`, `session.title_updated` — **0** frames containing an `agent_message` |

## What the real host actually provides

From `probe-real-host.mts`, on a real turn whose answer really streamed (16 frames on the
`sendMessage` stream, the stub model really served it):

- the wire envelope carries `body`, `kind`, `protocolVersion`, `requestId` and nothing else;
- the event channel carries **no** transcript: the assistant text appears only on the per-turn stream;
- a `getMessages` read taken mid-turn holds 1 message while the oracle ends with 2;
- the stream's `event_id` values are name-derived and non-contiguous
  (`…_pi_turn_start_3`, `…_pi_turn_end_7`, `…_pi_agent_end_8` — 4–6 carry no id at all), so they cannot
  order two updates or distinguish a gap from a step that never had one;
- `getActiveTurn` is the only read that names the running turn, which is what makes any recovery
  possible at all.

A snapshot-plus-deltas client therefore converges to a transcript that is missing the answer: the
consistency obligation fails on the existing host, executed rather than inferred.

## The decision, against the plan's own rules

1. **Correctness and a justified consistency model are prerequisites for promotion.** Arm B1 passes in
   the harness, but its consistency model cannot be justified on this host: the epoch, the cursor and
   the session-scoped update channel do not exist, and adding them is a new host contract, which P06
   forbids implementing. **Promotion fails this rule.**
2. **Keep the client approach if it meets the scenarios with fewer total responsibilities, or the
   server approach cannot prove ordering without a new host contract.** Both halves hold: Arm A meets
   8/9 with eight client-side policies and no new protocol identity; Arm B1 needs a new host contract
   and three new server obligations to reach 9/9.
3. **Promotion is not recommended.** The client policies it would eliminate are named below; the server
   obligations it adds are larger.
4. Not inconclusive: the evidence covers both arms, so no bounded evidence-gathering follow-up is owed.
5. No production rollout is implied. If the host ever gains a session-scoped ordered update stream, the
   comparison should be re-run against it rather than inherited from this document.

### Responsibilities, side by side

| | Arm A (client) | Arm B1 (server, invented) |
| --- | --- | --- |
| Client policies | active-turn probe; generation-fenced lease claim and scoped release; the `session.start` decision; recheck resolution; terminal attribution by turn id; cursor resume and overflow resync; delivery handle registration; stale-completion fence | the same probe is still needed for a turn the client never saw; snapshot/subscription ordering; gap and overflow handling; stale-epoch fence |
| New protocol identities | 0 | 2 (epoch, update cursor) |
| New server persistence | 0 | 1 (the update log) |
| Reads per scenario (measured) | 1–3 `getActiveTurn` | 1 epoch read + 0–1 delta reads |
| Converged | 8/9 | 9/9, only with the invented contract |

## The one identified client defect, and its bounded remediation

**Defect.** When a turn's terminal signal is lost on **both** channels, the lease and the phase stay
`streaming`. The recovery pass cannot repair it: the authoritative read says nothing is running, and
`recoverMissedWebuiTurn` only attaches to a turn that *is* running. The lease is repaired by the
**next** turn's `session.start`, which resolves through `resolveWebuiSubscriptionRecheck` to
`release` — the harness proves both halves (`missing-terminal-event-both-channels` diverges;
`stale-lease-repaired-by-next-start` converges with the branch sequence
`session-start:recheck → release-scoped → attach`).

**Remediation, specified not implemented.** In the recovery pass, when the authoritative read reports
no active turn and this client still holds a lease whose turn is not that one, release the lease and
settle the phase — the same transition the next `session.start` already performs, applied at the point
the client actually looks. It is bounded: one branch in `recoverMissedWebuiTurn`, its own
before/after scenario (the trace above is the failing case), and no change to the wire. It is not
implemented under this plan because it changes a behavioural path (when the phase settles) and P07's
validation matrix owns that decision.

## Limits of this evidence

- The trace comparison runs against a **scripted** host. That is sufficient for deterministic fault
  injection; the host-consistency claims above come from the separate real-host probe, not from it.
- The invented update channel has no loss policy in the harness. A design that adds a third channel has
  to say what happens when that one drops too; that obligation is listed and **not** measured.
- The real-host probe exercised one turn shape (a text answer, no tools, no queue drain) and no
  overflow. Overflow and restart behaviour are covered by the scripted traces only.
- Arm A's retention is bounded by the scenario's message count (at most two). No long-turn or
  high-chunk-rate measurement was taken, so "bounded retained state" is established structurally, not
  under load.
