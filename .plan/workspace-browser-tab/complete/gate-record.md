# The gate, and what it was run against

The plan's §7 names six gates, and §9 makes them the completion definition: "The WebUI gates in §7
pass". This file is that record — what was run, on what, and what it said — so the claim can be
checked without running it again.

**The run.** Every gate below was run on the tree that carries this record, in one sequence, in this
order. The only files that changed after the run are this record and the inventory line it adds; no
source file, no test and no document changed after it.

**The environment.** Linux 7.0.0-38-generic, Node v26.8.1, Google Chrome 152.0.7977.82
(`/usr/bin/google-chrome`), in the branch's own worktree.

## The gates

| Gate | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck:webui` | **pass** — the server, the client and the test projects all type-check |
| Unit and gate tests | `pnpm test:webui` | **pass** — 208 files, 3229 tests, 38.8s |
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

§7 says the gates run once, at the end of the whole slice, because running them per work package
would spend the time on gates that cannot pass until the slice is finished. That is what happened
for the *focused* work: each issue ran the suites that issue touched, and the full gate was not run
per issue.

The full gate itself ran three times, each after a whole block of changes:

1. **At the end of the plan.** It found two real defects: the stylesheet referenced two variables
   that do not exist, and the file results were read by the tab id while the read was filed by the
   content key. Both were fixed.
2. **After the external review's fixes.** It found the port-slices test naming the browser slice's
   members, which the new close operation had joined.
3. **On the tree that carries this record.** Everything green, as the table above says.

The unit suite was then run four further times while an intermittent file-level failure was chased
(the file's own tests all passed while the file was reported failed). It did not reproduce: 208 files
and 3229 tests, every time. That one failure was never captured, so it is not claimed to be
understood — only that it did not recur.

## What the real-browser acceptance rests on

The fourteen acceptance cases in
[`workspace-browser-tab.acceptance.json`](workspace-browser-tab.acceptance.json) were written by the
suite itself, against real Chrome 152, at the commit that carries this record. The record is the
programme's own evidence, and it is the file the published acceptance record is written from.

## What was not observed

- The macOS `verify` job, and CI's own run of `test:webui-browser`. Both are CI's to run, and
  neither was observed from here.
- The cross-surface bootstrap — a person opening a web tab while the run is selected on Edge — is
  implemented run-wide, but it has no dedicated test. The two same-surface cases are covered by the
  acceptance suite.
