# Plan — WebUI business reorganization

**Status: approved, and in execution.** The operator authorized the whole programme on 2026-10-13 and
required every ticket closed. **§14 is the decision record**: it holds the six decisions this plan
needed, each with how it landed, and nothing in this document is still open.

**Final programme position, at 2026-10-13**

| | |
| --- | --- |
| Phase 0 — the substrate matrix | **complete** 2026-10-12: `phase-0-substrate-matrix.md` accepted; §14.1 item 4 discharged |
| Phase 1 — the substrate and the seam | **complete**: turn intents, writer command groups, and the 18-file browser-contract re-file are in the delivered tree |
| Phase 2 — stop forwarding the composed transport | **complete**: the shell no longer forwards the generic composed value to business components; the composition-root interface remains, and optional capabilities remain represented in business slices |
| Phase 3 — business boundaries | **complete**: the twelve business contracts, per-business checks, and all §16.10 `execute` outcomes are represented in the tree |
| Phase 4 — directory grouping | **complete**: the final pass moved the three omitted presentation modules and six §15.1 owner/projection modules into their recorded homes |
| Phase 4b — declaration re-filing | **complete**: all 59 roster declarations have been filed by their owner layer |
| Phase 5 — finalize | **complete after E2 reconciliation**: ADR 0015, the generated business navigation table, the final extension re-measurement, and the external wrap-up are present; `pnpm check:webui-business-navigation` checks the generated table against the delivered tree and §5.6 contract |
| Execution boundary | **No issue was opened**; work was performed directly on `webui` as the operator directed. No PR or commit is part of this plan's completion claim. |
| Verification base | `webui @ 6a455a2419923550ff6a6b6f8afdb42a7652f66f` plus the final working-tree changes described below |
| Final verification | `build:webui`, `typecheck:webui`, `test:webui` (144 files / 2,337 tests), `check:webui-boundary`, `check:webui-dependency`, `check:source`, and `git diff --check` pass; browser suite is 96/97 with the same explicitly waived baseline failure reproduced at `07fd8885d6c9819e45cd3c9905eb4bff275ca278` |

The revision in the table below is the **design baseline** this plan was written against. It is the
comparison point and is not advanced by execution; delivered revisions are the position table above
and the board.

**Baseline**

| | |
| --- | --- |
| Repository | `/home/fectivnfy/my_data/project/my_project/minimax-code` |
| Branch / HEAD | `webui` @ `13bd8c9dac3ea7a46f84adcdaed0dd98cfe63a62` |
| Working tree | clean |
| Package under change | `packages/webui` only |
| Design authority | this document. The five grilling rounds that produced it are recorded in §13 and their full transcripts sit outside the repo in `~/my_data/project/my_project/minimax-code-webui-work/w2-business-reorg/` |

**What this plan is, and what it is not.** It is a refactor of **how business responsibility is
distributed across the browser client**. It is not a file-size refactor: splitting
`WebuiComposer` (2088 lines) is at most a *consequence* of drawing its boundary, never a goal. A
design that only moves files and breaks up functions is a failure even with every gate green.

**The four outcomes it must deliver**, and how each is measured:

| Outcome | Measurement |
| --- | --- |
| 业务职责更集中 | the declarations living inside 20 component files are re-filed to the layer that owns them — a census of **81**, a work roster of **59** after Phase 3's claims (§7.1); each business's row in §4 states one owner per concept |
| 模块边界更明确 | every business has a written eight-field contract (§4) and the unit is checked against four prohibitions (§5.1) that each name a concrete current violation |
| 相关代码更容易定位 | one business name appears at every layer; `client/**/<business>/` is the complete answer to "where does this business live" (§6) |
| 业务扩展落在清楚且有限的修改范围内 | the twelve extension scenarios of §10 are measured before and after; **S12 is the number that must move** |

---

## 1. Baseline, evidence and the boundaries of what was verified

### 1.1 Read

`packages/webui/AGENTS.md`; `CONTEXT.md` (repo root); `docs/adr/0003`, `0007`, `0013`, `0014`;
`docs/webui/webui-runtime-layer-plan.md` §7.1–§7.7; `scripts/lib/webui-dependency-rules.mjs` and
`webui-dependency-baseline.json`; `scripts/verify.mjs`; `test/vitest-suites.json`;
`test/webui-browser/` (16 Playwright specs); `docs/webui/pending-decisions.md`; the whole of
`packages/webui/src` structurally (AST inventory, per-file export map, per-declaration hook census,
port member census, cross-business import graph).

### 1.2 Verified first-hand at the design baseline

- git branch, HEAD, clean tree;
- 255 source files / 56 016 lines; per-directory census; the largest declarations (§2.2);
- the layer classification of all 258 source files, taken from the gate's own `classifyLayers`;
- **the port census: 8 client capability ports, 216 members — `settings-port` 53, `session-port` 43,
  `execution-port` 37, `workspace-port` 33, `interaction-port` 24, `terminal-port` 15,
  `account-port` 10, `plugin-port` 1** — with `client/contracts/transport.ts` declaring none of its
  own;
- the capability call sites under `client/components/` and the gate's blindness to them (§2.6);
- the 47 distinct `transport?.X` values forwarded by the shell (43 inside the prop region
  `WebuiClientFoundationApp.tsx:1430-1540`);
- `createWebuiSessionStore(options?: { catalog? })` — **the store holds no transport**;
- `attachWebuiTurn`'s contract and guards (`turn-commands.ts:85-105`);
- the composer's sink holding three businesses' writers plus one write to its own state
  (`SessionComposer.tsx:750-769`);
- `session-workflows.ts:53-54,184,388,410` — the `WebuiComposerPurger` edge;
- `SettingsModal.tsx:122-123` — settings as a second entry point for session commands;
- `LeftRail.tsx` — nine storage helpers above a layout component;
- the cross-business import graph: 54 edges, 16 source files, the composer importing eight other businesses;
- `session-catalog.ts:14-18` and `unread.ts:1-24` — the two modules that already name the rail as
  their consumer, which is what makes `sessions` the business name they assume.

### 1.3 Not verified — carried as limits, not as facts

- **No gate was run by the design round except a read-only dependency-graph probe.** The plan's
  acceptance criteria are therefore *specified* and not *demonstrated*.
- **No browser was driven, no server started.** Every interaction claim is from source.
- **`field 7` (substrate needs) is established from a direct import for five rows** — `composer`,
  `transcript`, `goal`, `shell`, `turn`. For the other seven, today's value is *hidden by prop relay*:
  `sessions`, `workspace`, `interactions`, `models`, `plugins`, `settings` and `account` import **no**
  substrate hook at all, because the shell hands them the values as props. Five plus seven is the twelve
  of §4; an earlier draft of this paragraph said "the other eight" and listed seven, omitting `goal`.
  §4 marked the three of those the props could not then decide — `sessions`, `workspace`, `models` —
  `[to derive]`, recorded the other four (`interactions`, `plugins`, `settings`, `account`) as `[verified]`
  or `[verified — corrected]`, and §8 step 0 made the remaining derivation an explicit obligation with a
  stated method. **That derivation was carried out in Phase 0 and its output was accepted on
  2026-10-12**, so all twelve rows now carry a value; the ledger is `phase-0-substrate-matrix.md` and
  §4's legend records the retired marker.
- The handoff document's commit statistics and the §5 comparison experiments of the migration plan
  were **not** re-run.

---

## 2. Why the business axis

### 2.1 The problem, measured

| | |
| --- | --- |
| Largest single functions (AST, not file size) | `WebuiComposer` 2088 lines (`SessionComposer.tsx:565`, 75 hook calls in the declaration, the JSX return alone 717 lines); `PluginManagement` 1469; `WebuiClientFoundationApp` 1333 (81 hook calls, JSX return 422 lines); `WebuiProjectList` 786; `WebuiModelPicker` 628; `WebuiSessionTranscript` 598 |
| Pure business functions living inside component files | **81 declarations across 20 files** — directly-exported, non-component function declarations, of which 59 remain to re-file once Phase 3's claims are subtracted (§7.1): `WorkspaceCanvas.tsx` 23, `SessionRail.tsx` 10, `DiffCard.tsx` 6 (including a state reducer), `LeftRail.tsx` 6 (browser storage IO), `ModelPicker.tsx` 5, `WorkspacePanels.tsx` 5, and 14 more files with 1–4 each |
| Hooks in `client/components/` | 266 `useState`, **0 `useReducer`** |
| Flat directories | `client/components/` 45 files, `client/projection/` 41, `client/application/` 27 |
| The shell's relay | 47 distinct `transport?.X` forwarded as props; 54 cross-business import edges; `WebuiComposer` imports eight other businesses |
| The contract layer's cut | 8 ports, 216 members, one port holding 53 unrelated duties and another holding 1 |
| Directory contradicts declared layer | exactly two files: `client/projection/composer-history.ts`, `client/projection/effect-reducer.ts` (both classified `application`) |

### 2.2 The defect is not size

`WebuiComposer` is 2088 lines because it is **five businesses in one body**. Its own state, by name:
the composer's own input state (`attachments`, `urlReferences`, `attachmentBusy`, `composerCaret`, `historyBrowse`,
`recordedTurn`); four menus (`composerMenu`, `workspaceBrowserOpen`, `permissionMenuOpen`,
`slashPanelOpen`); mention and slash ranges (`mentionRange`, `mentionIndex`, `commandIndex`);
turn/interaction lifecycle (`interactionError`, `queueItems`, `queuePaused`, `goalEnabled`,
`goalMode`, `goalSubmitting`, `planMode`, `permissionMode`); and five independent async-inspection
machines (`models`/`accountStatus`, `installedPlugins`/`plugins*`, `skills*`, `workspaceFiles`,
`commandOutput`). It constructs an application owner inside the component
(`createWebuiInteractionCoordinator`, `:744-773`) and hands it three businesses' writers
(`:750-769`).

So the plan's unit of work is **responsibility, not length**.

### 2.3 Three axes were considered

| Axis | Verdict |
| --- | --- |
| The **harness capability** family (sessions, workspace, models, plugins, account, permissions, goals) | Rejected. It is the axis the *ports* already use, and a capability cut "collapses `session` into one bag containing the catalog, the store, the workflows and the turn commands — five owners with five different lifetimes". It also makes S4 worse: a right-column tab kind would spread into every capability that can open the panel. |
| The **state owner** (§7.6's fifteen rows) | Rejected as a primary axis, kept as a rule. §7.6's owners are finer than either of the other two and have no member for rendering — there is no owner called "the rail". Ownership is the correct axis *inside* `application/`, which is what §7.6 already does. |
| The **business** (a place the user enters and works in) | **Adopted**, applied inside each existing layer directory. |

The discriminating test that decided it: *"I am asked to change what the rail does."* Under the
business axis that is `client/{components,application,projection}/sessions/` — one name, three
directories, plus a stated rule for anything the rail reads from elsewhere. Under the owner axis it is
five directories named after owner types, none of which is the rail.

---

## 3. Criterion C — business, capability, or neither

**A business owns a concept with its own lifecycle and identity that outlives any single business. A
capability is something a business presents.**

| Concept | Own lifecycle? | Surfaced by | Verdict |
| --- | --- | --- | --- |
| `goal` | yes — create / patch / clear, status, version | composer (mode entry), transcript (goal message) | **business** |
| `review` / diff | no — a diff exists iff a turn produced it; only mutations (`revertTurnDiff`/`reapplyTurnDiff`) | workspace tab **and** transcript card | **capability** — needs **one owner and two readers** |
| `terminal` | partially — `createTerminal`/`disposeTerminal` create a *process*, not a reviewable entity; nothing in the client reads terminal state as business state (`projection/terminal-size.ts` is layout metrics) | workspace tab | **capability** |
| `canvas` | no — it mutates a turn's graph | workspace tab | **capability** |
| `turn` | yes — attach → streaming → settled/aborted, with an identity (`turnId` + generation) and a lifetime longer than any business | **appears nowhere** | **business**, §7 = `self`, field 5 = none |

Two rejected criteria, kept here so they are not re-proposed: "has its own artefacts"
(`shared/contracts/review.ts`, a port, a projection, a test file) — fails outright, because
`terminal` has exactly the same set; and "a place the user enters" — fails, because a user enters the
terminal tab and works in it, and enters the review and expands it, so it cannot separate those from
goal mode.

**The bag / nesting test**, written into the plan so the next session can apply it:

> A **bag** is a set of owners that are independent axes, each of which could be owned separately
> without the others. A **nesting** is a set of owners with strictly decreasing scopes, where each
> exists only to protect the one inside it.

`turn` passes the nesting test: the store's stream slice has the session's lifetime, the lease has the
attachment's, the generation fences the loop, the loop drains the turn, and the in-flight read is a
projection rather than an owner. `sessions` passes because its members are the §7.6 owner split of one
record (store writes, catalog reads, workflows command) plus unread, which is the rail's projection of
event-hydration state, not a second owner.

---

## 4. The twelve businesses and their contracts

Eight fields per business, no exceptions:

`1 Owns` · `2 Publishes` · `3 Commands` · `4 Reads` · `5 Where it appears` · `6 Does not own (naming the
owner)` · `7 Substrate needs` (`read-model | in-flight-read | intents | self | none`, enumerated, never
prose) · `8 Failure & recovery` (what it does when the capability is absent or rejects; its
idempotence guard; what it fences on)

`field 7` carries one of four markers, and the criterion is *whether the source can decide the value*, not
how it is reached:

- **[verified]** — today's value is established from the source, either because the business's own
  components import the substrate directly (`composer`, `transcript`, `goal`, `shell`, `turn`) or because
  the props it receives decide the answer (§1.3).
- **[verified — corrected]** — the same, for a value this plan changed during review.
- **[corrected]** — the same, where the plan replaced a value rather than adjusting one.
- **[to derive]** — retired. It marked a value that neither a direct import nor the props decided at the
  time. Phase 0 derived the three rows that carried it (`sessions`, `workspace`, `models`) from the props
  each business receives, and its output was accepted on 2026-10-12. Every row below now carries
  `[verified]`, `[verified — corrected]`, `[corrected]` or `[derived]`.
- **[derived]** — settled in Phase 0 the same way, from the props rather than from imports
  (`phase-0-substrate-matrix.md`).

An earlier draft defined `[verified]` as requiring a direct import, which contradicted §1.3's own allowance
for settling a value from props; it also left `[corrected]` undefined.

### 4.1 `sessions` — appears as the rail

1. **Owns** the session store (the single writable copy), the catalog read model (entities + flat/tree
   query state), session CRUD workflows, session identity (hash, selection, labels), the unread
   controller *as the rail's projection of event-hydration state*, session-scoped usage.
2. **Publishes** `selectWebuiSession` and the catalog selectors, the activity/unread selectors, the ten
   selection/label/grouping functions currently inside `SessionRail.tsx:69-205`.
3. **Commands** create / select / archive / fork / rename / import / export / delete, mark-read, and
   `purgeComposerSlot` (an invocation of `composer`'s command — see §5.2).
4. **Reads** the session and execution capability slices; the **injected** storage adapter (overlay
   preferences are storage, not owned state); the substrate's read model and in-flight read; and
   `composer`'s published `purgeSlot`.
   For the context ring it additionally reads `account`'s published quota result and
   `models`' published selection — **reads only; it writes neither.**
5. **Where it appears** `components/sessions/` — the rail **and the composer's context ring
(`ContextUsageIndicator`), which is this business's context-window reader**. Two declared *other* entry points:
   `shell` invokes `createSession` (`WebuiClientFoundationApp.tsx:1337`, `:1433`) and `settings`
   renders the archived-sessions page (`SettingsModal.tsx:122-123`).
6. **Does not own** `workspaceProjectName` (→ `workspace`; filed here today at `SessionRail.tsx:144`
   and imported across businesses by `SessionComposer.tsx:156`); the composer's draft state (→
   `composer`); the transcript.
7. **[derived: `read-model, in-flight-read, intents`]** — the rail receives everything by prop today,
   which is why the cell could not be read from imports; Phase 0 read the props themselves
   (`SessionRail.tsx:215`, `:1085`) and settled it. The rail is the substrate's primary consumer.
8. **Failure & recovery.** The reconnect recovery policy — 7 files across 5 layers today — collapses
   here: on a missed `session.start`, probe the server, fence on `ownsWebuiStreamGeneration`, guard
   with `if (existing.subscription) return`, and never set sending when the capability is absent. The
   `purgeSlot` call must become a compiled command. What that removes is the **silent** half only:
   `session-workflows.ts:184` records that an absent purger means "drafts outlive the delete (a
   soft-loss)" — the draft that should have been purged stays. Making the call a published command makes
   the absent case uncompilable; any change to *observable* behaviour in a supported scenario is out of
   scope (§14.5).

### 4.2 `composer` — appears as the composer

1. **Owns** draft text, input history, attachments and url references, mention/slash ranges, the
   composer's menus and caret, `recordedTurn` (the retry record), the **queue's state**
   (`queueItems`, `queuePaused` — component-local today, `SessionComposer.tsx:780-781`), and the input
   mode flags (`planMode`, `goalMode`).
2. **Publishes** the composed turn to the substrate's send intent; and the mid-submit state the shell
   needs to gate the new-task action.
3. **Commands** `setDraft`, `recordComposerInput`, attachments, `chooseMention`, `chooseCommand`,
   `submit`, `retryResend`, `refreshQueue`, `removeQueued`.
4. **Reads** the substrate; `models`' published model list; `workspace`'s published directory listing
   and `workspaceProjectName`; `interactions`' published prompt state (it hosts the card);
   `plugins`' skill listing (it hosts the palette); `sessions`' published read model.
5. **Where it appears** `components/composer/`.
6. **Does not own** permission/questionnaire state or replies (→ `interactions`); the goal entity and
   its version fence (→ `goal`); the model catalogue, selection policy and thinking (→ `models`);
   `workspaceProjectName` (→ `workspace`); the queue's *command* (→ `turn`); the directory listing
   (→ `workspace`); the chip (→ whichever business renders it, see 4.7).
7. **[verified]** `read-model, in-flight-read, intents`. (`SessionComposer.tsx:713`
   `useWebuiSessionState(sessionId)` is the read model; the in-flight read and the intents come from
   `useWebuiSessionCommands`.)
8. **Failure & recovery.** A submit with `sendMessage` absent must block rather than throw; the retry
   path fences on `stream.refusal` plus `recordedTurn`; **after step 1 the composer holds no transport
   member at all**, and the three current sites (`:579-580`, `:907`, `:1745`) become the first phase's
   acceptance test.

### 4.3 `transcript` — appears as the conversation

1. **Owns** the transcript view model derived from the substrate (message/turn projection, turn
   grouping), tool/thinking/process rendering state, turn-navigator position, markdown rendering, the
   copy/feedback affordances.
2. **Publishes** the turn view union (`WebuiTurnView`), the transcript group model,
   `filterWebuiPendingUser`.
3. **Commands** load a history page, load older, request a turn review (an invocation of the `review`
   capability), and `loadMessages` is named here as the `session-port` capability it uses.
4. **Reads** the substrate's read model and in-flight read; the `review` capability; `goal`'s
   published projection (the goal message); the session capability slice for history.
5. **Where it appears** `components/transcript/`.
6. **Does not own** the diff state machine (→ `review`'s owner module, extracted from `DiffCard.tsx`'s
   reducer); the goal **entity** (→ `goal`; it reads goal's projection); the composer's live column.
7. **[verified]** `read-model, in-flight-read`.
8. **Failure & recovery.** A page that arrives after a session switch is discarded (request ownership);
   the live→history handover must not double-render, and **after `done` exactly one component renders
   the turn**.

### 4.4 `workspace` — appears as the right column

1. **Owns** the panel display state (open/expanded/tabs/active), the file-tree query state, the
   file-preview content state, the environment/git query state, the canvas layout state, the archive
   listing state, the sub-panel collapse state, the progress derivation, and **the single tab-kind
   registry** (today's three-place enumeration: the union at `workspace-panel-state.ts:3-9`, the label
   map at `WorkspacePanels.tsx:631`, the add-menu at `:655-657`).
2. **Publishes** the panel state, the tab-kind registry, the file tree, the progress view.
3. **Commands** the panel command vocabulary (`dispatchWorkspacePanel`), file read, git mutate (declared
   here, invoked from `settings`' review page), archive extract, canvas apply; and it **invokes** the
   `terminal` capability rather than owning it.
4. **Reads** the workspace capability slice; the substrate's read model and in-flight read (progress derives
   from live stream + history); the `review` capability (its tab).
5. **Where it appears** `components/workspace/`.
6. **Does not own** the `review` state machine (→ `review`'s owner module); the terminal process
   (→ `terminal` capability); and the 23 pure canvas functions move out of `WorkspaceCanvas.tsx` into
   this business's projection — **a filing fix, not a new owner per function**.
7. **[derived: `read-model, in-flight-read`]** — `WorkspacePanels` receives 11 capability props today;
   Phase 0 read them (`WorkspacePanels.tsx:275`) and found zero substrate turn intents reaching this
   business (`attachTurn`, `sendTurn`, `resumeSession`, `loadMessages`: 0 occurrences).
8. **Failure & recovery.** A failed file read renders an error row, not an empty panel; **tab content
   re-keys on session change while the tab set persists**; the canvas preview rolls back on a failed
   apply.

### 4.5 `interactions` — appears as the prompt, the questionnaire, the plan cards

1. **Owns** pending permission and questionnaire state, the replies, the late-read protection, the
   pending version fence, the authoritative re-read. **Loses** the goal duty it holds today
   (`interaction-coordinator.ts:1-10` claims two duties and its constructor takes three).
2. **Publishes** the pending prompt/questionnaire state and the interaction outcome.
3. **Commands** `replacePendingPermissions`, `removePendingPermission`, `applyQuestionnaire`,
   `replyPermission`, `replyQuestionnaire`, `dismissQuestionnaire`.
4. **Reads** the in-flight read; it **requests** a stream-phase transition through the substrate's
   published command — it does not read the phase.
5. **Where it appears** `components/interactions/`.
6. **Does not own** the goal (→ `goal`); the stream-phase transitions it triggers (→ `turn`).
7. **[verified]** `in-flight-read` only — no intents: the sink's four calls are all stream-phase
   writers, and the turn resumes through the substrate's own loop.
8. **Failure & recovery.** A reply that lands after the turn ended must not resurrect it; the fence is
   the **pending** version (not goal's); a failed re-read leaves the prompt as it was.

### 4.6 `goal` — appears as the banner and the composer's goal-mode entry

1. **Owns** the goal entity projection, status and version, the version fence, create/patch/clear, the
   **re-read-after-write rule** (`SessionComposer.tsx:964` — "a late steering re-read cannot resurrect
   the goal the event just replaced"), and the goal↔turn relationship.
2. **Publishes** the goal view and its status, the goal-message projection.
3. **Commands** `createGoal`, `patchGoal`, `clearGoal`, `refreshGoal`, goal-mode entry/exit.
4. **Reads** the goal capability slice; the in-flight read (a patch must know whether it races a live turn).
5. **Where it appears** `components/goal/` (the banner). The composer's goal-mode entry is **a read of goal's
   published state plus a command**, never goal state living in the composer.
6. **Does not own** the composer's input slot; the transcript's goal message (it reads the projection).
7. **[verified]** `in-flight-read` — **not** `intents`: nothing in the goal path calls `attachTurn` or
   `sendTurn` (each has exactly one call site, `SessionComposer.tsx:907` and `:1915`). If the fence is
   defined purely on goal version, `none` would also be defensible; the plan keeps `in-flight-read`.
8. **Failure & recovery.** A patch that disagrees with the current version is reported, not silently
   applied. The fence is the **goal** version — today it sits in a `useRef` declared in the composer
   (`:740`) and merely *passed out* to the coordinator (`:771-772`), while the composer's comment at
   `:735-739` claims the rule; this row closes that. Do not cite `pendingVersionRef` here — that is
   `interactions`' fence.

### 4.7 `models` — appears as the picker and the settings flyout

1. **Owns** the model catalogue query state, selection command state, thinking state, the provider list
   and provider CRUD drafts, the flyout/hover/search UI state, favourites and order.
2. **Publishes** the picker entries and provider groups, the thinking state, the provider list and its
   source badge.
3. **Commands** `listModels`, `selectModel`, provider CRUD (create/update/delete/test/discover),
   thinking commit, `refreshModels`.
4. **Reads** the settings capability slice's models half; the storage adapter (favourites).
5. **Where it appears** `components/models/`.
6. **Does not own** permission mode (→ `settings`); the composer's toolbar placement (→ `composer`);
   per-session usage (→ `sessions`); **the model chip** — the user-visible chip belongs to whichever
   business renders it, and declaring this is what stops the chip becoming an undeclared cross-business
   write.
7. **[derived: `none`]** — the picker contains no `sessionId` and no session hook, and the open half
   of the question was whether it must show the session's active model. **The source settles it, so it
   is a derivation and not a decision**: the picker already shows that model, resolved from `models`'
   own catalogue query (`SessionComposer.tsx:1264` reads `models.find((model) => model.selected)` and
   passes it as `selected`; `:1157` loads the list with `listModels?.({ sessionId })`), so the carve
   adds no cross-business read. See `phase-0-substrate-matrix.md`, "The `models` cell".
8. **Failure & recovery.** A failed selection must not leave the chip committed (a chip write, and
   therefore declared); a failed provider test preserves the draft; the hover timing must not commit a
   thinking choice on a fly-by (`model-picker-hover.ts`).

### 4.8 `plugins` — appears as plugin management

1. **Owns** the **marketplace/browse model** — `plugin-workflows.ts:39-64` holds `area`, `view`,
   `query`, `category`, `selection`, `rows`, `loading`, `revision`, `listing`, `mutating` — plus
   install/uninstall, enable/disable, skill listing and the MCP server listing. Discovery/preview is a
   different lifecycle from enable/disable and is part of this business.
2. **Publishes** the plugin view, the skill listing (`listRuntimeSkills` is read by the composer's
   palette — declare that reader).
3. **Commands** the plugin management operations.
4. **Reads** the plugin capability slice. **The port's shape hides its size**: `client/contracts/plugin-port.ts`
   is **one optional member** (`pluginManagement`), while `WebuiPluginManagementAction`
   (`shared/plugin-management.ts`) is a **29-value union** (`listApps`, `listMarketplacePlugins`,
   `listInstalledPlugins`, `previewGithubPlugin`, `importGithubPlugin`, `installPlugin`,
   `uninstallPlugin`, `enablePlugin`, `disablePlugin`, `listRuntimeSkills`, `listManageableSkills`,
   `setSkillEnabled`, `listMcpServers`, `createMcpServer`, `updateMcpServer`, `deleteMcpServer`,
   `testMcpServer`, `setMcpServerEnabled`, `listAgents`, `createAgent`, `updateAgent`, `deleteAgent`,
   `getAgent`, `readAgentAvatar`, `createSkill`, `deleteSkill`, `installSkill`, `listSkillHub`, …).
   **This is the inverse of `settings-port`'s 53 and the clearest case of a port whose shape hides its
   size**; the re-file must count actions, not port members.
5. **Where it appears** `components/plugins/`.
6. **Does not own** the slash palette's rendering of skills (→ `composer`); there is no plugin
   configuration tab in settings (verified — settings' tabs are desktop, custom-instructions, usage,
   account, archived, coding, worktree).
7. **[verified]** `none`.
8. **Failure & recovery.** A server that fails to start shows its status rather than vanishing; a
   failed install leaves the previous state and reports; **a failed *preview* must leave the browse
   view intact** (today's row only covered start failures).

### 4.9 `settings` — appears as the settings dialog and its tabs

1. **Owns** the dialog's own state (active tab, query, theme, wrap, context-window preference), the
   personalization writes (global instructions, agent memory, user profile, memory settings, the
   memory-manager dialog), the usage settings panel, the coding/review page, the worktree page.
2. **Publishes** the settings query state and the tab definitions.
3. **Commands** `setGlobalInstructions`, `setAgentMemory`, `setUserProfile`, `setMemorySettings`, the
   browser-local preferences; and it **invokes** `sessions`' `removeArchived`/`unarchive`.
4. **Reads** the settings capability slice (the non-models half); `sessions`' published commands and
   `sessions`' read model (the usage panel is session-scoped: `UsageModelSettings.tsx:19` takes
   `sessionId`, passed at `SettingsModal.tsx:123`); `account` for sign-out; the storage adapter.
5. **Where it appears** `components/settings/` — **including the archived-sessions page** (`SettingsModal.tsx:122-123`),
   which is a place that *renders* `sessions`' published state and commands. It is a place where the user works, not owned state.
6. **Does not own** model/provider CRUD (→ `models`); the archived-sessions state (→ `sessions`);
   sign-out policy (→ `account`).
7. **[verified — corrected]** `read-model` (not `none`; this is the same class of error found in
   `composer`'s row).
8. **Failure & recovery.** An unsaved form's state ends with the dialog; a failed save keeps the seed
   and reports; a failed memory delete must not clear the list.

### 4.10 `account` — appears as the user menu, the sign-in dialog and the usage banner

1. **Owns** sign-in phase and login state, **account-level** quota/credits snapshots and formatting,
   the user menu, and the conversation-usage **notice's dismissal flag**. Account-level quota and the
   per-session notice are **split**: the notice's data is `sessions`'; only its dismissal is owned here.
2. **Publishes** account status, the usage quota, the sign-in card phase.
3. **Commands** `signOut`, `beginAccountLogin`/`cancelAccountLogin`, `claimSignin`, `forceRefresh`.
4. **Reads** the account capability slice; `sessions`' read model and published usage
   (`session-port.ts:108 getSessionUsage?`); `settings` (the menu **hosts** the settings dialog — a declared dependency between businesses); `models`' published source for the badge.
5. **Where it appears** `components/account/`.
6. **Does not own** the settings dialog (it hosts it); per-session usage (→ `sessions`).
7. **[verified — corrected]** `read-model` (the conversation-usage notice is session-scoped).
8. **Failure & recovery.** A 401/expired response produces a re-sign-in affordance, never an empty
   panel; a failed quota fetch writes `usage.status = "error"` and the panel renders that error with retry
   (`account-workflows.ts:331-334`, `UserMenu.tsx:684-689`) — **this is the behaviour the round preserves.**
   Keeping a stale value instead is a follow-up outside this round (§14.5).

### 4.11 `shell` — appears as the application frame

1. **Owns** mount, the composition root, the provider graph, routing and selection, the state
   that says which business the main column shows (filed today as `projection/shell-surface.ts`;
   that identifier predates this vocabulary and is renamed in Phase 3 — a filing fix), the error
   boundary, the connection badge, the layout.
2. **Publishes** the application object, the owner contexts, the route.
3. **Commands** none of its own beyond switching business; it **invokes every business's published
   commands**, which is exactly why it is last in the staging order.
4. **Reads** everything — it is the composition root.
5. **Where it appears** `components/shell/`.
6. **Does not own** any business's state; the owners it constructs today (they move to
   `application/create-application.ts`); **the 47 forwarded transport methods — they are deleted, not
   re-filed.**
7. **[corrected]** `none`. Field 7 records *consumption* so the substrate's consumers are enumerable;
   the shell **constructs** the substrate, and construction is not consumption. `turn`'s `self` is the
   only non-consumption value, and it is the substrate itself.
8. **Failure & recovery.** Exactly one `watchEvents` channel per mount — **currently guaranteed by
   where `watchEvents` is called, which this refactor deletes, so it becomes a new invariant to
   preserve rather than an existing one**; disposal on unmount; a cold-start failure renders the
   startup fallback; a component-tree error is caught by the boundary.

### 4.12 `turn` — appears nowhere

1. **Owns** the store's stream/sending slice, the lease and generation, the stream loop, the turn
   commands (attach/send/stop/retry), the in-flight read, the application half of frame reduction, and
   the queue's **command**. It does **not** own the queue's state (→ `composer`).
2. **Publishes** the per-session read model selectors, the in-flight read (`readStream`, the active-turn
   probe), the three intents, and the frame-derived concepts **other** businesses own (the goal
   message, the diff view) — published, not owned.
3. **Commands** the stream-phase group, the turn-lifecycle group, and the turn capability slice
   (send/resume/load/stop) — the regrouping §8 step 1 requires.
4. **Reads** the execution capability slice; the session capability slice for messages. (No storage.)
5. **Where it appears** none.
6. **Does not own** anywhere the user sees — *`turn` appears nowhere*, which is field 5 expressed as a prohibition and what makes it a business under criterion C rather than a business in disguise; the
   interaction replies (→ `interactions`); the goal entity (→ `goal`); the queue's state (→ `composer`).
7. **[verified]** `self` — the substrate reads its own stream slice; no other business's read model.
8. **Failure & recovery** — the strictest row: the generation fence
   (`ownsWebuiStreamGeneration`, `turn-commands.ts:101`); the subscription guard
   (`:89 if (existing.subscription) return`); the **absent-capability guard**
   (`:86 if (!resumeSession) return`) preserved through the capability slice; resume overflow → resync;
   lease release on terminal/error/cancel; and one `watchEvents` channel per application instance.

---

## 5. The rules that must hold: boundaries, invariants, and duty preservation

### 5.1 Four prohibitions, each with a current violation as its evidence

1. **A business may not hold a writer for another business's state.**
   *Violated today* at `SessionComposer.tsx:750-769`: one `sink` holding four interaction writers, four
   stream-phase writers, and a write to the composer's own state, plus two version refs passed in.
   Also violated in reverse at `session-workflows.ts:388,410` (`sessions` reaching into `composer`).
2. **A rule may not be filed under a module that does not own the concept it describes.** Any module
   may *call* a published rule from its owner.
   *Violated today*: `workspaceProjectName` (`SessionRail.tsx:144`) is the workspace business's rule
   filed in the rail and imported across businesses by `SessionComposer.tsx:156`; `DiffCard.tsx`'s
   reducer is the review concept's rule filed in the transcript; the overlay/pins adapter
   (`LeftRail.tsx:4-29`) is storage filed in a component named `LeftRail`.
3. **The set of valid values may be enumerated in exactly one place.**
   *Violated today*: the right-column tab kinds exist as three independent enumerations
   (`workspace-panel-state.ts:3-9`, `WorkspacePanels.tsx:631`, `:655-657`). The type system catches two
   of the three, which is exactly why the defect survived.
4. **A rule shared across businesses gets one owner and every business reads it.**
   *Already correct in one place*, and it is the model for the rest: `application/unread.ts` is "the
   single owner of unread hydration ordering… exactly one implementation that sequences read the stored
   counts, apply them as a floor, then persist", with the contract written down.

**Rejected shape:** "the layer direction holding is enough". It is precisely why the composer can hold
47 `transport?.X` props and call `selectModel` (`:1248`) and `setPermissionMode` (`:1579`) directly —
every one of those is a legal `bindings → transport` edge and a business-rule violation. Layer
direction is a floor beneath these four rules, never a substitute.

### 5.2 The one cross-business write that is legal, and how

`sessions` deletes a session and must also purge the composer's draft slot. Under prohibition 1 this
must be an **invocation of `composer`'s published command** (`purgeSlot`), not an injected optional
object. This is not cosmetic: today's optional dependency fails **silently, and in the direction the source
names** — `session-workflows.ts:184`: "The composer purger; absent means **drafts outlive the delete** (a
soft-loss)", i.e. the draft that should have been purged stays. An earlier draft of this section paraphrased
that as "loses draft text with no error", which reverses it; §14.5 carries the verified wording. A published
command either exists or the call site does not compile.

Rejected alternatives: an event bus (there is none, `event-effects-registry.ts` binds *server* events
into the store and is not a business-to-business bus; and **do not build a bus for one subscriber**),
and recording it as debt (leaves a violation inside the row that documents the boundary, and leaves the
silent path in which the draft that should have been purged survives).

### 5.3 What a business module looks like

`application/unread.ts` is the template: a stated contract in the header, one implementation, an
injected adapter rather than a browser global, a fence on identity, and a named failure rule. Every
business's owner module is written in that shape. A component-facing API is narrower **only** when
an open-ended `updateX((current) => next)` is replaced by a factory for an already-fenced object plus
single-field intents; renaming a setter to a "command" without changing what it authorizes is not a
narrowing and will not be accepted as one.

### 5.4 The invariants, each checkable at a phase boundary

The four prohibitions are review rules (§12.1). This is the separate list the request asks for: what must
still be true when a phase ends, how it is checked, and whether the check is a machine or a reading. A
prose invariant is not an invariant, so every row names its check and its phase.

| # | Invariant | How it is checked | Checked at | Kind |
| --- | --- | --- | --- | --- |
| I1 | The gate verdict is unchanged — `0 violations across 0 pairs`, `0 cycles`, `1 allowance` | `pnpm check:webui-dependency` | every phase | machine |
| I2 | A moved `client/projection/*` module keeps its **basename** (see §6.1) | the move diff against §15.1 | Phase 4 | reading |
| I3 | No component mentions a composed transport. **Today's count is 1**, not 0: `GoalBanner.tsx:24` declares `type WebuiGoalBannerCapabilities = Pick<WebuiTransport, "patchGoal" \| "clearGoal">` — a per-business capability slice for `goal`'s banner, i.e. the legitimate form this carve produces. The invariant is "the count does not grow and every hit is a per-business slice", never "the count is zero" | `grep -rn 'Pick<WebuiTransport' client/components/`, then read each hit | Phase 1 exit, then per business | machine + reading |
| I4 | `attachTurn` is called with one argument | compile — `pnpm typecheck:webui` | Phase 1 exit | machine |
| I5 | `session-workflows.ts` reaches no other business's writer | after `purge` becomes a published command the injected `WebuiComposerPurger` no longer appears in its interface | Phase 3 (`sessions`) | reading |
| I6 | One enumeration per closed set | `grep` the tab-kind literals — three sites today | Phase 3 (`workspace`) | reading |
| I7 | The registered `webui` test group still passes | `pnpm test:webui` | every phase | machine |
| I8 | Exactly one writer per record — the `createWebuiSessionStore` construction sites are enumerated and the count does not grow | `grep` plus review of §4's `Owns` rows | every phase | reading |
| I9 | **The checker holds no business-boundary rule, and none is proposed.** The machine half is the per-business prohibition tests Phase 3 writes; the rest is a reading. A phase exit that reports the invariants met must not be read as "the boundaries are policed" | `pnpm check:webui-dependency` has no such rule, by design; the Phase 3 tests are the machine half | every phase | machine (Phase 3 tests) + reading (the rest) |

I9 is in the list deliberately. Without it a reader infers coverage from I1, which is precisely the
inference §12.1 exists to prevent.

**Not checkable at all, and said so rather than implied:** whether a moved component still *renders*
identically — static checks cannot establish it, and the SSR fixtures plus the registered test files give
partial evidence while neither is a live browser run; whether a business *split* is semantically right —
no machine can tell that `review` is a capability and `goal` is a business, so this stays a human
judgement; and the Desktop comparison of §14.4, which is not checkable from this repository at all.

### 5.5 Runtime and application duty preservation

The chain has the same shape for all twelve businesses. What varies is **which authority sits at each
hop** — so this is one chain with a per-hop authority table, not a per-business variant.

```
component → React binding → business command → application owner → client transport
          → wire operation → server handler → runtime adapter → harness port → harness
```

The order is the repository's own. `bindings` is the layer that **reaches the application**
(`bindings/application-context.tsx:32,83,91` provides and consumes `WebuiApplication`), so it sits *between*
the component and the owner, not after it. The transport has **two halves, and the plan names them
separately because an earlier draft of this section conflated them with a third thing**:
`client/contracts/transport.ts` declares `interface WebuiTransport` — the browser capability contract,
composing the eight ports; `client/infrastructure/transport.ts:91` constructs the value
(`createWebuiTransport`) that reaches the loopback server over the socket; and the **harness port** is a
different boundary on the other side — `CONTEXT.md` defines it as "the set of methods the WebUI runtime may
call on the harness, and the shape the loopback server is allowed to depend on". The harness port therefore
belongs near the **end** of the chain, never between a client owner and a wire operation.

| Hop | Holds authority | Merely reads |
| --- | --- | --- |
| component | **no business state** — only local view state and uncommitted form input, which it owns and which no other layer may hold | its business's published state and commands |
| React binding (`client/bindings/`) | nothing — it converts a writer into a command surface and supplies the application context | owner state |
| business command | that a command is legal, and which of its own state each may write | — |
| application owner | **the single writable copy** of that business's state | the store snapshot |
| client transport — type in `client/contracts/transport.ts` (`:26`), value from `client/infrastructure/transport.ts:91` | nothing — it carries the request to the loopback server. An owner invokes it through a `Pick<>` slice of the transport (`application/session-workflows.ts:73-77,185`) | owner state |
| wire operation | the DTO contract in `shared/contracts/` | — |
| server handler (`server/operation/`) | validation and operation dispatch | the runtime port |
| runtime adapter (`runtime/harness/`) | the harness call | the host contract |
| harness port (`CONTEXT.md`) | the interface the WebUI runtime may call on the harness, and the shape the loopback server may depend on | — |
| harness | the host's own state | — |

The last two rows are what the request's "two states with separate authority" requirement is about, and
they must stay visibly distinct: **no client-side state is authoritative for anything the harness owns.**
`application/unread.ts:1-24` is the only module that states such a rule explicitly today; it is the model
and is cited here as one.

**What "the component holds nothing" does not mean.** Components keep owning their own view state —
open/closed, expanded, hover, focus, and uncommitted form input — which `CONTEXT.md`'s component entry and
the frozen §7.6 ownership table already require. The prohibition is on *business* state and on writes to
another business's owner, never on local UI state; a reading that moved view state out of components would
exceed this programme's boundary, not enforce it.

**What this section does not authorize.** `runtime/`, `server/` and `shared/` keep their present layout
and duties; the carve does not reach into them, and §14.2 states that boundary as a change-type test
rather than a location test. Their relation to the business axis is recorded in §15.2 and §15.3.

### 5.6 The per-business boundary contract

Phase 3 cannot be executed from §4's prose alone, and this is the review's one open finding against the
revision: "write four tests first" and "generate a command surface" still leave the executor to decide which
modules may touch which state, what each business publishes, where each shared rule lives, and how far each
carve reaches. Those are plan-time decisions; the tests only check them. This table is the contract — §15.1
tells the executor which files each row moves.

| Business | Owner module (target path) | May write | Publishes | Shared-rule home | Carve scope |
| --- | --- | --- | --- | --- | --- |
| `sessions` | `application/session-store.ts` (root, per §6.1's tree), `application/sessions/session-catalog.ts` | the session store (the single writable copy), the catalog read model, unread hydration ordering, and the per-session context-window consumption published for the composer's ring — **not** the rail's view state, and **not** the ring's `open`/`breakdownOpen`/`placement`, which are the component's view state | create / select / archive / fork / rename / import / export / delete, mark-read, `contextWindowUsage(sessionId)`, and `purge` as the published form of today's injected `purgeSlot` | **`unread.ts` — the already-correct shared rule (§5.1.4) and the template for the rest** | `purgeSlot` becomes a published command (no injected optional); `workspaceProjectName` leaves `SessionRail.tsx:144` for `workspace`; the two storage-key maps leave `LeftRail.tsx`; **`ContextUsageIndicator` leaves `SessionComposer.tsx` for `components/sessions/`, reads `account`'s quota and `models`' selection without writing either, and owns no state beyond its own view state — it is React/DOM presentation and MUST NOT be filed under `client/projection/`**; **`ArchivedSessionsPage` files under `components/sessions/`** (the second entry point §4.1 already names), and the archived state must **not** be added back into `session-workflows.ts`, which holds two machines |
| `composer` | `application/composer/composer-store.ts`, `composer-workflows.ts` | draft text, input history, attachments and url references, mention/slash ranges, toolbar and queue state | `setDraft`, `recordComposerInput`, attachments, `chooseMention`, `chooseCommand`, the queue commands | — (its own) | The `sink` (`SessionComposer.tsx:750-769`) stops carrying four businesses' writers; the model, goal and interaction duties leave the composer |
| `transcript` | `application/transcript/` (request ownership) + `projection/transcript/` | the transcript view model derived from the substrate | load a history page, load older, request a turn review (an invocation of `review`) | the **`review` state machine** — owner module `projection/transcript/review-state.ts` (§15.1's row for the existing file, and §7's rule: the module is pure, so it files under `projection/`), extracted from `DiffCard.tsx`'s reducer, with two readers (§10 S13). A capability's home is inside the business that presents it | `DiffCard.tsx`'s reducer and its five other pure functions leave the component file |
| `workspace` | `application/workspace/workspace-queries.ts` + `projection/workspace/` | the file-tree query state and the git state. Panel open/expanded/active is the **component's** view state | `dispatchWorkspacePanel`, file read, git mutate (declared) | **the tab-kind enumeration — one registry, replacing the three sites at `workspace-panel-state.ts:3-9`, `WorkspacePanels.tsx:631`, `:655-657`** | the terminal *tab* stays; the terminal *process* does not (it is `workspace`'s capability, confirmed against Desktop in §14.4); **the coding and worktree settings pages are `workspace`' — `ReviewSettingsPage` and `WebuiReviewPanel` file under `components/workspace/`, and their review commands are the `review` capability's, not `settings`'; `WebuiWorktreePanel` likewise** |
| `interactions` | `application/interactions/interaction-coordinator.ts` | pending permission and questionnaire state, the replies, late-read protection | `replacePendingPermissions`, `removePendingPermission`, `applyQuestionnaire` | — (its own) | the coordinator loses the goal duty it absorbed as a third responsibility |
| `goal` | `application/goal/` + `projection/goal/` | the goal entity projection, status and version, **the version fence** | `createGoal`, `patchGoal`, `clearGoal`, `refreshGoal`, goal-mode entry/exit | the fence lives here and only here; it is WebUI-local (§14.4) | `GoalBanner.tsx` and `goal-state.ts` move here, not to `interactions` |
| `models` | `application/models/` + `projection/models/` | the model catalogue query state, selection command state, thinking state, the provider list | `listModels`, `selectModel`, provider CRUD | — (its own) | `ModelPicker.tsx`'s five pure functions leave the component; permission mode stays in `settings`; **provider CRUD (`upsertApiKey` `:146`, `patchProviderModels` and `updateProvider` `:232-233`) is this row's duty, not `settings`' — `UsageModelSettings` renders it and must not own it** |
| `plugins` | `application/plugins/plugin-workflows.ts` | the marketplace/browse model | the plugin management operations | — (its own) | **the action inventory must be enumerated first** — 29 actions behind one port member (§15.3), or this carve under-scopes by an order of magnitude |
| `settings` | `application/settings/settings-workflows.ts` | instruction / memory / profile settings and the persisted display preferences. The dialog's active tab, query and wrap toggle are the **component's** view state | `setGlobalInstructions`, `setAgentMemory`, `setUserProfile`, `setMemorySettings` | — (its own) | the archived-sessions state leaves `settings` for `sessions`; model/provider CRUD is `models`'; **api-key status, model source and Codex OAuth status (`:112-113`) are `settings`'**, and the usage/model-source screen is **three surfaces** (quota, provider form, oauth) whose provider-form commands leave for `models` before the surfaces separate; **the model-source panel belongs to `settings` and files under `components/settings/ModelSourcePanel.tsx`**, while the provider list, draft and CRUD (`:280-380`) are `models`' and file under `components/models/` |
| `account` | `application/account/account-workflows.ts` | sign-in phase and login state, **account-level** quota/credits snapshots and formatting | `signOut`, `beginAccountLogin` / `cancelAccountLogin`, `claimSignin`, `forceRefresh` | — (its own) | per-session usage leaves `account` for `sessions`; the quota panel's `loadUsage` is invoked from `settings/UsageModelSettings.tsx:108` as a **read**, and **the quota panel belongs to `account`** — it files under `components/account/UsageQuotaPanel.tsx`. **What stands from the earlier wording: `UsageModelSettings` as a whole must not become an account surface**, because it also renders `settings`' model source and `models`' provider CRUD. The file is split into three and each part files under the business that owns its commands; the quota failure path keeps today's error-plus-retry behaviour; the stale-marking proposal is **out of scope** (§14.5) |
| `shell` | `client/main.tsx` (composition root), `components/shell/` | mount, the provider graph, routing and selection, **which business the main column shows**, the error boundary, the connection badge, the layout | none of its own beyond switching business; it invokes every business's published commands | — | **last carve.** It stops constructing owners and forwarding 47 transport members (§8 Phase 2); `shell-surface.ts` moves to `projection/shell/` |
| `turn` | `application/turn/` | the store's stream/sending slice, the lease and generation, the stream loop, the turn capability slice | the stream-phase group, the turn-lifecycle group, the turn capability slice | — (it *is* the shared substrate) | Phase 1 widens the intents; `stream-state.ts` and `stream-recovery.ts` move to `projection/turn/` |

**"May write" means state that must outlive the component.** Local view state — open/closed, expanded,
active tab, query text, hover, focus, an input that no other layer needs — stays in the component and is not
listed here (§5.5). **A form input is not automatically local, though:** the composer's draft and input
history *are* application state, because they survive a session switch and a silent home→session creation
(`application/composer-store.ts:1-8`), so they belong to `composer`'s owner as its row says. Listing view
state as a business's write permission would have made this carve look like a UI-state migration; reading
every draft as component-local would make it look like a state migration in the other direction. The line is
survival, not the widget.

**Where this table once left a decision open, each is now closed.** Two cells were not settled by §4, and
neither is carried as an open item: `plugins`' action inventory (§15.3) is enumerated in
`plugin-action-inventory.md`, accepted by the operator on 2026-10-12; and whether `models`' picker must show
the session's active model was settled **by the source rather than by a decision**, because the picker
already shows it from `models`' own catalogue query, so `models`' `field 7` is `none` (§4.7.7, §14.3).

---

### 5.7 `UsageModelSettings` — attribution, and the lifecycle conditions a split must preserve

**"Which owner a surface reads" and "which business a display module belongs to" are different questions**, and the third
surface is where they diverge — which is why §5.6 and §15.1 could disagree without either being obviously wrong.

| surface | which owner it **reads** | which business the display module **belongs to** |
| --- | --- | --- |
| quota panel (`:257-268`; reads `accountState.usage.result` `:94-96`; calls `account.loadUsage()` `:108`) | `account` | **`account`** |
| model-source panel (`:112-113` `loadModelSource`, `loadCodexOAuthStatus`; `:254`, `:272`) | `settings` | **`settings`** |
| provider form (`:112` `loadProviders`; `:146` `upsertApiKey`; `:232-233` `patchProviderModels` + `updateProvider`; `:280-380`) | reads `settings`, but **its commands are `models`'** per §5.6 | **`models`** |

**The lifecycle conditions. Measured today:** `:111-115` is **one effect keyed on `[sessionId]`** that preloads five things
(`loadUsage`, `loadApiKeyStatus`, `loadProviders`, `loadModelSource`, `loadCodexOAuthStatus`); `:116-119` runs a **1 s quota
clock** unconditionally for the component's mounted lifetime; `:120-124` runs a **1 s Codex OAuth poll** gated on
`oauthLoginId && settings`. **So "each surface loads on its own" would change behaviour.**

- **LC-1 — what persists and what still resets.** The three `sourceTab` branches at `:257`, `:272`, `:280` are
  **conditional JSX inside one mounted component**, not three permanently-mounted children. **What persists is the parent:
  its state, its five preloads (`:111-115`, keyed on `[sessionId]`), and its two intervals (`:116-119` quota clock,
  `:120-124` OAuth poll). What resets is every subtree that unmounts.**
  `ProviderPresetPicker` (`:34`) is the worked example and the reason the earlier wording was wrong: it holds its own `open`
  and `query` and exists **only** at `:310`, inside `{!editingProvider ? … : null}` within the custom branch. Its state
  resets whenever that branch unmounts, **today**, and a rule that keeps children mounted cannot change that without
  changing behaviour. **Each new panel module is rendered in exactly the conditional branch it occupies today, so its mount
  and unmount boundary is unchanged. No permanent mounting is introduced, and none is removed.**
- **LC-2 — the preload effect stays in the parent, still keyed on `[sessionId]`** — not on mount order, not per panel.
- **LC-3 — the quota clock and the OAuth poll stay in the parent**, cleared on unmount exactly as today. Their owner is the tab, not a surface.
- **LC-4 — provider drafts are parent state** (`draftName`, `draftBaseUrl`, `draftApiKey`, `draftModelId`, `draftApiFormat`,
  `draftHeaders`, `draftTested`, `skipTest`, `providerPendingDelete`); they travel with the provider panel and stay **preserved
  across sub-tab switches**, which is today's behaviour because the component never unmounts.
- **LC-5 — the same pattern elsewhere.** `PersonalizationSettings`' page shell plays the same role: it composes the three editor files and stays mounted.
- **LC-6 — what changes deliberately: nothing.** The split moves the branch's JSX and its owning declarations into a file;
  it does not change when that JSX is in the tree. **Preserved:** the parent's session-keyed preload; both intervals and their
  cleanup; the provider drafts across sub-tab switches; and **`ProviderPresetPicker`'s `open`/`query` continuing to reset on
  unmount**, which is today's behaviour.
- **LC-6b — refused under P2:** moving the preload into a panel; moving the clock into the quota panel; re-keying the preload
  on the panel instead of `[sessionId]`; mounting a panel lazily; and **any change that makes a currently-resetting subtree
  stop resetting.**
- **LC-7 — `UserMenu`: the shell keeps the close policy and the mutual exclusion.** `:809-813` `loadUsage` sets
  `usageOpen=true, signinOpen=false`; `:815-819` `loadSignin` the reverse. **This crosses the new file boundary** — the shell
  retains both flags and both handlers and passes props. **A split giving each panel its own flag would let both be open at once. Refused.**
- **LC-8 — dismissal stays in the shell**: `:763-764` on menu close; `:873`'s usage-to-login and `:338-339`'s signin-to-usage paths both cross the boundary.
- **LC-9 — panels stay on-demand, not on mount.** `:851` loads signin on hover/focus, `:873` loads usage on click. A panel that
  preloaded on mount would issue requests the user did not ask for; P2 refuses it. The `:586` note about `focusin` reaching the
  usage anchor's `onFocus → loadUsage` must keep working.
- **LC-10 — `SettingsModal` is the opposite case.** Its seven pages render on `active ===`, so **each already mounts and unmounts
  on tab switch today**; the split is a pure file split with no lifecycle change, provided each page keeps its own load-on-mount.

## 6. Target directory structure

### 6.1 Adopted: layer-first, business-second, sub-directory only

The seven top-level `client/*` layer directories keep their names. Inside each, one directory per
business. Nothing new appears at the top level.

```
src/client/
  main.tsx  global.d.ts            composition root and ambient declarations (unchanged paths)
  contracts/
    <business>/<capability>.ts     re-filed from the 8 ports (see §9)
    value-readers.ts               ← from client/value-readers.ts
  bindings/                        unchanged layout (9 files)
  infrastructure/                  unchanged + team-mode.ts, no-project.ts
  mechanisms/                      unchanged (3 files)
  projection/
    common/                        paths, router, geometry/flyout/outside-close/scroll, unread-badge
    sessions/ composer/ transcript/ workspace/ interactions/ goal/ models/ plugins/ settings/
    account/ shell/ turn/
  application/
    create-application.ts  state.ts  session-store.ts  selectors.ts
    sessions/ composer/ transcript/ workspace/ interactions/ goal/ models/ plugins/ settings/
    account/ shell/ turn/
  components/
    sessions/ composer/ transcript/ workspace/ interactions/ goal/ models/ plugins/ settings/
    account/ shell/
    shared/                        icons, ContextMenu, ToggleSwitch (no business)
  runtime/  server/  shared/       unchanged
```

**Adopted, with the reason stated as a trade-off rather than a derivation.** Keeping the seven existing
top-level `client/*` names is a **constraint this plan adds**, not something the architecture forces. The
cost it names: the path to a business's module is one segment longer than a business-first tree would make
it (`client/application/composer/composer-store.ts` against `client/composer/state/…`), and a reader needs
the layer vocabulary to navigate. What it buys: the layer stays readable from the path for every file, so
the dependency rules that key on layer keep one meaning, and the presentation rule's coverage does not have
to be re-established.

**The candidate comparison, on the criteria the request names.** Layer-first and business-first were
compared on business locatability, typical change scope, sharing boundary and migration cost. The first two
favour business-first — a composer change lands in one directory instead of three layers.

**The sharing-boundary criterion is where the two differ, and the plan states the evidence without claiming
more than it shows.** `application/session-catalog.ts:15-17` and `application/unread.ts:1-24` both declare the
rail as their consumer while living outside any rail directory. That establishes **coupling, not a
refutation**: under a business-first tree those modules would sit under `sessions` alongside the rail, so the
question would then be whether `sessions` owns the rail's presentation duties — which criterion C answers
*no*, since the rail is a place the user works and the catalog is a query. An earlier draft presented this as
decisively disqualifying business-first; it does not, and the review was right to say so. The reasons the
plan actually rests on are the two below: the layer staying readable from the path, and the presentation rule
not needing re-proof.

**Migration cost, counted honestly.** A business sub-directory is *free* for the four prefix-classified
layers, because `classifyLayers` resolves those by `startsWith("client/<layer>/")`. It is **not** free for
`client/projection/`, which resolves by **basename** — `PROJECTION_SPLIT[base]` and
`PROJECTION_DOMAIN.has(base)` at `webui-dependency-rules.mjs:435-437`, tables at `:344` and `:359`, fallback
to `view` at `:438`. A sub-directory preserves the basename, so the carve is safe **only while no file is
renamed as it moves**: renaming `projection/goal-state.ts` to `projection/goal/goal.ts` silently moves the
module from `domain` to `view` and changes its allowed edges with no error. §5.4's I2 carries this, and any
rename inside `client/projection/` is a declared step rather than a side effect of a move.

**Why not business-first (`client/<business>/{view,state}`).** A file under a new top-level directory
classifies as `unknown`, whose allowed-edge set is empty (`:162`), so the gate fails en masse until the
classifier is rewritten to find the layer segment anywhere in the path. That repair is roughly fifteen lines
plus the layout fixtures — **and it is affordable, which is exactly why it is not the reason to reject the
candidate.** The reason is the re-proof the presentation rule would need, plus the path-readability gain
stated above — not the sharing-boundary observation, which is withdrawn as a reason.

**The presentation rule is a known workaround, and the plan says so.** `CALL_PRESENTATION_PREFIX =
"client/components/"` is a `startsWith` test carried because the layer set cannot express presentation:
`classifyLayers` maps `client/components/` to `bindings`, the same layer as the bridge, so a layer-only test
would exempt every component along with it — the implementation's own words at `:1594-1599`. It is kept
because it is load-bearing today, and any future layout must re-prove that half of the judgement **for that
layout** rather than inherit it.

**Explicitly not a goal:** fewer lines per file, more files, deeper directories. Flatness is only a
defect where a directory mixes several unrelated businesses; `client/mechanisms/` (3 files),
`client/bindings/` (9) and `client/infrastructure/` (8) stay flat. `client/contracts/` does **not**: it is
re-filed to `contracts/<business>/<capability>.ts` per §9, because its 8 files are cut by capability rather
than by business, and that cut is S12 — the number that must move. An earlier draft of this paragraph listed
`contracts/` among the flat directories, contradicting §6's own tree.

### 6.2 The floor is a row, not a business-free zone

The substrate (`turn`) gets a full contract row with `Where it appears = none`. It is **not** left as unnamed
modules: §7.6 currently owns the store, the lease/generation, the stream phase and the turn commands as
named rows, and replacing those with a structural note would orphan the most delicate concurrency
semantics in the client — the one part with generation fences, lease release and subscription takeover
— leaving it with no owner row and no failure contract.

---

## 7. Responsibility re-filing: the 59-declaration work roster

### 7.1 The measured defect

Twenty component files export **81 directly-exported, non-component function declarations**. That is a
**census**, not the work total: it includes the 21 declarations the Phase 3 tickets claim, so it cannot be
Phase 4b's work. The largest groups:

| File | Pure functions | Nature |
| --- | ---: | --- |
| `WorkspaceCanvas.tsx` | 23 | canvas geometry, zoom, nudge, gesture resolution, mutation builders, id generation, error description, node parsing |
| `SessionRail.tsx` | 10 | session grouping, sorting, labels, query matching, project naming, hash |
| `DiffCard.tsx` | 6 | a **state reducer**, failure description, mutation request building, confirmation |
| `LeftRail.tsx` | 6 | two storage-key maps and `JSON.parse`/`stringify` against `storage` — **browser storage IO in a component file**, which `packages/webui/AGENTS.md` forbids |
| `ModelPicker.tsx` | 5 | provider grouping, row identity, focus reconciliation |
| `WorkspacePanels.tsx` | 5 | file language, unified-diff line projection, todo projection, path predicates |

Each is re-filed to the layer that owns it — `projection/<business>/` for a pure derivation,
`application/<business>/` for a decision, `infrastructure/` for browser IO. **This is a filing fix:
it creates no new owner**, and the row wording in §4.4 says so explicitly so the next reader does not
create an owner per function.

**The work roster is what remains after Phase B's claims.** A read-only AST probe returns 20 files / 81
directly-exported, non-component function declarations; subtract what the carve tickets already carry and
the re-filing has 59 declarations left.

| | count | status |
| --- | ---: | --- |
| Declaration census | **81** | 20 files, directly-exported non-component function declarations |
| Less B's claimed symbols | **−21** | `SessionRail` 9 + 1 (`workspaceProjectName`, which B3 sends to `projection/workspace/`), `LeftRail` 6, `ModelPicker` 5 — each with a named carrier and target |
| Less B4's reducer | **−1** | `reduceWebuiDiffState`, initially claimed at `application/transcript/review-state.ts`; delivered at `projection/transcript/review-state.ts` because it is a pure state transition — subtracted because a symbol claimed anywhere in Phase B is not Phase 4b's work |
| **Work roster requiring re-filing** | **59** | across **12 destination directories** |
| `initialWebuiDiffState` | 1 | a **state seed, not a function** — travels with its implementation |
| Non-type export-list entries | 9 occurrences / **8 function names**, in 3 lists | **forwarded exports whose implementation is already outside `components/`** — recorded, not migrated |
| Constants | — | travel with the implementation needing them |

**Choosing a number between two measurements does not make it right.** An earlier draft of this section
offered "20 files / 82 counting declarations only; 21 / 90 counting re-export lists; the plan says 20 / 88,
inside the bracket" — **deleted**, because bracketing is not a determination. **`20 files` remains a
population statement about the component tree, not a work count.**

### 7.2 Two files whose directory contradicts their layer

**Two** projection modules are classified `application` by the gate while sitting in `projection/`:
`composer-history` and `effect-reducer`. They move to `client/application/<business>/`, keeping their
classification and making the path tell the truth. See §15.1's validity note: `PROJECTION_SPLIT`
(`webui-dependency-rules.mjs:359-371`) carries **four** entries, but two of them are dead.
`transcript-request-ownership` is already filed under `client/application/`, and `file-line-navigation`
does not exist anywhere in the package. Reading that table as a census of today's mis-filed files is the
error this paragraph exists to prevent — the table records mappings, and a mapping outlives the file it
described.
The `PROJECTION_SPLIT` entries for the other two names are dead, not live (§15.1).

---

## 8. Staging

Order is derived from dependencies. The first belief this plan had to discard was "move the directories
first": a responsibility change performed before the substrate is widened has to be re-import-repointed
later, and the two diffs become impossible to review separately. The second was "start with the worst
offender by size": the first business must be the one holding the most prohibition-1 violations. It
survives only as a reason `composer` is carved early — the order below puts the two businesses whose
published APIs `composer` consumes ahead of it.

Every step ends with a tree where all applicable gates pass, and lands as one commit or a small ordered
set whose message says whether it is a **move** or a **restructure**. There is no production feature
flag anywhere in this plan.

### Phase 0 — Derive the substrate matrix (no source change)

Re-derive `field 7` for the three rows marked **[to derive]** — `sessions` (§4.1), `workspace` (§4.4), `models` (§4.7), from **the props each business receives**
rather than from its own imports — because today's imports do not show it (§1.3). Output: the completed
eight-field table, committed to the design docs, and the enumeration of the substrate's consumers.
*Exit:* every one of the twelve rows has an enumerated `field 7`, and the substrate's consumer list is
complete. *Rollback:* none needed. **Done:** the output is `phase-0-substrate-matrix.md`, accepted by the
operator on 2026-10-12; the three derived values and the discharged decision are recorded in §14.1 item 4.

### Phase 1 — Substrate repair

1. **Widen the turn intents.** `attachTurn({ turnId })` / `sendTurn({ … })` stop demanding caller
   capabilities; the composition root holds the port in a closure and supplies them at call time
   (`readStream` is already a lazy store closure invoked inside `attachWebuiTurn`; `resumeSession` and
   `loadMessages` are call-time data with an absent-capability guard, so nothing needs to be stateful).
   Publish the **turn capability slice** (send/resume/load/stop), not just the intent callable —
   otherwise stop and retry still receive raw transport.
2. **Regroup the writer commands** into *stream phase* (5), *turn lifecycle* (4) and *interaction* (4),
   matching the two interfaces `session-commands.ts` already draws, and publish each group only to its
   owner.
3. **Re-file the ports** (§9) — after 1 and 2, because 2 needs the mapping and 1 needs the slice.

*Exit conditions for step 1, all checkable:*
`grep -c "resumeSession\|loadMessages\|sendMessage" client/components/*.tsx` returns 0;
`attachTurn` is called with one argument (compile-time); the absent-capability guard still exists and a
test asserts the no-capability path returns without setting sending; and the `unread.ts`-style contract
is written for the substrate.

*Rollback:* per step. Step 1 alone is independently shippable and independently valuable — it removes
the first true prohibition-1 violation.

### Phase 2 — Stop forwarding the composed transport

`client/contracts/transport.ts` remains the composed type used by the composition root and leaf prop
types. The composition root constructs the transport and cuts it into each business's **own port slice**
at `create-application.ts`, delivered through its own context instead of forwarding generic transport
members from the shell. **A directory re-file does not narrow the seam — only narrowing the seam does.**
Do not read "the gate stays green" as "the seam is closed"; these are different claims and the second
becomes true only here.

*Exit:* the shell forwards zero transport members; `Partial` optionality is preserved in exactly the
same places (`sendMessage?`, `resumeSession?`, `watchEvents?` today, with
`WebuiClientFoundationApp.tsx:157`'s `transport?` prop and the "not wired" mode intact). The browser
suite records 96 passing tests and one failure at `composer.spec.mjs:104`; the same failure was reproduced
at the documented Phase 4b base and explicitly waived as unrelated to that batch. The final verification
note records both runs and the evidence path.

*Rollback:* per business slice. **This is the highest-risk step in the programme** — the optionality is
where behaviour will silently change.

### Phase 3 — Business boundaries, one business at a time

Order: **`interactions` + `goal` → `composer` → `sessions` → `transcript` → `workspace` → `rail`
(subsumed into `sessions`) → `models` → `plugins` → `settings` → `account` → `shell` last.**

**Run the interactions and goal boundary repair before the composer carve so composer can consume their
published APIs without retaining their writers. The combined turn separates goal refresh/write/version-fence
duties from pending interaction duties. This ordering does not reassign composer input-mode state or settings
permission-mode state. Resolve the state/ref/effect disposition against §4/§5 and actual producers/consumers;
declaration proximity is not ownership evidence.** `composer` holds a case of all four prohibitions and is the
substrate's first consumer, which is why it is carved early — the order above puts the two businesses whose
published APIs it consumes ahead of it; `shell` last because it constructs the owners, and doing it early
means re-wiring it repeatedly.

**What makes the boundary non-negotiable is a test that fails, not a table that is read.** A per-business
plan-time table (`files today → target → duty change → acceptance → rollback`) **relocates** the boundary
decision into prose the executor reads and reinterprets — the "duty change" column *is* the judgement. So
the unit of Phase 3 work is:

1. **Four prohibition tests per business, written first.** Each of §5.1's four prohibitions gets one
   assertion in the business's own test file — `sessions` imports no writer of composer state; no component
   mentions a composed transport outside its own slice; the closed set has one enumeration; a business's
   exported rules are imported only from permitted modules. They run inside the existing `webui` group of
   `test/vitest-suites.json` (120 registered files), so they are gates rather than review notes.
2. **A generated command surface per business.** The business's published commands are *emitted* by a script
   that reads the exported command object, so "sessions publishes X" is an output and an added member shows
   up as a diff.
3. **§5.6's contract is what the tests are written against, and §15.1 is the file list they move.** §5.6 is
   where the plan-time decisions live — owner module, what each business may write, what it publishes, where
   each shared rule belongs, how far each carve reaches. §15.1 tells the executor which module to open.
   Neither the tests nor the generated surface decides those; they check decisions already taken in §5.6.

**Rollback unit: one business, not one layer within a business.** A layer-granular rollback unit is
attractive and wrong here: `composer`'s violation straddles layers (a component holding
application-layer writers), so fixing the directory without the writers leaves the violation in place
and produces a green diff that changed nothing. Within a business, order the commits **component →
owner → capability slice**, because that is the direction reads resolve.

**The retained §16 splits are Phase 3 work, not Phase 4 moves.** Phase 3's split scope is **§16.10's `execute` rows,
and nothing else**; they execute here,
inside each business's own turn, **after** that business's duty carve has resolved ownership — a
separation performed before its owner is named moves state without concentrating it, which is the precondition
§16.1 states. Each carries §16.4's two answers (B1, B2) in §16.9's table; a
candidate without them is not executed, and `GoalBanner` is withdrawn for failing exactly that test.
They cannot be deferred to Phase 4: Phase 4 is **pure relocation** — import repointing, no judgement —
and a split that changes a declaration's shape is not a relocation. The businesses that gain work here:
`composer` (its own body), `sessions` (`SessionComposer`'s context ring, and the in-file cut inside
`WebuiProjectList`), `workspace` (`SessionComposer`'s directory browser, and `SettingsModal`'s review
page), `plugins` (`PluginManagement`'s three surfaces),
`settings` and `account` (`PersonalizationSettings`, `UsageModelSettings`, `UserMenu`), `models`
(`UsageModelSettings`' provider form, and the in-file cut inside `ModelPicker`), and `composer` again
for `QueuePanel`. The cross-business contract backfills those re-filings depend on are already in
§4.1 and §5.6 — that is why they are recorded there and not here.

### Phase 4 — Directory grouping

The mechanical consequence of Phase 3: move the now-correct modules into `client/<layer>/<business>/`.
Pure moves plus import repointing; 116 files / 34 382 lines by §15.1's validated table, up to 853 relative
specifiers inside `src/` and 410 inside `test/`. Then delete the gate's now-dead provenance entries
(`CLIENT_FILE_PROVENANCE`, whose every entry has left `client/` root; and
`PROJECTION_SPLIT`'s two live entries — `composer-history`, `effect-reducer`. Its other two entries,
`transcript-request-ownership` and `file-line-navigation`, are already dead: the first is filed under
`application/` and the second does not exist, which is why deleting them is a separate clean-up rather
than a consequence of the move) and update
`packages/webui/AGENTS.md`, whose module role table names 40+ literal paths.

### Phase 4b — §7.1's roster only

The 59-declaration work roster leaves the component files for the layer that owns each
(`projection/<business>/` for a pure derivation, `application/<business>/` for a decision,
`infrastructure/` for browser IO). **This is a filing fix: it creates no new owner.** Batched by destination
directory, after Phase 4, because §7.1's moves change a layer and cannot share a batch with Phase 4's
classification-neutral moves. A batch that would need a baseline entry stops and reports it (§12.2).

**§7.2 is not in Phase 4b.** `composer-history` and `effect-reducer` sit in `projection/`, the gate already
classifies them `application`, and they are classification-neutral moves already present in §15.1's table.
**They execute in the Phase 4 C instances owning `client/application/composer/` and
`client/application/turn/`, and nowhere else.**

**Why Phase 4 does not cover §7.1.** Phase 4 is the mechanical consequence of Phase 3: move the now-correct
modules into `client/<layer>/<business>/`, pure moves plus import repointing. §7.1's declarations move **out
of** `client/components/` — the presentation layer — into `projection/`, `application/` or `infrastructure/`,
so they change layer and are not pure moves.

### Phase 5 — Finalize

1. **E1 — Record the decision and finish the contracts.** Write ADR 0015 under `docs/adr/`, keep
   ADR 0014 unchanged, and verify all twelve §4 rows against the eight fields in §5.6 and the final
   source paths. The ADR fixes the business axis and its invariants; it does not replace this
   implementation plan.
2. **E2 — Publish navigation from the delivered tree.** Generate the business × layer index in
   `packages/webui/AGENTS.md` with `scripts/webui-business-navigation.mjs`. The generator discovers
   business directories and the `sessions` / `shell` root entry modules from `packages/webui/src/client/`;
   its published-command and substrate columns are the approved §5.6 contract. It includes `turn` with
   no presentation module and lists shared application roots as shared modules rather than businesses.
   `pnpm check:webui-business-navigation` must reproduce the checked-in block; the generator and its
   output are committed together.
3. **E3 — Re-measure and reconcile.** Re-read the twelve extension scenarios in §10 against the
   final source tree and record the actual changed-file set each scenario requires. Recompute the
   §15.1 target and source totals from the final destinations and dispositions; do not carry forward
   design-baseline line counts. Record the verification scope and remaining live-runtime limits in
   an external wrap-up note.

**Exit:** ADR 0015 exists; every business row resolves to its actual owner and path; the generated
navigation table names only existing directories and matches §5.6; §10 identifies observed final
change surfaces and keeps the protocol-cost control rows explicit; §15.1's targets and totals agree
with the working tree; the wrap-up note records actual commands and outcomes. The exit checks were
reconciled on 2026-10-13 after finding that E2's table had no reproducible generator and omitted its
published-command contract column. The final evidence is in
`/home/fectivnfy/my_data/project/my_project/minimax-code-webui-work/phase5/phase5-wrap-up-20261013.md`.

---

## 9. The port re-file (S12 — the number that must move)

`client/contracts/` now has 13 business port files and 100 top-level capability members. This final count
uses direct `readonly` members on each port interface; it does not count nested request-shape fields. The
older baseline count of 216 included nested request-shape fields across eight ports and is not comparable.
The final per-file census is: `account` 8, `composer` 4, `goal` 5, `interactions` 5, `models` 15,
`plugins` 2, `sessions` 11, `settings` 17, `shell` 1, `transcript` 8, `turn` 4, and `workspace` 20
(including the terminal capability's 6). The member names are unique across the 13 files. `plugin-port`
has two top-level members, one of which (`pluginManagement`) carries 29 actions.

Both halves of the fix are required, and the second is the load-bearing one:

1. **Re-file the declarations** to `contracts/<business>/<capability>.ts`. This is a *classification and
   re-file* of the client's own declaration layer — `shared/contracts/` remains the cross-process
   contract and is untouched — and it is cheap because it moves type declarations.
   `settings-port`'s 53 members divide mechanically (models + providers → `models`; instructions, agent
   memory, user profile, memory settings → `settings`); `execution-port` splits three ways
   (`sendMessage`/`resumeSession` → the substrate, `runCommand` → `composer`, `watchEvents` →
   `shell`/`turn`); `session-port` splits between `sessions` and `transcript`.
2. **Stop passing the composed transport as a business capability.** The final tree keeps
   `client/contracts/transport.ts` as the composition-root interface, but the application cuts it into
   named business slices. Leaf components receive the specific optional capability props they use.

**Count the port's actions, not its members.** `plugin-port` has one member and 29 actions; the
opposite error is `settings-port`'s 53 members for seven duties. The re-file must be driven by the
action inventory, or `plugins` will be under-scoped by an order of magnitude.

**Why this is the number that must move:** every other row in §10 is a UI-or-orchestration cost that a
directory carve addresses. This one is a *vocabulary* cost in the client's own declaration layer, no ADR
freezes it, it is where 业务职责不集中 is most literally true, and if the programme ships without it the
new business directories will immediately start importing each other's port members — prohibition 1
violated *through the seam* rather than around it.

---

## 10. Extensions, measured before and after

| # | Extension | Today | Target |
| --- | --- | --- | --- |
| S1 | rail context-menu item on an existing capability | 4 files across `projection/` and `components/`; rules were duplicated across builders and render branches | `projection/sessions/rail-menu.ts` + `components/sessions/SessionRail.tsx` (2 files across the two owning layers) |
| S2 | permission prompt gains a field (with protocol) | 4+ files / 4 dirs | **unchanged** — inherent protocol cost; kept as the control row that calibrates what the carve cannot touch |
| S3 | change the reconnect recovery policy | design-baseline count: 8 files / 4 dirs | final decision/transition: `application/turn/turn-commands.ts`, `application/turn/active-turn-probe.ts`, `application/turn/event-effects-registry.ts`, `application/turn/effect-reducer.ts`, `projection/turn/stream-state.ts`; session activity remains in `projection/sessions/session-activity.ts`; event subscription is coordinated by `application/turn/event-channel.ts`; composition wiring stays at the shell/application boundary |
| S4 | new right-column tab kind | baseline had kinds enumerated in 3 places | final discriminant and shape registry: `projection/workspace/workspace-panel-state.ts`; host rendering: `components/workspace/WorkspacePanels.tsx` |
| S5 | new composer toolbar control | baseline: 2 files, one a 2088-line function | presentation host `components/composer/WebuiComposer.tsx` (2460 lines); extension placement must be rechecked against the target component split, so the file-count reduction is not claimed |
| S6 | a second business shows the same session | no independent consumer was added by this reorganization; the scenario remains a design acceptance constraint | the new business should consume `sessions`' read model and the turn substrate with zero imports from `components/`; this is architectural guidance, not a measured before/after result |
| S7 | new wire operation end to end | 13-step baseline in `packages/webui/AGENTS.md` | unchanged — protocol cost, retained as a control row; this filing work did not add a wire operation |
| S8 | a business is added to the client | design baseline: no navigation guide; `goal` had to be spread by hand across 47 files in 12 directories | `packages/webui/AGENTS.md` now provides the business × layer index; port and registration work remains governed by the existing application assembly contracts |
| S9 | new stream frame / tool-result kind | baseline: 7 files / 4 dirs / 3 layers | `projection/common/event-kinds.ts` centralizes goal/interaction event classification; parser and render consumers use it, while stateful event effects remain in `application/turn/effect-reducer.ts` |
| S10 | goal status gains a value | baseline: 47 files across 12 dirs; goal shared interaction coordination | goal state projects in `projection/goal/goal-state.ts`; orchestration lives in `application/goal/goal-coordinator.ts`; shared event classification is in `projection/common/event-kinds.ts` |
| S11 | = S8, stated as the on-boarding cost | — | — |
| **S12** | **a capability port gains a member** | design baseline: 216 nested-inclusive members in 8 ports | final: 100 direct top-level members in 13 business port files, with unique member names; `pluginManagement` separately retains its 29-action inventory |
| S13 | review/diff rendered in a second place | baseline draft placed reducer in a transcript component | one pure owner, `projection/transcript/review-state.ts`, consumed by `components/transcript/DiffCard.tsx` and `components/workspace/ReviewSettingsPage.tsx` |

**The re-measurement is an acceptance condition, not a report.** A design that moves no row is not an
improvement, and neither is a table whose numbers improve while the mechanism does not. Two rows are
load-bearing and are checked by construction rather than by counting:

- **S10 and S12 together** — the point is not that `settings-port`'s 53 members are distributed, it is that a
  component no longer receives business RPC through a composed object, and that an owner no longer has to
  coordinate across several modules to publish one rule. If, after the carve, components still hold business
  RPC or owners still cross modules, the defect has changed address rather than gone.
- **S4 and S9** — the closed sets now have one enumeration each, verified by §5.4's I6, not by the row's
  smaller file count.

---

## 11. Documentation and decision record

**A new ADR 0015, which supersedes by reference and does not amend 0014.** 0014 records a *completed*
migration (`docs/webui/webui-runtime-layer-plan.md` §7) and is left untouched — not because amending a
decision is one-way, but because 0014 is settled and amending it would misrepresent both decisions'
provenance. ADR 0015 records: the business axis is decided; the layer cut of 0014 remains in force;
what the business unit is and is not; criterion C and the bag/nesting test; the four prohibitions; the
turn substrate's three members; the capability seam; and the non-goals.

**Correction to an earlier claim, recorded so it is not repeated:** ADR 0007 does **not** constrain this
work. `grep -c 'packages/webui' docs/adr/0007-*.md` returns 0, but the ADR *does* name the WebUI work
in prose ("The WebUI work therefore adds a package and incremental wiring rather than restructuring
anything"). The reason 0007 does not bind is that `packages/webui` is first-party workspace code that
does not exist in `upstream/main` (`packages/webui/AGENTS.md`), so there is no three-way merge to
protect. An earlier draft of this plan cited 0007 and was wrong.

`packages/webui/AGENTS.md` gains the one thing it lacks: **a business-axis table** mapping each business
name to the set of directories it occupies, its contract row, and the substrate members it consumes.
That table is what makes a business findable; without it the grouping only helps someone who already
guessed the name.

---

## 12. Verification

### 12.1 What this plan does **not** claim

**The four prohibitions have no machine rule in the dependency checker.** `check:webui-dependency` enforces
layer direction, cycles and (after a stated spike) capability calls; it cannot express "a rule may not be
filed under a module that does not own its concept" or "the set of valid values is enumerated once".
The prohibitions therefore split into **three layers, and the plan must not blur them**:

1. **The dependency checker** (`check:webui-dependency`) holds **no** business-boundary rule, and this plan
   proposes none. It catches layer direction, cycles and capability calls.
2. **The per-business prohibition tests** Phase 3 writes — one assertion per prohibition, per business —
   are the machine half, and they run in the registered `webui` group.
3. **The residual rules no test can express** (is this *split* semantically right) stay a reading.

**"The gate is green" is not "the new structure is policed"** — different claims, and only the first is
true from the checker alone. An earlier draft of this section and of §5.4's I9 said the prohibitions had *no*
machine rule, which contradicted Phase 3; this three-layer form is the correction. The invariants that *are* checkable, with their phase and their
kind, are §5.4's list; **I9 in that list is this paragraph stated as an invariant**, so a phase exit that
reports "all invariants hold" cannot be read as "the boundaries are enforced".

### 12.2 Checking the layer direction and the runtime/application duties

The duty table this section checks against is §5.5; the invariants are §5.4.

**A carve may not add or widen a dependency baseline entry. Measure new findings against the pre-carve
graph. Resolve an illegal edge by completing the scoped extraction/injection or by correcting the sequence;
if resolution requires a scope or architecture change, stop the affected ticket and obtain an amended plan.
A reported finding is not a passed acceptance criterion.**

`pnpm check:webui-dependency` must report the **same verdict before and after** Phase 3–4 moves
(`0 violations across 0 pairs`, `0 cycles`, `1 allowance`) because the carve is sub-directory-only.
Per business, before and after its phase: count the `watchEvents` openings, the store construction
sites, and the `useSyncExternalStore` subscriptions touching session state — **the count must not
grow**; and confirm `runtime/` and `server/` are untouched by the phase.

### 12.3 Proving state ownership and uniqueness

- Exactly one writer per record: the store construction sites are enumerated and their count must not
  increase; a second `createWebuiSessionStore` is a failure, not a refactor.
- For every row in §4, the `Owns` list is checked against the writers that actually exist, and
  every `Does not own` clause names the owner that does.
- The `purgeSlot` conversion is proved by deleting the optional dependency and reading the compiler:
  a missing command must fail to compile.

### 12.4 Proving a moved module is really in the build and call path

`pnpm build:webui` prints server/client input counts: **a new module that exists while the counts do
not move has been written but never wired.** `pnpm check:webui-boundary` then proves nothing foreign
entered the graph. Component testids and classes are grepped in the built artifacts.

### 12.5 Proving behaviour is equivalent

| Level | Proves | Does not prove |
| --- | --- | --- |
| AST body comparison on every move | bodies are byte-equal, and *which* declarations changed | nothing about statement **order** between functions — the control flow of every extraction is read separately, because "all branches equivalent" and "the steps are in the same order" are two claims |
| Exported pure-function fixtures (`pnpm test:webui`, node env) | transitions, request bodies, boundaries, fences | no DOM, no effects, no wiring |
| SSR assertions (`renderToStaticMarkup`) | every render branch: neutral/active, expand/collapse, `disabled`, copy, attributes, what must not render | that a click reaches a handler |
| `pnpm test:webui-browser` (Playwright, built client + scripted server, linux) | real interaction: rail menu/pin/search/star, composer, questionnaire, transcript, turn lifecycle, workspace progress, settings, plugin status, connection status, account login | not a live agent process, not pixels-as-acceptance |
| Resolved-declaration CSS snapshot | the stylesheet renders identically | nothing about layout interaction |
| `pnpm typecheck:webui` + `typecheck:webui-full` | the whole `src/` + `test/` tree compiles against the new paths | nothing about behaviour |

**Unverified by everything above, to be reported as such:** the live loopback→harness sequence against
a real agent process; real WebSocket reconnect; PTY behaviour; pointer-event ordering; portal and
nested-popover hit-testing; visual appearance (the user owns visual acceptance); any state that only
exists across a page reload.

### 12.6 Gate list and the per-commit obligations

`pnpm typecheck:webui`, `pnpm typecheck:webui-full`, `pnpm test:webui`,
`pnpm build:webui` (counts), `pnpm check:webui-boundary`, `pnpm check:webui-dependency`,
`pnpm test:webui-browser`, `pnpm build:styles` + the resolved-declaration snapshot,
`node scripts/source-inventory.mjs --write && pnpm check:source` (per commit that adds or moves a
file), `git diff --check`. New test files are registered in the `webui` group of
`test/vitest-suites.json`. `TMPDIR=/tmp` is required for `test:policy`; the TUI suites need an English
locale.

### 12.7 The one spike this plan requires

The presentation half of the call rule cannot see a capability reached through a **function-parameter
destructuring** — the resolver's `destructuredMemberPath` returns a source only for a variable
declaration or an assignment, and a parameter has none — which is why 1439 call sites under
`client/components/` resolve to zero capability methods. Extending it would turn prohibition 1's
current violations into machine findings. **Spike first, with a measured new-violation count**; if the
resolver produces unbounded false positives, stop and report rather than shipping a rule that cannot be
trusted, and never widen a baseline to reach green. This spike is separable: dropping it leaves every
other phase intact and weakens only the *verification* of Phase 3.

**Spike outcome — run 2026-10-13 against the delivered seam (ticket #65). The extension is validated and
prepared, not landed, and the nine findings it produces are filed on the carves that own them.**

Measured on `webui` at the commit that closed A3, four configurations, same program build each time.
The probe lives outside the repository (`minimax-code-webui-work/w3-spike-12.7/probe.mjs`) and drives
`buildDependencyGraph`/`evaluateGraph` directly:

| configuration | resolved call sites | under `client/components/` | `forbiddenCalls` |
| --- | ---: | ---: | ---: |
| A — as shipped | 3802 | 1440 | 0 |
| B — resolver extended to function-parameter destructuring | 3996 | 1633 | 2 |
| C — B + the policy map updated to the re-filed interfaces | 3996 | 1633 | 9 |
| D — policy map updated, resolver unextended (what a commit can ship today) | 3802 | 1440 | 0 |

**The stop condition is not met.** The extension resolves 194 more sites and produces 9 findings, not an
unbounded set; every one of the nine is a verified true positive — a `Pick<WebuiTransport, …>` capability
slice invoked from a presentation component, which is prohibition 1 in its literal form:

| file:line | method | owning carve |
| --- | --- | --- |
| `GoalBanner.tsx:143`, `:152` | `patchGoal`, `clearGoal` | `interactions` + `goal` (B1) |
| `DiffCard.tsx:213` | `getTurnDiff` | `transcript` (B4) |
| `MessageItem.tsx:146`, `:154`, `:164` | `getSessionRewindPreview`, `rewindSession`, `editSessionMessage` | `transcript` (B4) |
| `MessageItem.tsx:172`, `:181` | `forkSession`, `getSessionForkOptions` | `transcript` (B4) |
| `SessionComposer.tsx:850` | `loadMessages` | `transcript` (B4) / `composer` (B2), whichever lands first |

**Why it is not landed here.** Landing B or C turns the gate red with those nine, and this plan forbids
widening a baseline to reach green and treats a reported finding as a stopping result — so the extension
lands *with* the carve that removes its findings, per business, not before. The extension itself is one
branch in `destructuredMemberPath` (`if (ts.isParameter(outer)) return { keys, source: outer };`) plus the
resolver's existing `propertyAlongPath`, which already does the right thing with a parameter — it reads the
parameter's *declared type*, so a capability reached through a prop bag typed as a port is resolved, and an
untyped parameter yields no site rather than a false one.

**A second finding, and the reason C differs from B: the A3 port re-file silently dropped coverage.** The
call rule keys first on the interface a method was declared in
(`FORBIDDEN_RECEIVER_INTERFACES`), and that map still named `ExecutionPort` — destroyed by the re-file —
while the six interfaces the re-file produced (`TranscriptPort`, `TurnExecutionPort`, `ComposerPort`,
`ShellEventPort`, `ModelsPort`, `GoalPort`) were absent. Seven of the nine findings reach the rule only
after the map is corrected; with the map as shipped, sites declared on the new interfaces fall through to
the receiver-type lookup and are never judged. **A rename cannot turn a gate red, which is why this went
unnoticed** — the map was corrected in the same commit as this record (`FORBIDDEN_RECEIVER_INTERFACES` now
names the thirteen interfaces the re-file produces and no longer names `ExecutionPort`), and that
correction is inert on today's tree: configuration D measures 0, because every site on a new interface
sits in `client/application/`, where capability calls are legitimate.

**What remains a reading, not a measurement.** Whether each of the nine is resolved the right way *in its
business's terms* — a published command invoked by the owner, or the component handing the intent up — is
the carve's judgement, not the rule's. The rule can only say that a presentation component invoked it.

---

## 13. How this design was reached

**A direction review, then seven grilling rounds.** The plan was first reviewed as a *direction* review by a
separate Lead profile (codex `gpt-6.1-sol`, read-only; brief `review-lead-01-plan-direction.md`, answer in
`lead-review-01.log`). Its verdict — **the direction is right, the plan is not yet approvable** — produced
eight findings. Its re-review of the first revision scored them **two closed, four partly closed, one
open, and one open with the scope disclosed**, and found four problems the revision itself introduced. Those
open items were recorded rather than smoothed over, and both are closed now: §14.1 carries the six settled
decisions and §14.3 records the closure of the three gaps. The plan-time boundary contract (§5.6) was the one
deciding whether the direction could be approved, and the review's own words for it were
that the revision "handed the gap to writing tests and generating an export list" instead of closing it; §8
Phase 3 now makes those two the unit of the work, which is why §5.6's table is read against a failing test
rather than against prose. Then six grilling rounds against a second agent
(MiniMax `M3.1-Flash-Preview`, read-only, one persistent session).

**The specified model is not available, and this is the declaration the request asks for.** The request
names `m3.1think`; the provider's model list contains eight entries and none of them is `m3.1think` —
`M3.1-Flash-Preview` (thinking and non-thinking), `M3` (both), `M2.7-highspeed`, `M2.7`, and two
custom-provider entries. The closest available model is `M3.1-Flash-Preview · thinking`, and that is what
every round used. The request's rule for this case — state it plainly and continue with the analysis that
can be done — is what this paragraph discharges; the earlier revision used the model without saying so. The protocol: each round puts the whole
*frontier* — the decisions whose prerequisites are settled — with the operator's recommended answer on each;
the counterparty agrees or disagrees with evidence; the answers reshape the tree. Transcripts and per-round
briefs: `~/my_data/project/my_project/minimax-code-webui-work/w2-business-reorg/grill-0{1..7}-*.md` plus
`grill-r*.log` and `lead-review-01.log`.

**Where the counterparty changed the operator's mind, with the reason it mattered:**

- The substrate is not usable as described: `attachTurn({ turnId, resumeSession, loadMessages })`
  requires the caller to hold two transport capabilities, and the flat 12-method `commands` object is called only from the composer. The operator's three-group split also cut across the interface
  boundary `session-commands.ts` already draws. Both accepted; substrate repair became Phase 1.
- The operator's "a directory re-file makes prohibition 1 enforceable at the seam" was wrong: only
  narrowing the seam narrows it. Accepted; Phase 2 exists because of it.
- `workspace` first was wrong: worst-offender-by-size is not worst-offender-by-boundary. **`composer`
  first**, because it holds a case of all four prohibitions.
- Rollback unit is one **business**, not one layer within a business, because `composer`'s violation
  straddles layers.
- The operator's criterion B ("a place the user enters") fails on the terminal; **criterion C** (own
  lifecycle and identity outliving any business) replaces it, with the bag/nesting test.
- The substrate must have a **row**, not be a business-free zone, and then — by criterion C — it is
  simply the twelfth business, `turn`.
- `field 7` must be **enumeration, never prose**, and carries an eighth field the operator had not
  written: **Failure & recovery**. Without it, "attach and send resolve their own capabilities" is
  unimplementable.
- The operator's ADR 0007 citation was wrong; the new ADR supersedes by reference instead.
- Most valuable single find: the operator's drafted rows contained a real prohibition-1 violation it had
  not declared (`sessions` purging `composer` state on two paths), and three of twelve `field 7` values
  were wrong — the same error class in `composer`, `settings` and `account`.

**Where the counterparty corrected the plan in the closing rounds, and what changed:**

- **§6.1 argued the layout from the gate, which inverted a premise accepted in round 2** (`grill-02`
  accepted that the gate's path vocabulary is *not* automatically stable; §6.1 then argued layer-first
  *because* it is stable). The reasoning is replaced by an explicit trade-off and a candidate comparison,
  and the gate is no longer the reason — see §6.1.
- **The gate's `client/projection/` classification is basename-keyed, not path-keyed**
  (`webui-dependency-rules.mjs:435-437`), so a rename during a move silently changes a module's layer. That
  is §5.4's I2, and it is the concrete cost §6.1 must name.
- **A Phase 3 table does not hold the boundary; a test does.** A plan-time mapping "relocates the decision
  into prose" — the four prohibition tests are now the unit of Phase 3 work, and §15.1 is the checklist they
  are written from.
- **§14.2 conflated a location test with a change-type test**, which made it contradict §1.1, §11 and §12.
  Both the criterion and §14.1's decision list were corrected.
- **§7.2 said "the only two such files"; the gate carries four** (`PROJECTION_SPLIT`,
  `webui-dependency-rules.mjs:359-371`). Corrected, with the fourth (`file-line-navigation`, a
  `bindings`-classified file under `projection/`) called out.
- **Desktop settles the one question that could have moved the business list.** `terminal` is bound to a
  `sessionId` and destroyed with it, so criterion C does not make it a business; the twelve-business list
  stands. Recorded with the two business differences Desktop exposes (§14.4).
- **Invariant I3 cannot be written as `grep → 0`.** Today's count is 1 and the hit is a legitimate
  per-business capability slice (`GoalBanner.tsx:24`), so the invariant is "does not grow and every hit is a
  slice".

**Where the operator held, and why:** the business axis over the capability axis and over the state-owner
axis (§2.3); the substrate's status as a business rather than an unnamed floor (§3); and the refusal to
let "the gate stays green" stand for structural enforcement (§12.1).

**Unresolved when this document was written, and since settled:** `field 7` for the three rows §4
marked **[to derive]** — `sessions`, `workspace`, `models` (§1.3, §4.1, §4.4, §4.7) — was derived in
Phase 0 and accepted on 2026-10-12; the six decisions listed in §14.1 were settled by the operator's
authorization of 2026-10-13 and are recorded there. **§14 is the record, and nothing in §13 is still
open.**

---

## 14. The decision record, and out-of-scope items

### 14.1 The six decisions this plan needed, as settled

This section was a question list. Each item now carries its **decision**, how it landed, and what
delivers it. Nothing here is open. One item is marked as a decision *this plan* made rather than an
operator ruling, and it is stated that way rather than being dressed up as one.

**1. Adopt the business axis, and with it §4's twelve-business list — ADOPTED.**

- *How it landed:* the operator authorized the whole programme on 2026-10-13, which settles the axis
  and the list together. The board is built from §4: one Phase 3 carve ticket per business, the Phase 4
  and Phase 4b batches per layer, and Phase 1 already publishes `turn` as a business.
- *Three judgements that travel with it:* `goal` is a business rather than part of `interactions`;
  `turn` is a business that appears nowhere (it stands on criterion C, and §12.1 records that its
  boundary is carried by tests rather than by a carve); and `terminal` is a **capability**, not a
  business, so the list stays at twelve — §14.4 carries the Desktop evidence that a terminal is bound
  to a `sessionId` and destroyed with it.
- *One vocabulary correction accepted with it:* `rail` is WebUI-local. Desktop's surface is `Sidebar*`
  throughout, so the two products are not assumed to share a vocabulary and the business name stays
  `sessions` (§14.4).
- *Formal record:* ADR 0015 (§11), written in Phase 5. The ADR restates this decision; it does not
  reopen it.

**2. Phase 2 — stop forwarding the composed transport — is in the first delivery. IN.**

- *How it landed:* the operator's authorization. Phase 2 is in §8's staging and carries its own board
  milestone.
- *Why it is not optional:* it is the step that makes prohibition 1 real at the seam. §8 says so
  in one line: "a directory re-file does not narrow the seam, only narrowing the seam does." Deferred,
  the delivery could not be called the completed business-boundary reorganization (item 6).

**3. The call-rule spike (§12.7) is in scope now. IN.**

- *How it landed:* the operator's authorization; it is a Phase 1 deliverable and it is what makes
  prohibition 1 measurable rather than merely reviewed.
- *The stop rule still binds the implementer:* if the extended resolver produces unbounded false
  positives, the spike reports and stops rather than shipping an untrustworthy rule, and the frozen
  baseline is never widened (§12.2, §12.7). A spike that stops leaves this item delivered as a
  measurement, not as a rule.

**4. `field 7` for the three rows marked to derive — DISCHARGED 2026-10-12.**

- *How it landed:* Phase 0's output was accepted by the operator on 2026-10-12.
  `phase-0-substrate-matrix.md` opens with that acceptance and closes with "§14.1 item 4 is discharged:
  the operator accepted this output on 2026-10-12, Phase 0 is closed, and Phase 1 (`#57`) may start."
- *The values:* `sessions` → `read-model, in-flight-read, intents`; `workspace` →
  `read-model, in-flight-read`; `models` → `none`. §4.1.7, §4.4.7 and §4.7.7 now carry them, and §4's
  legend records `[to derive]` as retired.
- *Delivered by:* `#57`, which the acceptance released.

**5. The layout axis — a decision THIS PLAN makes, not an operator question: layer-first.**

- *The decision:* the seven top-level `client/*` names are kept, so the layer stays readable from the
  path and the dependency rules keep one meaning, at the cost of one extra path segment per business
  module (§6.1).
- *Why it was listed here and is still not an operator question:* §6.1 makes the trade-off explicitly,
  and an earlier form of this item presented the trade-off as if it were open. A business-first
  top-level layout is *affordable* — the classifier repair is small — and would narrow the typical
  change scope. It is not chosen for the two reasons §6.1 states: the layer stays readable from the
  path, and the presentation rule's coverage does not have to be re-proved. The catalog/unread modules
  that name the rail as their consumer are **not** a third reason — earlier drafts read them as proof
  that business-first forces mixed duties, which the source does not show.
- *Delivered by:* §15.1's move table, executed across Phase 4's batches.

**6. Phase 3's prohibition tests are written. WRITTEN, and required.**

- *How it landed:* the operator's authorization. Each Phase 3 carve delivers its business's four
  prohibition tests as the unit of its work (§8 Phase 3), and the generated command surface of §8
  Phase 3 makes each business's published commands an output rather than a claim.
- *Why it is not optional:* they are the machine half of §12.1's three-layer split. The dependency
  checker holds no business-boundary rule either way, so a green gate must not be read as coverage it
  does not provide.
- *Delivered by:* `#57`, which carries the `turn` business's four (and the command-surface generator
  itself); then the Phase 3 carve ticket of each business. `turn` has no carve ticket, which is why its
  tests land in Phase 1.

### 14.2 Out of scope, stated as a change-type test

The earlier form of this section said "any change outside `packages/webui/src/`", which contradicted §1.1,
§11 and §12 — all three read or edit files outside `src/` (`docs/adr/`, `scripts/lib/`, `scripts/verify.mjs`,
`test/vitest-suites.json`, `packages/webui/AGENTS.md`, `release/public-source.json`). The criterion is a
**change-type** test, and location follows from it.

**Out of scope — a capability or protocol change that needs work outside the package.** Adding a wire
operation (the 13-step path in `packages/webui/AGENTS.md`), changing a DTO in `shared/contracts/`, or changing
host business semantics. If a business needs a capability the port does not expose, that is a separate task
with its own record.

**In scope and required — the repository-level companion changes.** ADR 0015 (§11); the business-axis table in
`packages/webui/AGENTS.md` (§11); `test/vitest-suites.json` whenever a test file is added (§12.6);
`release/public-source.json` via `node scripts/source-inventory.mjs --write` for every commit that adds or
moves a file (§12.6); and the `webui-dependency-baseline.json` entry deletions Phase 4 requires.

Unchanged in substance and still out of scope: a second view of the same session as a shipped feature (the
substrate must not block it — S6 — but building it is a product decision); `docs/webui/pending-decisions.md`
items; the stacked-generation CSS; a new workspace package or a change to publication boundaries;
`packages/tui` (ADR 0003: read as specification, never imported); extending `tsconfig.test.json` to the whole
webui test tree; and the two business differences recorded in §14.4.

**The repository-facing clause an earlier form of this section carried, and what supersedes it.** It listed
"any PR, push, roadmap baseline edit, group message or issue" as out of scope. That was written for a design
round which was not authorized to change anything. **The operator superseded it explicitly on 2026-10-13**,
having been asked the question directly: closing a ticket is a remote write, so that clause and the
instruction to close every ticket could not both hold.

- **Authorized by the operator on 2026-10-13:** commits on the `webui` feature branch; pushing that branch to
  `origin` (`mcode-webui/minimax-code`, the working remote — **never `upstream`, never the default branch**);
  and `gh` writes against that remote, i.e. commenting on and closing the board's issues, each closure
  carrying its per-criterion evidence. Plus the `release/public-source.json` regeneration every such change
  needs (§12.6).
- **Not authorized, and out of scope:** a pull request against the default branch — the operator's word was
  that it is not needed to close a ticket, and it stays a Phase 5 question; any edit to the roadmap's baseline
  line; group messages; and merging the feature branch. `CONTRIBUTING.md` keeps its own requirements for
  contribution time.

### 14.3 The three gaps this section carried, now closed

All three were closed before Phase 1 ran. None is carried as an open item.

| gap | closed by |
| --- | --- |
| `field 7` derivation for the three rows marked `[to derive]` — `sessions`, `workspace`, `models` (§1.3, §4.1, §4.4, §4.7) | **Phase 0's derivation, accepted by the operator on 2026-10-12** (`phase-0-substrate-matrix.md`). Values: `sessions` → `read-model, in-flight-read, intents`; `workspace` → `read-model, in-flight-read`; `models` → `none`. §4.1.7, §4.4.7 and §4.7.7 carry them. |
| Whether the `models` picker must show the session's active model, which decides `models`' `field 7` and whether the chip is a declared write (§4.7) | **The source settles it, so it was a derivation and not a decision.** The picker already shows that model, and does so without a substrate read: `SessionComposer.tsx:1264` resolves it as `models.find((model) => model.selected)` and passes it as `selected`, and `:1157` loads the list with `listModels?.({ sessionId })`, so the session-awareness is a property of `models`' own catalogue query. `field 7` is `none` on both sides of the carve, and the carve adds no cross-business read. |
| The action-level inventory of `plugin-port` (29 union values behind one member) — the re-file needs it enumerated rather than counted (§4.8, §9) | **`plugin-action-inventory.md`, accepted by the operator on 2026-10-12** together with Phase 0's output. It enumerates the 29 actions and is the inventory §9's re-file is driven by; `#59` (A3) and the `plugins` carve each name it as a Required predecessor. |

**What this section does not claim:** that the programme has no unknowns left. §14.4's two Desktop business
differences and §14.5's two behaviour changes stay deliberately outside it — out of scope by decision, not
open by omission.

### 14.4 The Desktop reconciliation, and the business differences it records

The WebUI is ported from Desktop and Desktop is the authority for business semantics, so the three judgements
this carve rests on were checked against it. Desktop project: `~/my_data/project/my_project/minimax-webui`,
authority `app/dist/main/` — readable compiled CommonJS — because its frontend is 607 minified chunks with no
source maps and its `docs/` holds two screenshots. All three were answerable, and all three are answered:

| Question | Verdict | Evidence |
| --- | --- | --- |
| Is `terminal` a business or a capability? | **Capability.** The twelve-business list stands, `workspace` keeps the terminal tab, and `terminal-port`'s 15 members remain the capability record criterion C produced | `app/dist/main/modules/terminal/index.js:9-10` "owns every PTY process spawned for the sidebar terminal panel"; `:14-15` each terminal is bound to a `sessionId` "so we can do batch cleanup when the session is destroyed"; `:298` `disposeBySession(sessionId)`, `:313` `disposeAll()`; the renderer-facing surface is six handlers under `IPC_CHANNELS.TERMINAL_*` in `ipc/terminal.ipc.js`. **A terminal does not outlive its session, so criterion C does not make it a business** |
| What is `goal`'s version fence authoritative for? | **There is no Desktop counterpart.** The fence is WebUI-local | `patchGoal` sends only `status`/`objective`/`objectiveResources`; zero files across 607 chunks carry `goalVersion`/`versionFence`/`baseVersion`/`expectedVersion`; no goal symbol exists in the main process. The negative is weaker than it looks — the bundle is minified with no source maps, so a differently-named accessor would not surface |
| Does the rail own the unread counts? | **No — Desktop queries them.** §4's `sessions` row stays the owner, but its unread controller derives a **query-shaped** value, not rail-local state | `SidebarQueryScope` with `unread_session_ids`, `excluded_session_ids` and `excluded_project_ids` (`chunks/90321-23bf59453dce9c7b.js`); exactly three persisted keys exist — `agentarchon:taskCompletionNotification`, `agentarchon:unreadTerminalBySession`, `agentarchon:cronUnread` |

**Two business differences, recorded separately as the request asked and not fixed here:**

1. **Server-side unread exclusion has no WebUI equivalent.** Desktop filters `excluded_session_ids` and
   `excluded_project_ids` as part of the query; the WebUI cannot express "leave these sessions or projects
   out of the unread count" at all. That is a **missing capability**, not a naming note, and it is a §14.2
   item: reaching it needs a wire/operation change.
2. **`rail` is WebUI-local vocabulary.** Desktop's surface is `Sidebar*` throughout (`SidebarCollapsed`,
   `SidebarSessionTree`, `SidebarQueryScope`), and its only `rail` tokens are slider theme keys, plus
   `thumbnailRail` for transcript thumbnails. The name difference is recorded so the two products are not
   assumed to share a vocabulary; this plan's business name stays `sessions`.

**What the Desktop artifact cannot settle, said as unknowns:** whether a version fence exists behind a
generated or differently-named accessor (needs unminified source, a source map, or the absent
`docs/design/sidebar-terminal-panel.md`); and what Desktop uses overlay flags *for*, because it appears to
have none — three storage keys, no pin/star/favourite set. Either Desktop has no overlay-flag feature (a
capability the WebUI has and Desktop lacks) or the flags live in a service entity unreachable by chunk
search; this artifact cannot distinguish the two.

### 14.5 Behaviour changes, separated from this programme

The request requires error-handling behaviour to stay equivalent and forbids folding fixes into the
reorganization. Two rows of §4 touch behaviour. Both are **separated here, not carried as in-scope changes**,
and both descriptions below are the source's, verified:

| Where | Today, in the source's own words | What changes | Disposition |
| --- | --- | --- | --- |
| `sessions` → `composer` purge | `session-workflows.ts:184`: "The composer purger; absent means **drafts outlive the delete** (a soft-loss)" | the injected optional becomes a published command, so the absent case becomes uncompilable | **The interface reorganisation is in scope** — prohibition 1 requires it (§5.2). Any change to *observable* behaviour in a supported scenario is **out of scope**, needs its own record, and is not covered by the equivalence acceptance |
| `account`'s quota read | a failed fetch writes `usage.status = "error"` (`account-workflows.ts:331-334`) and the panel renders `usage-popover-error` with "请重新登录" or "加载失败" plus retry (`UserMenu.tsx:684-689`) | keeping the last rendered value and marking it stale instead of showing that error | **Out of scope.** A new expected behaviour, not a reorganisation: a follow-up with its own acceptance |

An earlier draft of this section described today's behaviour wrongly in both rows — it said the quota failure
"renders as zero" and that an absent purger "silently loses draft text". The source says the opposite in both
cases, and §5.2 already quoted the purger comment correctly, so that draft contradicted §5.2 as well.

---

## 15. Appendix A — the business × layer mapping

### 15.1 The move table, regenerated

**Counting rules that bind every figure in this plan.** Counts state their population, unit, baseline
revision and measurement method. Line counts are sizing estimates, not a source partition. Import counts
distinguish specifier occurrences from distinct importers. The §7 work roster counts declarations requiring
re-filing; forwarded exports and already-filed implementations are recorded separately. Regenerate the
affected figures using the chosen definitions; a count made with a different unit is not directly
comparable. Two figures this rule was written for are §7.1's roster (a census of 81, a work roster of 59)
and §9's port census, whose 216 reproduces only when nested request-shape fields are counted as members —
see `docs/webui/plugin-action-inventory.md`, finding 2.

**Final move-table count: 155 printed target rows, representing 151 unique destinations from 134 moved source files.**
The seven `move` and two `delete` dispositions in §15.4 are executed; `transport.ts` is retained as the composition-root type contract. The
count includes split-component outputs and the six relocated modules plus shared glyph extraction listed in
the supplemental Phase 3 table. Four split-component targets repeat the retained target row (`PluginCatalogue`,
`WebuiComposer`, `SettingsModal`, and `UserMenu`); after those four are deduplicated there are 151 unique
destinations. The supplemental table is an audit view of rows already counted here, not an additional set of
destinations. These are current-tree counts, not the pre-disposition estimate.

The `lines` column is each target's size in the verified final tree, for review sizing only. Split modules have
multiple rows, and their row sizes do not claim to partition every source line. The six relocation rows and
the shared glyph extraction are recorded in the supplemental table below. Every target is under a business directory from §4 or one of the two deliberate shared
homes, `projection/common/` and `components/shared/`.

**This is a `client/**` list, not a package inventory.** `server/`, `runtime/` and `shared/` appear nowhere in
it: §5.5's duty table governs them and this programme does not move them.

**The arithmetic a reviewer runs.** Count each mapping row's destination in §15.1, including split-component
outputs and port re-files; normalize destinations beginning `components/` by prefixing `client/`. This yields
155 printed destination rows and 151 unique destinations; four retained-target rows repeat in the split table.
Carry quoted source cells (`"`) forward and count distinct source paths from the source/destination mapping rows:
134 source files move, two held placeholders are deleted, and the retained `transport.ts` is one additional
disposition. Together these are the 137 files previously in the move-or-hold population.
The supplemental Phase 3 table records seven of those destinations with their source and rationale and does not
add to the total. The `lines` values were regenerated from the final files under `packages/webui/src/client/`.

| from | to | lines |
| --- | --- | ---: |
| `client/ConnectionStatus.tsx` | `client/components/shell/ConnectionStatus.tsx` | 152 |
| `client/application/account-workflows.ts` | `client/application/account/account-workflows.ts` | 438 |
| `client/application/active-turn-probe.ts` | `client/application/turn/active-turn-probe.ts` | 68 |
| `client/application/command-workflows.ts` | `client/application/composer/command-workflows.ts` | 43 |
| `client/application/composer-store.ts` | `client/application/composer/composer-store.ts` | 351 |
| `client/application/composer-workflows.ts` | `client/application/composer/composer-workflows.ts` | 178 |
| `client/application/event-channel.ts` | `client/application/turn/event-channel.ts` | 35 |
| `client/application/event-coordinator.ts` | `client/application/turn/event-coordinator.ts` | 301 |
| `client/application/event-effects-registry.ts` | `client/application/turn/event-effects-registry.ts` | 87 |
| `client/application/interaction-coordinator.ts` | `client/application/interactions/interaction-coordinator.ts` | 257 |
| `client/application/plugin-workflows.ts` | `client/application/plugins/plugin-workflows.ts` | 457 |
| `client/application/queue-command.ts` | `client/application/turn/queue-command.ts` | 53 |
| `client/application/session-catalog.ts` | `client/application/sessions/session-catalog.ts` | 323 |
| `client/application/session-commands.ts` | `client/application/sessions/session-commands.ts` | 261 |
| `client/application/session-workflows.ts` | `client/application/sessions/session-workflows.ts` | 451 |
| `client/application/settings-workflows.ts` | `client/application/settings/settings-workflows.ts` | 333 |
| `client/application/stream-lease-controller.ts` | `client/application/turn/stream-lease-controller.ts` | 62 |
| `client/application/stream-state-bundle.ts` | `client/application/turn/stream-state-bundle.ts` | 27 |
| `client/application/transcript-history.ts` | `client/application/transcript/transcript-history.ts` | 125 |
| `client/application/transcript-request-ownership.ts` | `client/application/transcript/transcript-request-ownership.ts` | 68 |
| `client/application/turn-commands.ts` | `client/application/turn/turn-commands.ts` | 265 |
| `client/application/turn-coordinator.ts` | `client/application/turn/turn-coordinator.ts` | 164 |
| `client/application/unread.ts` | `client/application/sessions/unread.ts` | 198 |
| `client/application/workspace-queries.ts` | `client/application/workspace/workspace-queries.ts` | 828 |
| `client/components/AccountLoginDialog.tsx` | `client/components/account/AccountLoginDialog.tsx` | 223 |
| `client/components/ActivityIndicator.tsx` | `client/components/transcript/ActivityIndicator.tsx` | 369 |
| `client/components/ArchonPage.tsx` | `client/components/shell/ArchonPage.tsx` | 5 |
| `client/components/ArchonShell.tsx` | `client/components/shell/ArchonShell.tsx` | 14 |
| `client/components/AssistantBody.tsx` | `client/components/transcript/AssistantBody.tsx` | 370 |
| `client/components/Composer.tsx` | `client/components/composer/Composer.tsx` | 14 |
| `client/components/ContextMenu.tsx` | `client/components/shared/ContextMenu.tsx` | 152 |
| `client/components/ConversationUsageBanner.tsx` | `client/components/account/ConversationUsageBanner.tsx` | 248 |
| `client/components/DiffCard.tsx` | `client/components/transcript/DiffCard.tsx` | 217 |
| `client/components/GoalBanner.tsx` | `client/components/goal/GoalBanner.tsx` | 205 |
| `client/components/InteractionPanel.tsx` | `client/components/interactions/InteractionPanel.tsx` | 468 |
| `client/components/LeftRail.tsx` | `client/components/sessions/LeftRail.tsx` | 14 |
| `client/components/MessageActions.tsx` | `client/components/transcript/MessageActions.tsx` | 237 |
| `client/components/MessageAttachments.tsx` | `client/components/transcript/MessageAttachments.tsx` | 238 |
| `client/components/MessageItem.tsx` | `client/components/transcript/MessageItem.tsx` | 306 |
| `client/components/ModelPicker.tsx` | `client/components/models/ModelPicker.tsx` | 1126 |
| `client/components/ModelSettingsFlyout.tsx` | `client/components/models/ModelSettingsFlyout.tsx` | 423 |
| `client/components/NotFound.tsx` | `client/components/shell/NotFound.tsx` | 2 |
| `client/components/OutputError.tsx` | `client/components/transcript/OutputError.tsx` | 214 |
| `client/components/PlanModeCards.tsx` | `client/components/interactions/PlanModeCards.tsx` | 388 |
| `client/components/PluginManagement.tsx` | `client/components/plugins/PluginCatalogue.tsx` | 1208 |
| `client/components/RailRow.tsx` | `client/components/sessions/RailRow.tsx` | 49 |
| `client/components/SessionComposer.tsx` | `client/components/composer/WebuiComposer.tsx` | 2460 |
| `client/components/SessionRail.tsx` | `client/components/sessions/SessionRail.tsx` | 1342 |
| `client/components/SessionTranscript.tsx` | `client/components/transcript/SessionTranscript.tsx` | 814 |
| `client/components/SettingsModal.tsx` | `client/components/settings/SettingsModal.tsx` | 232 |
| `client/components/StartupFallback.tsx` | `client/components/shell/StartupFallback.tsx` | 60 |
| `client/components/ThinkingTrigger.tsx` | `client/components/composer/ThinkingTrigger.tsx` | 186 |
| `client/components/ToggleSwitch.tsx` | `client/components/shared/ToggleSwitch.tsx` | 38 |
| `client/components/Transcript.tsx` | `client/components/transcript/Transcript.tsx` | 13 |
| `client/components/TranscriptPrimitives.tsx` | `client/components/transcript/TranscriptPrimitives.tsx` | 609 |
| `client/components/TranscriptSkeletons.tsx` | `client/components/transcript/TranscriptSkeletons.tsx` | 118 |
| `client/components/TurnNavigator.tsx` | `client/components/transcript/TurnNavigator.tsx` | 277 |
| `client/components/UserMenu.tsx` | `client/components/account/UserMenu.tsx` | 271 |
| `client/components/WebuiClientFoundationApp.tsx` | `client/components/shell/WebuiClientFoundationApp.tsx` | 1644 |
| `client/components/WebuiErrorBoundary.tsx` | `client/components/shell/WebuiErrorBoundary.tsx` | 130 |
| `client/components/WorkspaceArchiveView.tsx` | `client/components/workspace/WorkspaceArchiveView.tsx` | 257 |
| `client/components/WorkspaceCanvas.tsx` | `client/components/workspace/WorkspaceCanvas.tsx` | 388 |
| `client/components/WorkspaceFileTree.tsx` | `client/components/workspace/WorkspaceFileTree.tsx` | 59 |
| `client/components/WorkspaceHtmlPreview.tsx` | `client/components/workspace/WorkspaceHtmlPreview.tsx` | 139 |
| `client/components/WorkspaceMediaPreview.tsx` | `client/components/workspace/WorkspaceMediaPreview.tsx` | 162 |
| `client/components/WorkspacePanels.tsx` | `client/components/workspace/WorkspacePanels.tsx` | 666 |
| `client/icons.tsx` | `client/components/shell/icons.tsx` | 678 |
| `client/markdown.tsx` | `client/components/transcript/markdown.tsx` | 380 |
| `client/no-project.ts` | `client/infrastructure/no-project.ts` | 18 |
| `client/paths.ts` | `client/projection/common/paths.ts` | 34 |
| `client/projection/action-requests.ts` | `client/projection/sessions/action-requests.ts` | 135 |
| `client/projection/composer-history.ts` | `client/application/composer/composer-history.ts` | 270 |
| `client/projection/composer-interactions.ts` | `client/projection/composer/composer-interactions.ts` | 146 |
| `client/projection/composer-state.ts` | `client/projection/composer/composer-state.ts` | 108 |
| `client/projection/context-breakdown.ts` | `client/projection/composer/context-breakdown.ts` | 201 |
| `client/projection/context-usage-popover.ts` | `client/projection/composer/context-usage-popover.ts` | 153 |
| `client/projection/context-usage.ts` | `client/projection/composer/context-usage.ts` | 29 |
| `client/projection/effect-reducer.ts` | `client/application/turn/effect-reducer.ts` | 465 |
| `client/projection/event-parsers.ts` | `client/projection/interactions/event-parsers.ts` | 117 |
| `client/projection/flyout-position.ts` | `client/projection/common/flyout-position.ts` | 128 |
| `client/projection/goal-state.ts` | `client/projection/goal/goal-state.ts` | 108 |
| `client/projection/message-file-reference.ts` | `client/projection/transcript/message-file-reference.ts` | 37 |
| `client/projection/message-parts.ts` | `client/projection/transcript/message-parts.ts` | 665 |
| `client/projection/message-projection.ts` | `client/projection/transcript/message-projection.ts` | 520 |
| `client/projection/model-favorites.ts` | `client/projection/models/model-favorites.ts` | 164 |
| `client/projection/model-picker-cascade.ts` | `client/projection/models/model-picker-cascade.ts` | 121 |
| `client/projection/model-picker-hover.ts` | `client/projection/models/model-picker-hover.ts` | 98 |
| `client/projection/model-picker-search.ts` | `client/projection/models/model-picker-search.ts` | 132 |
| `client/projection/model-reorder.ts` | `client/projection/models/model-reorder.ts` | 10 |
| `client/projection/outside-close.ts` | `client/projection/common/outside-close.ts` | 266 |
| `client/projection/overlay-geometry.ts` | `client/projection/common/overlay-geometry.ts` | 56 |
| `client/projection/plan-mode.ts` | `client/projection/interactions/plan-mode.ts` | 285 |
| `client/projection/questionnaire-state.ts` | `client/projection/interactions/questionnaire-state.ts` | 113 |
| `client/projection/review-state.ts` | `client/projection/transcript/review-state.ts` | 434 |
| `client/projection/session-activity.ts` | `client/projection/sessions/session-activity.ts` | 324 |
| `client/projection/shell-surface.ts` | `client/projection/shell/shell-surface.ts` | 65 |
| `client/projection/stream-recovery.ts` | `client/projection/turn/stream-recovery.ts` | 23 |
| `client/projection/stream-state.ts` | `client/projection/turn/stream-state.ts` | 540 |
| `client/projection/terminal-size.ts` | `client/projection/workspace/terminal-size.ts` | 75 |
| `client/projection/thinking-control.ts` | `client/projection/models/thinking-control.ts` | 254 |
| `client/projection/token-plan-model.ts` | `client/projection/models/token-plan-model.ts` | 67 |
| `client/projection/tool-projection.ts` | `client/projection/transcript/tool-projection.ts` | 297 |
| `client/projection/transcript-projection.ts` | `client/projection/transcript/transcript-projection.ts` | 334 |
| `client/projection/transcript-scroll.ts` | `client/projection/common/transcript-scroll.ts` | 60 |
| `client/projection/transcript-shape.ts` | `client/projection/transcript/transcript-shape.ts` | 479 |
| `client/projection/unread-badge.ts` | `client/projection/common/unread-badge.ts` | 14 |
| `client/projection/usage-settings.ts` | `client/projection/models/usage-settings.ts` | 69 |
| `client/projection/workspace-file-tree.ts` | `client/projection/workspace/workspace-file-tree.ts` | 110 |
| `client/projection/workspace-panel-state.ts` | `client/projection/workspace/workspace-panel-state.ts` | 319 |
| `client/projection/workspace-progress.ts` | `client/projection/workspace/workspace-progress.ts` | 407 |
| `client/projection/worktree-state.ts` | `client/projection/sessions/worktree-state.ts` | 128 |
| `client/rail-buckets.ts` | `client/projection/sessions/rail-buckets.ts` | 151 |
| `client/router.ts` | `client/projection/common/router.ts` | 6 |
| `client/slash-palette.ts` | `client/components/composer/slash-palette.ts` | 417 |
| `client/team-mode.ts` | `client/infrastructure/team-mode.ts` | 65 |
| `client/value-readers.ts` | `client/contracts/value-readers.ts` | 101 |

**Rows this table is missing, and rows it must replace.** The 116 rows above are not the whole set.

**Class (d) — three files that had no row at all, producing 8 executable rows.** Two rows that appeared in an
earlier draft — `UsageQuotaPanel` and `ModelSourcePanel` — are **removed**: both are `audit` under §16.10 and
produce no target and no task. They are recorded in §16.10 and nowhere here. (`MemoryManagerDialog` owns eleven
states and its own save and delete-confirm, so it is a target in its own right, not part of `MemorySection`):

| from | to | lines |
| --- | --- | ---: |
| `client/components/QueuePanel.tsx` | `client/components/composer/QueuePanel.tsx` | 81 |
| `client/components/settings/PersonalizationSettings.tsx` | `client/components/settings/PersonalizationSettings.tsx` (thin page) | 144 |
| " | `client/components/settings/GlobalInstructionsSection.tsx` | 203 |
| " | `client/components/settings/UserProfileSection.tsx` | 265 |
| " | `client/components/settings/MemorySection.tsx` | 211 |
| " | `client/components/settings/MemoryManagerDialog.tsx` | 534 |
| `client/components/settings/UsageModelSettings.tsx` | `client/components/models/ProviderFormPanel.tsx` | 243 |
| " | `client/components/settings/UsageModelSettings.tsx` (parent — the shared lifecycle block) | 258 |

The `UsageModelSettings` targets follow §5.6's backfill: quota is `account`'s and provider CRUD is `models`',
so the form's commands leave for `models` before the surfaces separate.

**The four splitting component files — 11 executable rows replacing 4 existing entries.** Three rows that
appeared in an earlier draft are **removed**: `DesktopSettingsPage` is `withdraw`, and `WorktreeSettingsPage` and
`ArchivedSessionsPage` are `audit` — they produce no target and no task, and are recorded in §16.10 and nowhere here:

| replaces | with | lines |
| --- | --- | ---: |
| `SessionComposer.tsx` -> `components/composer/WebuiComposer.tsx` | `components/composer/WebuiComposer.tsx` | 2460 |
| " | `components/workspace/WebuiWorkspaceDirectoryBrowser.tsx` | 182 |
| " | `components/sessions/ContextUsageIndicator.tsx` | 343 |
| `PluginManagement.tsx` -> `components/plugins/PluginCatalogue.tsx` | `components/plugins/PluginCatalogue.tsx` | 1208 |
| " | `components/plugins/PluginItemDialog.tsx` | 370 |
| " | `components/plugins/PluginImportDialog.tsx` | 138 |
| `SettingsModal.tsx` -> `components/settings/SettingsModal.tsx` | `components/settings/SettingsModal.tsx` (shell + primitives) | 232 |
| " | `components/workspace/ReviewSettingsPage.tsx` | 317 |
| `UserMenu.tsx` -> `components/account/UserMenu.tsx` | `components/account/UserMenu.tsx` (shell) | 271 |
| " | `components/account/UserMenuSignin.tsx` | 401 |
| " | `components/account/UserMenuUsage.tsx` | 217 |

**No new row:** `SessionRail.tsx`, `ModelPicker.tsx`, `GoalBanner.tsx` and `MessageItem.tsx` keep their existing
rows — their cuts stay inside files already tabulated.

Every one follows from §9's own enumeration, quoted here so each row carries its own citation:

| from | to | lines | §9's sentence |
|---|---|---:|---|
| `client/contracts/execution-port.ts` | `client/contracts/turn/execution-port.ts` | 57 | "…`execution-port` splits three ways (`sendMessage`/`resumeSession` → the substrate, `runCommand` → `composer`, `watchEvents` → `shell`/`turn`)" |
| " | `client/contracts/composer/command-port.ts` | 41 | same |
| " | `client/contracts/shell/watch-port.ts` | 29 | same |
| `client/contracts/settings-port.ts` | `client/contracts/models/provider-port.ts` | 47 | "`settings-port`'s 53 members divide mechanically (models + providers → `models`; …)" |
| " | `client/contracts/settings/settings-port.ts` | 62 | same |
| `client/contracts/session-port.ts` | `client/contracts/sessions/session-port.ts` | 66 | "`session-port` splits between `sessions` and `transcript`" |
| " | `client/contracts/transcript/session-read-port.ts` | 37 | same |
| `client/contracts/interaction-port.ts` | `client/contracts/interactions/interaction-port.ts` | 34 | "`interaction-port` (24) maps to `interactions` and `goal`" |
| " | `client/contracts/goal/goal-port.ts` | 22 | same |
| `client/contracts/account-port.ts` | `client/contracts/account/account-port.ts` | 30 | §9's port enumeration |
| `client/contracts/plugin-port.ts` | `client/contracts/plugins/plugin-port.ts` | 31 | same |
| `client/contracts/terminal-port.ts` | `client/contracts/workspace/terminal-port.ts` | 47 | "`terminal-port`'s 15 members remain the capability record criterion C produced" — a capability inside `workspace` |
| `client/contracts/workspace-port.ts` | `client/contracts/workspace/workspace-port.ts` | 82 | §9's port enumeration |


**Validity note — what this table is and is not.** Every source above was checked against the working tree:
each exists, no two rows share a target, and every target's business directory is one of §4's twelve (plus
`projection/common/` and `components/shared/`, the two deliberate non-business homes). Three corrections were
made against an earlier draft, all found by review rather than by reading the gate: `GoalBanner.tsx` and
`goal-state.ts` belong to **`goal`**, not `interactions`; `shell-surface.ts` belongs to **`shell`**, not
`sessions`; and the `stream-state`/`stream-recovery` pair belongs to **`turn`** — `projection/stream/` was
never a business.

**One row gains a target after the action inventory.** `listSkills` (`settings-port.ts:57`) is the member
that carries the skill listing §4.2 and §4.8 publish to the composer's palette, and neither target above
holds it. It files under `client/contracts/plugins/` (the operator's decision, 2026-10-12); the inventory
that found it is `docs/webui/plugin-action-inventory.md`. The three cells' line budget is re-derived at
A3, because a line count here is a sizing estimate, not a source partition.

**Phase 3's own modules — supplemental path records (added 2026-10-13).**
Phase 3 *creates* modules as well as moving them: a carve that separates a duty has to leave the separated code
somewhere, and §6.1's tree is what names that somewhere. The rows below record the six relocated modules and
shared glyph extraction, plus `ReviewSettingsPage` already listed in the split-component table. These rows
explain destinations already included in the 155-row, 155-target count above; they are not additional targets.

| from | to | lines | created by |
| --- | --- | ---: | --- |
| `client/application/models-workflows.ts` | `client/application/models/models-workflows.ts` | 310 | the `models` duty carve: §5.6 gives that business the catalogue, the selection and the provider list |
| `client/application/goal-coordinator.ts` | `client/application/goal/goal-coordinator.ts` | 178 | B1, separating the goal duty from the interaction coordinator (§5.6 `goal`) |
| `client/application/turn-capabilities.ts` | `client/application/turn/turn-capabilities.ts` | 79 | §8 Phase 1 step 1; §5.6's `turn` row names the turn capability slice as `turn`'s |
| `client/projection/event-kinds.ts` | `client/projection/common/event-kinds.ts` | 156 | B1's S9 registry — the one enumeration of the goal and interaction event families, shared by two businesses, so it files at the non-business home (§6.1) rather than under either |
| `client/projection/rail-menu.ts` | `client/projection/sessions/rail-menu.ts` | 119 | B3's S1 — the rail is a place the user works and the menu is the rail's rule (§4.1) |
| `client/projection/workspace-name.ts` | `client/projection/workspace/workspace-name.ts` | 23 | B3, moving the rule off `SessionRail.tsx` (§5.6 `workspace`) |
| `client/components/workspace/ReviewSettingsPage.tsx` | *(at its target)* | 317 | §16.10 `execute`. Created as `SettingsReviewPage.tsx` and renamed to this row's basename on 2026-10-13, so the tree matches §15.1 and §16.10 |
| `client/components/settings/settings-atoms.tsx` | `client/components/shared/settings-glyphs.tsx` | 9 | extracted the shared `SearchIcon` and `FolderIcon` presentation helpers so settings and review pages use one glyph module; the source module remains for settings-specific atoms; no business owns the shared presentation, so `components/shared/`, §6.1's non-business home |**Three Phase 3 modules need no row.** `client/application/query-store.ts` (115 lines — the cached-read fence |
§16.3 requires to exist once), `client/application/version-cell.ts` (42 — one version cell per fence) and
`client/application/port-slices.ts` (296 — the per-business slice constructor) are **root-shared application
modules**, which §6.1's tree provides for beside `create-application.ts`, `state.ts`, `session-store.ts` and
`selectors.ts`. Their Phase 4 target is their current path.

**Four of the contract rows above carried a basename the A3 re-file did not use; aligned on 2026-10-13.**
`composer/command-port.ts` is on disk as `composer/composer-port.ts`, `shell/watch-port.ts` as
`shell/event-port.ts`, `models/provider-port.ts` as `models/models-port.ts`, and
`transcript/session-read-port.ts` as `transcript/transcript-port.ts`. The rows' basenames are the authority and
the tree moved to them. This rename stays inside `client/contracts/`, which §6.1 classifies by prefix, so —
unlike a rename inside `client/projection/` — it cannot change a module's classification.

**What this table cannot prove.** It is a mapping, not a census. `PROJECTION_SPLIT` and
`CLIENT_FILE_PROVENANCE` are tables of *mappings*, and a mapping outlives the file it described — two of
`PROJECTION_SPLIT`'s four entries point at files that have already moved or never existed (§7.2), and two
rows of an earlier draft of this table were exactly that error. Read this as the move list for Phase 4 and
re-check each source against the tree at the time of the move.### 15.2 What each business owns across the layer boundaries

`client/contracts/` is re-filed per §9. The cross-process layers are named here so a reader can see that the
carve stops at the client's own boundary, and `shared/contracts/` holds its 16 DTOs:

| Business | `client/contracts/` (from §9) | `shared/contracts/` |
| --- | --- | --- |
| `sessions` | `session-port`'s session half | `session.ts` |
| `composer` | `execution-port`'s `runCommand` | `commands.ts` |
| `transcript` | `session-port`'s message half | `messages.ts`, `review.ts` |
| `workspace` | `workspace-port`, `terminal-port` (the capability) | `workspace.ts`, `canvas.ts`, `terminal.ts` |
| `interactions` | `interaction-port` | `interactions.ts` |
| `goal` | `interaction-port`'s goal members | `goal.ts` |
| `models` | `settings-port`'s model/provider members | `models.ts` |
| `plugins` | `plugin-port` — **and see 15.3** | — |
| `settings` | `settings-port`'s instructions/memory/profile members | `personalization.ts` |
| `account` | `account-port` | `account.ts`, `usage-quota.ts` |
| `shell` | `execution-port`'s `watchEvents` | `stream.ts` |
| `turn` | `execution-port`'s `sendMessage`/`resumeSession` | `stream.ts`'s frame types, `queue.ts`, `version.ts` |

Cells are derived from the declarations as they stand; each is confirmed or corrected during its Phase 3
pass rather than assumed here.

### 15.3 Why `server/operation/` and `runtime/harness/` get two lists, not a grid

Both layers are **already cut one file per capability**, so a per-business grid would be uniformly "stays" and
would tell a reader nothing. The honest artifact is two exception lists, both of which the re-file needs:

**A capability with a port but no business of its own** — the record that criterion C produced a capability
rather than a business:

- `terminal-port` (15 members) → the `terminal` capability inside `workspace`. Confirmed against Desktop in
  §14.4: a terminal is bound to a session and destroyed with it, so it does not get a business.

**A business with no port of its own** — this is the one that under-scopes the work if it is missed:

- `plugins` — 1 port member (`plugin-port`) standing in front of 29 actions. **The re-file must be driven by
  the action inventory, not the member count**, or `plugins` is carved an order of magnitude too small.

For completeness, the two layers as they stand today, so nothing is hidden by the summary:
`server/operation/` holds 20 files — `account.ts`, `agent-memory.ts`, `bind-handlers.ts`, `common.ts`, `goal.ts`, `interaction.ts`, `memory-settings.ts`, `messages.ts`, `operation-contract.ts`, `operation-dispatch.ts`, `operations.ts`, `permission-mode.ts`, `personalization.ts`, `plugin-management.ts`, `provider.ts`, `questionnaire.ts`, `queue.ts`, `session.ts`, `user-profile.ts`, `workspace.ts` — and `runtime/harness/` holds
10 — `account.ts`, `adapter.ts`, `execution.ts`, `host-contract.ts`, `interactions.ts`, `models-plugins.ts`, `requirements.ts`, `sessions.ts`, `settings.ts`, `workspace.ts`. Neither layout changes in this programme; what changes is that
the client's own declaration layer stops being cut across them (§9).

### 12.8 The behaviour risks, bound to a phase check

The lead review's third risk was that this programme moves lifecycle and failure paths while verifying them
mostly structurally. Each risk below therefore names the evidence that can exist short of a live browser run,
and the honest floor for it. The list is what §12.5 leaves abstract.

| Risk the carve touches | Evidence short of a live run | Floor | Phase |
| --- | --- | --- | --- |
| The generation fence | `test/unit/stream-lease.test.ts` plus `ownsWebuiStreamGeneration` (`application/turn-commands.ts:101`) | machine | 1 |
| Request attribution | `application/transcript-request-ownership.ts`, asserted through `test/unit/transcript-shape.test.ts` and `test/unit/webui-application-commands.test.ts` — **there is no test file named after that module**, so its coverage is indirect and must be read rather than assumed | machine + reading | 3 (`transcript`) |
| **Absent optional capability** | `application/turn/turn-commands.ts` guards the path; registered `test/unit/turn-substrate-fences.test.ts:212` asserts the absent-capability exit releases the raw sink exactly once | machine + reading | 1 |
| Mount and release | `test/unit/webui-shell.test.ts`, `test/unit/connection-health.test.ts` for construction; "exactly one channel per mount" is not machine-checkable today | machine + reading | 2 |
| Refresh | `test/unit/session-stream-retry.test.ts` | machine | 2 |
| Reconnect | `test/unit/session-stream-retry.test.ts` | machine | 2 |
| Late results across a session switch | the request-ownership path above | machine | 3 (`transcript`) |
| Failure recovery | `test/unit/session-stream-retry.test.ts`, `test/unit/questionnaire-goal-autoreply.test.tsx` | machine | 3 (`interactions`, `goal`) |

**The floor for every row above is unit or SSR evidence.** None of it establishes live-interaction behaviour —
mount and unmount timing, focus effects and streaming cadence need a browser, and the registered browser suite
needs a built client (`§12.5`'s row for `pnpm test:webui-browser`). This paragraph is the one place the plan
says so, and nothing later may imply otherwise.


### 15.4 The ten held contracts — the dispositions, decided

**Each of the ten carries exactly one disposition: `move`, `keep` or `delete`. §15.1 does not presume they move.** The dispositions below are **decided, not proposed.** The enumeration is `contract-re-file-inventory.md`, produced at `876a48e6`, and it is what `#59` (A3) executes.

| file | line | disposition | target | why |
| --- | ---: | --- | --- | --- |
| `stream-state.ts` | 182 | **move** | `client/contracts/turn/stream-state.ts` | declares `WebuiStreamState`, `WebuiStreamSubscription`, `WebuiStreamMessage`; its importers are `mechanisms/stream-loop.ts`, `mechanisms/stream-lease.ts` and `projection/stream-state.ts`, all `turn`'s. **Not** the same-named file under `projection/` that §15.3 assigns to `turn` |
| `slash-command.ts` | 111 | **move** | `client/contracts/composer/slash-command.ts` | declares the palette's vocabulary (`SlashComposerMode`, `SlashPaletteSection`, `classifyWebuiSlashCommand`); importers are `projection/composer-state.ts`, `slash-palette.ts`, `SessionComposer.tsx` |
| `transcript-view.ts` | 105 | **move** | `client/contracts/transcript/transcript-view.ts` | declares the transcript's render shapes (`WebuiTranscriptItem`, `WebuiTranscriptProcessSegment`); importers are `projection/transcript-*` and `components/transcript/*` |
| `message-view.ts` | 89 | **move** | `client/contracts/transcript/message-view.ts` | declares the message entity, page and loader — §9's "session-port's message half", which §15.2 assigns to `transcript` |
| `model-view.ts` | 85 | **move** | `client/contracts/models/model-view.ts` | declares the picker's shapes; every importer is on the `models` surface |
| `session-view.ts` | 39 | **move** | `client/contracts/sessions/session-view.ts` | declares `WebuiClientSession`, `WebuiClientProject`, `WebuiClientSessionTreeNode` — §9's "session-port's session half" |
| `review-view.ts` | 34 | **move** | `client/contracts/transcript/review-view.ts` | declares `WebuiDiffState` and `WebuiDiffStateAction`, the state and action types of `reduceWebuiDiffState`; the reducer is currently `projection/transcript/review-state.ts`, and the types remain with that transcript-owned state machine. `workspace` presents review surfaces and commands the `review` capability, but does not own this state machine |
| `transport.ts` | 34 | **keep** | `client/contracts/transport.ts` | declares the composed `WebuiTransport` type used at the composition root and by application slice construction. Phase 2 removed generic transport forwarding to business components; it did not remove this composition-root type contract |
| `workspace-view.ts` | 9 | **delete** | — | **zero declarations, zero importers.** It holds a comment only: the runtime-layer plan reserved it as a target-layout placeholder, and the comment records that every workspace and review view moved to `shared/contracts/`, so no browser-local workspace type remains |
| `execution-state.ts` | 9 | **delete** | — | same shape: **zero declarations, zero importers**, and the comment states the active-turn trio is a shared wire DTO with no browser-local copy left to declare |

**Seven `move`, one `keep`, and two `delete`.** The two zero-declaration files were deleted on 2026-10-13. They are `delete` rather than `keep` for the
reason this section itself gives: a `keep` means the file stays in the delivered tree and the layout claims a
home it does not fill, and the new `client/contracts/<business>/` tree is the declared home for a future
browser-local view, so the placeholder has nothing left to stand for. Both were verified to have no importer
in `src/client` or `test`; the only textual matches are a CSS class and a component's own class string.
**All ten dispositions are represented in the current tree:** seven moves, one retained composition-root
contract, and two deleted placeholders. The generated source inventory is regenerated with the final file set.

**Entry conditions common to all ten.** (a) Each disposition is recorded here and in `contract-re-file-inventory.md`. (b) §15.1 line counts and destination totals are regenerated against the final tree. (c) `release/public-source.json` is regenerated for the final file set. A `delete` disposition removes a row and a file.

---

---

---

## 16. Two rules for overweight units, and what they forbid

*(Placed after Appendix A rather than before it so that the `§15.x` section numbers referenced
throughout this plan do not move. This section is normative: a reviewer applies it by hand.)*

These rules decide two questions at two granularities. Per §5.4's I9 and §12.1, **neither has a machine
rule.** `check:webui-dependency` enforces layer direction, cycles and capability calls; it cannot express
"this region owns its state", "this surface has its own lifecycle", or "these two must not be parted".
**A reviewer applies this section by hand** and MUST record, for every boundary created: which rule claimed
it, the evidence, and the 16.0 check result.

### 16.0 The protocol-duty gate — a precondition that vetoes

**No boundary may be created under 16.1 or 16.2 until this gate has been run and passed.** It is assessed on
**protocol duty and semantic preservation, not on file or step counts.**

**P1 — Did the cut cross a protocol layer?** A cut MUST NOT move a declaration across a protocol boundary:
a wire event, its reducer, its coordinator and its presentation are four different duties, and a change to any
one of them is expected to touch the others. If the cut makes a change to `permission.ask` or to a new wire
operation touch **fewer duties than before**, the cut has absorbed a protocol hop and **MUST be refused**.

**P2 outranks §16.9.** B1 and B2 are **maintenance-benefit judgements only**; they may not authorise, justify or
excuse a change to when data loads, what mounts, what unmounts, what state resets, or what any command returns.
**A cut that answers neither B1 nor B2 is withdrawn; a cut that fails P2 is refused regardless of how well it
answers B1 and B2.** A lifecycle change is **out of §16's scope entirely** — it is a behaviour change under §14.5
and requires its own record, verification and approval; §16 has no mechanism to authorise one.

**P2 — Is observable behaviour preserved?** The cut MUST NOT change what a user sees, what a command returns,
what is requested and when, or what survives a mount, unmount, tab switch or session switch. **There is no path
inside §16 that permits a lifecycle change: it is a behaviour change under §14.5 and is out of §16's scope.**
B1 and B2 are maintenance-benefit judgements (§16.9) and **may not authorise, justify or excuse one**.

**P3 — Does a shared invariant keep one implementation and a stated order?** (16.3)

**Counts are deliberately not the gate.** §6.1 already declares fewer lines, more files and deeper directories
non-goals; freezing file counts would re-import that non-goal as a measurement. **S2 and S7 remain the plan's
control rows for reading the gate's outcome**, but the gate asks whether the protocol duties they exercise are
still four and still thirteen — not whether a directory listing happens to shrink.

### 16.1 The declaration rule — when a body is cut

A declaration is worth cutting when **all four** hold:

1. **It contains two or more regions, each encapsulating an independent interaction or lifecycle.** The test is
   *encapsulation*, not *state creation*. A region qualifies when the interaction it performs — load, edit,
   save, retry, navigate, open, close — would have to exist somewhere regardless, and the region performs all
   of it.
2. **Encapsulated, not duplicated.** A region qualifies by **holding the state, delegating to exactly one
   owner, or reading an existing owner** — never by **copying** it. A module that manufactures a second copy
   of state to satisfy this clause has failed it, and the copy must not be introduced. **Reading an existing
   application owner forms a legitimate module.**
3. **Each region is a boundary the source already names** — a union member, a `data-*` marker a registered
   test selects, a dialog or panel, or a state group with a common prefix.
4. **The benefit precondition (§16.9) is answered** — both B1 and B2, not just one.

**The rule applies only after the duty carve.** Before the carve a component's regions hold other businesses'
state and clause 1 cannot be evaluated.

**Withdrawn by this clause:** a component that carries **one interaction across many state groups does not
split.** `GoalBanner.tsx` holds seven state names, but the banner is one interaction — show the objective,
expand it, tick the elapsed time, confirm a clear. Assembling it into three declarations produces three small
modules whose readers must hold the whole banner in their heads to follow any one of them, which is a net
loss. `WebuiGoalClearDialog` already exists and already owns its own root; the remaining split is
**withdrawn**.

### 16.2 The file rule — when a file is separated

A file is worth separating when it holds **two or more surfaces**, where each surface **encapsulates an
independent interaction or lifecycle** under 16.1's clauses 1 and 2, and each **delegates to its own owner and
commits through its own command**. **Loading is not part of the test:** a surface's load may be owned by a parent
that keeps it mounted, and **an existing load schedule MUST NOT be moved into a surface** (§5.7 LC-2, LC-6).
Separating a surface changes who holds its interaction, never when its data arrives

**A surface is a complete change scope, not a container of state.** Three classes that the earlier "owns state"
wording could not explain consistently now resolve as follows, and the resolutions are the rule's test cases:

| case | why it qualifies | what it is |
| --- | --- | --- |
| `UserMenu`'s signin and usage panels | They **own no local state** — both are controlled by the shell. Each is nevertheless a complete interaction: fetch on demand, render, retry on failure, render its own skeleton. **Reading the owner forms the module** (16.1.2) | separate |
| `SettingsModal`'s tab pages | `Appearance` **holds no state at all** — props in, markup out. It qualifies because a change to desktop-appearance settings is made wholly within that page; the page is a **complete change scope** | separate |
| `PersonalizationSettings`' three editors | **Co-visible, and that is not a counter.** Each editor is an independent **edit lifecycle** — load, edit, save, error, retry — committing through its own command (`setGlobalInstructions`, `setUserProfile`, `setAgentMemory` + `setMemorySettings`) | separate |

**Co-visibility and declaration count are not tests at either level.** A tab that changes which data flows
through one component is a view parameter; a tab whose page is a complete change scope is a surface.

### 16.3 Shared invariants — one implementation and a stated order

**A shared invariant holds when exactly one implementation exists and the execution order is stated and
enforced. Co-location is neither necessary nor sufficient.**

**Two modules may call the same guard through an explicit command and the invariant still holds.** Extracting a
shared fence, a path-safety guard chain, or a command-order rule into its own module is permitted and is
sometimes the correct move. What is forbidden is **a second implementation** and **an unstated order**.

Three live cases, restated under this scope:

- `createWebuiWorkspaceQueries`' three machines share one `versions` late-response fence and one `listeners`
  set. The machines may be separated **provided each reaches the one fence**; forking it creates a second
  state source and violates §5.1.
- `runtime/workspace-archive.ts`'s two operations share one traversal envelope — `resolveEntryPath` at `:266`
  and `:340`, `resolveInside` at `:298`/`:325`/`:330`, `normalizeEntryName` at `:423`–`:668`. Extracting that
  envelope into a module called by both is permitted; **re-implementing any part of it per operation is not.**
- `reduceWebuiEffect`'s three business families share three order invariants its own comments state: the
  session guard runs first and returns the same state object; `reduceWebuiWorkspaceProgressEvent` is called
  unconditionally; the progress write is always the first command. **Any separation MUST state and preserve
  that order.** This clause no longer forbids the split; it constrains it.

### 16.4 Composition — one boundary, one rule, file rule first

**A boundary is claimed by exactly one rule, and the file rule is evaluated first.** A file split moves a
region into **its own file**, where it is a single declaration and 16.1 then finds nothing; a declaration cut
moves a region into **its own declaration inside the same file**. They are sequential. **A reviewer MUST NOT
claim the same boundary under both rules.** Where both appear in one unit they must name different
boundaries; otherwise the file-rule claim stands and the declaration-rule claim is withdrawn.

`MemoryManagerDialog` is the legitimate case: the file rule does not separate it — it is the memory surface's
own dialog — and 16.1 extracts its delete-confirm overlay (`:1301-1360`, `confirmingDelete` `:962`) as a
sibling declaration **in the same file**.

### 16.5 Prohibitions — a reviewer MUST refuse

1. **MUST NOT cut a declaration for length.** `InteractionPanel.tsx` (469 lines) has three regions and one
   state-owning one — the questionnaire; its other two are stateless markup. **Refuse.**
2. **MUST NOT cut a region that encapsulates no independent interaction or lifecycle.** A region's state is not
   what qualifies it. **A controlled region qualifies**: a panel that renders and retries from state an owner
   holds is a module, and separating it moves **no state and forks no owner**. What MUST be refused is a region
   with no interaction of its own — markup that exists only to be indented.
3. **MUST NOT count a mirror as owned state.** `ModelPicker.tsx`'s `favoriteIds` is read from
   `favorites.read()` on open and written through `favorites.write()`; the store is the only writer.
4. **MUST NOT count a launcher as a surface.** `UserMenu.tsx` renders `SettingsModal` (imported `:22`) and
   `AccountLoginDialog` (`:879`) — both already separate files. `UserMenu` holds **two** in-file surfaces
   (signin, usage), not five.
5. **MUST NOT cut or separate a construct with no lifecycle** — a table, map, registry, enum, route list or
   class. **This binds 16.2 as well as 16.1.** `server/operation/bind-handlers.ts` is 1064 lines because it is
   **86 entries in one object literal** (`:464-1028`); `runtime/usage-quota.ts` (805) is one client class over
   four endpoint paths and two origin tables.
6. **MUST NOT split a layout slot of a composition root.** A slot whose state arrives from outside as props,
   or is keyed by a longer-lived identity, is held — not owned. `WebuiClientFoundationApp`'s `pinnedSessions`
   is passed out at `:1264-1267`; `workspacePanelStates` is a sessionId-keyed `Map` read at `:1097`. **Its
   treatment is the duty carve (§8 Phase 2-3), and a split MUST be refused.**
7. **MUST NOT use declaration count as evidence.** `UserMenu.tsx` has 26 declarations and 2 in-file surfaces;
   `WebuiClientFoundationApp.tsx` has 1 declaration and ≥6 held regions; `PersonalizationSettings.tsx` has 5
   declarations and 3 surfaces. It measures writing style.
8. **MUST NOT use co-visibility as a test.** `PersonalizationSettings.tsx:325-341` renders all three sections
   unconditionally and stacked. Co-visibility is a layout fact.
9. **MUST NOT split a file whose declarations are one composite.** `WebuiProjectList` renders
   `WebuiSessionList` at `SessionRail.tsx:641`.
10. **MUST NOT separate by file where the defect is by business.** A file holding several businesses is
   re-filed by §6.1 with no content change; a file holding several surfaces of **one** business is separated
   by 16.2.
*"**MUST NOT introduce a second implementation of a shared invariant, and MUST NOT leave its execution order unstated.** Separating a guard, a fence or an order rule into its own module is permitted under 16.3 provided one implementation survives and the order is written down. Two violations the plan has already found: forking `versions`/`listeners` in `createWebuiWorkspaceQueries`, and re-implementing any part of `workspace-archive.ts`'s traversal envelope per operation."*
   test and exists because of it.
### 16.6 The population — how this table is derived

§16.7 is **not hand-built.** It is the result of two steps a reviewer can re-run, and the arithmetic below is
the check that the derivation is complete.

**Step 1 — partition by directory. Every file lands in exactly one bucket, and every bucket has a named
section that already governs it.** This is what replaces hand-building: a file in no bucket is detectable by
counting, not by recall.

| Bucket | Files | Governing section |
| --- | ---: | --- |
| `client/components/**` | **45** | **§16 — this design** |
| `client/application/**` | 27 | §5.6 duty assignment (the factories) |
| `client/projection/**` | 41 | §7 re-filing (pure derivations) |
| `client/contracts/**` | 18 | §9 port re-file |
| `client/bindings/**` | 9 | §5.5 duty table (wiring) |
| `client/mechanisms/**` | 3 | §5.5 duty table |
| `client/infrastructure/**` | 8 | §5.5 duty table |
| `client/` root files | 12 | §6.1 ("unchanged paths" + `no-project.ts`, `team-mode.ts`) |
| `server/**` | 43 | §5.5 duty table + the 16.0 control rows |
| `runtime/**` | 32 | §5.5 duty table + the 16.0 control rows |
| `shared/**` | 20 | §9 contracts + §5.5 |
| **Total** | **258** | |

**Step 2 — inside `client/components/**` only, a file's verdict is decided by its *unit* count.** A **unit**
is a declaration that **(a) encapsulates an independent interaction or lifecycle**, by holding the
state, delegating to exactly one owner, **or reading an existing owner** — and **(b) is reached by its own
navigation, dialog, panel or `data-*` root.** Clause (a) is **not** "owns state"; a state-free page (`Appearance`), a controlled panel (`UserMenu`'s signin and usage) and a co-visible editor
(`PersonalizationSettings`) are all units under it. **A declaration that duplicates an owner to satisfy clause
(a) is not a unit** and MUST be refused.
own panel, tab, dialog, or `data-*` root. A declaration that owns no state **and performs no interaction of its own** is a **part**. A declaration that owns
no state but **renders, retries and commits through a caller-supplied owner** is a **controlled unit** — it
separates, and the split moves no state and forks no owner. **What makes a part a part is the absence of an
interaction, not the absence of state.** After counting units,
the second question is **heterogeneity**: units of *different businesses* are re-filed by §6.1; units of *one*
business are surfaces under §16.2; a single unit with several state-owning regions is a §16.1 candidate.

A file with 0 or 1 unit **still receives a row**, marked `neither` with its reason. That row is what stops the
next session re-proposing the cut.

**The arithmetic a reviewer runs:** 45 + 27 + 41 + 18 + 9 + 3 + 8 + 12 = **163** (`client/`); 163 + 43
(`server/`) + 32 (`runtime/`) + 20 (`shared/`) = **258**, the measured total. The table below **names all 45
files** of `client/components/**` in **39 rows** — six rows bundle more than one file, and they are the small
ones. **Count files, not rows: if the names do not cover 45, or the bucket columns do not sum to 258, the
derivation is stale and the table must be regenerated before it is applied.**

**Prohibition 12 — a reviewer MUST NOT build this table by hand.** The three hand-built lists that produced
the first draft missed `SessionComposer.tsx`, the largest file in the package, because it had been judged
under §5.6's duty carve and therefore "already decided". **A unit is counted once per file regardless of how
many rounds have judged it**, and a file's verdict names the rule that decided it.

### 16.7 Retained population

**This is a filtered workflow, not an instruction to execute §16 mechanically.** Structural evidence produces
candidates; §16.9's benefit precondition decides execution. A candidate may be withdrawn here without a source
change, and one already withdrawn may return if a change-scope analysis is produced for it.

**New files (produce §15.1 rows):**

| Source | Targets | Lines |
| --- | --- | ---: |
| `SessionComposer.tsx` | `components/composer/WebuiComposer.tsx` · `components/workspace/WebuiWorkspaceDirectoryBrowser.tsx` · `components/sessions/ContextUsageIndicator.tsx` | 2088 · 196 · 318 |
| `PluginManagement.tsx` | `components/plugins/PluginCatalogue.tsx` · `PluginItemDialog.tsx` · `PluginImportDialog.tsx` | ~1059 · 305 · 105 |
| `SettingsModal.tsx` | `components/settings/SettingsModal.tsx` (shell) · `components/workspace/ReviewSettingsPage.tsx` | ~81 · 276 |
| `SettingsModal.tsx` | **not targets** — §16.10 withdraws `DesktopSettingsPage` and holds `WorktreeSettingsPage` and `ArchivedSessionsPage` as audit; they produce no target and no task | 19 · 67 · 30 |
| `UserMenu.tsx` | `components/account/UserMenu.tsx` (shell) · `UserMenuSignin.tsx` · `UserMenuUsage.tsx` | ~209 · 420 · 216 |
| `settings/PersonalizationSettings.tsx` | 4 editor files + the thin page | 1367 across 5 |
| `settings/UsageModelSettings.tsx` | 1 executable surface (the parent, plus `ProviderFormPanel.tsx`) | 389 across 3 |
| `settings/UsageModelSettings.tsx` | **not targets** — `UsageQuotaPanel` and `ModelSourcePanel` are audit under §16.10 and produce no target | — |
| `components/QueuePanel.tsx` | `components/composer/QueuePanel.tsx` | 81 |
| **7 sources → 19 executable rows** (20 before the five §16.10 dispositions were applied) | | |

**In-file cuts (no new file, no §15.1 row):** `SessionRail.tsx`'s `WebuiProjectList` — 3 regions (context menu, project-list expansion, rail-view strip); `ModelPicker.tsx` — 2 regions (menu cluster, drafts editor; `favoriteIds` is a mirror and is excluded). **2 candidates.**

**Withdrawn:** `GoalBanner.tsx` — one interaction across seven state groups; no real modification becomes smaller. **0 rows.**

**Downgraded to audit:** `MessageItem.tsx` —4 regions (edit, rewind, mutation, fork). The structural test passes; only a change-scope analysis can lift it. **0 rows until then.**

**Not candidates, with the reason recorded:** `InteractionPanel.tsx` (1 state-owning region of 3) · `WorkspacePanels.tsx` (8 declarations, one business, one composite) · `WorkspaceCanvas.tsx` (1 component, 0 roots — no named boundary) · `SessionTranscript.tsx` (1 region) · `WorkspaceArchiveView.tsx` (`extractState` + `destination` shared by listing and controls) · `MessageActions.tsx` (1 region; `WebuiRewindDialog` is controlled, its machine is `MessageItem`'s) · `icons.tsx`, `TranscriptPrimitives.tsx`, `TurnNavigator.tsx`, `AssistantBody.tsx`, `PlanModeCards.tsx`, `AccountLoginDialog.tsx`, `ConversationUsageBanner.tsx`, `MessageAttachments.tsx`, `OutputError.tsx`, `WorkspaceMediaPreview.tsx`, `ModelSettingsFlyout.tsx`, `ActivityIndicator.tsx` (0–1 units each) · `WebuiClientFoundationApp.tsx` (layout slots of a composition root; the duty carve is its treatment) · `server/operation/bind-handlers.ts`, `runtime/usage-quota.ts` (no lifecycle — registry and class) · `client/bindings/use-query-state.tsx` (§6.1 re-file question, not §16's).

**Counts:** **19 execute rows (12 new files, 3 relocations, 4 retained modules), 2 in-file cuts, 1 withdrawn,
4 audit, 1 downgraded, 45 files enumerated and none unnamed.** These are §16.10's dispositions and this section
**authorises nothing**; the withdrawn and audit modules carry no row. The benefit precondition is answered per module
in §16.10's record.

---

### 16.8 What this section does not claim

It does not claim fewer lines per file, more files, or deeper directories — §6.1's non-goal stands and this
section does not amend it. It does not claim every overweight unit is cut: 16.7 is the population, and 26 of
its 45 rows say **no**.

**The population governed by §16 is `client/components/**` and nothing else.** Every other directory has a
named governing section in 16.6's Step 1 — this is stated rather than implied, because the previous wording
("components and component files") silently excluded `client/projection/`, `client/application/`, `client/contracts/`,
`client/bindings/`, `server/`, `runtime/` and `shared/`, and left nothing recording that they were considered.

**The nine application factories are not governed by §16.1 or §16.2.** A factory holding several state
machines is a third shape neither rule decides; its treatment is **§5.6's duty assignment**.

And it is not policed — per §12.1, "the gate is green" is not "the boundaries are enforced."

### 16.9 The benefit precondition — a candidate without these two answers is not executed

Structural evidence **produces candidates**; maintenance benefit **decides execution**. Every candidate
records, in the plan, before any file moves:

**B1 — Which real modification becomes smaller to understand?** Name the change a maintainer actually makes —
a field added, a provider added, a surface opened — and say what it now touches. If no real modification
changes, the candidate is withdrawn.
**B2 — What does a caller now have to know that it did not before?** Record the answer even when it is
**"nothing"**. A cost-free split is **neutral, not disqualifying** — it is executed if B1 names a real
modification it makes smaller, and **withdrawn if B1 cannot**. B2 is a disclosure, not a filter. **The
withdrawal test is B1 alone.**

**A cut that improves neither is splitting for splitting's sake, and the rule admits it: "two state groups
plus two named regions" passes every structural clause and fails this one.**

**Applied — every surviving candidate, with both answers:**

| candidate | B1 — what becomes smaller | B2 — what a caller must newly know | result |
|---|---|---|---|
| **`PersonalizationSettings`** — 3 edit lifecycles | "Add a setting to the memory editor" today reads `PersonalizationSettings.tsx` from `:1`, because nothing in the filename says which editor you are changing. It reads `:713-940` | The editor file imports its own command module. A caller learns the memory editor's command home — **one fact, about the editor it already opened** | **execute** |
| **`PluginManagement`** — 3 surfaces | "Add a field to the MCP server form" today is a read of a 1595-line file containing a ternary tower over five areas; it is now `:1` of the item-dialog module | A caller must know which of three files holds the form it is editing. Mitigated: each file's name is the surface the user named | **execute** |
| **`SessionComposer`** — directory browser | "Add a workspace directory filter" today is a read of a 2977-line file; it is now `:1` of the browser module | A caller must know the browser lives under `workspace`, not `composer` — **which is the correction §6.1 was always owed** | **execute** |
| **`SessionComposer`** — context ring | "Add a context category" today is a read of 2977 lines; it is now the ring module. **This is module extraction, not a wholesale path change** | The caller learns the ring is `sessions`' presentation. **It is React/DOM presentation and must NOT go into `projection/`** — §6.1 records that `client/projection/` resolves by basename, so filing it there silently reclassifies its edges | **execute, with the stated caveat** |
| **`SettingsModal`** — 5 tab pages | "Add a setting to the worktree page" today is a read of a 526-line shell plus 8 declarations; it is now the page file | A caller must locate the page by tab name. **This is a net gain**: the tabs are already the user's model, and `custom-instructions`/`usage` already work this way | **execute** |
| **`UserMenu`** — 2 panels | "Add a sign-in day" today is a read of 888 lines mixing three surfaces; it is now the signin module | A caller learns signin and usage are separate modules under `account`. **Neither panel holds state**, so the split moves no state and forks no owner | **execute** |
| **`UsageModelSettings`** — 3 surfaces | "Add a provider field" today is a read of a file that also loads quota and API-key status; it is now the provider module | A caller must pick among three modules by tab. **Offset by the contract backfill in 16.5**, which names each module's business | **execute** |
| **`SessionRail`** — 3 regions in `WebuiProjectList` | "Add a rail context-menu item" is the plan's own **S1** row, today 4 files / 1 dir with the rule in two builders. S1's remedy is one registry | A caller reads the context-menu region, which already has its own render branch at `:990`. **No new file, so no new target to learn** | **execute** |
| **`ModelPicker`** — 2 regions in-file | "Add a per-model draft field" today is a read of a 1036-line file whose `drafts` map is invisible in its shape; it is now one declaration | Nothing new — both declarations stay in one file already named by business | **execute** |
| **`GoalBanner`** — 3 regions | — | — | **WITHDRAWN** — no real modification becomes smaller; a reader must still hold the whole banner |
| **`MessageItem`** — 4 regions | Not yet answered | Not yet answered | **DOWNGRADED TO AUDIT** — the structural test passes; only a change-scope analysis of the edit/rewind/fork paths can lift it |

### 16.10 The execution list — the sole authority

**This table has 24 rows: 19 `execute`, 4 `audit`, 1 `withdraw`**, across 7 source files.
**§16.10 is the only list in §16 that authorises work.** §16.7 is a census: it names every file and its reason
so none is silent, and it **authorises nothing**. §16.9 records benefit answers and **authorises nothing**.
**§16.10 is the sole authority for the split targets §16 produces**: no split target may enter §15.1 or §8 from any
other source. **Every other target in §15.1 — the pre-existing re-filings under §6.1, the pure-derivation re-filings
under §7, the eight component files that move wholesale, and §9's contract rows — remains authorised by its own
section and is not revoked here.**

**Three dispositions, and each binds every other section:**
- **`execute`** — produces a target row in §15.1 and a task in §8's Phase 3.
- **`audit`** — **produces no target row and no task** until its entry condition is met. An audit module is
  *named* in §16.7 and *discussed* in §16.9, and that is all.
- **`withdraw`** — **produces no target row, no task, and no target file.** The declarations stay where they
  are; nothing in §15.1 or §8 refers to them.

**The list, reconciled against §16.7 and §16.9:**

| source | target | disposition |
|---|---|---|
| `SessionComposer.tsx` | `composer/WebuiComposer.tsx` | **execute** (relocate) |
| | `workspace/WebuiWorkspaceDirectoryBrowser.tsx` | **execute** |
| | `sessions/ContextUsageIndicator.tsx` | **execute** |
| `PluginManagement.tsx` | `plugins/PluginCatalogue.tsx` | **execute** (retained as the remainder) |
| | `plugins/PluginItemDialog.tsx` | **execute** |
| | `plugins/PluginImportDialog.tsx` | **execute** |
| `SettingsModal.tsx` | `settings/SettingsModal.tsx` (shell) | **execute** (retained) |
| | `workspace/ReviewSettingsPage.tsx` | **execute** |
| | `settings/DesktopSettingsPage.tsx` | **WITHDRAW** |
| | `workspace/WorktreeSettingsPage.tsx` | **audit** — B1 must be scoped to `WebuiWorktreePanel` (45 lines), not to the page |
| | `sessions/ArchivedSessionsPage.tsx` | **audit** — a 30-line screen; §4.1 already names it a second entry point |
| `UserMenu.tsx` | `account/UserMenu.tsx` (shell) | **execute** (retained) |
| | `account/UserMenuSignin.tsx` | **execute** |
| | `account/UserMenuUsage.tsx` | **execute** |
| `settings/PersonalizationSettings.tsx` | thin page | **execute** (retained as parent) |
| | `GlobalInstructionsSection.tsx` | **execute** |
| | `UserProfileSection.tsx` | **execute** |
| | `MemorySection.tsx` | **execute** |
| | `MemoryManagerDialog.tsx` | **execute** |
| `settings/UsageModelSettings.tsx` | parent | **execute** (retained) |
| | `models/ProviderFormPanel.tsx` | **execute** |
| | `account/UsageQuotaPanel.tsx` | **audit** — no independent benefit answer |
| | `settings/ModelSourcePanel.tsx` | **audit** — no independent benefit answer |
| `QueuePanel.tsx` | `composer/QueuePanel.tsx` | **execute** (relocate) |

**§16.7 is amended to state, per row, that its verdict is a census entry and not an instruction.** The `separate5` against `SettingsModal` becomes *"1 target executes, 1 withdrawn, 2 audit"*; `separate 3` against `UsageModelSettings` becomes *"1 target executes, 2 audit"*. **The prose in §16.7 must not read as a target count.**

**§16.9's group conclusions are deleted.** Its per-module B1/B2 rows remain as the record, each gaining a trailing **disposition** column bound to §16.10. No conclusion sentence survives that asserts a split.

**§8's Phase 3 scope becomes:** Phase 3 carries the duty carve, **plus §16.10's 19 execute rows across 7 source files —
decomposed as 12 new files, 3 relocations and 4 retained modules.** (§8's step list names those three numbers and does not use the figure 19.) It does **not** carry `DesktopSettingsPage` (withdrawn), `WorktreeSettingsPage`, `ArchivedSessionsPage`, `UsageQuotaPanel` or `ModelSourcePanel` (audit). **Withdrawal removes real work, not just a row** — §8's step list and its exit conditions name the three numbers
above, and the five are not counted in Phase 3's scope.

**The record.**

**`SettingsModal` — five modules assessed, one of which executes.** The other four are withdrawn or audit and
appear here as records only; **their disposition is §16.10's and is final here — this table records the answer, it
does not create the target.**

| module | B1 — what becomes smaller | B2 — what a caller newly knows | disposition |
|---|---|---|---|
| `DesktopSettingsPage` (~19) | **Cannot answer.** No real modification is scoped to it — theme, wrap, new-tab and context-window are four separate SettingsModal writes at `:117`, and pulling them out does not shrink any of them | Nothing | **WITHDRAW** — it is `GenericPage` (3 lines) + `Appearance` (16) and is not a module |
| `ReviewSettingsPage` (276) | "Add a review-file filter" today is a read of a 526-line shell plus 8 declarations; becomes `:1` of the page, beside `WebuiReviewPanel` and `WebuiReviewWorkspacePicker` | The review page is `workspace`'s, not `settings`' — **which the backfill now states** | **execute** |
| `WorktreeSettingsPage` (67) | "Add a worktree field" — real, but the panel is 45 lines and its content is a list plus a select | Same as above | **audit** — B1 must be scoped to the panel, not the page |
| `ArchivedSessionsPage` (30) | "Change what unarchiving does" is real, but 30 lines is one screen and §4.1 already names it a second entry point | Same as above | **audit** |
| `SettingsModal` shell (~81, retained) | n/a — not a new module | n/a | **keep** |

**`UserMenu` — the two panels answer, the shell is retained.**

| module | B1 | B2 | disposition |
|---|---|---|---|
| `UserMenuSignin` (420) | "Add a sign-in day" — today a read of 888 lines mixing three surfaces | Signin loads **on hover/focus, not on mount** (LC-9). That is a fact a caller must know, and it is a constraint the panel must preserve | **execute** |
| `UserMenuUsage` (216) | "Add a quota window" — today a read of 888 lines | Usage loads **on click** (LC-9), and the shell's close policy and mutual exclusion cross this boundary (LC-7) | **execute** |

**`PluginManagement` — three modules, three answers.**

| module | B1 | B2 | disposition |
|---|---|---|---|
| `PluginItemDialog` (305) | "Add a field to the MCP server form" — today a read of 1595 lines containing a ternary tower over five areas | The item dialog and the MCP form are **one dialog, discriminated by `dialog === "mcp"`** — a caller must know it is one target, not two | **execute** |
| `PluginImportDialog` (105) | "Change the Git-import preview" — today `:1490-1589` inside the same file | None beyond its own root | **execute** |
| `PluginCatalogue` (~1059, retained as the remainder) | "Add an area" — the ternary tower at `:843-1140` stays; the areas are **regions inside this module**, not files | — | **keep, with a §16.1 note on the areas** |

**`SessionComposer` — three modules.**

| module | B1 | B2 | disposition |
|---|---|---|---|
| `WebuiWorkspaceDirectoryBrowser` (196) | "Add a directory filter" — today a read of 2977 lines | It lives under **`workspace`, not `composer`** — the correction §6.1 owed | **execute** |
| `ContextUsageIndicator` (318) | "Add a context category" — today a read of 2977 lines | It is `sessions`' presentation and **must not be filed under `projection/`** (§6.1's basename rule) | **execute, with the caveat** |
| `WebuiComposer` (2088, retained) | n/a | n/a | **keep** |

**`PersonalizationSettings` — five modules.**

| module | B1 | B2 | disposition |
|---|---|---|---|
| `GlobalInstructionsSection` (162) | "Add a field to the instructions editor" — today a read from `:1` of1367 lines | Its command is `setGlobalInstructions` | **execute** |
| `UserProfileSection` (197) | "Add a profile field" | Its command is `setUserProfile` | **execute** |
| `MemorySection` (228) | "Add a memory-settings toggle" | Its commands are `setAgentMemory` + `setMemorySettings` | **execute** |
| `MemoryManagerDialog` (427) | "Change what deleting a memory does" — today a read of 1367 lines; 11 states and its own save-and-delete lifecycle | It holds its own drafts; **the withdrawn GoalBanner split is the cautionary case here** — this one is kept because the interaction is whole, not because three regions were found | **execute** |
| thin page (~91, retained) | n/a — it is the parent that keeps all editors mounted (LC-5) | n/a | **keep** |

**`UsageModelSettings` — four modules assessed, one of which executes.** The benefit does not follow the source
file's split, and two modules were therefore not executed with it; **this table records the answer, it does not
create the target.**

| module | B1 | B2 | disposition |
|---|---|---|---|
| `UsageQuotaPanel` (~90) | **Cannot answer independently.** "Change a quota window's label" is a `UsageQuotaClient` + `formatUsageResetLabel` change; splitting the panel does not make it smaller. The quota **payload** is `account`'s | — | **audit** — do not execute it with its source |
| `ProviderFormPanel` (~190) | "Add a provider field" — real, and the CRUD leaves for `models` first (backfill 3.2) | Provider drafts travel with the panel and survive a sub-tab switch (LC-4) | **execute** |
| `ModelSourcePanel` (~109) | **Cannot answer independently.** "Change which model source is offered" is a `settings.setModelSource` + `loadApiKeyStatus` change; the OAuth poll (LC-3) belongs to the parent regardless | — | **audit** |

**`QueuePanel` (81, relocated):** B1 — "Add a queue-row action" is a read of a 389-line `PlanModeCards`-adjacent area today; it is already its own file, so the split is a relocation only. **execute (move only).**

---
