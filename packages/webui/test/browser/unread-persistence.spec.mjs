// Unread persistence across a real boot (T02; correction C1, plan §4.1).
//
// The unit suite proves the assembly hydrates before it writes and excludes the
// session it is opening. What only a real boot can show is the other half of C1:
// the production entry actually hands the assembly the browser storage adapter,
// so a returning user's counts survive a reload and the session they open does
// not come back with the badge they just read.
//
// The storage key and its format belong to `platform/storage.ts`
// (`SESSION_UNREAD_STORAGE_KEY`, positive counts only), and the badge attribute
// is what the rail publishes, so both are asserted as the real artifacts rather
// than through a helper the app does not use.

import { expect } from "@playwright/test";

import { openApp, test } from "./harness.mjs";

const SESSION_UNREAD_STORAGE_KEY = "mavis-session-unread";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER_CONSOLE_ERROR", message.text()); });
});

/** Seeds the stored counts before the app boots, the way a returning user has them. */
async function seedUnread(page, counts) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_UNREAD_STORAGE_KEY, JSON.stringify(counts)],
  );
}

const storedCounts = (page) =>
  page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, SESSION_UNREAD_STORAGE_KEY);

// The badge lives inside the row the rail publishes for a session, so the row's
// own link attribute is the anchor rather than a selector invented here.
const badgeOf = (page, sessionId) =>
  page.locator(`[data-webui-session-link="${sessionId}"] [data-webui-unread-badge]`);

test("a returning user's counts are restored, and the opened session is not badged", async ({ page }) => {
  await seedUnread(page, { A: 5, B: 3 });
  await openApp(page, "#session=A");

  // B keeps the count the store held for it…
  await expect(badgeOf(page, "B")).toHaveAttribute("data-webui-unread-badge", "3");
  // …and A does not come back badged with the count the user just read: the
  // route reached hydration before the first write, so A's entry was dropped
  // rather than restored.
  await expect(badgeOf(page, "A")).toHaveCount(0);

  // The persisted value is the restored floor minus the open session — the
  // production entry wrote it, which is what C1 was about.
  await expect.poll(() => storedCounts(page)).toEqual({ B: 3 });
});

test("the counts survive a reload", async ({ page }) => {
  await seedUnread(page, { A: 5, B: 3 });
  await openApp(page, "#session=A");
  await expect.poll(() => storedCounts(page)).toEqual({ B: 3 });

  await page.reload();
  await openApp(page, "#session=A");

  // The second boot reads what the first one persisted: B is still badged and A
  // is still clean.
  await expect(badgeOf(page, "B")).toHaveAttribute("data-webui-unread-badge", "3");
  await expect(badgeOf(page, "A")).toHaveCount(0);
});

test("opening another session clears that session's badge and persists the reduction", async ({ page }) => {
  await seedUnread(page, { A: 4, B: 6 });
  await openApp(page, "#session=A");
  // Boot restored B's count and dropped A's (A is the open session).
  await expect(badgeOf(page, "B")).toHaveAttribute("data-webui-unread-badge", "6");
  await expect.poll(() => storedCounts(page)).toEqual({ B: 6 });

  await page.evaluate(() => { window.location.hash = "session=B"; });
  await expect(badgeOf(page, "B")).toHaveCount(0);
  // Opening B clears B, and nothing else is badged, so the stored floor empties.
  // The key is dropped rather than left holding zero counts, which is the
  // positive-count rule the storage adapter owns.
  await expect
    .poll(async () => (await storedCounts(page)) ?? {})
    .toEqual({});
});
