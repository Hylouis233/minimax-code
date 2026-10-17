// V08 — one zone's failure is recoverable, and it takes nothing else with it.
//
// The root error boundary existed before the zone boundaries, and it was the
// only one: a Workspace, Settings, Plugins or Transcript render failure replaced
// the whole application with the recovery copy. An unsent draft died because a
// file tree failed to render. `WebuiZoneBoundary` now holds the throw at the
// zone that caused it and forwards the *same* recovery contract, so a zone retry
// and an app retry mean the same thing in one place.
//
// This row can only be discharged in the built client. The unit test mounts the
// zone boundary directly; only here are the zone, the composer, the rail and the
// workspace panel all live at once, so "the rest of the app keeps working" is an
// observation rather than an assertion about one component in isolation.
//
// Invalid history rows are discarded by transcript projection. This malformed
// tool record remains a valid message identity and faults while its transcript
// activity is rendered, inside the transcript zone boundary.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

test("a zone failure is recoverable without losing the app", async ({ page }) => {
  await configureFixture(page, () => undefined);
  await openApp(page);

  // The healthy baseline, so every "still there" assertion afterwards has
  // something to have been true of.
  await expect(page.locator("[data-webui-transcript]")).toHaveCount(1);
  const composer = page.getByPlaceholder("输入消息…（输入 / 唤起命令）");
  await expect(composer).toBeVisible();

  // Fault the transcript zone after projection has accepted the message row.
  await page.evaluate(() => {
    window.__fixture.setPage("A", {
      messages: [{ msgId: "broken-tool-call", role: "assistant", toolCalls: [null] }],
      hasMore: false,
    });
  });
  // Re-open the session so the transcript re-reads the poisoned page.
  await page.evaluate(() => {
    window.location.hash = "session=B";
  });
  await page.evaluate(() => {
    window.location.hash = "session=A";
  });

  // The zone caught it. This is the zone copy, not the root one: the title
  // names the transcript, and the root recovery copy is titled differently.
  const zoneError = page.getByTestId("webui-error-boundary-retry");
  await expect(zoneError).toBeVisible();
  await expect(page.locator("body")).not.toContainText("页面的一部分未能正常显示");

  // The point of the row: everything else is still mounted and still usable.
  await expect(page.locator("[data-webui-transcript]")).toHaveCount(0);
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();

  // The composer still takes input, so the draft that motivated the boundary
  // is not the thing that was lost.
  await composer.fill("分区出错时仍可输入");
  await expect(composer).toHaveValue("分区出错时仍可输入");

  // Recovery: answer the read honestly and retry the zone. The retry button is
  // the boundary's own, and it remounts the zone's children, which is what
  // re-establishes their reads.
  await page.evaluate(() => {
    window.__fixture.setPage("A", {
      messages: [
        {
          msgId: "recovered-A",
          role: "user",
          msgContent: "Recovered history A",
          timestamp: 1_700_000_000_001,
        },
      ],
      hasMore: false,
    });
  });
  const readsBeforeRetry = await page.evaluate(
    () => window.__fixture.requests.filter((request) => request.operation === "getMessages" && request.body.id === "A").length,
  );
  await zoneError.click();

  await expect.poll(() => page.evaluate(
    () => window.__fixture.requests.filter((request) => request.operation === "getMessages" && request.body.id === "A").length,
  )).toBeGreaterThan(readsBeforeRetry);

  await expect(page.locator("body")).toContainText("Recovered history A");
  await expect(page.getByTestId("webui-error-boundary-retry")).toHaveCount(0);
  // And the draft typed while the zone was down survived the recovery.
  await expect(composer).toHaveValue("分区出错时仍可输入");
});
