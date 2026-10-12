# Plugin action inventory — the 29 actions behind `plugin-port`

**Status: produced, awaiting the operator's acceptance** — the same gate Phase 0's output is under.
§5.6's `plugins` row makes this inventory a predecessor of the carve; #59 (A3) and #72 (B7) each name it
as a Required one.

## What this owes, and who consumes it

§15.3: *"`plugins` — 1 port member (`plugin-port`) standing in front of 29 actions. **The re-file must be
driven by the action inventory, not the member count**, or `plugins` is carved an order of magnitude too
small."*

§5.6's `plugins` row: *"**the action inventory must be enumerated first** — 29 actions behind one port
member (§15.3), or this carve under-scopes by an order of magnitude"*. §14.3 lists it as a known gap the
plan does not close; this document closes it.

| consumer | what it needs from here |
| --- | --- |
| **#59 (A3)** | the action-level half of the re-file. `plugin-port`'s single member carries all 29, so the declaration-side split has no cell to divide. |
| **#72 (B7)** | the population the carve must cover, so the carve reaches 29 actions rather than one member. |
| **C04** | B7 is its Required predecessor; the relocation itself is unchanged. |
| **§9 / §15.1 table 2** | `client/contracts/plugin-port.ts` → `client/contracts/plugins/plugin-port.ts` (11 lines) is unaffected by the count. |

## Counting rule

| field | value |
| --- | --- |
| population | `WebuiPluginManagementAction`, `packages/webui/src/shared/plugin-management.ts:1`-`:30` |
| unit | one union value = one action |
| baseline | `webui @ 7c4aaa92`, tracked working tree clean |
| method | read the union's members; cross-check the two other carriers of the same set |

Three lists carry the same 29 names, so the count is not a single reading: the union (**29** values),
`ACTIONS` (`server/operation/plugin-management.ts:9`-`:39`, a 29-entry `Set`), and `INPUT_SHAPES`
(`:52`-`:166`, 29 keys). One count, three witnesses.

**The port's member count is a different unit and is not the size of this work.** `plugin-port.ts:10`
declares one member (`pluginManagement?`). One member, 29 actions. The carve is sized by the 29.

## The inventory

`surface` is the area of the plugin-management page that calls the action
(`type Area = "plugins" | "skills" | "apps" | "mcp" | "agents"`, `PluginManagement.tsx:15`; the five tabs
at `:75`-`:81`). Callers are in `client/application/plugin-workflows.ts` unless stated; the component
sites are the mutation dispatch (`PluginManagement.tsx:241`-`:257`) and its named call sites.

### Surface `plugins` — the catalogue and its lifecycle (8)

| # | action | client caller | business |
| ---: | --- | --- | --- |
| 1 | `listMarketplacePlugins` | `plugin-workflows.ts:260` (market), `:288` (personal) | `plugins` |
| 2 | `listInstalledPlugins` | `plugin-workflows.ts:266`, `:287`, `:310`; **also `SessionComposer.tsx:1020`** | `plugins` — `composer` is a declared reader (§4.2) |
| 3 | `previewGithubPlugin` | `plugin-workflows.ts:423` | `plugins` |
| 4 | `importGithubPlugin` | `plugin-workflows.ts:428`; `PluginManagement.tsx:622` | `plugins` |
| 5 | `installPlugin` | `plugin-workflows.ts:424`; `PluginManagement.tsx:968` | `plugins` |
| 6 | `uninstallPlugin` | `plugin-workflows.ts:425`; `PluginManagement.tsx:1143` | `plugins` |
| 7 | `enablePlugin` | `plugin-workflows.ts:426`; `PluginManagement.tsx:971` | `plugins` |
| 8 | `disablePlugin` | `plugin-workflows.ts:427`; `PluginManagement.tsx:970` | `plugins` |

### Surface `skills` — the skill catalogue (7)

| # | action | client caller | business |
| ---: | --- | --- | --- |
| 9 | `listManageableSkills` | `plugin-workflows.ts:324` | `plugins` |
| 10 | `listSkillHub` | `plugin-workflows.ts:313` | `plugins` |
| 11 | `setSkillEnabled` | `plugin-workflows.ts:431`; `PluginManagement.tsx:975` | `plugins` |
| 12 | `deleteSkill` | `plugin-workflows.ts:432`; `PluginManagement.tsx:1154` | `plugins` |
| 13 | `installSkill` | `plugin-workflows.ts:429`; `PluginManagement.tsx:1045` | `plugins` |
| 14 | `createSkill` | `plugin-workflows.ts:430`; `PluginManagement.tsx:598` | `plugins` |
| 15 | `listRuntimeSkills` | **no client caller** — see the first finding | `plugins`, with no surface to build |

The personal skill list is read through `listManageableSkills` on purpose: runtime skills exclude disabled
entries and the management list must include them so one can be turned back on
(`plugin-workflows.ts:319`-`:320`).

### Surface `apps` — the mini-app catalogue (1)

| # | action | client caller | business |
| ---: | --- | --- | --- |
| 16 | `listApps` | `plugin-workflows.ts:348` | `plugins` |

### Surface `mcp` — MCP servers (7)

| # | action | client caller | business |
| ---: | --- | --- | --- |
| 17 | `listMcpServers` | `plugin-workflows.ts:351` | `plugins` |
| 18 | `getMcpServer` | `plugin-workflows.ts:412` | `plugins` |
| 19 | `createMcpServer` | `plugin-workflows.ts:433`; `PluginManagement.tsx:453` | `plugins` |
| 20 | `updateMcpServer` | `plugin-workflows.ts:434`; `PluginManagement.tsx:453` | `plugins` |
| 21 | `deleteMcpServer` | `plugin-workflows.ts:435`; `PluginManagement.tsx:1104` | `plugins` |
| 22 | `setMcpServerEnabled` | `plugin-workflows.ts:436`; `PluginManagement.tsx:460`, `:976` | `plugins` |
| 23 | `testMcpServer` | `plugin-workflows.ts:437` | `plugins` |

### Surface `agents` — agent administration (6)

| # | action | client caller | business |
| ---: | --- | --- | --- |
| 24 | `listAgents` | `plugin-workflows.ts:353` | `plugins` — a capability, not a business (§below) |
| 25 | `readAgentAvatar` | `plugin-workflows.ts:363` (list rows), `:420` (reader) | `plugins` — capability |
| 26 | `getAgent` | `plugin-workflows.ts:416` | `plugins` — capability |
| 27 | `createAgent` | `plugin-workflows.ts:438`; `PluginManagement.tsx:586` | `plugins` — capability |
| 28 | `updateAgent` | `plugin-workflows.ts:439`; `PluginManagement.tsx:586` | `plugins` — capability |
| 29 | `deleteAgent` | `plugin-workflows.ts:440`; `PluginManagement.tsx:919` | `plugins` — capability |

**Verdict: 29 of 29 actions belong to `plugins`.** No action belongs to another business, and exactly one
(`listRuntimeSkills`) has no client surface to carve. What the carve has to cover is therefore the whole
page, not its marketplace listing: five surfaces, 29 actions, one owner module.

## The one group criterion C does not make a business

The six `agents` actions are one tab of the same page, and criterion C asks whether a surface is a place
the user enters and works in. It is not a business of its own, for the same reasons §15.3 gives for
`terminal` inside `workspace`:

- **One entry point.** The page is reached from one rail row (`WebuiClientFoundationApp.tsx:1247`);
  no route, rail row or shell state names agents separately.
- **One owner and one state.** `plugin-workflows.ts` holds the listing state for all five surfaces
  (`:33` declares the port slice; the readers at `:260`-`:363` and the mutations at `:423`-`:440` are
  one module). `PluginManagement.tsx` renders all five.
- **Recorded as a capability.** Agent administration is a capability inside `plugins` — the shape §15.3
  already uses for `terminal-port` inside `workspace` — so the inventory does not invent a thirteenth
  business, and the carve is not allowed to leave it behind.

Two alternative homes were considered and rejected, with the evidence:

| candidate home | why it was considered | why it is not |
| --- | --- | --- |
| `settings` | agent **memory** is a settings-port member (`settings-port.ts:34`), read by `settings-workflows.ts:342`, so "agent things" look like settings' | that is memory as a *setting of the running agent*; §5.6 fixes `settings`' published commands at four (`setGlobalInstructions`, `setAgentMemory`, `setUserProfile`, `setMemorySettings`) and agent catalogue CRUD is none of them |
| `sessions` | the page's agent rows create a session through `sessions`' `createSession` (the `onChatWithAgent` hook, `WebuiClientFoundationApp.tsx:1336`-`:1344`) | that is `sessions`' command invoked *by* the page, not a duty of the page; §4.1's owns list holds no agent entity |

## Readers this publishes for another business

`composer` reads **`listInstalledPlugins`** for its `@` mention menu — `SessionComposer.tsx:1020`, through
the raw transport member the shell hands down at `WebuiClientFoundationApp.tsx:1470`. §4.2 already
declares the composer as hosting the palette and reading `plugins`' skill listing; this is the concrete
action behind that declaration, and the carve must publish a command for it rather than forward the
member. The slash-palette read is a different one and is not among the 29 (first finding).

## Findings

### 1. `listRuntimeSkills` is not the palette's read, and `listSkills` has no cell in §15.1

§4.8 item 2 and §4.2 item 4 name `listRuntimeSkills` as the read behind the composer's palette. The
source says otherwise:

- `"listRuntimeSkills"` occurs **nowhere** in `packages/webui/src/client/`, `server/service.ts` or the
  runtime adapters except as a union value, a validator entry and the frozen legacy copies under
  `test/unit/legacy-protocol/`. Measured over `packages/`, `test/` and `scripts/`: every other occurrence
  is in another package's own skill service (`packages/local-runtime`, `packages/local-runtime-v2`,
  `packages/tui`), not on WebUI's wire.
- The palette's two reads are `listSkills` (`settings-port.ts:57`, operation `listSkills`,
  `shared/operation-names.ts:67`, called at `SessionComposer.tsx:1057`) and `listInstalledPlugins`
  (`:1020`).

Two consequences, neither of which this document applies to the plan file:

1. `listRuntimeSkills` stays in the union — removing a capability is outside this programme (§14.2) — and
   carries **no client surface**. B7 must not build one, and no business declares a reader for it.
2. `listSkills` is the member that carries `plugins`' published skill listing to the composer, which
   makes it **`plugins`' declaration**, not `settings`'. §15.1 table 2 gives `settings-port` two targets
   (`models/provider-port.ts`, `settings/settings-port.ts`) and `listSkills` lands in neither. A3's
   re-file needs a third target for the `settings-port` row, or the member that the composer actually
   reads stays filed under the business that does not publish it.

### 2. §9's port census counts a different unit than "member"

§1.1 and §10's S12 row state **216 members in 8 ports**. Measured at `7c4aaa92` under two rules:

| rule | unit | 8-port total | `settings-port` |
| --- | --- | ---: | ---: |
| every property or method name at any indent in the file, nested request-shape fields included | name occurrence | **216** | 53 |
| members of the exported port interface (two-space indent, `readonly x?:`) | interface member | **108** | 33 |

The plan's per-port figures (53, 43, 37, 33, 24, 15, 10, 1) reproduce exactly under the **first** rule,
so they are name occurrences, not interface members. Under the second rule the same eight files hold
108. Recorded because E3 re-measures this figure: a re-measurement in the other unit would read as a
halving that never happened. Which unit S12 moves is not settled here.

### 3. What §15.1 table 2 gives A3, and what it does not

§15.1's `lines` column is the source file's own line count divided across its targets: `execution-port.ts`
is 94 lines and its three targets are `~60` + `~10` + `~24`; `settings-port.ts` is 102 and its two are
`~55` + `~47`; the eight files are 531 lines and the table's eight row groups sum to 531. It is a line
budget, not a member census.

So A3's member-to-business split rests on §9's sentences plus the resulting file, and each split can be
checked against the line budget above. The sentences settle most of it (`settings-port`: model and
provider members → `models`; instructions, agent memory, user profile, memory settings → `settings`),
and leave at least `listSkills` (Finding 1) and the model-source commands' status-versus-action boundary
(`getMiniMaxApiKeyStatus`/`getCodexOAuthStatus` per §5.6, against `upsertMiniMaxApiKey`,
`startCodexOAuthLogin`, `cancelCodexOAuthLogin`, `refreshModels`) to be read off §5.6's `settings` and
`models` rows at A3. Named here as the boundary of this document, not resolved by it.

## Exit condition

§5.6 requires the inventory before the `plugins` carve, and §15.3 requires the re-file to be driven by it.
Both hold when (a) all 29 actions are enumerated, (b) each has one business, and (c) the action count is
not conflated with the port's member count.

- **29 of 29 enumerated**, with the counting rule, the unit and the baseline stated (§above).
- **Every action has one home**: `plugins`, with agent administration recorded as a capability inside it.
- **The two counts are separated**: 29 actions, 1 port member.
- **The consumers are named**: #59, #72, C04, and the `plugin-port` row of §15.1 table 2.

What this document does not grant itself is the acceptance that releases #59, which belongs to the
operator and is asked for together with Phase 0's output.
