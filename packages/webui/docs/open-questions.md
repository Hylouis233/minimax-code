# Open questions

Decisions deliberately not made. Each entry says what ships today, what a decision would change, and
where to look. These are choices between two defensible answers; picking one without the operator
would be picking for them. Nothing here is a bug report.

## 1. Does the model chip's depth level take a separator before it?

**Status:** open, shipped as 6px of space, deliberately reversible.
`client/features/models/ui/ModelPicker.tsx` renders `<span className="flex min-w-0 items-baseline
gap-[6px]">` and the level span beside it, with no separator token anywhere in `features/models/`.

- **Today:** `M3.1-Flash-Preview  max` — the 6px gap reads as one label at 12px tertiary weight.
- **Alternative:** a middle dot (`·`) draws an explicit line between a model and a setting.
- **How to decide:** render the longest catalogue name at both settings and compare; the gap choice
  was made reversible precisely so this is a one-line change.

## 2. Does a committed thinking/variant choice survive a reload?

**Status:** open, and unmeasured. The data-contract half of the original question is settled: the
`supportedVariants` field is declared on the wire contract (`shared/contracts/models.ts`) and
populated by the server projection (`server/projections/model-provider.ts`), and the thinking
control reads the switch from `mode === 'switchable'` plus `supportedVariants` / `default_value`
(`client/features/models/projection/thinking-control.ts`).

What has not been measured: a grep of `features/composer/application/` and `client/platform/storage.ts`
finds no persistence of the chosen variant or effort, and no test covers reload survival. The browser
therefore behaves as "the choice is per composer session" until someone measures it.

- **What a decision would change:** whether the selection joins the persisted composer state
  (`webui.composer.state.v1`) or stays in memory.
- **How to decide:** one browser pass — pick a non-default level, reload, observe. Record the
  observation here and close the question.

## 3. May this browser surface reach every connected App?

**Status:** open, with no decision recorded anywhere. The mcode-tools broker is what makes the
connector tools work (`known-gaps.md` §1). Enabling it for the WebUI means an agent running in a
loopback-reachable browser page can call every App the user has connected on this machine.

- **What a decision would change:** whether the beta feature stays the only gate, whether a
  per-surface permission is introduced, or whether connector access stays off for this client.
- **Why it is not a mechanical fix:** ADR 0004 binds the service to loopback and validates Host and
  Origin, which protects against other machines, not against a local page or a second local user. The
  same question class was already recorded for Computer Use; the answer there does not transfer
  automatically.

## 4. Is `titleSafetyBypass: true` the WebUI's permanent value?

**Status:** open, carried as today's effective value so that declaring the `webui` identity row did
not silently change title generation (`packages/local-runtime/src/runtime/runtime-owner-policy.ts`,
`webui` row, with the reasoning in the code comment).

- **What a decision would change:** whether WebUI sessions get the title-safety bypass the terminal
  client gets, or fall back to the policy's default. A change here moves user-visible session titles.
- **How to decide:** needs a title-generation comparison across both settings on real sessions; no
  such run is recorded.
