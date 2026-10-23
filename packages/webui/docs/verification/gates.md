# Gates and evidence

What this package's gates prove, what they do not, and the evidence levels a claim has to name.
Passing CI is not the same as having exercised a live service. The built-client suite has its own
document: [`browser-suite.md`](browser-suite.md).

## Gates

`pnpm verify` runs these in this order (`scripts/verify.mjs`); it is the same set CI runs.

| Gate | Proves | Fails on |
| --- | --- | --- |
| `pnpm typecheck:webui` | Every source file and every test file compiles under `strict`: the server/runtime/shared config, the client config, and one test program whose `include` is the whole `test/` and `src/` tree | A port member without its stub, a missing binding, a wrong DTO, a test fixture that no longer matches the signature it calls |
| `pnpm check:webui-dependency` | Import direction and role ownership over the resolved source graph, including `import type` edges | A forbidden direction, a role violation, a business holding one role in two homes, a private cross-business import, or an unclassified source |
| `pnpm build:webui` | The client and server bundles build, and prints input counts | A module that is written but not wired (counts do not move) |
| `pnpm check:webui-boundary` | The combined client/server build graph contains required entries and inputs within declared package roots; direct WebUI workspace imports use exported subpaths; the artifact integrity record matches current inputs and outputs | A retired source path, the terminal renderer, a private direct workspace import, a forbidden internal reference, or a stale/modified build artifact |
| `pnpm test:webui-package` | The packaged artefact runs as published | Packaging drift |
| `pnpm test:webui` | The registered WebUI Vitest group (unit, integration and verification-gate tests) | Behaviour change, unregistered new test file |
| `pnpm test:webui-browser` | Every Playwright spec collected under `packages/webui/test/browser/`: the built client and deterministic in-page transport, plus explicit real-browser bridge and production-host/native-PTY harnesses | Behaviour change in the built bundle, a real bridge path, or native lifecycle |
| `pnpm check:source` | `release/public-source.json` lists exactly the delivered files | A new, moved or deleted file without inventory regeneration |

`pnpm check:webui-dependency` reads the resolved source graph; `pnpm check:webui-boundary` reads the
combined esbuild metafile. The dependency check enforces import direction, including type-only edges,
while the boundary check validates the aggregate build inputs and artifact integrity. Because the
build script merges client and server metafile inputs, the boundary check does not independently
attribute each input to a particular output. The dependency check rejects new direction violations
and stale baseline entries; the current direction baseline is empty. Its separate structural
allowance records the non-literal runtime import described in
[`../architecture/boundaries.md`](../architecture/boundaries.md). That document states the rules these
gates enforce.

## Evidence levels

Name the level a claim was established at. The levels are not interchangeable, and a lower level
never proves a higher one.

| Level | What it is | Established by |
| --- | --- | --- |
| 1 | Pure behaviour | Unit tests over projections, reducers and mechanisms — no DOM, no transport |
| 2 | Assembled application behaviour | `test/unit/*application*`, `*workflows*`, `*commands*`, creation/adoption and lifecycle suites, with injected capabilities, storage and channel |
| 3 | Real boundary behaviour | `test/integration/loopback-harness-path.test.ts`: a real service, real loopback socket, real envelope, dispatcher and registry, a real `watchEvents` delivery, drop-and-reconnect, and a close that refuses further connections |
| 4 | Built-browser behaviour | `pnpm test:webui-browser`: rendered built client, navigation, multi-page interaction and recoverable zone failures. Fixture-backed specs use a deterministic in-page transport and do not prove the production service/runtime path. |
| 5 | Real local product boundary | `agent-transcript.test.ts`, `real-host-loopback.test.ts`, `real-host-model-turn.test.ts`, the real Chromium navigation integrations, explicit real-browser bridge specs, and `native-runtime.spec.mjs` on the executing host. These prove only the named local boundary and platform; they do not prove cloud accounts, live external providers or other platforms. |

Deterministic loopback tests replace the leaf host, and deterministic browser tests replace the
server transport. Their levels do not imply native execution. `real-host-loopback.test.ts` and
`real-host-model-turn.test.ts` additionally use the production host; the latter controls only its
external HTTP model endpoint. `agent-transcript.test.ts` drives the built Chromium composer through
the WebUI socket, service, production runtime adapter and a persisted temporary harness session.
Its local deterministic model stub controls streamed reasoning, answers, tool calls and timing; the
test observes an active `sendMessage` WebSocket being closed while the response is held, a new
production `resumeSession` request carrying the last cursor, continued rendered output and persisted
history. A later page reload separately verifies history anchoring through `afterMsgId`. It also
observes an in-flight queued follow-up, runtime request delivery, rendered transcript order, persisted
history and an emptied runtime queue. It selects `@reference.md` from the
workspace mention list and verifies it in the actual send request. A synthetic text attachment is
forwarded through that request, materialized by the runtime into its temporary asset store, and read
back byte-for-byte from persisted attachment metadata. A synthetic runtime `write` executes before
Plan Mode, and the test checks both the isolated workspace bytes and the rendered diff card's file
path and change count. The same test initializes an isolated temporary Git repository and observes
the branch rendered from the production `getWorkspaceEnvironment` service query. After the runtime
write, it also requires another environment query and the rendered changed-file line count. A held
response after a runtime `todowrite` lets the same browser session operate the embedded browser
against a local HTTP page while the Agent is still active; the test checks the todo panel and browser
state before releasing the response. A separate fixture-backed browser test covers a
`workspace.git.changed` event refreshing branch and line counts; that is client evidence, not runtime
integration evidence. `/plan <prompt>` checks request intent and the local model response, but does
not claim a persisted plan-review or approval state. Ask User is emitted once by the stub, answered
through the questionnaire UI, then checked as a rendered assistant continuation and persisted
message in the same harness session. `/goal` is checked through its persisted objective and banner.
The same production-path journey selects `/compact` in the slash palette, carries its custom
instruction and forked-session identity through `runCommand` and the production command runner, and
asserts the command result rendered by the composer. It exits Plan Mode first because that mode
changes the meaning of subsequent composer submissions. The focused browser composer spec separately
checks `/compact` selection and the exact request sent by the built client to its in-page fixture;
that fixture case alone is not runtime evidence.

Several Vitest integration suites launch a system Chromium and use `describe.skipIf` when none of
their supported executable paths exists. In a skip, their real-browser assertions are untested even
though the rest of `test:webui` may pass. The Playwright bridge specs similarly skip Edge-specific
cases when the installed Edge executable is missing. Report those skips from the actual gate output;
do not infer their execution from the suite or file being registered.

The session row's “更多操作” menu creates a real runtime fork; a fork-only composer message is
persisted under the new session, and loading the source and fork session hashes confirms the
transcripts remain separate. Session restoration is checked through route reloads, not a
pointer-driven selection between the two rail links. The stub emits a production `todowrite` call
and holds the following model response open; the test observes the todo in the built-client
progress panel and the rendered `todowrite` activity row while that runtime turn remains active,
then opens a synthetic local origin through the same production browser adapter/service and checks
the browser service target URL, toolbar URL and page frame before releasing the response. Finally,
it stops a held Agent response through the composer, observes `abortSession` and runtime turn
settlement, verifies no late answer persisted, then submits another message and observes a rendered
and persisted recovery answer. A separate controlled `invalid_request_error` response exercises the
assistant error surface: the test waits for the runtime turn to settle and the visible retry button,
clicks it, observes a second `sendMessage` with the identical user text, then checks the rendered
and persisted successful answer. The local model stub refuses until that click, so recovery cannot
be explained by a hidden automatic retry. These cases establish neither live account/provider
authorization nor cloud or other-platform behavior, and they do not cover every permission mode or
diff format.
`native-runtime.spec.mjs` starts the production host/service in a separate process and verifies real
native PTY ownership, output and exit events, providing level-5 evidence for that local terminal
path on the executing platform. State the specific seam and platform instead of extending a green
gate's conclusion to those boundaries.

The Plugins zone has built-client coverage in `plugin-catalogue-layout.spec.mjs`,
`plugin-mcp-status.spec.mjs`, and `visual-baselines.spec.mjs`. The Playwright cases use the real
mounted catalogue/forms and assert visible list, status and dialog results plus the emitted
`pluginManagement` request envelopes. Their catalogue, Skill and MCP responses are synthetic
fixture data. This is level-4 UI and request-wiring evidence; it is not a marketplace call, a real
filesystem install, a production plugin runtime operation, or a live MCP connection. Plugin
workflow Vitest cases separately exercise the production workflow owner with injected operation
ports, and server operation tests validate the accepted action/input contract. No current gate
claims a production-runtime-to-installed-plugin or live MCP journey. The action inventory records
the supported action set and identifies `listRuntimeSkills` as the one action without a client UI
caller.

The add Skill, create Agent, add MCP Server and Git repository import controls are clicked in the
built browser suite. Those cases assert dialog semantics, full-viewport fixed overlay and centered
geometry, desktop field alignment, 390×844 constrained viewport fit, field widths, cancel/backdrop
dismissal, validation, successful request payloads and close-after-save behavior. The MCP case also
switches transport and checks advanced HTTP headers and timeout. Linux screenshots accompany each
dialog. These remain level-4 UI/request evidence because the browser transport uses the in-page
fixture. `real-host-loopback.test.ts` separately exercises production MCP listing through the real
runtime adapter, operation registry, WebuiService and loopback WebSocket, then decodes the response
with the production client codec. It proves the local service/result shape, not the mounted page or
a live MCP connection. Live marketplace, plugin installation and external MCP service behavior
remain outside the default gates.

Linux visual baselines include the plugin marketplace and Skill marketplace card grids, Skill
management rows, and MCP management rows. The browser tests assert grid columns and visible/in-view
geometry independently from the screenshots. The MCP failure reason must render using the
secondary-text token; a browser-level computed-style assertion guards that contrast contract.

## Comparison methods

When a change is supposed to preserve behaviour, the comparison — not the green suite — is the
evidence:

- **Moved bodies: AST equivalence.** Compare function bodies between revisions with the repository's
  own TypeScript compiler API. A hand-rolled brace matcher silently skips declarations whose
  parameter types contain a nested `)` (for example `raw: import("ws").RawData`) or whose name is a
  `#`-private, and then reports "no differences" for a file it barely compared. Normalise relative
  import depth (`./x.js` vs `../x.js`) but keep the target module in the comparison.
- **Wire compatibility: bytes, in order.** Compare frame count, frame order and the UTF-8 payload
  bytes (`Buffer.from(payload, "utf8").equals(...)`). Never parse-and-sort JSON first: that hides a
  reordered frame and a changed key order. Compare the capability calls, the abort signals and the
  iterator finalisation, not only the payload.
- **CSS: effective declarations.** Rebuild, then compare the effective declarations rather than the
  bytes: the compiled stylesheet's hash is expected to move when shadowed declarations are dropped.
  `webui-design-tokens.test.ts` additionally hard-asserts that named component classes appear in the
  compiled stylesheet, so a class no markup references can still be pinned.
- **Consolidation: a mutation.** A preservation case may pass before and after. Prove the new
  implementation owns the behaviour with a targeted fault/mutation, or by removing the old path and
  watching the case fail, not by requiring every preservation case to fail on the baseline.

## Conventions

- **A new Vitest file must be registered** in the `webui` group of `test/vitest-suites.json`. It is an
  explicit list, not a glob; an unregistered file never runs.
- **A new, moved or deleted file must reach the inventory**: `node scripts/source-inventory.mjs
  --write` then `pnpm check:source`. Content-only edits do not need it. Review the added, removed and
  renamed paths before regenerating: recording a file does not make it publishable.
- **Never assert that a testid string exists.** Such an assertion survives every mutation and reads
  as manufactured coverage. Assert the visible or observable outcome instead.
- **Validators are asserted by code, not by message.** `webui-service.test.ts` checks the
  `invalidBody` code only, so a changed message or a relaxed predicate is invisible to the suite. Pin
  message text with `assert.deepEqual` when you touch a validator, and diff the old and new
  implementations with a throwaway probe rather than trusting the suite.
- **No DOM test framework.** Do not add jsdom, happy-dom or `@testing-library/*`, and do not change
  `vitest.oss.config.mjs` (`environment: "node"` is shared by every suite). Interaction coverage
  takes two shapes: extract the transitions into exported pure functions and test those, and assert
  each render branch through `renderToStaticMarkup`. Whatever SSR cannot reach belongs in the
  untested-boundary section of your report.
- **Work material stays outside the repository.** The inventory scans the working tree, so scratch
  committed inside the repository silently becomes a publication problem.

## What the boundary check asserts

`pnpm check:webui-boundary` reads `dist-webui/metafile.json` and applies one rule per assertion
(`scripts/lib/webui-boundary.mjs`): both entry points present; no retired source path
(`packages/local-runtime/src/http/`, `packages/local-runtime-v2/src/http/` and the rest of
`scripts/lib/retired-sources.mjs`); no terminal renderer (`packages/tui/src/tui`); no forbidden
internal hosts or embedded credentials in the inputs it reads from disk; no CLI entry module in the
combined inputs; no unapproved direct workspace import from WebUI source; and build inputs within
WebUI, declared workspace package roots, or `node_modules/`. The script is the authority for this
list; extend it there, with its own test, rather than in prose.
