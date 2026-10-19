# Verification and delivery

Read current `packages/webui/AGENTS.md`, `docs/verification/gates.md`, `docs/verification/browser-suite.md`, root `CONTRIBUTING.md`, `scripts/verify.mjs` and applicable `.agents/skills/testing-workflow/SKILL.md`. The tables below route work; current commands and required gates remain repository authority.

## Select checks

Reuse passing gate evidence: before starting a check, inspect results for the same commit, gate and
platform. Run each applicable check once for unchanged inputs; after a passing `pnpm verify`, do not
repeat its constituent checks for reassurance. Rerun when relevant source, configuration or generated
inputs change, a result failed or did not finish, the required platform is uncovered, or CI requires
the newer commit. If one gate needs a rerun, target that gate instead of repeating the full suite.

| Change | Focused verification, followed by applicable delivery gates |
| --- | --- |
| TypeScript source/tests | `pnpm typecheck:webui` (client, server and tests) |
| Business behavior | Relevant declared Vitest file, then `pnpm test:webui` |
| Imports, roles, publication, file movement | `pnpm check:webui-dependency` |
| Rendered UI, CSS, theme or browser behavior | `pnpm build:webui`, relevant browser scenario, `pnpm test:webui-browser`; inspect actual screenshots for visual claims |
| Bundle/entries | `pnpm build:webui` then `pnpm check:webui-boundary` |
| npm package/launcher | `pnpm test:webui-package`; do not confuse local packaging with publishing |
| New/removed/renamed repo files | Review paths, `node scripts/source-inventory.mjs --write`, `pnpm check:source` |
| Changed exports | `pnpm gen:tsconfig`, `pnpm check:tsconfig` |
| Host events | `pnpm --filter @mavis/webui gen:host-events`, server freshness/type checks and decoder tests |

For a focused Vitest run use the root config, e.g. `pnpm exec vitest run --config vitest.oss.config.mjs packages/webui/test/unit/webui-design-tokens.test.ts`. Every new Vitest file goes in the `webui` group of `test/vitest-suites.json`; otherwise it never joins the declared suite.

Before claiming repository code work done, follow the package's `pnpm verify` requirement. Before a PR the testing workflow requires the reviewed commit with clean tracked files; source export reads committed HEAD. Do not discard another task's dirty work to satisfy this. Report any blocked full verification and complete independent checks. An external personal skill with no repository source changes does not warrant inventing a repository code change just to run its full delivery pipeline.

`pnpm verify --list` shows current platform gates. `pnpm lint`/TUI lint is not a WebUI ESLint gate. Build artifact checks require a current build; Vite development behavior is not the shipped esbuild artifact.

## Test conventions

Unit/integration/gate/browser tests live in `packages/webui/test/{unit,integration,gates,browser}`. The shared Vitest environment is Node. Use pure transitions and `renderToStaticMarkup` for deterministic state/render branches; browser interaction uses Playwright. Do not add jsdom/happy-dom/testing-library or change the shared root environment for convenience.

Browser specs import `test` from `test/browser/harness.mjs`, with `expect` as needed from Playwright. The harness checks both health and page run IDs, not mere port reachability. Default server reuse is off; deliberate reuse must still match its run ID. Keep reports/state outside the repository. Set `WEBUI_BROWSER_OUTPUT_DIR` to a task-specific external directory instead of inheriting a system-temp default where task instructions forbid that.

Assert outcomes users/consumers observe. Existing validators' code-only tests do not pin messages/predicates: add exact rejection assertions for touched validators. Async scenarios should deliberately control delayed answers, navigation, invalidation and disposal, not use arbitrary sleeps. A testid or helper-name string check does not establish behavior.

## Evidence boundaries

| Evidence | Establishes | Does not establish |
| --- | --- | --- |
| Pure unit behavior | Reducer/projection/mechanism contract | Assembly, DOM or wire |
| Assembled application with injected capabilities | Owner/command/lifecycle collaboration | Real loopback/host |
| `loopback-harness-path.test.ts` | Real service/socket/envelope/registry/event delivery with scripted leaf | Real provider/account |
| Built-browser fixture | Rendering, navigation and interactions of built client | Actual service/host/cloud behavior |
| Production host with controlled model HTTP endpoint | Real local host/turn path to that endpoint | Real provider authorization |
| `native-runtime.spec.mjs` | Production host/service and native PTY on executing platform | Other OSes, real account/provider |

Keep each claim at its actual seam. HTTP 200 or a listener is not browser readiness. A screenshot is not interaction coverage. One-page session switching is not independent-page ownership evidence. Native terminal coverage in one scenario does not turn every fixture scenario into native evidence.

For behavior preservation, compare actual contracts: AST bodies with TypeScript tooling for moved logic; frame count/order/UTF-8 payloads and iterator/capability calls for wire; effective declarations and rendered geometry for CSS. Use a targeted fault/mutation when needed to prove a consolidation really owns behavior. These are selected techniques, not a universal obligation to mutate every change.

## Delivery scope

This is a reviewed public source projection: source inventory scans untracked files, so keep scratch/reports outside the repo. Review assets and licenses; do not add real sessions/accounts/credentials. Generated inventory and tsconfig paths are regenerated, not hand edited. Documentation and commit messages are English; preserve product localization and runtime prompt requirements.

Respect explicit authorization. Default repository workflow uses purpose-prefixed feature branches and PRs, not direct default-branch pushes. Issue/PR operations target the private fork identified by the package guide; inspect remotes and pass its explicit repo argument. A task to code or create this skill is not authorization to file public issues, open PRs, send team messages or push. Read the appropriate dedicated workflow if such delivery is requested.
