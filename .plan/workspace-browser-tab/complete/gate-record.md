# The gate, and what it was run against

The plan's §7 names six gates, and §9 makes them the completion definition: "The WebUI gates in §7
pass". This file is that record — what was run, on what, and what it said — so the claim can be
checked without running it again.

**The run.** Every gate below was run on the tree that carries this record, in one sequence, in this
order. The only files that changed after the run are this record and the inventory line it adds; no
source file, no test and no document changed after it. The run was made at `4e7efd43`; the only
commits since are this record and the inventory line it adds, so the code the gates ran against is
the code this tip carries. The gate was first run on that code at `4d247f43`.

**The unit suite ran four more times** after the last of the fixes below, on the same tree: 208 files
and 3230 tests, every time, with no unhandled errors. The gate had been red twice before that — once
for a reason that is now understood, and once for a reason that was a defect in the service.

**The environment.** Linux 7.0.0-38-generic, Node v26.8.1, Google Chrome 152.0.7977.82
(`/usr/bin/google-chrome`), in the branch's own worktree.

## The gates

| Gate | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck:webui` | **pass** — the server, the client and the test projects all type-check |
| Unit and gate tests | `pnpm test:webui` | **pass** — 208 files, 3230 tests |
| Dependency direction | `pnpm check:webui-dependency` | **pass** — 476 source files, 1734 in-package references, 0 violations, 0 cycles, 0 role violations, 0 publication violations |
| Build | `pnpm build:webui` | **pass** — 130 server inputs, 345 client inputs, 467 total |
| Build boundary | `pnpm check:webui-boundary` | **pass** — 467 inputs; source/output integrity, required entries and public workspace imports verified |
| Source projection | `node scripts/source-inventory.mjs --write` then `pnpm check:source` | **pass** — 5406 published paths |
| Real browser | `pnpm test:webui-browser` | **pass** — 146 Playwright tests, 2.1m, against real Chrome 152 |

One gate beyond §7 was run as well, because it is the closest thing the repository has to
"the thing a person installs works":

| Gate | Command | Result |
| --- | --- | --- |
| Installed package | `pnpm test:webui-package` | **pass** — `@fectivnfy112358/minimax-code-web@0.1.0-preview.3`; archive installation, real runtime startup, HTTP assets, the packaged bridge's admission and shutdown |

The repository's own full gate is deliberately **not** run: §7 says the repository-level gates cover
ground this change does not move, and the macOS `verify` job is CI's to run.

## The cadence, honestly

§7 says the gates run **once**, at the end of the whole slice, because running them per work
package would spend the time on gates that cannot pass until the slice is finished. The rule was
honoured where it matters — **the gate was never run per work package**; each issue ran only the
suites that issue touched — but the gate as a whole ran **five times, not once**. Every run came
after a whole block of changes, and each of the first four found a real defect, so stopping after
the first would have meant shipping a gate that was red for a known reason.

| Run | The tree it ran at | What it found |
| --- | --- | --- |
| 1 | at the end of the plan | two defects: the stylesheet referenced two variables that do not exist, and the file results were read by the tab id while the read was filed by the content key |
| 2 | after the external review's fixes (`456f814c`) | the port-slices test named the browser slice's members, which the new close operation had joined |
| 3 | `4d247f43` | an acceptance case failing intermittently — a run with no selection that opened a web tab was not given the page, because the service compared a selection it had read *before* the listing against a generation that had moved while the listing was in flight. The service now reads the selection per target, and the registry adopts a provider-reported generation that is ahead, because a page that is still loading is observed as a replaced page while it is being attached to. |
| 4 | the same tree, before `782c137b` | the suite's file failing with every test in it passing: the provider removed its profile directory right after killing the browser, and the browser was still writing it. The removal is now retried. |
| 5 | `4e7efd43` | nothing — everything green, as the table above says |

Runs 3 and 4 found the *same* two defects from different angles: the first was a test failing, the
second was a file failing with nothing failing in it.

**Everything else was a targeted re-run, not the gate.** The unit suite was re-run four more times
on the final tree — 208 files and 3230 tests every time, no unhandled errors — while the two
intermittent failures above were being pinned down, and single suites were re-run while their own
defect was being fixed. Those are development iterations on a failing suite; the table above is the
list of the gate runs, and this file is the list of what each one found.

## What the repository's CI says, and what it does not

The fork's CI runs the repository's whole `verify` profile, which is wider than §7. Its history on this
branch and on the base branch:

| Tip | What failed |
| --- | --- |
| `83d8052a` (the first push) | `test:webui` on ubuntu — the suite's file failing with every test in it passing: the `ENOTEMPTY` cleanup race, fixed in `782c137b` |
| `5d154673` | `test:capabilities` on macos-latest, in `packages/local-runtime-v2/test/unit/agent/storage/agent.repository.test.ts` |
| `acbf1b40` | `verify (ubuntu-latest)` — the six external-bridge cases described below |
| `01cf5785` (the tip) | the same six, and `verify (macos-latest)` was **cancelled** with the matrix |
| `a63a6c99` — the base branch's own CI run, before this programme | `verify (macos-latest)` and `verify (ubuntu-latest)` |

So the `test:capabilities` failure is **pre-existing on the base branch**, in a package this slice
does not touch: `packages/local-runtime-v2`. The plan's §7 says the repository-level gates cover
ground this change does not move, and that is exactly what the history shows. The webui gates — the
ones §7 names and §9 requires — are green at the tip that carries this record, and the run at
`83d8052a` that the CI caught was the cleanup race, which is fixed.

The base branch's own run, `a63a6c99`, **cannot** say anything about the external-bridge spec: the
spec did not exist at that commit. It was introduced by the browser-use programme at `91a1a1c4`, and
every CI run of that programme from there on has failed the same six cases.

### The CI's ubuntu job, at the tip

The CI's `Source verification` run at the tip this record carries — run `39649558021`, head
`01cf5785`:

| Job | Result |
| --- | --- |
| `changes` | **pass** |
| `verify (windows-latest, 24)` | **pass** (3m14s) |
| `verify (macos-latest, 24)` | **cancelled** — the matrix cancelled it when the ubuntu job failed, so it carries **no verdict**, not a pass |
| `verify (ubuntu-latest, 24)` | **failure** (18m45s), stopped at `test:webui-browser` |
| `verification` | failure — "Require every planned check" |

Inside the ubuntu job:

| Step | Result |
| --- | --- |
| `test:webui` | **pass** (107.5s) — the webui unit suite is green in CI |
| `test:webui-package` | **pass** (23.1s) |
| `test:webui-browser` | **FAIL** (890.4s) — 140 passed, **6 failed** |

### The six failures, and what they are not

The six are all in `packages/webui/test/browser/browser-bridge-real-external.spec.ts` — the
**previous** programme's external-bridge cases, which drive a real browser with the built extension
and then act on the **live tab**. Each one ran to the test's own 120-second timeout with no other
error:

| Case | Result |
| --- | --- |
| `browser-bridge-real-external.spec.ts:82:5` — the bridge survives the worker being terminated in `chromium` | timeout (2.0m) |
| `browser-bridge-real-external.spec.ts:162:5` — text input reaches the page through the chrome bridge in `chromium` | timeout (2.0m) |
| `browser-bridge-real-external.spec.ts:262:5` — a DevTools command runs against the live tab through the chrome bridge in `chromium` | timeout (2.0m) |
| `browser-bridge-real-external.spec.ts:82:5` — the bridge survives the worker being terminated in `msedge` | timeout (2.0m) |
| `browser-bridge-real-external.spec.ts:162:5` — text input reaches the page through the edge bridge in `msedge` | timeout (2.0m) |
| `browser-bridge-real-external.spec.ts:262:5` — a DevTools command runs against the live tab through the edge bridge in `msedge` | timeout (2.0m) |

**This corrects what an earlier version of this record said.** It said the runner "cannot drive a
real browser with the extension", and that the spec's "is the browser installed" guard was the
reason. Both were wrong. In the *same job*, the sibling spec
`packages/webui/test/browser/browser-bridge-real-browser.spec.ts` **passes in both channels**: the
extension completes the handshake in **785 ms** in `chromium` and in **22.6 s** in `msedge`. The
runner does launch a real browser with the built extension, and the extension does pair with the
host. What is true is narrower: on that runner, the external spec's operations against the live tab
never come back.

**And it is inherited, not introduced here.** The same six cases failed the same way on `a18c916b`
— the browser-use programme's own head commit, merged as PR #195 — where the ubuntu job stopped at
the same gate with **138 passed, 6 failed**:

```console
$ gh run view 39538891164 -R mcode-webui/minimax-code --log-failed \
  | grep -oE "✘ +[0-9]+ packages/webui/test/browser/[^ ]+|[0-9]+ failed|[0-9]+ passed \([0-9.]+m\)|Verification failed at: .*"
✘   20 packages/webui/test/browser/browser-bridge-real-external.spec.ts:82:5
✘   21 packages/webui/test/browser/browser-bridge-real-external.spec.ts:162:5
✘   22 packages/webui/test/browser/browser-bridge-real-external.spec.ts:262:5
✘   23 packages/webui/test/browser/browser-bridge-real-external.spec.ts:82:5
✘   24 packages/webui/test/browser/browser-bridge-real-external.spec.ts:162:5
✘   25 packages/webui/test/browser/browser-bridge-real-external.spec.ts:262:5
138 passed (15.8m)
6 failed
Verification failed at: test:webui-browser
```

`a18c916b` is an ancestor of this branch's base (`webui`), so the base branch carries that redness.
This slice does not touch the extension, the bridge server, or that spec:

```console
$ git diff --name-only webui..HEAD -- packages/browser-extension packages/webui/src/server/browser-bridge
                                     # (no output)
$ git diff --name-only webui..HEAD -- packages/webui/test/browser
packages/webui/test/browser/acceptance-record.ts
packages/webui/test/browser/architecture-acceptance.spec.mjs
packages/webui/test/browser/native-runtime.spec.mjs
packages/webui/test/browser/review-consumers.spec.mjs
packages/webui/test/browser/terminal-cross-page.spec.mjs
```

The five files under `packages/webui/test/browser/` are the acceptance-record writer — which the
sibling spec shares, and which the sibling spec passing in CI demonstrates to be sound — and four
specs that never mention the bridge or the extension.

**They pass here**: the same six cases, on the same tree, in about five seconds, and the record they
write names the browsers they ran in — Chromium 153.0.8010.12 and Edge 155.0.4283.62, six cases,
all `pass` (`.plan/browser-use/complete/real-external.acceptance.json`).

**What is left, exactly:** the CI's ubuntu job is red on six external-bridge cases that were
already red on the base branch's own head. Everything this slice is responsible for is green in CI
(`test:webui`, `test:webui-package`) and green locally (the browser suite, 146 cases).

## What the real-browser acceptance rests on

The fourteen acceptance cases in
[`workspace-browser-tab.acceptance.json`](workspace-browser-tab.acceptance.json) were written by the
suite itself, against real Chrome 152, at the commit that carries this record. The record is the
programme's own evidence, and it is the file the published acceptance record is written from.

## What was not observed

- The macOS `verify` job at the tip: it was **cancelled** with the matrix when the ubuntu job
  failed, so it has no verdict. At `acbf1b40` the same job passed (14m47s), on the same code — the
  five commits between them are documentation only.
- Why the six external-bridge cases hang on that runner. They hang without an error, the run names
  no step, and Playwright's trace for them is written to the runner's temporary directory and is
  not uploaded with the verification summary. The local runs pass, the runner's sibling spec
  passes, and the same six failed on the base branch's own head; what is still unknown is the
  step inside the case where they stop. Nothing in this slice narrows that further, and this
  record says so rather than naming a cause it has not seen.
- The cross-surface bootstrap — a person opening a web tab while the run is selected on Edge — is
  implemented run-wide, but it has no dedicated test. The two same-surface cases are covered by the
  acceptance suite.

## A commit whose subject names only part of it

`0cc664a0` is titled `docs(webui): the plan records that the slice is delivered`, and it is also
where one line of `packages/webui/test/unit/webui-port-slices.test.ts` changed: `closeBrowserWebTab`
joined the expected members of the browser port slice. The commit's body says so. The subject was
not rewritten afterwards, because rewriting it would change the hash of every commit above it, and
those hashes are what the two records in this directory and the published comments on the board
issues refer to — the evidence chain would break in exchange for a better first line. The change
itself is one line, in a test that asserts the port's published members.

## Where the external review's invocation is recorded

The review was run through **paseo**, which started a Codex session against this branch. The
invocation — the provider, the model, the thinking option, the session, the workspace and the
prompt — is written down in [`codex-review.md`](codex-review.md), so that the review is not only
attested by the commit that fixed its findings.

