// V04 — a PTY belongs to the runtime, not to the page that opened it.
//
// The workspace panel used to hold the terminal catalogue, the active id and
// the watch handle itself, so a panel that unmounted took the only record of
// what was attached with it: navigating away released the watch, and the PTY
// was no longer listed or watchable anywhere. The Terminal owner now holds that
// truth, and process lifetime belongs to `disposeProcess` / `disposeAll`.
//
// A unit test can prove the owner keeps a record, but only the built client can
// prove what the row is actually about: that a PTY created while session A was
// on screen is still listed, still watched and still producing output after the
// UI has moved to session B and come back. That is why this row needs browser
// evidence, and why the fixture holds the process catalogue itself rather than
// letting a socket own it — see `createTerminal` in fixture.mjs. The bridge is
// synthetic; this spec does not launch a real PTY or terminal service.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

const openTerminalTab = async (page) => {
  await page
    .getByTestId("workspace-panel-controls")
    .getByRole("button", { name: "工作区文件侧栏" })
    .click();
  // A terminal tab is not among the tabs the panel opens with: it comes from the
  // add menu (`role="menuitem"`), which is the only route to a terminal tab.
  const existing = page.getByTestId("workspace-panel").getByRole("tab", { name: "终端" });
  if (await existing.count()) {
    await existing.click();
    return;
  }
  await page.getByRole("button", { name: "添加标签" }).click();
  await page.getByRole("menuitem", { name: "终端" }).click();
  await expect(page.getByTestId("workspace-panel")).toHaveAttribute("data-active-tab", "terminal");
};

const createTerminal = async (page) => {
  await page.getByRole("button", { name: "新建终端" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__fixture.terminals().length))
    .toBeGreaterThan(0);
};

test("a PTY created on one page is listed and watched from another", async ({ page }) => {
  await configureFixture(page, () => undefined);
  await openApp(page);

  await openTerminalTab(page);
  await createTerminal(page);

  const created = await page.evaluate(() => window.__fixture.terminals());
  expect(created).toHaveLength(1);
  const { terminalId } = created[0];

  // The panel is watching it. If nothing is attached, every later assertion
  // would pass against a client that never opened a watch at all.
  await expect
    .poll(() => page.evaluate(() => window.__fixture.watchedTerminalIds()))
    .toContain(terminalId);

  // A second app page attaches to the same synthetic runtime catalogue.
  const pageB = await page.context().newPage();
  await configureFixture(pageB, () => undefined);
  await openApp(pageB);
  await openTerminalTab(pageB);
  await expect(pageB.getByTestId("workspace-panel")).toContainText("#1");
  await expect
    .poll(() => pageB.evaluate(() => window.__fixture.watchedTerminalIds()))
    .toContain(terminalId);
  await expect
    .poll(() => pageB.evaluate(() => window.__fixture.terminals().length))
    .toBe(1);

  // Closing B's panel releases its watch, while A remains attached and can
  // still write to the same synthetic process.
  await pageB.getByRole("button", { name: "关闭面板" }).click();
  await expect
    .poll(() => pageB.evaluate(() => window.__fixture.watchedTerminalIds()))
    .not.toContain(terminalId);
  await page.locator(".webui-xterm-host").click();
  await page.keyboard.type("echo page-A\r");
  await expect.poll(() => page.evaluate(
    (id) => window.__fixture.requests.some((request) => request.operation === "writeTerminal" && request.body.terminalId === id),
    terminalId,
  )).toBe(true);
  expect(await page.evaluate(() => window.__fixture.terminals()[0]?.status)).toBe("running");

  // The roster holds exactly the PTY created before the round trip. A fixture
  // or an owner that re-created on attach would show two tabs here.
  const final = await page.evaluate(() => window.__fixture.terminals());
  expect(final).toHaveLength(1);
  expect(final[0].terminalId).toBe(terminalId);

  // The still-open watch also receives output after B detached.
  const delivered = await page.evaluate(
    (id) => window.__fixture.emitTerminalFrame(id, { data: "after-return\r\n" }),
    terminalId,
  );
  expect(delivered).toBe(1);
});

test("a watch is released without ending the process, and a disposed PTY does not come back", async ({
  page,
}) => {
  await configureFixture(page, () => undefined);
  await openApp(page);

  await openTerminalTab(page);
  await createTerminal(page);

  const { terminalId } = (await page.evaluate(() => window.__fixture.terminals()))[0];

  // Closing the panel detaches the watch. The row is about the two halves being
  // separate: a panel going away releases a watch, never a process.
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__fixture.watchedTerminalIds()))
    .not.toContain(terminalId);

  const stillRunning = await page.evaluate(() => window.__fixture.terminals());
  expect(stillRunning).toHaveLength(1);
  expect(stillRunning[0].status).toBe("running");

  // An explicit close is the other half: it ends the process, and the roster
  // loses the row rather than reporting it as exited-but-present.
  await openTerminalTab(page);
  await page.locator(".webui-terminal-actions").getByRole("button", { name: "关闭" }).click();

  await expect
    .poll(() => page.evaluate(() => window.__fixture.terminals().length))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.__fixture.watchedTerminalIds()))
    .not.toContain(terminalId);
});
