# The external review of the workspace browser tab model

An independent review of this programme, run with the local OpenAI Codex through
**paseo** (`codex/gpt-6-luna`, `thinkingOptionId: high`), against the branch
`feat/workspace-browser-tab` and its base `origin/webui`.

The reviewer was asked for a read-only review: findings, not patches. It found
five, and the WebUI gate found a sixth. All six are fixed; the commit that
fixes them is `456f814c`, and the acceptance record and the capability matrix
were corrected with them.

## What the reviewer was asked for

1. **Correctness bugs** — the generation fence on every page; the routing of a
   screencast frame to the page it belongs to; races between a page's first
   load and the answer that opened it; anything left behind.
2. **The two cells** — the run's selection and the tab the person is looking
   at, with one writer each and exactly one bootstrap.
3. **Layering and ownership** — the workspace and the browser business must not
   reach into each other's private modules.
4. **Tests that do not prove what they claim** — a test that would pass with
   the behaviour broken; a mock where a real browser is required.
5. **The documentation's honesty** — a rule described as `implemented` without
   the code behind it; a claim a record does not support; a stale statement.
6. **Anything the change broke that the programme did not notice.**

## What the reviewer confirmed

- The provider's per-page generation and frame routing: pages by target and by
  CDP session, `Page.enable` per page, the generation raised by a main-frame
  navigation, and events resolved from the envelope's `event.sessionId`. The
  numeric `event.params.sessionId` is used only for the screencast
  acknowledgement. No defect found in those paths.
- The two selection cells are substantially separated: runtime commands resolve
  the run's selection, the client's viewed-page state supplies the target for
  its frame stream and its input, and the panel's `page-viewed` effect does not
  write the run's selection.
- The stable tab model and the cache adjustments: client-assigned ids and
  mutable contents, the same-file rule as a content lookup, the workspace
  review and the turn review as distinct content sources, and the file and
  review reads depending on the content as well as the tab's identity.
- The cross-business edges use published interfaces: the workspace strip calls
  the browser port and shares the browser's DTOs, and the browser host mounts
  the published workspace strip. No private-module import between the two
  businesses in the paths reviewed.

## The findings, and what closed each

| # | Severity | Finding | Closed by |
| --- | --- | --- | --- |
| 1 | MAJOR | **Closing a web tab left its browser page running.** The close button dispatched the client command and nothing else: the runtime kept publishing the tab, the isolated Chromium kept the page alive, and the next snapshot could make the supposedly closed tab reappear. The acceptance test called the service method directly, so it did not cover the person's close action. | A `closeBrowserWebTab` operation beside `openBrowserWebTab`, and the button goes through it. The page is closed in the browser **first** and the tab leaves the strip after — the runtime stops publishing the tab when its page is closed, and a tab that left the strip while the runtime still published it would be re-added by the next snapshot. The acceptance case now closes through the server's own handler. |
| 2 | MAJOR | **The person's launcher could be refused because the Agent was working in Edge.** The launcher sent the run's id, and the runtime chose the run's *selected* surface — so a url typed in the panel went to the bridge, which cannot open a page. The embedded panel is the isolated browser's view. | The person's page is always opened in the isolated Chromium, and the run keeps the page it was working on. |
| 3 | MINOR | **The bootstrap could race an Agent selection.** The run's selection was read after the page was created, so a run that selected a page while the person's page was opening lost its selection to the bootstrap afterwards. | The selection is read **before** the page is created, and read across every surface: the Agent acts on one page, so the bootstrap is about the run and not about a surface. |
| 4 | MINOR | **The acceptance record overstated what it measured about the client strip.** The case fabricated the runtime's snapshot and called the pure reconcile function and the reducer. That exercises the reducer, not the production subscription or the mounted strip. | The case reads the runtime's own published stream, and it says what it did: the runtime publishes the tab, the strip's reconciliation turns it into a panel command, and the reducer makes it the active tab. The mounted strip is covered by the unit suites. |
| 5 | MINOR | **The authorization trace's source pointers were stale.** They named `#frameMatchesSelection` at `browser-service.ts:733`, `sendInput` at `:289` and the target-change listener at `:176`; none of those identified the code that is there now. | The pointers name the fence that is there now. |
| 6 | MINOR | **The file results never appeared** (found by the WebUI gate, not by the reviewer). The file cache was **read** by the tab id while the read was **filed** by the content key, so the preview never found its result. The effect that reads a file also depended on the content *object*, so a content replaced by an equal one re-read the file and superseded the read already in flight. | The render reads the key the read writes, and the effect follows the content key rather than the content object. |

## What the reviewer did not check

- The whole-programme gate. The reviewer ran focused suites only, and the gate
  is the programme owner's.
- The macOS `verify` job, which is a CI concern.
- The `test:webui-browser` Playwright suite in CI; the local run against real
  Chrome 152 is what the 14-case acceptance record was written from.
