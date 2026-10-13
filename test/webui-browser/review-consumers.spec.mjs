// The review consumers, against the built client (T10's verification seam:
// "transcript/workspace review browser consumers").
//
// The transcript's diff card reads a turn through the review owner — the owner
// asks the runtime, and the card shows what came back — and a revert the owner
// settles is announced so the workspace review family refreshes. Unit tests pin
// the owner's decisions; these cases pin that the surfaces are actually wired to
// it.

import { expect } from "@playwright/test";

import { configureFixture, openApp, switchSession, test } from "./harness.mjs";

/** An assistant message carrying a turn diff, which is what makes the transcript
 *  render its diff card. */
const diffMessage = {
  msgId: "assistant-diff",
  role: "assistant",
  msgContent: "改好了",
  timestamp: 1_700_000_000_500,
  fileChanges: [{ file: "a.ts", additions: 2, deletions: 1 }],
  changeSetId: "cs-1",
  sourceMessageId: "assistant-diff",
  canUndo: true,
  turnDiffStatus: "active",
};

const requests = (page, operation) =>
  page.evaluate(
    (name) => window.__fixture.requests.filter((request) => request.operation === name).length,
    operation,
  );

/** Boot, seed the diff-bearing page, and re-enter the session so the transcript
 *  reads it. */
async function openSessionWithDiff(page) {
  await configureFixture(page, () => undefined);
  await openApp(page);
  await page.evaluate((message) => {
    window.__fixture.setPage("A", { messages: [message], hasMore: false });
  }, diffMessage);
  await switchSession(page, "B");
  await switchSession(page, "A");
}

test("the diff card reads its turn through the review owner", async ({ page }) => {
  await openSessionWithDiff(page);
  const card = page.locator('[data-testid="turn-diff-card"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("a.ts");
  // The card did not fetch this itself: the owner did, on the card's behalf.
  await expect.poll(() => requests(page, "getTurnDiff")).toBeGreaterThan(0);
});

test("a revert the owner settles is what the card shows", async ({ page }) => {
  await openSessionWithDiff(page);
  const card = page.locator('[data-testid="turn-diff-card"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-webui-diff-state", "active");

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("turn-diff-undo").click();
  await expect.poll(() => requests(page, "revertTurnDiff")).toBeGreaterThan(0);
  // The reverted view comes back through the owner, not from a local guess.
  await expect(card).toHaveAttribute("data-webui-diff-state", "reverted");
  await expect(page.getByTestId("turn-diff-undo")).toContainText("重新应用");
});
