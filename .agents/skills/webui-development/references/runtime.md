# Loopback, contracts and runtime

Read `packages/webui/docs/runtime/harness-boundary.md`, `boot.md` and `owner-identity.md` as relevant. Source paths below are under `packages/webui/src/`.

## Operation changes

Trace the complete producer/consumer path. The package guide prescribes the declaration sequence:

1. Canonical name and `OperationSpec` row in `shared/operation-names.ts`; shared DTOs in `shared/contracts/<domain>.ts`.
2. Descriptor plus actual body validator in `server/operation/<domain>.ts`. Pin rejection predicate, stable code and exact message when changing validators.
3. Capability binding in `server/operation/bind-handlers.ts`. `binding-mechanism.ts` checks group/method/argument tuple/result mapper. Dedicated `handlers/` remain for stream/terminal/command shapes, response shaping or capability degradation; inspect `DEDICATED_OPERATION_NAMES`.
4. Registration in `server/operation/operations.ts`. Order is observable: append rather than reorder existing entries.
5. Capability in `runtime/port.ts`, adapter in `runtime/harness/`, and affected stubs/fixtures. For browser use, extend feature contract, `client/contracts/transport.ts`, `client/platform/transport.ts`, injected slice and owner command.

Both sides use canonical names, not independent literals. The runtime port references shared DTOs rather than defining them. Type correctness is only one check: prove registration, wiring, caller reachability and real-envelope behavior.

## Capabilities

Read `shared/capability-manifest.ts`, `server/service.ts` (`withRegistryDerivedAvailability`) and `runtime/harness/adapter.ts` (`readHostPrerequisites`). Support comes from registered operations, callable bindings and actual host prerequisites.

`supported`, `absent`, `not-ready` are distinct. Missing manifest on an older handshake means client-side unknown, retaining the unverified attempt path. A complete browser method table proves only protocol knowledge. Permission denial remains a call failure.

## Wire and delivery

`server/operation/operation-dispatch.ts` validates envelopes before trusting identity, rejects non-request frames, honors shutdown, validates bodies and dispatches. Preserve stable capability error codes; uncoded errors become harness errors. Frame identity, payload bytes and order can be compatibility contracts.

Acknowledgement is opt-in. Iterator finalization shares one idempotent gate between abort and normal cleanup so unresolved pulls close without double-return. Client cancellation ends delivery, not host execution.

`client/platform/wire.ts` owns socket/unary/stream mechanics; `transport.ts` maps domain methods to operation names; `event-channel.ts` owns persistent event connection/reconnect. Business interpretation stays with owners.

## Process resources

`server/access-policy.ts` owns loopback Host/Origin/URL-host and upgrade admission; `server/credentials.ts` owns the per-start credential. Retain admission guarantees when diagnosing dev/browser failures.

`runtime/assembly.ts` constructs resources; `runtime/lifecycle.ts` owns startup-failure cleanup and close. Auth, host, mcode-tools broker and external browser provider close in order; all cleanup is attempted and failures reported. Service shutdown stops admission, closes connections and closes harness/resources. Register new process resources with the actual close owner and failure path.

The host declares `webui` identity rather than borrowing `tui`/`cli`. Inspect the policy row and assembly for quarantined startup, permission/questionnaire behavior, auth leases, beta tools and optional Browser Use before modifying them.

For host-event changes, run `pnpm --filter @mavis/webui gen:host-events`. `shared/contracts/host-event-types.generated.ts` must stay fresh; production session-fact decoding handles each catalog fact or records an explicit unhandled rationale. Generation neither changes host producers nor defines WebUI DTOs automatically.

## Scope and dependencies

Read `docs/known-gaps.md` and `open-questions.md` when behavior seems absent. Disabled tabs, beta tools, optional providers and temporarily failed calls differ. Historical schedulers/navigation generators are not current requirements.

Reuse existing dependencies: React/React DOM; marked + KaTeX + selectively registered highlight.js core; xterm/fit for terminal UI; node-pty for processes; ws for loopback; archive adapters' existing libraries. Recheck manifest versions. New browser dependencies need a reviewable reason and bundle assessment; Node dependencies do not become browser-safe through reuse.
