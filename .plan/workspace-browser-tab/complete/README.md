# Completion evidence — workspace browser tab model

This directory is where the workspace browser tab model's **completion evidence** will live: the
records the suites write while they run, and the completion note.

The plan is [`../workspace-browser-tab-plan.md`](../workspace-browser-tab-plan.md). There is no
execution board for this programme yet, and none of the work has started.

## What belongs here

| File | Written by | What it holds |
| --- | --- | --- |
| `<suite>.acceptance.json` | the Playwright suites, through `packages/webui/test/browser/acceptance-record.ts` | one record per case: what was set up, what was observed, and what the person saw |
| `*.evidence.json` | a probe run by hand | what a real isolated Chromium did, on the machine named in the record |

The published acceptance record for this work is
`packages/webui/docs/browser-use/09-acceptance-record.md`, and the decision record is
`packages/webui/docs/adr/0022-webui-workspace-panel-is-a-browser-tab-strip.md`.

## The rule

The record files are written by the suites, and the path is set in
`packages/webui/test/browser/acceptance-record.ts`. A new programme's records must go to **that
programme's** `complete/` directory, not to this one — a second plan's records landing on top of
this one's is the failure the per-plan directory exists to prevent.
