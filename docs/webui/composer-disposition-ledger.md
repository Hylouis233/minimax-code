# `composer` disposition ledger (ticket #67, Phase 3 B2)

Every state, ref and effect `SessionComposer.tsx` declares, with one disposition each:
**composer state** (the owner's, so it must leave the component), **local view state**
(§5.5 — open/closed, cursor, hover, focus, a query's own loading/error — stays in the
component), or **a read of another owner** (the value is that business's; this file only
renders it).

The classification test is the plan's own, from §5.6: **the line is survival, not the
widget.** Draft text survives a session switch and a silent home→session creation, so it
is application state; an open menu does not, so it is view state.

Re-derive the inventory (the numbers below are from this commit):

```sh
grep -nE 'const \[[a-zA-Z]+, set[a-zA-Z]+\] = use(State|Reducer)|const [a-zA-Z]+ = useRef' \
  packages/webui/src/client/components/SessionComposer.tsx   # 64 elements
grep -n 'useEffect(' packages/webui/src/client/components/SessionComposer.tsx  # 22 effects
```

The target owner module already exists: `application/composer-store.ts` (draft and input
history are in it today) with `application/composer-workflows.ts`. §5.6's target path
`application/composer/composer-store.ts` is the Phase 4 directory re-file, not a B2 change.

## 1. Composer state — must leave the component

| Element | Today | Disposition | Target |
| --- | --- | --- | --- |
| `attachments` `:786` | **resolved** — `composerSnapshot.staging.attachments` | composer state (§5.6 may-write: attachments) | `composer-store.ts`: `readStaging()` / `setStaging()`, on the same subscription |
| `urlReferences` `:787` | **resolved** — `staging.urlReferences` | composer state (§5.6 may-write: url references) | same |
| `attachmentBusy` `:788` | **resolved** — `staging.busy` | composer state (the upload's flag rides with what it gates) | same |
| `seededTokenRef` `:1484` | **resolved** — `staging.seedToken` | composer state (the seed's dedupe guard) | same |

The two view types moved with the state: `WebuiComposerAttachment` and
`WebuiComposerUrlReference` now live in `projection/composer-interactions.ts`, beside the
attachment limit rule that already belonged to the composer's projection — an application
module may not import component types, and the owner has to hold them.
| `mentionRange` `:797` | **resolved** — `composerSnapshot.mentionRange` | composer state (§5.6 may-write: mention/slash ranges) | `composer-store.ts`: `readMentionRange()` / `setMentionRange()` |
| `slashDraftRef` `:1339` | **reclassified — not state** | see below | stays |
| `slashRangeRef` `:1340` | **reclassified — not state** | see below | stays |

**The two slash refs are a stale-closure workaround, not the composer's state**, and the
ledger corrects itself here rather than moving them for symmetry. What they hold is a mirror
of a *prop* (`draft`) and of a *derivation* (`commandRange = findWebuiSlashRange(draft,
composerCaret)`), and their comment says exactly why they exist: "so the listener always sees
the latest values without re-attaching on every keystroke". §5.6's "mention/slash ranges" is
satisfied by the two real things — `mentionRange` (state, now in the owner) and `commandRange`
(derived, owned by nobody because it is recomputed). Moving a mirror into the owner would
give the same value two homes, which is the shape this programme forbids, so they stay where
they are: local implementation detail of one effect, in §3's category.

That also answers the question left open last round. The refs only disappear if the draft
becomes readable synchronously from the owner — but they should not disappear, because they
are not state to relocate. The draft can keep flowing as a prop, and whether the shell writes
it or invokes an owner command is `shell`'s decision in its own carve, not B2's.
| `queueItems` `:780` | **resolved** — read from the owner as `queueState.items` | composer state (§4.2 names `:780` as the temporary home) | `composer-store.ts`: `readQueue()` / `setQueue()`, on the one subscription |
| `queuePaused` `:781` | **resolved** — `queueState.paused` | same | same |

The queue is **live state**: not persisted, and a single field rather than one per slot.
The reason is what today's code actually does — nothing remounts the composer when the
session changes, so the component's own state survives a session switch, and one live field
reproduces exactly that. Keying it by session would be the behaviour change here: it would
drop the current list on the way out and show a different one on the way back.
`composer-history.test.ts` asserts the half that matters (`does not persist the live state`,
and the snapshot the live state rides).
| `recordedTurn` `:1757` | **resolved** — `composerSnapshot.retry` | composer state (§4.2 field 1: the retry record) | `composer-store.ts`: `readRetry()` / `setRetry()` |
| `recordedTurnRef` `:1756` | **gone** — the second holder was the problem, not the solution | composer state (its guard) | `readRetry()` returns the current value synchronously, so the ref that existed to beat the render no longer has a job |
| `planMode` `:777` | **resolved** — `composerSnapshot.modes.plan` | composer state (§4.2 field 1: input mode flags) | `composer-store.ts`: `readModes()` / `setModes()` |
| `goalMode` `:776` | **resolved** — `composerSnapshot.modes.goal` | composer state (§4.2 field 1: input mode flags) | same |

The retry record's type moved with it: `WebuiRecordedTurn` was exported from the component
and is now in `projection/composer-state.ts` (no other module imported it, so nothing needed
repointing).

## 2. Foreign state in a temporary home — the two fence cells (resolved)

There is a fourth disposition, and the composer holds exactly two of them:

| Element | Today | Why it is foreign | Disposition |
| --- | --- | --- | --- |
| `goalVersionRef` `:736` | was `useRef(0)` here; now `versionCells.goal`, read from the application | §4.2 field 6: the composer **does not own** "the goal entity and its version fence (→ `goal`)" | **resolved:** `createWebuiApplication` creates the pair (`const versionCells = createWebuiVersionCells();`) and the composer reads it through `bindings/version-cells.ts#useWebuiVersionCells`. The fallback in that hook is a per-mount pair for a composer mounted without an application (unit tests, a standalone surface), so the guard keeps working rather than silently comparing against a counter that resets every render |
| `pendingVersionRef` `:737` | was `useRef(0)` here; now `versionCells.pending` | §4.2 field 6: the composer does not own interactions' late-read protection | **resolved:** same construction; `createWebuiVersionCells()` returns one type and two independent objects |

This is the ledger earning its keep: B1 gave each business its own cell and its own policy,
and the *creation* of both cells still sat in the component it was moved out of. The pair is
asserted in `goal-interaction-prohibitions.test.ts` (the application creates it, the composer
holds no `useRef(0)`, and bumping one cell leaves the other at zero) and the independence
cases in `goal-coordinator.test.ts` (`a goal write does not bump the pending cell`, `a pending
reply does not bump the goal cell`) keep the two from merging.

## 3. Local view state — stays in the component (§5.5)

| Element | Kind |
| --- | --- |
| `composerMenu` `:789`, `permissionMenuOpen` `:800`, `workspaceBrowserOpen` `:796` | open/closed |
| `slashPanelBelow` `:1403`, `placement` `:2656` | panel placement |
| `composerCaret` `:810`, `mentionCaretRef` `:805`, `pendingMentionCaretRef` `:806` | caret |
| `mentionIndex` `:798`, `commandIndex` `:1321` | menu cursor |
| `historyBrowse` `:816` | the history browse cursor (the history itself is the store's) |
| `listing` `:337`, `error` `:338`, `loading` `:339`, `manualPath` `:340` | the workspace picker's request result, error, flag and typed path |
| `permissionBusy` `:801`, `permissionUnavailable` `:802` | in-flight flag and the owner's "not wired" state as this view shows it |
| `commandRunning` `:785`, `commandOutput` `:784` | in-flight flag and transient output |
| `goalSubmitting` `:778`, `interactionError` `:779` | in-flight flag / the owner's error as shown |
| `editingGoalDraftRef` `:832` | a focus guard |
| `slashSkillsRequestRef` `:1043`, `slashSkillsLoadedRef` `:1272` | a query's guards |
| `sessionIdRef` `:738` | a stable mirror of the prop |
| `fileInputRef` `:803`, `folderInputRef` `:804`, `textareaRef` `:833`, `composerRegionRef` `:834`, `permissionWrapRef` `:839`, `composerAddWrapRef` `:843`, `workspacePickerRef` `:847` | DOM refs |

Three elements in the file's second component, `ContextUsageIndicator`, are a different
case: §5.6 says that component **leaves the file** for `components/sessions/`, and `enabled`
`:2646` is a *persisted display preference* — settings' concept (§5.6's settings row), which
this file must stop holding. `open` `:2647`, `hovered` `:2648`, `breakdownOpen` `:2653`,
`anchorRef` `:2654`, `surfaceRef` `:2655` are view state of the moved component.

## 4. Reads of another owner — the value is not this business's

| Element | Owner | Available API | Owner module arrives in |
| --- | --- | --- | --- |
| `goalEnabled` `:775` | `goal` | `WebuiGoalCoordinator.isGoalEnabled` — **available** (B1) | landed |
| `models` `:782` | `models` | `useWebuiPortSlice("models").listModels` — available | `application/models/` (B4) |
| `accountStatus` `:783` | `account` | `getAccountStatus` on the account slice — available | `application/account-workflows.ts` (B6) |
| `installedPlugins` `:790` | `plugins` | the plugin port's catalogue member — available | `application/plugins/` (B5) |
| `slashSkills` `:1040` | `plugins` | `listSkills` — available | `application/plugins/` (B5) |
| `workspaceFiles` `:795` | `workspace` | `listWorkspaceFileTree` — available | `application/workspace/` (B3) |
| `permissionMode` `:799` | `settings` | `getPermissionMode` / `setPermissionMode` — available | `application/settings/` (B5) |
| `pluginsLoading` `:791`, `pluginsError` `:792`, `skillsMenuLoading` `:793`, `skillsMenuError` `:794` | the request's own view state | — | stays here |

## 5. The 22 effects

| Line | What it does | Disposition |
| --- | --- | --- |
| `:362` | `browse(initialDir)` | a `workspace` read (`browseWorkspaceDirs`) |
| `:817` | resets the history browse cursor on a session switch | composer state |
| `:850` | `loadMessages` on a session switch | a `transcript` read; §12.7's nine-finding table `:1191` assigns `SessionComposer.tsx:850` to `transcript` (B4) **or** `composer` (B2) — whichever lands first, so it is in scope here |
| `:863` | resets the goal projection when there is no session | `goal` — through the owner |
| `:990` | reads the permission mode | a `settings` read (`getPermissionMode`) |
| `:1012` | loads the plugin catalogue for the menu | a `plugins` read |
| `:1064`, `:1273` | loads the slash skill list | a `plugins` read (`listSkills`) |
| `:1080` | loads the workspace file tree for a mention | a `workspace` read (`listWorkspaceFileTree`) |
| `:1107` | probes whether the goal is enabled | a `goal` read — now the owner's `isGoalEnabled` |
| `:1123` | resets the goal on a session switch, then reads through the owner | `goal` — already owner-based (B1) |
| `:1140` | reads the account status and the model list | `account` + `models` reads |
| `:1322`, `:1325` | clamps the menu cursors | local view state |
| `:1341` | mirrors the draft into the slash range | composer state |
| `:1346`, `:1380`, `:1425` | panel geometry, outside-click, slash-panel keys | local view state |
| `:1485` | seeds the attachment list | composer state |
| `:2697`, `:2708`, `:2724` | `ContextUsageIndicator` measurement and the persisted preference | local view state + a `settings` read; the component leaves the file |

## 6. Resolved and unresolved

**Resolved against an available API:** every read in §4 names one that exists today
(`useWebuiPortSlice`'s slices, the `goal`/`interactions` owners landed in B1, `listSkills`,
`listWorkspaceFileTree`, `getPermissionMode`, `loadMessages`). No row is blocked, so the
ticket is not blocked.

**Not yet in its final home** (this carve's work, in the order the code allows):
1. §1 — **done: eleven elements moved into `composer-store.ts`** (the queue — §4.2's two
   named rows — the attachment staging, the two input modes, the retry record, `mentionRange`),
   one ref deleted rather than moved (`recordedTurnRef`), and the last two reclassified as
   view state with the reason recorded above. Nothing this component owns is left
   component-local.
2. §2 — **done** (the two cells above).
3. §4 — the caches whose owner module does not exist yet lose their local copy in that
   owner's carve; until then the ledger records the API each one resolves against, and the
   composer's `useState` is a cache of a published read rather than a second source.

**One interpretation, stated so it can be corrected:** §5.6's composer may-write cell says
"toolbar state". This ledger reads the *menus'* open/closed flags as §5.5 view state (the
two cells would otherwise contradict each other) and leaves "toolbar state" to mean the
composer's own persisted input-mode flags, which §4.2 field 1 names separately.
