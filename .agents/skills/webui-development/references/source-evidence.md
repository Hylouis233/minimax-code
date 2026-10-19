# Source evidence and refresh

## Baseline

Investigated on 2026-10-19 starting at HEAD `4de6a59a5df5fa8a2eeab782fdb71603e1da9197` in `/home/fectivnfy/my_data/project/my_project/minimax-code`. The working tree already contained modifications to the package manifest and browser/integration tests, and a staged test-result deletion. `test/browser/fixture.mjs` also changed during the investigation. Concurrent work advanced HEAD to `7574e4b07579570c08fd1d83af67cc92294de75d`; the intervening diff changes the package manifest and tests, with no `packages/webui/src/` changes. Final capture provenance records that later clean tree and input hashes. This skill creation did not edit or commit repository files.

The dependency checker scanned all 435 TypeScript source files and 1,557 in-package references: zero direction violations, cycles, role violations or publication violations; one declared structural exception. The current build succeeded with 108 server inputs, 331 client inputs and 432 combined inputs. Counts describe that run only and are not acceptance thresholds.

Human/source investigation followed all four execution boundaries, all business homes, application wiring and teardown, request-freshness and submission mechanisms, validators/registry/bindings, capability derivation, runtime resources, style/token/compiler setup and representative unit/integration/browser tests. This is comprehensive architecture-oriented coverage, not a claim that every line of every file received an exhaustive correctness review.

Independent read-only forward-testing exercised file-preview refresh during session switching and a new appearance settings row. It confirmed useful routing and found two refinements incorporated here: inspect leaf-owner disposal rather than universalizing application fencing, and settle/verify the actual surface before screenshot capture. The helper now checks finite animation settlement, image loads, theme and settings-versus-conversation identity. The final six originals were visually inspected. Full repository test suites and real provider/account scenarios were not executed for this external skill-only change.

## Source anchors by claim

| Claim | Read/refresh in the repository |
| --- | --- |
| Operating rules and doc authority | root/package `AGENTS.md`, `packages/webui/docs/README.md`, `CONTEXT.md` |
| Layer and role direction | `scripts/lib/webui-dependency-rules.mjs` (`ALLOWED_EDGES`, `PROJECTION_DOMAIN`, `classifyLayers`, `classifyRole`, role/publication checks), `scripts/check-webui-dependency.mjs` |
| Browser wiring | `src/client/main.tsx`, `application/create-application.ts`, `port-slices.ts`, `bindings/application-context.tsx` |
| Canonical state and temporal identity | `application/session-store.ts`, `identity-epochs.ts`, `conversation/request-freshness.ts`, `session-scope.ts`, `stream-lease.ts` |
| Creation and submission | `application/task-session-workflows.ts`, `features/turn/contracts/submission.ts`, `application/submission-admission.ts`, `composer-submission.ts`, `turn-commands.ts`, Composer controller |
| Independent business ownership | Feature application modules listed in `architecture.md`; per-session Goal/Interactions, separate Review families, provider editor, terminal owner |
| Ingress and delivery | `client/platform/event-channel.ts`, `features/turn/application/event-coordinator.ts`, `session-fact.ts`, `conversation/stream-loop.ts`, Turn sink adapter |
| Loopback contract | `shared/operation-names.ts`, `server/operation/{operations,bind-handlers,binding-mechanism,operation-dispatch}.ts` |
| Support/readiness | `shared/capability-manifest.ts`, `server/service.ts`, `runtime/harness/adapter.ts` |
| Process close | `runtime/assembly.ts`, `runtime/lifecycle.ts`, `runtime/terminal.ts`, `server/service.ts` |
| Visual baseline | `client/styles/{tokens,index,shell}.css`, `tailwind.config.cjs`, feature CSS, `ConversationSurface.tsx`, `WebuiClientFoundationApp.tsx`, Settings appearance source |
| Verification | `scripts/verify.mjs`, root/package scripts, `test/vitest-suites.json`, `playwright.config.mjs`, browser harness/server/fixture, token tests |

Unless explicitly prefixed, source rows refer to `packages/webui/src/`. Use symbol search for exact current locations rather than freezing line numbers that will drift.

## Refresh workflow

When using this skill, re-read current operating instructions and touched source. Refresh a reference only when changed source or an actual task reveals it is stale. Check callers, tests and decision rationale together; repository documents are navigation, not implementation proof. Never restore retired plans/generated navigation tables merely because a past memory mentions them.

For a visual refresh: inspect source/CSS changes, rebuild, run the capture helper to a new external directory, inspect original PNGs in both themes, review the manifest/errors and only then deliberately replace the skill references. Keep synthetic data labels and provenance. Rendering a new screenshot does not approve a product redesign.

The capture helper is reusable tooling. Its output should stay outside the repository; it owns an ephemeral loopback server and headless browser only. It uses existing repository Playwright and fixture code. Failure to find a build, package, browser or selector is explicit; resolve the actual mismatch rather than silently generating a fake reference image.

Hindsight knowledge search/list were attempted during creation but returned connection failures. No Hindsight page was treated as source evidence. Historical local notes helped select lifecycle and evidence-boundary questions; current code/docs/gate output supply the actual guidance here.
