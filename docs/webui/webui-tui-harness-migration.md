# WebUI TUI-Harness migration plan

> **Status:** this file records the state at its own baseline. Paths cited below
> (`src/server/port.ts`, `src/server/assembly.ts` and others) were relocated by
> the migration in `docs/webui/webui-runtime-layer-plan.md` and have not been
> back-filled line by line. The plan and its reasoning still stand; only the
> paths are stale.

Migration of `packages/webui/` to a TUI-driven backend over the desktop
application's visual language. The WebUI is currently a half-finished client
that uses a `runtimeOwnerKind: 'cli'` harness host; this plan changes it to use
the TUI identity (so the harness renders the TUI system prompt and command
semantics), and builds out the client surface against the desktop design
tokens and the desktop visual reference.

The repository already locks in the boundaries:

- [ADR 0001](../adr/0001-webui-is-a-peer-client-of-the-harness.md): the WebUI
  is a peer client of the harness layer (`@mavis/local-runtime-v2`), not a CLI
  wrapper.
- [ADR 0003](../adr/0003-no-dependency-on-tui-internals.md): the WebUI may
  **read** the terminal client's code as a reference but must not **import** it;
  it must write its own narrow adapter.
- [ADR 0009](../adr/0009-webui-reuses-the-desktop-visual-language.md): the
  WebUI reuses the desktop application's design tokens.
- [ADR 0011 — shared event corpus](../adr/0011-shared-event-corpus-in-local-runtime-v2.md):
  the WebUI re-implements TUI's projection logic independently; both clients
  rely on a shared event-corpus fixture in `@mavis/local-runtime-v2` to stay
  aligned with the harness event protocol rather than copying each other.
- [webui-visual-language.md](webui-visual-language.md) defines the tokens,
  theme mechanism, typography and layout rules the WebUI already adopts.

This document fills in what those ADRs leave unspecified: **which** terminal
client behaviour we mirror, **which** visual assets we lift from the desktop
build, and **in what order**.

## How this plan was reviewed

This document is the result of a two-reviewer cross-audit:

- **codex luna** (`codex/gpt-5.6-luna`): review captured in
  [review-brief-original-requirement.md](review-brief-original-requirement.md)
  and the conversation log on the day this plan was written.
- **hermes deepseek v4.1** (`hermes/opencode-go:deepseek-v4.1-flash`):
  review captured in the same conversation log.

The plan addresses every BLOCKER, MAJOR and MINOR flagged by either reviewer.
Where a reviewer pushed back on a substantive design choice (for example the
"WebUI mirrors TUI projection logic" framing), the response was a deliberate
re-design recorded in the relevant ADR amendment, not a paragraph rewrite in
this plan. NITs were resolved in passing.

Specific reviewer-driven changes include: corrected verification gates (root
scripts, not `--filter webui`); a corrected description of what
`runtimeOwnerKind: 'tui'` actually enables at four product-policy sites
including `contentReviewEnabled` for the `cn` region; corrected path
references for permission/questionnaire projection (the actual reference is
`packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts`,
lines 27-50; the originally cited
`packages/tui/src/tui/controller/chat-controller-support.ts:134` is inside
`requiresQueueFallback`, a session-busy code predicate that has nothing to do
with permission or questionnaire state); corrected KaTeX font count (60
files, not 30); corrected `requestCompaction` port shape (single-object
form, not three positional arguments); narrowed data-directory scope to
read-only display; added `test/vitest-suites.json` registration for every
new test file; added a lockfile-update step for the new `katex` dependency;
made the phase boundaries self-consistent.

## Scope

| Category | Decision |
| --- | --- |
| Backend identity | `runtimeOwnerKind: 'tui'` (was `'cli'`). Drives `promptProfile: 'tui'` → `_v2/tui/SYSTEM.md.hbs` and `tuiProductPolicy` at four sites in `@mavis/local-runtime-v2`. |
| Command system | Six commands — `help`, `new`, `compact`, `status`, `usage`, `model` — the subset of TUI's runtime-independent command set whose backing call exists in the harness. The descriptor **shape** mirrors `{ name, description }` from `packages/tui/src/application/command-descriptors.ts`; the description wording is the WebUI's own copy. Skip `doctor`, `context`, `skills`, `mcp`, `export` (TUI-only or session-output-only). |
| Compaction | Carry over the `/compact` command and `session.compaction.{started,completed,failed}` projection. Wire to a new `requestCompaction` server operation that calls the harness with the single-object shape `CliService` expects. |
| Usage / context | Expose the context-window and session-usage **data** the harness already reports (`getSessionUsage`); presentation follows the WebUI visual language, not the terminal transcript layout. |
| Questionnaire / permission | Carry over the projection logic from `packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts:27-50` (`permission.ask` / `permission.resolved` / `questionnaire.ask` event handling) and `packages/tui/src/runtime/event-normalizer.ts:19-30` (event-shape normalisation). Both are re-implemented locally; the **shared event corpus** described in the ADR amendment is the conformance surface. |
| Visual asset scope | Image assets (27 PNG/JPG) and KaTeX font faces (60 files / 2.2 MB / 20 each of `.ttf` / `.woff` / `.woff2`, content-hashed, in `../minimax-webui/app/out/_next/static/media/KaTeX_*`) are checked in. CSS compiled product (548 KB / 25 minified files in `../minimax-webui/app/out/_next/static/css/`) and Next.js chunks (37 MB in `_next/static/chunks/`) are not. |
| Pages | Re-author four pages against the visual language: `/login`, `/onboarding`, `/archon`, `/404`. Defer `/archon-mini-chat`, `/log-viewer`, `/pdf`, `/doc`, `/docx`. |
| Settings | Modal inside `/archon` (route unchanged). Cover: `general` (theme, language), `appearance` (font size, density), `account` (login state, sign out), `account-onboarding`, `model` (model selection, thinking level, context control). **Reduced scope:** data-directory section is **read-only** display of the current path; relocation is deferred. Skip desktop-only items: `shortcut`, `notification`, `tray`, `run-on-startup`, `power-save-blocker`, `Computer Use toggle`. |
| KaTeX | Wire `katex` into `markdown.tsx` so `$...$` / `$$...$$` render. Fonts come from `../minimax-webui/app/out/_next/static/media/` (verified today: 20 `.ttf`, 20 `.woff`, 20 `.woff2`, total 2.2 MB). `katex` is added as a runtime dependency; `release/dependency-licenses.json` records its MIT license. The CSS is integrated via `postcss-import` against the single ADR-0010 stylesheet, not a second `<link>` in `index.html`. |

**Axis rule.** Where this plan cites `packages/tui`, the reference is
harness behaviour only — identity, event protocol, call shapes, product
policy, prompt selection. The terminal client's labels, output layout,
product copy and input syntax are presentation: they are not conformance
surfaces. The WebUI's presentation follows the desktop visual language
(axis two) or is the WebUI's own copy.

The visual asset rules above are consistent with
[`webui-visual-language.md`](webui-visual-language.md), which already
establishes that the WebUI reuses the desktop tokens by re-authoring them
rather than copying the compiled product. The 548 KB / 25-file CSS product
size was re-measured on this branch and is unchanged from the figure cited in
the visual-language doc's note about a 235 KB main file: the latter is the
single largest file, the former is the directory total. Both are reported as
**observed figures** that may shift with future desktop extractions.

## Out of scope (left to later milestones)

- **Data-directory relocation.** The desktop settings IPC has
  `DESKTOP_GET_LOCAL_RUNTIME_DATA_DIR_INFO` and
  `DESKTOP_RELOCATE_LOCAL_RUNTIME_DATA_DIR` handlers
  (`../minimax-webui/app/dist/main/ipc/settings.ipc.js:347-385`); these do
  not exist in `@mavis/local-runtime-v2` and re-implementing them is more
  work than fits this milestone. v1 shows the current path only.
- Global shortcut binding, system notifications, tray, run-on-startup,
  power-save-blocker, Computer Use toggle: all desktop-only and irrelevant in
  a browser tab.
- `archon-mini-chat`, `log-viewer`, `pdf` / `doc` / `docx` preview pages:
  deferred.
- A standalone `/settings` route: not needed while the modal lives inside
  `/archon`.
- Resumption of the desktop build's OAuth callback via `minimax://` deeplink:
  inherited limitation; the WebUI continues to read the credential file
  directly via `packages/webui/src/server/auth-context.ts`.
- **IM / chat-app connector onboarding and configuration** (discord,
  feishu, lark, dingtalk, wecom, wxwork, weixin, slack, telegram): the
  desktop archon exposes these in `/connectors/oauth` and in onboarding
  step 3, but they all rely on the desktop's `minimax://` deeplink
  OAuth callback that v1 explicitly does not implement. WebUI shows
  the connector entry points as **disabled** in the sidebar with a
  tooltip "Desktop only", and onboarding step 3 is skipped.
- **Maxclaw and Maxhermes** routes (`/max-claw`, `/max-hermes`): desktop
  product features with their own status state machines
  (`maxclaw_status_*`); v1 shows the sidebar entry as **disabled** with
  tooltip "Desktop only".
- **Websites** route (`/websites`), **Remote control** route
  (`/remote-control`, `/connect-mobile`), **Plugin / Skill
  marketplace** routes (`/plugins`, `/plugins/manage`): desktop-only
  surfaces. v1 shows the sidebar entries as **disabled** with tooltip
  "Desktop only".
- **Cron / schedules** route (`/schedules`, `/schedules/:cronId`):
  desktop-only. v1 shows the sidebar entry as **disabled** with
  tooltip "Desktop only". The `cronEnabled` capability is also
  disabled at runtime for `runtimeOwnerKind: 'cli' | 'tui'`
  (`profile-source.ts:53`); v1 does not surface it.
- **Goal / plan review** views in archon (`goal`, `plan_review`,
  `plan_review_recovery`): desktop-only. v1 does not project them.
- **Worktree / git workspace switching** (`worktree`,
  `worktreeMode`, `local_changes`): desktop-only. v1's workspace
  picker shows the simple list view, not the worktree mode toggle.
- **Pricing / upgrade / subscribe** flows (`home_subscribe`,
  `pricing`): desktop-only. v1 does not surface them.
- **Operation banners** (`agent_desktop_operation_banners`,
  `operation_banner_*`): desktop-only. v1 does not show them.
- **CS widget / share / like / dislike feedback** in the transcript
  footer: desktop-only. v1 omits the footer feedback widgets.
- **Page-tracking / Sensors telemetry** in the WebUI bundle: the WebUI
  does not currently include the sensors SDK; v1 does not add it.
- **Token-plan / budget-limited / usage-limited** indicators in the
  archon topbar: desktop-only. v1's `/archon` topbar shows session
  usage from `getSessionUsage` but not the token-plan badge or the
  budget-limited banner.
- **`max_output_tokens` / thinking-effort controls** in the model
  selector: desktop-only. v1's model selector lists models and shows
  the currently configured thinking level but does not expose
  per-session `max_output_tokens` or thinking-effort toggles.

## v1 feature parity matrix

A single read of the desktop archon chunk at
`../minimax-webui/app/out/_next/static/chunks/app/(pages)/(mavis)/archon/page-b80d2a3aab9be6d2.js`
(681 string identifiers) versus the plan's locked scope, summarised
below. **In v1** lands in the implementation; **In v1 (Desktop only
UI)** lands visually but is rendered disabled; **Deferred** is
explicitly out of scope. The table is the source of truth for what a
reviewer expects to see in the resulting WebUI.

| Module | Desktop identifier(s) | v1 status |
| --- | --- | --- |
| Session list (read + sidebar entry) | `sessions`, `sidebar_primary`, `navigate_to_session` | **In v1** — read-only list, with star / pin / archive row operations |
| Session row: rename | `rename_click`, `rename_confirm_click` | **In v1** (A3) — goes through the harness session-list mutation port |
| Session row: delete | `delete_click`, `delete_confirm_click` | **In v1** (A3) — goes through the harness session-list mutation port |
| Session row: star / pin / archive | `star`, `unstar`, `pin`, `unpin`, `archive`, `archived` | **In v1** (A3) — pure client-side flag overlay on the harness session list |
| New session action | `sidebar_new`, `add_new_chat_click`, `create_session_from_home` | **In v1** |
| Sidebar primary entries other than "new" | `sidebar_user_menu`, `sidebar_pinned_order`, `sidebar_cloud_shortcut`, `sidebar_moveto` | **In v1 (Desktop only UI)** — disabled buttons with "Desktop only" tooltip |
| Composer (chat input, send, model selector) | `composer`, `select_model`, `toggle_model_thinking`, `thinking_effort` | **In v1** for the basic composer + model selector + current thinking level display; max-output-tokens and thinking-effort toggles are deferred; the agent-team-mode toggle is **In v1** on `teamModeOff` alone (decision 2026-09-22, see the Agent team mode section) |
| Agent Team mode toggle | `teamMode`, `teamModeActive`, `teamModeOff`, `home.agent_team_label`, `home.agent_team_locked_tip`, `mavis-team-mode` | **In v1 — single-field plan (decision 2026-09-22): create-time `teamModeOff` pass-through + client-side state; no harness edit. `teamMode` exists only as an unpopulated view field and is never read. The field has no runtime consumer in `local-runtime-v2` today — see risk 11** |
| Composer run location | `composer_run_location` | **In v1** if desktop uses a single "local" value for browser sessions; otherwise deferred |
| Settings modal: general | `general`, theme, language | **In v1** |
| Settings modal: appearance | `appearance`, font size, density | **In v1** |
| Settings modal: account | `account`, sign out | **In v1** |
| Settings modal: account-onboarding | `account-onboarding` | **In v1** |
| Settings modal: model | `model`, list / select / thinking level | **In v1** |
| Settings modal: data directory | `DESKTOP_GET_LOCAL_RUNTIME_DATA_DIR_INFO` | **In v1** (read-only) |
| Settings modal: persona | `persona_editor_placeholder`, `persona_section_identity`, `persona_section_soul`, `persona_section_user`, `persona_load_failed`, `persona_save_failed_*`, `persona_mode_code`, `persona_mode_preview`, `persona_no_chat`, `persona_empty`, `persona_empty_missing`, `persona_save_success`, `get_persona_file`, `save_persona_file`, `persona` | **Deferred — desktop renderer→cloud API, not exposed via harness; v1's `WebuiHarnessPort` has no `getPersonaFile` / `savePersonaFile` method, and adding one requires harness changes outside this plan's scope. Section is rendered with a "Coming soon — desktop only" placeholder in `SettingsModal.tsx`.** |
| Settings modal: providers | `provider_create`, `provider_update`, `provider_delete`, `provider_duplicate`, `provider_minimax_key_upsert`, `provider_minimax_source_set`, `provider_minimax_test`, `provider_models_discover`, `provider_model_test`, `provider_codex_models_refresh`, `provider_codex_oauth_connect`, `provider_candidate_*`, `provider_context_update`, `provider_parameters_update`, `provider_id`, `custom_provider` | **Deferred — desktop renderer→cloud API (Thrift IDL), not via harness. Section renders with a "Coming soon — desktop only" placeholder.** |
| Settings modal: memory | `memory_enable_click`, `memory_manage_click`, `memory_save_click`, `memory_delete_click`, `memory_delete_confirm_click`, `memory_create_in_session_click`, `session_memory_popup_view` | **Deferred — desktop renderer→cloud API, not via harness. Section renders with a "Coming soon — desktop only" placeholder. Note: this is the user-visible opt-in flag, distinct from the always-on harness memory module.** |
| Onboarding step 1 (Agent Team mode) | `Agent Team mode` / `Agent Team 模式` | **In v1 — onboarding copy only; the actual agent-team toggle itself is Deferred** |
| Onboarding step 2 (Memory & self-evolution) | `Memory & evolution` / `记忆 & 自进化` | **Deferred** (skipped in v1 because OAuth / connector flows do not back it) |
| Onboarding step 3 (IM / chat-app connector) | `IM` / `通讯工具接入` | **Deferred** (skipped in v1; the `minimax://` deeplink OAuth callback is not implemented) |
| Onboarding step 4 (Ready) | `Ready` / `就绪` | **In v1** |
| Sessions list badge for team mode | `home.session_type_team_*`, `chat_type: agent_team` | **In v1** (paired with the team-mode toggle) |
| Compaction rows | `session.compaction.*` | **In v1** (B3) |
| Permission / questionnaire cards | `permission.*`, `questionnaire.*` | **In v1** (B3) |
| Token usage display | `usage`, `context_window`, `update_model_context` | **In v1** |
| `/archon-mini-chat` | (own route) | **Deferred** |
| `/log-viewer` | (own route) | **Deferred** |
| `/pdf`, `/doc`, `/docx`, `/xlsx`, `/pptx` preview | (own routes) | **Deferred** |
| `/schedules` | `schedule`, `schedules_*`, `crons_*` | **Deferred** (sidebar entry disabled, tooltip "Desktop only") |
| `/plugins`, `/plugins/manage` | `plugin_marketplace`, `plugin_*` | **Deferred** (sidebar entry disabled) |
| `/connectors/oauth` | `discord`, `feishu`, `lark`, `dingtalk`, `wecom`, `wxwork`, `weixin`, `slack`, `telegram`, `connect_recommendation`, `connectors` | **Deferred** (sidebar entry disabled) |
| `/websites` | `websites`, `website`, `desktop_download_popup_*` | **Deferred** (sidebar entry disabled) |
| `/remote-control`, `/connect-mobile` | `remote`, `remote_control_*`, `remote_chat_page` | **Deferred** (sidebar entry disabled) |
| `/max-claw`, `/max-hermes` | `maxclaw`, `maxhermes`, `maxclaw_*` | **Deferred** (sidebar entry disabled) |
| Goal view, plan review | `goal`, `plan_review`, `plan_review_recovery` | **Deferred** |
| Worktree mode toggle | `worktree`, `worktreeMode`, `local_changes` | **Deferred** |
| Token-plan / budget banner | `token_plan`, `budget_limited`, `usage_limited`, `personal_plan_type` | **Deferred** |
| Operation banners | `agent_desktop_operation_banners`, `operation_banner_*` | **Deferred** |
| Footer feedback widgets | `feedback`, `like_click`, `dislike_click`, `share_click`, `cs_widget_tooltip` | **Deferred** |
| Sensors / page-tracking telemetry | `mavis_*_render_started`, `route_modules_loaded`, `surface_committed` | **Deferred** (WebUI does not currently include the sensors SDK) |
| Pricing / upgrade flows | `home_subscribe`, `pricing`, `subscribe` | **Deferred** |
| Artifacts preview popup | `artifact_*_click`, `artifact_preview_popup_view` | **Deferred** |
| Settings modal sections: shortcut / notification / tray / run-on-startup / power-save-blocker / Computer Use toggle | `shortcuts`, `notification`, `tray`, `run-on-startup`, `power-save-blocker` | **Out of v1 scope** (desktop-only settings; documented above) |
| OAuth `minimax://` deeplink callback | (desktop only) | **Out of v1 scope** (inherited limitation; documented above) |

This matrix is the single place a reviewer should check when asking
"is this module in v1?". Every entry above is backed by an identifier
that exists in the desktop archon chunk today; the matrix is generated
from a manual pass of that chunk on this branch and may drift if the
desktop is rebuilt against the new archival knowledge.

## How the WebUI gains built-in tools and skills

This question was raised during plan review. The answer is that the WebUI
**already** has built-in tools and skills without further work, because they
live entirely in the harness layer:

| Concern | Where it lives |
| --- | --- |
| Builtin tool ID list | `@mavis/config` — `packages/config/src/agent-capabilities.ts:1-14` (`AGENT_BUILTIN_TOOL_IDS` includes `read`, `write`, `edit`, `bash`, `grep`, `glob`, `web_fetch`, etc.) |
| Builtin MCP tool ID list | `@mavis/config` — `packages/config/src/agent-capabilities.ts:23-...` (`AGENT_BUILTIN_MCP_TOOL_IDS` includes `images_understand`, `gen_videos`, etc.) |
| Tool implementations | `@mavis/agent-tools` — `packages/agent-tools/src/desktop/local-{bash,grep,glob,read,write,edit,web-search,webfetch,skill,task,...}.ts` |
| Skill registry and loaders | `@mavis/agent-modules/skills` — `packages/agent-modules/skills/src/{registry,types,directory-watcher}.ts` |
| Builtin skill `SkillSourceKind` | `@mavis/agent-modules/skills` — `packages/agent-modules/skills/src/types.ts:1` includes `'builtin'` |
| Tool and skill catalog assembly | `@mavis/local-runtime-v2` — `packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts:455-470` |
| Capability config (`persona` / `tools` / `builtinTools` / `skills` / `features`) | `@mavis/local-runtime-v2` — `packages/local-runtime-v2/src/service/turn-system/agent-host/preparation/config/local-agent-config-builder.ts:646-651` |
| WebUI side today | `packages/webui/src/server/assembly.ts:174-179` declares only the four interaction capabilities (`cliEmbedded`, `questionnaireReply`, `permissionPrompt`, `elicitation`). It does **not** declare `tools`, `builtinTools` or `skills`; the harness applies its defaults, which include the full builtin set. |

The TUI today (`packages/tui/src/runtime/embedded-host.ts:90-93`) does the
same thing under a different shape: it spreads
`runtimeOptions.capabilities` into the harness host options. The two
clients **do not maintain their own tool or skill lists**. The harness is
the only place those lists are declared and implemented.

There is no tool-or-skill settings UI in the desktop settings modal either
(`../minimax-webui/app/out/_next/static/chunks/app/(pages)/(mavis)/archon/page-*.js`
exposes only `general`, `appearance`, `account`, `account-onboarding`,
`model`), so the locked-in settings scope covers everything that exists.
The plan therefore adds no new tool-or-skill settings UI.

**Advisory for plan C4:** the WebUI's
`WebuiForwardedRuntimeHostOptions.capabilities` type
(`packages/webui/src/server/assembly.ts:174-179`) should add **placeholder
fields** `tools?: readonly string[]`, `builtinTools?: readonly
AgentBuiltinMcpToolId[]`, `skills?: readonly string[]`, `features?: {
mavis: boolean; delegation: boolean; webSearch: boolean }` so that future
settings work extends the harness's shape rather than the TUI's shape.
Even when `undefined`, declaring the fields communicates intent and keeps
the WebUI symmetric with the harness contract.

## Backend migration: TUI identity, command catalogue, event projections

The backend work lands in three steps, plus a phase-zero precondition.

### Phase zero — Inventory pre-step

**Why this is needed first.** `release/public-source.json` is currently
**stale on this branch** (verified by running `node
scripts/source-inventory.mjs` without `--write`): it still lists the
pre-`docs/webui/`-move paths. Until the inventory is committed,
`pnpm check:source` is red on the reviewed commit, and no later gate can
be green.

**Action.** Regenerate the inventory before any plan change:

   ```
   node scripts/source-inventory.mjs --write
   ```

Review the diff. The two moved docs (`docs/webui-visual-language.md` →
`docs/webui/webui-visual-language.md`, `docs/webui-v1-scope.md` →
`docs/webui/webui-v1-scope.md`), this new plan, and the new ADR amendment
must be present. Commit the inventory alongside the plan in the same
review.

### Step B1 — Switch the runtime owner identity to TUI

**Files**

- `packages/webui/src/server/assembly.ts` — change `runtimeOwnerKind`
  literal from `"cli"` to `"tui"` (lines 170, 292); widen the
  `WebuiForwardedRuntimeHostOptions.runtimeOwnerKind` type from the
  literal `"cli"` to `"cli" | "tui"`.
- `packages/webui/test/unit/webui-service.test.ts` — update the assertion
  at line 1618 (`expect(lastOptions?.runtimeOwnerKind).toBe("cli")`) to
  `toBe("tui")` and the comment at line 1735 referencing
  `runtimeOwnerKind: 'cli'`. Add a regression test for the
  `isCommandLineRuntimeOwner` branch in `profile-source.ts:52-53` so the
  memory-disabled / cron-disabled invariant is asserted on the
  WebUI-shaped options.

**Effect on the harness**

- `runtimeOwnerKind: 'tui'` selects `promptProfile: 'tui'` →
  `_v2/tui/SYSTEM.md.hbs` is loaded for the primary agent
  (`packages/local-runtime-v2/src/service/agent/builtin/catalog.ts:605-606`,
  `609-615`).
- `runtimeOwnerKind === 'tui'` **also enables `tuiProductPolicy`** at four
  composition sites in `@mavis/local-runtime-v2`. The plan must own this,
  because the policy turns on without further configuration:
  - `packages/local-runtime-v2/src/services.ts:764` —
    `createGoalEvaluatorVerifier({ tuiProductPolicy: true })`.
  - `packages/local-runtime-v2/src/services.ts:1002-1004` —
    `tuiProductPolicy: true` and `contentReviewEnabled:
    getRuntimeRegion() === "cn"`. **In the `cn` region this turns on
    content review for every WebUI session.**
  - `packages/local-runtime-v2/src/application/session/runtime-session-composition.ts:103,123,134,240,259`
    — `tuiProductPolicy` is read to set
    `implicitCustomProviderThinking`.
  - `packages/local-runtime-v2/src/application/agent/runtime-agent-product.ts:167`
    — `tuiProductPolicy: runtimeOwnerKind === 'tui'`.
- Verified non-effects, so the plan does not change them: `agent-prompt-surface.ts:31`
  maps both `'cli'` and `'tui'` to surface `'cli'`
  (`packages/local-runtime-v2/src/service/turn-system/agent-host/preparation/agent-prompt-surface.ts:31`),
  and `profile-source.ts:52-53` keeps memory and cron disabled for both
  owners. The persona line in `_v2/tui/SYSTEM.md.hbs` is rendered only when
  `persona.enabled` is true, so the visual check below is conditional on
  that flag.
- `capabilityProfile: 'cli'` stays; only the owner identity changes.

**Decision on the product policy.** The locked brief says "backend logic
from TUI". Switching the owner identity is the mechanism for that, and the
`tuiProductPolicy` flags are an inseparable consequence. The plan accepts
this: the WebUI v1 inherits the same TUI product semantics as the
terminal client. If a future milestone wants the WebUI to opt out of one
of the flags (e.g. to disable content review in `cn`), it must propose a
new code path in `@mavis/local-runtime-v2`; the WebUI does not own this.

**Verification**

- `pnpm typecheck:webui` — confirms the literal and type widen cleanly.
- `pnpm test:webui` — runs `webui-service.test.ts` with the updated
  expectation and the new memory/cron regression test.
- Boot the WebUI against a managed MiniMax login and a session in coding
  mode. Inspect the rendered system prompt. With `persona.enabled` true,
  the first line must read "You are a coding agent running in the MiniMax
  Code terminal, developed by MiniMax" (the persona header from
  `_v2/tui/SYSTEM.md.hbs:2`). If `persona.enabled` is false, the check is
  vacuous; flag that explicitly in the PR description.
- `pnpm check:webui-boundary` and `pnpm check:source` — must be green
  after the phase-zero inventory step.

### Step B2 — Command catalogue

**Goal.** Expose a WebUI-callable command surface covering the same
harness capabilities TUI's commands cover, without importing
`packages/tui/src/application/command-descriptors.ts`. The descriptor
**shape** is re-declared verbatim —
`{ readonly name: string; readonly description: string }` (lines 1-4), no
additional fields — but the description **wording** is the WebUI's own
copy: TUI's terminal text is presentation, not a conformance surface.
Adding argument schemas, help groups or alias maps is out of scope.

**Locked selection.** Six commands: `help`, `new`, `compact`, `status`,
`usage`, `model`. Skipped: `doctor`, `context`, `skills`, `mcp`, `export`
(TUI-only maintenance commands and session-output commands that do not
fit a browser tool palette).

**New files**

- `packages/webui/src/server/commands/descriptors.ts`

  Pure data: six descriptors with the same shape as
  `TuiCommandDescriptor`. No additional fields.
- `packages/webui/src/server/commands/runner.ts`

  Routes a `{ command, input, sessionId }` request through the
  process-local harness service that the WebUI host exposes. The harness
  is **not** a CLI binary and **not** the ACP adapter (ADR 0001).

  Per command:

  - `help`: returns the catalogue; no runtime call.
  - `new`: `createSession` with an explicit `workspaceDir` carried from
    the caller (refusing implicit workspaces per
    [v1-scope step 8](webui-v1-scope.md#wiring-additive-edits-to-existing-files)).
  - `compact`: `requestCompaction(sessionId, agentName, input ||
    undefined)`. The `requestCompaction` call shape on `CliService` is a
    **single object** `{ name, id, reason: 'ui_request',
    customInstructions }` (see
    `packages/tui/test/unit/tui-runtime-adapter.test.ts:339-344`). The
    runner constructs that object. It surfaces
    `NOTHING_TO_COMPACT` / `unchanged` as a handled no-op
    (`{ handled: true, output: <message> }` — the message wording is the
    WebUI's own copy) and other failures as `runtimeRejected` with the
    original error code.
  - `status`: `getSession(request)` (plus `getAccountStatus` for the
    account line); the command reports the model and workspace **data**
    the harness holds. Labels, order and layout are the WebUI's own
    presentation — the terminal's `status-visualization.ts` label map is
    not a reference for this command.
  - `usage`: `getSessionUsage(request)`; the command reports the token,
    cost and cache **numbers** the harness returns. Grouping and layout
    are the WebUI's own presentation — the terminal's
    `context-visualization.ts` layout is not a reference for this
    command.
  - `model`: `listModels` for completion, `selectModel` for switching —
    these two harness calls are the seam; whatever `selectModel` returns,
    including a rejection, is surfaced to the caller rather than
    swallowed. Input syntax (`provider/model[#variant]` or a bare id) and
    error wording are the WebUI's own UX decisions; pre-validating
    against `listModels` is an optional UX choice, not a conformance
    requirement — mirroring TUI's `resolveModelSelection` parser
    (`packages/tui/src/acp/commands.ts:375-404`) is not required, as
    that parser is terminal command UX, not harness behaviour.

**Wired into the WebUI transport**

- `packages/webui/src/server/operations.ts` gains a `runCommand`
  operation that delegates to `commands/runner.ts`. Reuses the existing
  operation-registry pattern; no new envelope kind.
- `packages/webui/src/server/port.ts` gains
  `WebuiRunCommandRequest` and `WebuiRunCommandResult` types and a
  new `requestCompaction` port method (the WebUI currently has no
  compaction port at all). `packages/webui/src/server/host.ts` forwards
  it from the `CliService` shape.
- `packages/webui/src/client/transport.ts` gains a `runCommand` client
  method. Uses the existing request / response / error frame kind; the
  envelope schema in `packages/webui/src/server/envelope.ts` does not
  change.

**This step changes the client.** The plan's earlier draft said phase 2
ships "without a client change". That was wrong: `client/transport.ts`
gains `runCommand`, which is a client-side change. Phase 2 ships with the
client wiring landed in the same commit as the server operation. The
phase table at the end of this document reflects the corrected boundary.

**Verification**

- `packages/webui/test/unit/commands.test.ts` — covers each of the six
  commands against a stub `CliService` mirroring the tui app tests'
  fixtures (`packages/tui/test/unit/tui-runtime-adapter.test.ts:312-340`).
  Tests must include: `NOTHING_TO_COMPACT` mapping; `runtimeRejected`
  mapping; `requestCompaction` single-object call shape; malformed
  command handling; unknown command rejection by the operation
  registry.
- `packages/webui/test/unit/transport-frame.test.ts` (new) — covers
  the `runCommand` request / response / error framing on the client
  transport. The existing `webui-stream.test.ts:344` probe is a
  reducer-fixture contract, not a transport test, and remains.
- Register both new test files in the `webui` group of
  `test/vitest-suites.json` (`scripts/lib/vitest-suites.mjs:42-51`
  enforces membership; without registration `check:source` fails).
- `pnpm test:webui`, `pnpm typecheck:webui`, `pnpm build:webui`,
  `pnpm check:webui-boundary`.

### Step B3 — Event projections

**Goal.** Mirror the runtime-event projections the TUI consumes, in
particular the compaction projection, the permission / questionnaire
projection and the usage projection, so the WebSocket event stream can
drive the client state machines. The shared event corpus described in
the ADR amendment is the conformance surface.

**New files**

- `packages/webui/src/server/projections/context-snapshot.ts`

  Reads `SessionStreamFrame` messages and produces a
  `WebuiContextSnapshotResponse` carrying `compaction.state`,
  `compaction.lastAt`, `usage`, `window`, `usedTokens`,
  `compactionThresholdTokens`. Mirrors the *behaviour* of
  `projectCompaction` at
  `packages/tui/src/runtime/projections/context-snapshot.ts:93-...`
  without depending on it. The behaviour contract is "compaction
  projection reflects the latest `compaction_start` / `compaction` /
  `compaction_failed` message" — both implementations must satisfy it
  against the shared corpus fixtures.
- `packages/webui/src/server/projections/compaction.ts`

  Subscribes to `session.compaction.started` / `completed` / `failed`
  events. The predicate is the same shape as
  `isCompactionEvent` at
  `packages/tui/src/tui/controller/runtime/runtime-event-flow.ts:1115`
  (a tagged-union discriminant on
  `'session.compaction.started' | 'session.compaction.completed' |
  'session.compaction.failed'`).
- `packages/webui/src/server/projections/usage.ts`

  Re-implements `isTurnCompactionMessage` locally. Mirrors
  `packages/tui/src/application/response-usage.ts:14` so the WebUI does
  not double-count compaction messages into usage totals.
- `packages/webui/src/server/projections/permissions.ts`

  Re-implements the permission / questionnaire state mapping from
  `packages/tui/src/tui/controller/runtime/runtime-state-coordinator.ts:27-50`,
  which is the actual location of
  `permission.ask` / `permission.resolved` / `questionnaire.ask` event
  handling. **The originally cited
  `packages/tui/src/tui/controller/chat-controller-support.ts:134` is
  inside `requiresQueueFallback`, a session-busy code predicate that has
  nothing to do with permission or questionnaire state** — that
  citation was wrong. `runtime-state-coordinator` is the correct
  reference.
- `packages/webui/src/server/projections/index.ts`

  Barrel exporting the projections and a single `reduceEvents(state,
  frame)` used by `operations.ts`.

**Wired into**

- `packages/webui/src/server/operations.ts` — the existing
  `watchEvents`-driven operations use the projections instead of touching
  the raw frames.
- `packages/webui/src/client/stream-loop.ts` — the reducer consumes the
  projected shapes, not the raw `SessionStreamFrame`. The frame schema in
  `packages/webui/src/server/envelope.ts` does not change.

**This step changes the client.** `client/stream-loop.ts` is a client
file. Phase 3 ships with the client reducer update landed in the same
commit as the server projections. The phase table reflects the corrected
boundary.

**Verification**

- `packages/webui/test/unit/projections.test.ts` — drives the WebUI
  reducers against the `@mavis/local-runtime-v2` shared event corpus
  fixtures (see the ADR amendment for the corpus layout). Frame fixtures
  come from the same source as
  `packages/tui/test/unit/runtime-event-normalizer.test.ts:702-720`
  (`session.compaction.completed` fixture), so a single harness
  protocol change lights up tests in both clients.
- Register `projections.test.ts` in `test/vitest-suites.json`.
- `pnpm test:webui`, `pnpm typecheck:webui`, `pnpm build:webui`,
  `pnpm check:webui-boundary`.

## Client migration: visual surface and pages

The client work is the larger half of the milestone. It does not change
the server surface contract; it only changes the React components and the
assets they reference.

### Agent team mode

Decision (2026-09-22, option a): v1 ships the composer toggle on a
**single field** — `teamModeOff` — plus client-side state, mirroring
the desktop's own mechanism. The harness is not modified.

Contract facts (verified against `packages/protocol/src/local.ts`):

- `CreateSessionInput.teamModeOff?: boolean` (`:831`) is the only
  create-time team field. `teamMode` does **not** exist on any input.
  It exists only on `SessionInfoView` (`:725`), and **no package ever
  populates it** — the WebUI must not read it.
- `SendMessageInput` (`:571`) and `UpdateSessionInput` (`:846`) carry
  no team fields: the mode is fixed at session creation, exactly as on
  desktop (its renderer only passes `teamModeOff` in
  `createSession({agentId, workspaceDir, teamModeOff, …})` and caches
  the choice client-side as `createdSessionTeamModeOff`).
- `local-runtime-v2` consumes `teamModeOff` **nowhere** (zero reads in
  the package, templates included). The flag is accepted and
  registered, not yet acted upon. Team assembly in practice happens
  when the agent spawns child sessions via `parentSessionId`; the
  toggle does not gate that path today. Recorded as risk 11.

What v1 ships:

- `WebuiCreateSessionRequest.teamModeOff?: boolean`, passed through to
  `createSession` (absent means unchanged).
- The composer toggle chip next to the model selector, desktop tokens;
  the persisted choice lives under the `mavis-team-mode` localStorage
  key and is read on composer mount.
- The lock predicate `teamModeOff === false || getChildSessions(session.id).length > 0`,
  in product code (importable by tests), with the
  `home.agent_team_locked_tip` tooltip.
- The sessions-list "team" badge (`chat_type: agent_team`): derived
  client-side from child-session count plus the locally cached
  creation-time choice — there is no server-side signal (contract
  facts above).
- Onboarding step 1 copy and image:
  `subtitle: "Agent Team 模式" / "Agent Team mode"`,
  `title: "下达目标，MiniMax 自主组建小队" / "Define the goal. MiniMax builds the team."`,
  `desc: "启用 Agent Team 模式后..." / "Enable Agent Team mode and..."`,
  `image: "onboard_v2_1_{cn,en}.png"`, and step 4 ("Ready" / "就绪")
  mentioning team assembly.

Verification: the toggle is visible in the phase-5 screenshots next to
the model selector; `team-mode.test.ts` imports the lock predicate
from product code and drives it with fixture sessions; the
`mavis-team-mode` key is written on toggle and read on mount.

### Visual reference provenance

The desktop-extracted WebUI project at `../minimax-webui/` is the visual
source of truth for layout, component shape and page composition. The
plan reuses the desktop design tokens (`tokens.css` is the canonical
re-authoring) but **does not copy** the desktop's Next.js chunks, compiled
CSS product or React components. The implementer must therefore consult
the desktop static export directly when the visual-language document does
not resolve an ambiguity.

#### Priority order when sources disagree

1. **`packages/webui/src/client/styles/tokens.css`** wins for any token
   value. If a desktop page references a token that is not in
   `tokens.css`, the implementer must port the value into `tokens.css`
   (as a primitive ramp value, not as a literal hex) and reference the
   new token from the component. The plan does not author a parallel
   literal somewhere in the component tree.
2. **`docs/webui/webui-visual-language.md`** wins for any structural or
   typographic decision (typography stacks, layout proportions, theme
   switching mechanism, density, spacing scale).
3. **Desktop static export under `../minimax-webui/app/out/`** wins for
   page composition, component shape, gesture vocabulary and empty
   states — things the visual-language doc covers in prose only.
   Specifically:
   - page entry HTML: `../minimax-webui/app/out/<route>/index.html` (one
     per page in v1 scope);
   - page-level JavaScript chunks: the
     `_next/static/chunks/app/(pages)/(mavis)/<route>/page-*.js` files
     (read-only, for visual reference; do not copy code);
   - the settings modal lives inside the `archon` route, not in its own
     route — read
     `_next/static/chunks/app/(pages)/(mavis)/archon/page-*.js` for the
     modal's section order, control types and copy.

The plan never lifts compiled artefacts from the desktop export; the
implementer reads them in place. This is the only way to honour
[`webui-visual-language.md:104-107`](webui-visual-language.md), which
forbids copying the compiled stylesheet.

#### Per-page reference map

| WebUI route | Desktop static export reference |
| --- | --- |
| `/login` | `../minimax-webui/app/out/login/index.html` |
| `/onboarding` | `../minimax-webui/app/out/onboarding/index.html` |
| `/archon` | `../minimax-webui/app/out/archon/index.html` + `_next/static/chunks/app/(pages)/(mavis)/archon/page-*.js` (the latter for the settings modal) |
| `/404` (catch-all) | `../minimax-webui/app/out/404/index.html` |
| Settings modal (inside `/archon`) | sections enumerated in `_next/static/chunks/app/(pages)/(mavis)/archon/page-*.js`: `general`, `appearance`, `account`, `account-onboarding`, `model` |

Per-component references within `archon`:

- left rail layout (width ~18 %, session list shape, settings entry
  position): archon chunks, search the rendered JSX shape.
- composer shape (large radius 16-20 px, attach button, trailing model
  selector, dark circular send button, suggestion-chip row below,
  workspace capsule + local tag below that): archon chunks.
- welcome brand anchor (centred, generous top space): archon HTML.
- two-column grid with the rail one step darker than the main surface:
  archon HTML and `tokens.css` `bg_default_*` pairs.

#### Visual acceptance

After phase 5 lands, the implementer takes two screenshots:

1. `packages/webui/screenshots/archon-light.png` — WebUI `/archon`
   rendered with `data-density="comfortable"` and the light theme.
2. `packages/webui/screenshots/archon-dark.png` — same view, dark
   theme.

Comparison is done by opening the screenshots and the corresponding
desktop archon HTML in a browser side by side (the implementer does not
need pixel-perfect overlay; the eye check is enough). Acceptance is:

- Two-column layout with the rail narrower than the main, and the rail
  one step darker.
- Composer shape matches the prose description above (large-radius
  field, trailing model selector, dark circular send button).
- Suggestion-chip row + workspace capsule row visible below the
  composer.
- Welcome brand anchor centred with generous top space.
- No regressions in the light/dark theme mechanism (theme switching
  rebinds the 211 semantic tokens per
  [`webui-visual-language.md:47-60`](webui-visual-language.md)).

Pixel-perfect parity is **not** an acceptance criterion. The desktop
chunks render against Next.js-specific hydration order; the WebUI
renders against Vite. Layout proportions, not pixel counts, are the
target.

#### Conflict resolution

When the desktop static export disagrees with the visual-language doc or
`tokens.css`, the implementer raises the discrepancy in the PR
description and picks the side that aligns with the priority order
above. Conflicts that go the other way (for example, a desktop fragment
that uses a literal hex while `tokens.css` already declares a token for
that colour) are noted but not blocking — the WebUI follows `tokens.css`
and the desktop fragment is left untouched because it is read-only.

### Asset carry

- 27 PNG / JPG files in `packages/webui/src/client/assets/img/` (mirroring
  the layout of `../minimax-webui/app/out/assets/img/`, verified today:
  `onboard_v2_{1..4}_{en,cn}.png` × 8, `desktop_im{,_dark}.png`,
  `computer_use.png`, `pic_windows.png`,
  `remote_control_phone_{en,zh}.png`, `wechat.png`,
  `share_wechat_friends.png`, `discord.jpg`, `feishu.png`,
  `feishu-feedback-group.png`, `pic_{1,2,3}.png`, `pic_{1,2}_cn.png`,
  `breakDown.png`, `emptypicture.png`, `beian.png` = 27 total).
- 60 KaTeX font files in
  `packages/webui/src/client/assets/fonts/katex/` (20 `.ttf`, 20 `.woff`,
  20 `.woff2`, 2.2 MB total, verified today in
  `../minimax-webui/app/out/_next/static/media/KaTeX_*`). The desktop
  filenames are content-hashed; the plan renames them to the canonical
  `KaTeX_<family>-<style>.<ext>` form so the build source does not
  reference hashed URLs.
- One shared `LICENSE.katex-fonts` note alongside the fonts and points to
  the upstream `katex` package license (MIT, verified at the upstream
  project). `release/dependency-licenses.json` records the `katex`
  runtime dependency added in step C3.

The 548 KB / 25-file desktop CSS product
(`../minimax-webui/app/out/_next/static/css/`) is **not** lifted.
`packages/webui/src/client/styles/tokens.css` remains the visual source
of truth, per the visual-language doc and ADR 0009.

**Verification**

- `node scripts/source-inventory.mjs --write` regenerates
  `release/public-source.json` to include the new asset paths.
- `release/dependency-licenses.json` lists `katex` with the MIT license.
- `pnpm check:source` is green.
- A source-to-destination filename manifest is committed alongside the
  asset copy so reviewers can diff the file list. A count-only check is
  not sufficient because two images could share the same byte count.
- `pnpm install` must update `pnpm-lock.yaml` (the GitHub CI installs
  with `--frozen-lockfile`; without a committed lockfile change the CI
  fails).

### Step C1 — Image assets land

- Copy the 27 image files into `packages/webui/src/client/assets/img/`,
  categorised by use site (see the table in "Asset carry" above).
- Update `release/public-source.json` via the inventory script.
- Commit the filename manifest alongside the images.
- No CSS or component changes.

### Step C2 — KaTeX font files land

- Copy the 60 font files into
  `packages/webui/src/client/assets/fonts/katex/` and rename to the
  canonical `KaTeX_<family>-<style>.<ext>` form.
- Add the `LICENSE.katex-fonts` note pointing at the upstream KaTeX
  package license.
- Update `release/public-source.json`.
- Add `katex` to `packages/webui/package.json` dependencies and commit
  the `pnpm-lock.yaml` change.
- `pnpm check:source`.

### Step C3 — KaTeX runtime wired into markdown

- Add `katex` to `packages/webui/package.json` dependencies (the same
  version whose fonts ship in C2; pinned to keep the bundled font
  references valid).
- Update `packages/webui/src/client/markdown.tsx` so block-code with
  language `'math'` and the inline `$...$` / `$$...$$` token in plain
  text delegate to `katex.renderToString`. The current markdown
  pipeline uses `marked` which emits no `$...$` token natively, so the
  plan must specify the tokenizer extension that recognises inline
  math. The chosen extension is
  [`marked-katex-extension`](https://www.npmjs.com/package/marked-katex-extension)
  or a hand-rolled marked extension with the same behaviour; either way
  the tokenizer regex is the only allowed math surface, no
  `katex/contrib/auto-render` (which runs an over-eager global regex
  pass).
- CSS integration: the ADR-0010 single-stylesheet rule
  (`scripts/build-webui-styles.mjs` produces the only stylesheet
  consumed by both dev and packaged output; `index.html` links
  `./styles.css`; the esbuild client build has no CSS loader) is not
  compatible with a second `<link>` in `index.html`. The plan adds
  `postcss-import` to the styles pipeline and `@import
  "katex/dist/katex.min.css";` to `packages/webui/src/client/styles/index.css`.
  The build copies the font directory from
  `packages/webui/src/client/assets/fonts/katex/` into the build output
  so the bundled CSS's font URLs resolve.

### Step C4 — Settings modal

The settings surface lives in `Archon.tsx` and is opened from
`LeftRail.tsx`. Sections, in order, matching the desktop modal's
order in
`../minimax-webui/app/out/_next/static/chunks/app/(pages)/(mavis)/archon/page-b80d2a3aab9be6d2.js`:

1. **general** — theme (light / dark, written to `localStorage` and
   reflected through `.light` / `.dark` on `<html>` per
   [`webui-visual-language.md:47-60`](webui-visual-language.md)),
   language (zh / en, stored in `localStorage`).
2. **appearance** — font size (12 / 14 / 16), density (comfortable /
   compact), each toggling a `data-density` attribute on `<html>`.
3. **account** — show the authenticated user from `getAccountStatus`,
   with a sign-out button that calls the existing credential invalidator
   (`authContext.invalidator`).
4. **account-onboarding** — re-entry to `/onboarding` for users who
   skipped it.
5. **model** — list from `listModels`, selection via `selectModel`;
   shows the currently configured thinking level and the context-window
   usage from `getSessionUsage`. **Note**: per-session
   `max_output_tokens` and thinking-effort toggles are deferred (see
   "v1 feature parity matrix").
6. **persona** — **Coming soon — desktop only**. The section renders
   the section heading (so the user sees the same option order as
   desktop) but every action is a placeholder with copy "Coming soon
   — desktop only". The desktop persona flow goes through the cloud
   API (`get_persona_file` / `save_persona_file`); v1's
   `WebuiHarnessPort` does not expose these methods, and adding them
   requires harness changes that are out of scope for the WebUI plan.
   The desktop identifier constants (e.g. `persona_section_identity`)
   ARE present in the file as `// i18n key:` markers for the eventual
   future implementation, so a future milestone that adds the harness
   plumbing knows where the constants live.
8. **providers** — **Coming soon — desktop only**. Same treatment as
   persona. The desktop provider flow goes through the cloud Thrift
   IDL (not via harness), so v1 renders the section heading and
   identifier constants only. Codex-OAuth-gated entries
   (`provider_codex_*`) would remain disabled even when the section
   is wired up, because the OAuth deeplink is out of scope (see
   "OAuth `minimax://` deeplink limitation").
9. **memory** — **Coming soon — desktop only**. Same treatment. The
   desktop memory flow goes through the cloud API; v1 renders the
   heading and identifier constants only. The user-visible opt-in
   flag (vs. the always-on harness memory module) is what the desktop
   UI controls; v1 does not.
11. **data directory** — **read-only display of the current dataDir**.
    The plan explicitly defers relocation: re-implementing
    `DESKTOP_GET_LOCAL_RUNTIME_DATA_DIR_INFO` /
    `DESKTOP_RELOCATE_LOCAL_RUNTIME_DATA_DIR` (the desktop settings IPC
    handlers at
    `../minimax-webui/app/dist/main/ipc/settings.ipc.js:347-385`) would
    require a host lifecycle change in
    `@mavis/local-runtime-v2` and a credential-preservation story for
    the shared `~/.minimax` directory. Neither fits this milestone.

**Why persona / providers / memory are deferred rather than implemented.** These three sections are the result of an earlier assumption in the plan that the harness would expose ports for them. After the third implementation round, it was confirmed that:

- The desktop renderer implements them by calling **the cloud backend directly** (Thrift IDL, `agent.minimax.cn`), not through the desktop main process and not through `@mavis/local-runtime-v2`.
- The WebUI's `WebuiHarnessPort` has no `getPersonaFile`, no `savePersonaFile`, no memory CRUD, no provider CRUD.
- Adding these to `@mavis/local-runtime-v2` would affect every harness consumer (TUI, desktop, future clients) and is the kind of change that AGENTS.md and `docs/source-sync.md` warn against without a dedicated review path.

So v1 ships the **section headings** (so the modal layout matches the desktop order) with **placeholder copy and i18n-key markers**, and a future milestone that adds the harness plumbing can wire the actions without changes elsewhere in the WebUI.

The desktop's `shortcut` / `notification` / `tray` / `run-on-startup` /
`power-save-blocker` / `Computer Use toggle` entries are intentionally
absent.

The `tokens` for the placeholder sections come from `tokens.css`; no
new tokens are introduced in this milestone.

### Onboarding flow

The desktop onboarding has four steps, defined in
`../minimax-webui/app/out/_next/static/chunks/60688.b5ccd11e10880be9.js`:

| Step | Subtitle (zh / en) | v1 status |
| --- | --- | --- |
| 1 | "Agent Team 模式" / "Agent Team mode" | **In v1** |
| 2 | "记忆 & 自进化" / "Memory & evolution" | **Deferred** — skipped because OAuth / connector flows do not back it; the Memory settings modal entry is reachable from `/archon` settings instead |
| 3 | "通讯工具接入" / "IM" | **Deferred** — skipped because the `minimax://` OAuth deeplink is not implemented; the connector sidebar entries are disabled with the "Desktop only" tooltip |
| 4 | "就绪" / "Ready" | **In v1** |

The onboarding component (`packages/webui/src/client/components/OnboardingSteps.tsx`)
takes a list of steps. v1 ships a two-step onboarding:

1. Step 1 copy and image from the desktop chunk (zh + en):
   `subtitle: "Agent Team 模式" / "Agent Team mode"`,
   `title: "下达目标，MiniMax 自主组建小队" / "Define the goal. MiniMax builds the team."`,
   `desc: "启用 Agent Team 模式后..." / "Enable Agent Team mode and..."`,
   `image: "onboard_v2_1_{cn,en}.png"`.
2. Step 4 copy and image:
   `subtitle: "就绪" / "Ready"`,
   `title: "在输入框里下达一切指令" / "Just say the word"`,
   `desc: "选择一个本地工作目录开始你的任务。无论是创建技能、查看记忆、设置定时任务，还是组建 Agent Team，一切需求，在输入框里下达即可。"`,
   `image: "onboard_v2_4_{cn,en}.png"`.

The desktop's "Next" / "开始 / Get started" button labels are kept
verbatim. The desktop's back-arrow control is also kept.

The implementation must **not** skip steps with placeholder copy — v1
ships a two-step onboarding, not a four-step onboarding with two
empty steps. A reviewer reading the onboarding component should see
exactly two slide markers.

### Step C5 — Streaming transcript

Driven by `packages/webui/src/server/projections/*` plus a thin reducer
in `packages/webui/src/client/stream-loop.ts`. Compaction rows,
tool-result previews and assistant / user cells are styled with the
visual tokens; nothing here is a terminal emulator.

The reducer keeps the existing probe hook `__webuiProbeReduce` so the
existing `packages/webui/test/unit/webui-stream.test.ts` continues to
work as a fixture reference. The probe is a reducer-fixture contract,
**not** an end-to-end smoke test; a real WebSocket round-trip smoke test
is added in phase 5 below.

### Session list operations

The session list in the WebUI's `LeftRail.tsx` exposes three
row-level operations (decision A3):

1. **star / unstar** — pure client-side flag overlay on the harness
   session list. The WebUI keeps a per-session star map in
   `localStorage` under a new key
   `mavis-webui-session-stars:v1`. Server-side state is untouched.
2. **pin / unpin** — same overlay mechanism under
   `mavis-webui-session-pins:v1`. The desktop's
   `sidebar_pinned_order` key is **not** reused; the WebUI maintains
   its own pin order to avoid clashing with the desktop client's
   state on a shared `~/.minimax` data dir.
3. **archive / unarchive** — same overlay mechanism under
   `mavis-webui-session-archives:v1`. Archived sessions are
   hidden from the default list view; the user toggles visibility
   via a chip in the rail header.
4. **rename** — calls the harness session-list mutation port. If the
   harness does not expose a rename port, the implementer stops and
   reports (see the "stop and report" rules).
5. **delete** — calls the harness session-list mutation port. Same
   stop-and-report rule applies.

The desktop's session list has additional rows actions (`star`,
`unstar`, `pin`, `unpin`, `archive`, `archived`, `rename`,
`delete`, `marked_all_read`). The five above are the only ones v1
implements. The other desktop-only actions (e.g. `navigate_to_session`
which is purely client-side routing in the desktop) are folded into
the WebUI's row click handler instead of being separate row actions.

Row-action icons and labels are taken from the desktop chunks
verbatim. The tooltip strings (`rename_click`, `delete_click`, etc.)
are the i18n keys; the WebUI resolves them through the same locale
loader that the desktop uses.

### Sidebar entries

The sidebar's primary entry list in `LeftRail.tsx` matches the
desktop's order (decision B1):

| Position | Entry | v1 status |
| --- | --- | --- |
| 1 | New session (sidebar_new) | **Active** — opens a workspace picker and creates a session |
| 2 | Schedules (schedules, crons_*) | **Disabled** — tooltip "Desktop only" |
| 3 | Plugins / Skill marketplace (plugin_marketplace, skill_*) | **Disabled** — tooltip "Desktop only" |
| 4 | Websites (websites, website) | **Disabled** — tooltip "Desktop only" |
| 5 | Remote control (remote_control_*) | **Disabled** — tooltip "Desktop only" |
| 6 | Maxclaw (maxclaw_*) | **Disabled** — tooltip "Desktop only" |
| 7 | Maxhermes (maxhermes) | **Disabled** — tooltip "Desktop only" |
| 8 | Local (workspace list, lastSelectedWorkspace) | **Active** — the user's workspaces |

Disabled entries use the desktop's visual treatment for disabled
controls (the same tokens the desktop uses for its `disabled` state).
The "Desktop only" tooltip text matches the desktop's
`sidebar_cloud_shortcut` / `sidebar_primary` copy.

The "User menu" entry (`sidebar_user_menu`) is rendered as the
avatar / sign-out trigger at the rail footer and is active; clicking
it opens the settings modal (default tab `account`).

### Page re-authoring

Four pages are re-authored. They use the existing React + Vite toolchain
in `packages/webui/src/client/`, not the Next.js export from the desktop
build.

**Shared components** (new, under
`packages/webui/src/client/components/`):

- `ArchonShell.tsx` — the two-column layout (left rail ~18% width, main
  surface lighter than the rail). Header, footer, model badge, send
  button. Lays out exactly the way
  `webui-visual-language.md` describes the conversation surface.
- `LeftRail.tsx` — session list (with the row operations in the
  "Session list operations" section above), new-session action,
  primary sidebar entries (with the disabled "Desktop only" entries
  per the "Sidebar entries" section above), settings entry at the
  rail footer, user menu trigger. Styling tokens from `tokens.css`
  only.
- `Composer.tsx` — large-radius field, attach button, trailing model
  selector, solid dark circular send button. Suggestion-chip row
  underneath; workspace capsule and local tag below.
- `Transcript.tsx` — renders message cells driven by the projected
  frames (compaction rows, tool previews, assistant / user cells). Same
  projection output the tui produces, expressed in HTML.
- `SettingsModal.tsx` — `/settings` modal opened from the rail.
- `LoginCard.tsx`, `OnboardingSteps.tsx`, `NotFound.tsx`.

**Page routes** (each is a thin entry that composes the shared
components):

- `pages/Login.tsx` → mounted at `/login`
- `pages/Onboarding.tsx` → `/onboarding`
- `pages/Archon.tsx` → `/archon` (includes the `/settings` modal)
- `pages/NotFound.tsx` → `/*`

A minimal client-side router replaces the current single-view
`app.tsx`. The choice is between keeping the existing flat SPA and
adding a tiny `route()` helper, or pulling in `react-router-dom`.
Default: flat SPA + `route()` helper under
`packages/webui/src/client/router.ts`. Lift to `react-router-dom` only
if the modal history or back-button behaviour requires it.

### Phase 5 dev server wiring

ADR 0010 says Vite is the WebUI dev server. The wiring is not currently
present in the tree (no vite config anywhere under
`packages/webui/`, no `dev` script in either
`packages/webui/package.json` or the root `package.json`). Phase 5
adds the dev server explicitly:

- `packages/webui/vite.config.ts` — points at
  `packages/webui/src/client/main.tsx`, proxies WebSocket to
  `127.0.0.1:<port>` from the running server.
- `packages/webui/package.json` — `dev: "vite"`,
  `dev:server: "node ../../scripts/run-webui-server.mjs"` (or the
  equivalent server entry that already exists).
- Root `package.json` — `dev:webui: "pnpm --filter @mavis/webui dev"`
  if a top-level convenience script is wanted.

Without the dev server, phase 5's "Boot the WebUI and walk through
`/login` → `/onboarding` → `/archon` → `/settings`" smoke test is not
runnable.

## Verification matrix

The repository's actual gate names, verified against the current root
`package.json` and `scripts/verify.mjs`:

| Gate | Command | Notes |
| --- | --- | --- |
| Boundary | `pnpm build:webui && pnpm check:webui-boundary` | WebUI esbuild artifact with Vite as the dev server (ADR 0010). Boundary asserts no retired sources and no `packages/tui/src/tui` import. |
| Type check | `pnpm typecheck:webui` | Browser and server code under the same package; runs `typecheck:server` and `typecheck:client`. |
| Tests | `pnpm test:webui` | Runs the `webui` group in `test/vitest-suites.json` via `scripts/run-vitest-suite.mjs`. |
| Standalone type check | `pnpm check:standalone` | Confirms the standalone CLI build does not bundle webui sources. |
| Source | `pnpm check:source` | Reads `release/public-source.json` and retired sources. Requires phase-zero inventory step. |
| Inventory | `node scripts/source-inventory.mjs --write`, reviewed before committing | New binary and source files must be in the inventory. |
| Test registration | every new test file listed in `test/vitest-suites.json` under the `webui` group | Without registration, `check:source` fails (see `scripts/lib/vitest-suites.mjs:42-51`). |
| Lockfile | commit the `pnpm-lock.yaml` update for `katex` | CI installs with `--frozen-lockfile` (`.github/workflows/ci.yml:40`). |
| License | `release/dependency-licenses.json` lists `katex` with MIT | No CI gate today; manual review before opening the PR. |
| Full verify | `pnpm verify` | Run on the reviewed commit with a clean tracked tree. |

The plan does not use `pnpm --filter webui typecheck` /
`pnpm --filter webui build` / `pnpm --filter webui test:unit` — those
commands do not exist in this package. The earlier draft of this plan
used them; the corrected commands are above.

`docs`-profile eligibility: this plan, the ADR amendment and the
inventory update all land under `docs/` and are documentation-shaped
under `scripts/ci-changes.mjs:15`, but the implementation steps are
not — the full profile is the correct choice.

## Phasing

The phases below are ordered so each one ships a runnable artifact with
green gates.

| Phase | Steps | Outcome | Client changes? |
| --- | --- | --- | --- |
| 0 — Inventory | regenerate `release/public-source.json` | `pnpm check:source` becomes green from a known-red baseline | No |
| 1 — Identity switch | B1 | WebUI runs the TUI system prompt and inherits `isCommandLineRuntimeOwner` semantics, including `tuiProductPolicy` and `contentReviewEnabled` for `cn` | No |
| 2 — Command surface | B2 | `runCommand` operation and transport method callable from the client; six commands wired | Yes (`client/transport.ts`) |
| 3 — Projections | B3 | Streaming frames the client consumes carry compaction, permission, questionnaire and usage state | Yes (`client/stream-loop.ts`) |
| 4 — Assets and dev server | C1, C2, C3, phase-5 dev server wiring | Image and KaTeX assets land; KaTeX wired into markdown; Vite dev server runnable | No (asset migration only) |
| 5 — Pages and settings | C4, C5 | Four pages render; settings modal is openable and writes back to the runtime host | Yes (client pages and components) |

The phase-1 gate is `pnpm typecheck:webui` + `pnpm test:webui` + manual
prompt inspection. Phase-2 through phase-5 gates include
`pnpm check:webui-boundary`, `pnpm check:standalone`, and
`pnpm check:source`. Each phase ends with `pnpm verify` on the
reviewed commit before the next one starts, per AGENTS.md.

The earlier draft of this plan said phases 1–3 ship "without a client
change". That was wrong: B2 changes `client/transport.ts` and B3 changes
`client/stream-loop.ts`. The corrected boundary is in the table above.

## Risks

The risks below are listed in priority order; the top items are the ones
most likely to bite during implementation.

1. **`tuiProductPolicy` and `contentReviewEnabled` are product-policy
   changes, not infrastructure.** Switching the owner identity to `'tui'`
   turns on four flags in `@mavis/local-runtime-v2` without further
   configuration. In the `cn` region this turns on content review for
   every WebUI session. The plan accepts this as part of "backend logic
   from TUI" but it must be called out in the PR description. Mitigation:
   if the product wants to opt out of one of the flags for WebUI, the
   proposal must add a new code path in `@mavis/local-runtime-v2`. The
   WebUI does not own this.
2. **Projection drift against the harness event protocol.** The ADR
   amendment establishes the shared event corpus as the conformance
   surface. The risk is real but bounded: a harness protocol change
   lights up tests in both clients, and the corpus is reviewed alongside
   every harness protocol PR. The longer-term fix (extract a shared
   client package) is out of scope per the original brief.
3. **`_v2/tui/SYSTEM.md.hbs` is mandatory.** The harness throws if the
   file is missing (`packages/local-runtime-v2/src/service/agent/builtin/catalog.ts:358`).
   The build pipeline must preserve it during packaging. Mitigation: a
   smoke test boots the WebUI with a fresh `~/.minimax` and confirms
   the file is read.
4. **`katex` lockfile, license and bundle weight.** Adding `katex` is
   the largest single new dependency. The lockfile update must be
   committed or CI fails. The license entry must be added to
   `release/dependency-licenses.json`. The CSS bundle weight (the
   katex CSS plus the bundled font directory, on top of the single
   ADR-0010 stylesheet) must be measured after phase 4 and added to the
   PR description; the visual-language doc's "do not lift the compiled
   stylesheet" rule still applies to the desktop CSS, not to the katex
   CSS, but a budget needs to be agreed.
5. **Asset count drift.** The 27-image and 60-font counts are observed
   figures on this branch and may shift with future desktop extractions.
   A filename manifest is committed alongside the asset copy so reviewers
   can see what changed.
6. **Existing `webui-service.test.ts:1618` regression.** B1's file list
   includes the test update; if the test update is missed the existing
   `'cli'` assertion fires.
7. **`postcss-import` adds a build-time dependency.** If the postcss
   pipeline cannot resolve the katex CSS path, the build fails. The plan
   accepts this as a phase-4 exit criterion.
8. **Dev server wiring is missing today.** Phase 5 adds it. Without it,
   the "boot the WebUI and walk through" smoke test cannot run.
9. **Data-directory section is read-only.** Anyone who reads the
   "data directory" section of the settings modal and assumes it
   supports relocation will be disappointed. The section title and
   helper copy must say so explicitly.
10. **`pnpm check:source` is red on this branch before any work starts.**
    Phase zero fixes it. The PR description must call this out so a
    reviewer who runs `check:source` against `main` is not surprised.
11. **The team-mode toggle registers intent but has no harness-side
    consumer.** `CreateSessionInput.teamModeOff` is accepted by the
    protocol and forwarded by the WebUI, yet nothing in
    `@mavis/local-runtime-v2` reads it today and no input carries
    `teamMode`. The toggle drives client state (choice, lock, badge)
    and persists the create-time flag, but does not by itself change
    agent behaviour. If product expects team assembly to key off the
    toggle, that needs a harness-side consumer — a separate milestone.
    The PR description must state this.

## Plan revision note (post-implementation)

During the third implementation round, the implementer correctly
stopped rather than invent behaviour. Specifically:

- `WebuiHarnessPort` does **not** expose `getPersonaFile` /
  `savePersonaFile` / provider CRUD / memory CRUD ports.
- `@mavis/local-runtime-v2` reads **neither** field at runtime, and no
  input type carries `teamMode`; `teamModeOff` does exist on the
  protocol's `CreateSessionInput` but has zero consumers inside the
  package, and `MessageSendInput` carries no team fields. (Decision
  2026-09-22: option a — ship the toggle on `teamModeOff` alone; see
  the Agent team mode section and risk 11.)

These were originally planned as in-scope (this revision of the plan
predates the correction). The desktop renderer implements them by
calling the cloud backend directly (Thrift IDL,
`agent.minimax.cn`), not through the harness. v1 is constrained to
the harness as its single seam (per
[ADR 0001](../adr/0001-webui-is-a-peer-client-of-the-harness.md));
extending the harness to expose these is a separate concern that is
explicitly out of this plan's scope.

The plan was revised accordingly:

- The persona, providers and memory settings-modal sections are
  rendered as section headings with placeholder copy and i18n-key
  markers, so the section order matches desktop without inventing
  behaviour. A future milestone that adds the harness plumbing can
  wire the actions without changes elsewhere.
- The session-level "Agent Team mode" composer toggle is removed
  entirely from v1. Onboarding step 1 ("Agent Team mode") still
  appears because it is onboarding copy, not the toggle.

A future milestone that wants these features should:

1. Add the relevant ports / contract fields to
   `@mavis/local-runtime-v2` and `CliService`. This affects every
   harness consumer (TUI, desktop, future clients) and is the kind of
   change AGENTS.md and `docs/source-sync.md` warn against without a
   dedicated review path.
2. Expose them through `@mavis/local-runtime-v2` →
   `@mavis/webui`'s `WebuiHarnessPort`.
3. Then re-activate the in-scope rows in the v1 feature parity
   matrix above and implement against the new ports.

The shared event corpus from
[ADR 0011](../adr/0011-shared-event-corpus-in-local-runtime-v2.md)
still applies: when the harness protocol changes, both TUI and WebUI
clients update their consumers independently, validated against the
same fixtures.