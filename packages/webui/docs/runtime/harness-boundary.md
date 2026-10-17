# The harness boundary

`runtime/port.ts` declares `WebuiHarnessPort`: the callable, `AsyncIterable` and cancellation types
plus one method per operation, typed with the DTOs in `shared/contracts/<domain>.ts`. The adapters
under `runtime/harness/` implement it from `WebuiRuntimeHostHandle`; `createHarnessPortFromHost`
derives the port from the handle.

## The roster must agree with the registry

The port's method set is contractually the same as the set of registered operations.
`server/operation/bind-handlers.ts` derives its `Pick` from the port, so a port method added or
removed must reach the registry in the same change. That agreement is enforced by the compiler
rather than by an assertion:

- every port fake must implement every member — `FullPort` in
  `test/unit/webui-host-shape-invariant.test.ts`, `ScriptedHarnessPort` in
  `test/unit/webui-service.test.ts`;
- the binding count is pinned separately (`createBindingEntries(port).size`).

Drop a port member without dropping its binding, or add one without reaching the registry, and
`pnpm typecheck:webui` stops compiling. The current roster is pinned in
`test/unit/webui-operation-binding.test.ts`: **86** bindings, **13** dedicated handlers, **99**
operations. A new operation breaks all three counts, so bump them in the same change — after
checking that the roster really grew.

The thirteen operations that keep a hand-written handler live in `server/operation/handlers/`
(`account`, `commands`, `messages`, `stream`, `terminal`, `workspace`). They are the ones that cannot
be expressed as a single capability call.

## The one cast left in the boot path

`runtime/assembly.ts`'s default factory casts the host it gets back, and the difference it states is
not about the options: the runtime's `cliService` returns its own view types (`SessionPage`,
`GetMessagesResult`, …) while `WebuiRuntimeCliService` declares the WebUI's wire projections of the
same results (`WebuiSessionPage`, `WebuiMessagesResult`, …). Measured, they disagree on 40 members.
Replacing those projections with a derivation plus an explicit runtime→wire conversion is
outstanding work; until it lands, the cast is where the difference is stated instead of being hidden
in a mirror. See [`../known-gaps.md`](../known-gaps.md).

## What the browser can ask for

Every operation has a descriptor in `server/operation/<domain>.ts`, a binding in
`server/operation/bind-handlers.ts`, and an entry in the registry that
`../architecture/layered-model.md` describes. The wire frames they arrive in are described there too.
A capability the host does not offer is not an error: each capability port method is optional, and
`undefined` means "this operation is not wired".
