# Gates and evidence

What this package's gates prove, what they do not, and the evidence levels a claim has to name.
Passing CI is not the same as having exercised a live service. The built-client suite has its own
document: [`browser-suite.md`](browser-suite.md).

## Gates

`pnpm verify` runs these in this order (`scripts/verify.mjs`); it is the same set CI runs.

| Gate | Proves | Fails on |
| --- | --- | --- |
| `pnpm typecheck:webui` | The client config, the server/runtime/shared config and the test program compile together | A port member without its stub, a missing binding, a wrong DTO |
| `pnpm typecheck:webui-full` | The same sources under the second, stricter test program | Divergence between the two test programs |
| `pnpm check:webui-dependency` | Import direction and role ownership over the source, including `import type` edges | A forbidden direction, a role violation, a business holding one role in two homes, a stale peer-import exception |
| `pnpm build:webui` | The client and server bundles build, and prints input counts | A module that is written but not wired (counts do not move) |
| `pnpm check:webui-boundary` | Nothing outside the allowed entries entered the build graph | A retired source path, the terminal renderer, a client module in the server bundle or vice versa, a forbidden internal reference |
| `pnpm test:webui-package` | The packaged artefact runs as published | Packaging drift |
| `pnpm test:webui` | The 171-file Vitest group (unit + integration) | Behaviour change, unregistered new test file |
| `pnpm test:webui-browser` | The built client in a real browser against a deterministic in-page transport | Behaviour change in the built bundle |
| `pnpm check:source` | `release/public-source.json` lists exactly the delivered files | A new, moved or deleted file without inventory regeneration |

`pnpm check:webui-dependency` reads source; `pnpm check:webui-boundary` reads build output. Neither
substitutes for the other: type-only edges are erased from the metafile, and an input's presence says
nothing about the direction it points. The dependency check's exception baseline is
`scripts/lib/webui-dependency-baseline.json`; the gate fails both on a new violation and on an entry
that is no longer violated. `../architecture/boundaries.md` states the rules those two gates enforce.

## Evidence levels

Name the level a claim was established at. The levels are not interchangeable, and a lower level
never proves a higher one.

| Level | What it is | Established by |
| --- | --- | --- |
| 1 | Pure behaviour | Unit tests over projections, reducers and mechanisms — no DOM, no transport |
| 2 | Assembled application behaviour | `test/unit/*application*`, `*workflows*`, `*commands*`, creation/adoption and lifecycle suites, with injected capabilities, storage and channel |
| 3 | Real boundary behaviour | `test/integration/loopback-harness-path.test.ts`: a real service, real loopback socket, real envelope, dispatcher and registry, a real `watchEvents` delivery, drop-and-reconnect, and a close that refuses further connections |
| 4 | Live product behaviour | A real agent process, cloud account, native terminal or cross-platform run |

The distribution's reproducible ceiling is level 3, and only partly: at level 3 the leaf host behind
the harness port is a scripted stand-in, because a live `CliSession` is not deterministic to drive
from a test (ADR 0006 requires the stand-in). **No test in this repository proves that a real agent
process answers.** Offline success never substitutes for the cloud, native-terminal or
cross-platform acceptance those boundaries need, and those runs are recorded separately when they
happen.

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
internal hosts or embedded credentials in the inputs it reads from disk; no server-side call back
into the CLI entry points; and every bundled file either inside `packages/webui`, an exported subpath
of a workspace package declared in `release/extraction.json`, or a third-party dependency under
`node_modules/`. The script is the authority for this list; extend it there, with its own test, rather
than in prose.
