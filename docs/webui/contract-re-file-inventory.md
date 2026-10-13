# The ten held contracts — dispositions

**Status: decided, and executed by #59 (A3).** The seven `move` dispositions are decided here. **The
operator authorized the two `delete`s on 2026-10-13**, so all ten now carry a disposition that is either
decided or mechanically owned: `transport.ts` is retained at `client/contracts/` as the composition-root
type contract; Phase 2 removes forwarding of the composed value to business components, not this type.

§15.4 requires exactly one disposition each — `move`, `keep` or `delete` — and states the common entry
condition: *"(a) §9's amendment enumerates the non-port contracts and assigns each a business or records
a `keep`. (b) §15.1's `lines` column is regenerated. (c) `release/public-source.json` is regenerated for
every added, moved or deleted file."* This document is (a). (b) and (c) are executed at the tickets named
below, not here.

At the inventory's baseline, `client/contracts/` held 18 files: 8 ports, the 10 contracts below, and
`value-readers.ts`. §9 enumerated only the ports, which is why these ten needed explicit dispositions.
After execution, seven contracts moved, `transport.ts` remains at the composition root, and two placeholders
were deleted. `shared/contracts/` is untouched and gets no row.

## Counting rule

| field | value |
| --- | --- |
| population | the ten `client/contracts/` files §15.4 lists |
| unit | one file = one disposition, one target row |
| baseline | `webui @ 876a48e6`, tracked tree clean |
| method | read each file's declarations, then its importers (`grep -rln` over `src/client` and `test`) |

Line counts and declaration counts are measured, not quoted: `wc -l` and `grep -c "^export "` per file.
§15.4's `line` column reproduces exactly, so its rows are line counts of the file.

## The ten dispositions

| file | lines | exports | disposition | target | why |
| --- | ---: | ---: | --- | --- | --- |
| `stream-state.ts` | 182 | 11 | **move** | `client/contracts/turn/stream-state.ts` | declares the stream state and subscription (`WebuiStreamState`, `WebuiStreamSubscription`, `WebuiStreamMessage`); its importers are `mechanisms/stream-loop.ts`, `mechanisms/stream-lease.ts` and `projection/stream-state.ts`, all `turn`'s. §15.4 warns it is **not** the same-named file under `projection/` |
| `slash-command.ts` | 111 | 13 | **move** | `client/contracts/composer/slash-command.ts` | declares the palette's vocabulary (`SlashComposerMode`, `SlashPaletteSection`, `classifyWebuiSlashCommand`); importers are `projection/composer-state.ts`, `slash-palette.ts`, `SessionComposer.tsx` |
| `transcript-view.ts` | 105 | 6 | **move** | `client/contracts/transcript/transcript-view.ts` | declares the transcript's render shapes (`WebuiTranscriptItem`, `WebuiTranscriptProcessSegment`); importers are `projection/transcript-*` and `components/transcript/*` |
| `message-view.ts` | 89 | 6 | **move** | `client/contracts/transcript/message-view.ts` | declares the message entity, page and loader (`WebuiClientMessage`, `WebuiClientMessagePage`, `WebuiClientMessageLoader`) — §9's "session-port's message half", which §15.2 assigns to `transcript` |
| `model-view.ts` | 85 | 4 | **move** | `client/contracts/models/model-view.ts` | declares the picker's shapes (`WebuiModelPickerEntry`, `WebuiModelPickerDraft`, `WebuiModelProviderGroup`); every importer is on the `models` surface |
| `session-view.ts` | 39 | 5 | **move** | `client/contracts/sessions/session-view.ts` | declares `WebuiClientSession`, `WebuiClientProject`, `WebuiClientSessionTreeNode` — §9's "session-port's session half" |
| `review-view.ts` | 34 | 2 | **move** | `client/contracts/transcript/review-view.ts` | declares `WebuiDiffState` and `WebuiDiffStateAction`, the state and action types of `reduceWebuiDiffState`. The reducer is in `projection/transcript/review-state.ts`, so these browser-local state types stay with the transcript-owned state machine. `workspace` presents review surfaces and commands the `review` capability but does not own this state machine |
| `transport.ts` | 34 | 1 | **keep** | `client/contracts/transport.ts` | it declares the composed `WebuiTransport` interface used at the composition root and by application slice construction; leaf components receive business slices and specific optional props |
| `workspace-view.ts` | 9 | **0** | **delete — authorized 2026-10-13** | — | **zero declarations and zero importers.** It holds a comment only: the runtime-layer plan reserved it as a target-layout placeholder, and the comment records that every workspace and review view moved to `shared/contracts/`, so no browser-local workspace type remains |
| `execution-state.ts` | 9 | **0** | **delete — authorized 2026-10-13** | — | same shape: **zero declarations, zero importers**, and the comment states the active-turn trio is a shared wire DTO with no browser-local copy left to declare |

**Seven `move`, one `keep`, and two `delete`.** The two zero-declaration files are
`delete` rather than `keep` for the reason §15.4 itself gives: a `keep` means the file stays
in the delivered tree and the layout claims a home it does not fill. The new
`client/contracts/<business>/` tree is the declared home for a future browser-local view, so the
placeholder has nothing left to stand for. Both were verified to have no importer in `src/client` or
`test`; the only textual matches are a CSS class and a component's own class string.

## What this changes downstream

| consumer | what it must now carry |
| --- | --- |
| **#59 (A3)** | the enumeration below §9's eight baseline ports. §9's re-file covered the client declaration files beyond those ports; the declaration-side result S12 is measured over the final business port files. |
| **#97 (C20)** | the execution carrier. C20 owns `client/contracts/` and currently carries one row (`value-readers.ts`); the seven `move` files become its rows, once A3 has decided the targets above. |
| **Phase 2** | retained `transport.ts` as a composition-root type while removing generic transport forwarding to business components. |
| **Phase 5** | S12 re-measured by direct top-level capability member: 100 across 13 port files; nested request fields are excluded, and the 29 plugin actions remain separately inventoried. §15.1 now records 155 printed target rows and 151 distinct destinations; the supplemental rows explain included destinations. |

**A `delete` removes a file and a source-inventory entry.** The current `release/public-source.json` was
regenerated for the final moved and added paths.

## Exit condition

§15.4's entry condition (a) is met: each of the ten carries exactly one disposition — seven moves, one
retained composition-root contract, and two deleted placeholders. §15.4's (b) and (c) are reflected in the
final §15.1 line counts and generated source inventory. The source inventory records moved and newly added
files for publication review.
