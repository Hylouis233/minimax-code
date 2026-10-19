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
| `pnpm test:webui-browser` | The built client in a real browser against deterministic transport, plus the declared production-host/native-PTY scenario | Behaviour change in the built bundle or native lifecycle |
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
| 4 | Built-browser behaviour | `pnpm test:webui-browser`: rendered built client, navigation, multi-page interaction and recoverable zone failures against its declared fixture |
| 5 | Live product behaviour | A real agent process, cloud account, native terminal or cross-platform run |

Deterministic loopback tests replace the leaf host, and deterministic browser tests replace the
server transport. Their levels do not imply native execution. `real-host-loopback.test.ts` and
`real-host-model-turn.test.ts` additionally use the production host; the latter controls only its
external HTTP model endpoint. `native-runtime.spec.mjs` starts the production host/service in a
separate process and verifies real native PTY ownership, output and exit events, providing level-5
evidence for that local terminal path on the executing platform. These cases establish neither live
account/provider authorization nor cloud or other-platform behavior. State the specific seam and
platform instead of extending a green gate's conclusion to those boundaries.

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
