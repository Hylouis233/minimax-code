# The ten held contracts — dispositions

**Status: decided, and executed by #59 (A3).** The seven `move` dispositions are decided here. **The
operator authorized the two `delete`s on 2026-10-13**, so all ten now carry a disposition that is either
decided or mechanically owned: `transport.ts` stays undecided until Phase 2 records whether the composed
interface is still published, which is that row's design rather than a gap in this document.

§15.4 requires exactly one disposition each — `move`, `keep` or `delete` — and states the common entry
condition: *"(a) §9's amendment enumerates the non-port contracts and assigns each a business or records
a `keep`. (b) §15.1's `lines` column is regenerated. (c) `release/public-source.json` is regenerated for
every added, moved or deleted file."* This document is (a). (b) and (c) are executed at the tickets named
below, not here.

`client/contracts/` holds 18 files: the 8 ports, the 10 held contracts, and `value-readers.ts`. §9
enumerates only the 8 ports, which is why these ten had no home. `shared/contracts/` is untouched — §9's
first half says so — and gets no row.

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
| `review-view.ts` | 34 | 2 | **move** | `client/contracts/transcript/review-view.ts` | declares `WebuiDiffState` and `WebuiDiffStateAction`, the state and action types of `reduceWebuiDiffState`. §5.6 files that reducer under `application/transcript/review-state.ts` (§7-stage B4), so the types travel to the same business. §15.4's warning about the `review` collision is answered by §5.6's single owner: `workspace` presents review surfaces and commands the `review` capability, it does not own the state machine |
| `transport.ts` | 34 | 1 | **undecided — blocked on Phase 2** | decide at A4-s2, execute at A4-s5 | it declares `WebuiTransport` itself. Phase 2 records whether that interface is still published once the shell stops forwarding 47 members: `delete` if it is not, `keep` at `client/contracts/` if the phase decides it survives — in which case it needs no row |
| `workspace-view.ts` | 9 | **0** | **delete — authorized 2026-10-13** | — | **zero declarations and zero importers.** It holds a comment only: the runtime-layer plan reserved it as a target-layout placeholder, and the comment records that every workspace and review view moved to `shared/contracts/`, so no browser-local workspace type remains |
| `execution-state.ts` | 9 | **0** | **delete — authorized 2026-10-13** | — | same shape: **zero declarations, zero importers**, and the comment states the active-turn trio is a shared wire DTO with no browser-local copy left to declare |

**Seven `move`, one Phase 2 decision, two `delete`.** The two zero-declaration files are
`delete` rather than `keep` for the reason §15.4 itself gives: a `keep` means the file stays
in the delivered tree and the layout claims a home it does not fill. The new
`client/contracts/<business>/` tree is the declared home for a future browser-local view, so the
placeholder has nothing left to stand for. Both were verified to have no importer in `src/client` or
`test`; the only textual matches are a CSS class and a component's own class string.

## What this changes downstream

| consumer | what it must now carry |
| --- | --- |
| **#59 (A3)** | the enumeration below §9's eight ports. §9's re-file covers 18 files, not 8; the declaration-side result S12 is measured over must be stated over all of them. |
| **#97 (C20)** | the execution carrier. C20 owns `client/contracts/` and currently carries one row (`value-readers.ts`); the seven `move` files become its rows, once A3 has decided the targets above. |
| **#61 (A4-s2)** | the `transport.ts` decision: record whether `WebuiTransport` is still published after the shell stops forwarding its members. |
| **#64 (A4-s5)** | the execution of that decision, including the `delete` if Phase 2 lands that way. |
| **#122 (E3)** | S12 re-measured by declaration. Row counts re-derived once the dispositions land — §15.1's opening arithmetic (144 rows / 127 of 137 files) is the *pre*-disposition figure and is recomputed, never adjusted. |

**A `delete` removes a file and a source-inventory entry**, so `release/public-source.json` is
regenerated in the same change that acts on it. `#59` does so for the seven `move`s and the two
authorized deletions; nothing in this document touched the tree by itself.

## Exit condition

§15.4's entry condition (a) is met: each of the ten carries exactly one disposition — seven decided and
executed here, one owned by a phase that carries its input, and two authorized by the operator and
executed by `#59`. §15.4's (b) and (c) belong to the tickets above, which is where the regenerated
figures become reviewable.
