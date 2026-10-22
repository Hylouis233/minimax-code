// The browser's half of the workspace panel.
//
// The strip's web tabs, the toolbar and the page are all driven by what the
// runtime publishes, and the runtime is the only thing that can publish them.
// The fixture now answers the browser family with a synthetic browser -- pages
// it paints itself, tabs a test stages, and a run's selection it marks -- so
// this spec can drive the panel's browser half end to end: the launcher's
// address box opens a page, the panel is a window around it, the Agent's page
// is named where a browser has no such mark, and a gesture lands on the page
// in front rather than on the Agent's.
//
// What this spec does NOT prove is the runtime's own browser behaviour. The
// isolated Chromium, the extension and the bridge are proven elsewhere -- by
// the runtime's integration tests and by `browser-bridge-real-*.spec.ts`.
// What is proven here is the client's half: that the panel draws a window,
// that the strip and the toolbar follow what the runtime published, and that
// the two cells stay apart.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

const openPanel = async (page) => {
  await page
    .getByTestId("workspace-panel-controls")
    .getByRole("button", { name: "工作区文件侧栏" })
    .click();
  await expect(page.getByTestId("workspace-panel")).toBeVisible();
};

/** The launcher's address box, opened the way a person opens it. */
const openLauncher = async (page) => {
  await page.getByTestId("workspace-add-tab").click();
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
};

const openPage = async (page, url) => {
  await openLauncher(page);
  await page.getByTestId("workspace-launcher-url").fill(url);
  await page.getByTestId("workspace-launcher-url-submit").click();
};

test("the launcher's address box opens a page, and the panel is a window around it", async ({ page }) => {
  await configureFixture(page, () => undefined);
  await openApp(page);
  await openPanel(page);

  await openPage(page, "https://example.test/");

  // The runtime was asked, and it answered with a page.
  await expect
    .poll(() => page.evaluate(() => window.__fixture.browserTabs().length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__fixture.requests.some((request) => request.operation === "openBrowserWebTab")))
    .toBe(true);

  // The window: a toolbar with the url in an address bar, and the page.
  await expect(page.getByTestId("browser-toolbar")).toBeVisible();
  await expect(page.getByTestId("browser-toolbar-url")).toHaveText("https://example.test/");
  await expect(page.getByTestId("browser-panel-frame")).toBeVisible();

  // A window has no heading above its page, and no list of the browser's pages
  // beside it: the strip is where the tabs are. The section keeps its name for
  // anyone who cannot see the window.
  await expect(page.locator(".webui-browser-panel-title")).toHaveCount(0);
  await expect(page.locator(".webui-browser-targets")).toHaveCount(0);
  await expect(page.getByTestId("browser-panel")).toHaveAttribute("aria-label", "浏览器");
});

test("the strip shows the page the runtime published, and the panel follows it", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setBrowserTabs([
      { id: "tab-1", title: "Example Domain", url: "https://example.test/" },
      { id: "tab-2", title: "Another Page", url: "https://another.test/" },
    ]);
  });
  await openApp(page);
  await openPanel(page);

  // Two pages, two rows in the strip. The rows are the workspace's own tabs,
  // so they are found by the page's title -- which is what a person reads.
  await expect(page.getByRole("tab", { name: "Example Domain" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Another Page" })).toBeVisible();

  // Choosing one brings its page to the front, and the address bar names it.
  await page.getByRole("tab", { name: "Another Page" }).click();
  await expect(page.getByTestId("browser-toolbar-url")).toHaveText("https://another.test/");
  await expect(page.getByTestId("browser-panel-frame")).toBeVisible();
});

test("the page the Agent is on is named at the quiet end of the toolbar", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setBrowserTabs([
      { id: "tab-1", title: "Person page", url: "https://person.test/" },
      { id: "tab-2", title: "Agent page", url: "https://agent.test/", selected: true },
    ]);
  });
  await openApp(page);
  await openPanel(page);

  // The mark says whose page it is, and which page.
  const mark = page.getByTestId("browser-toolbar-agent");
  await expect(mark).toBeVisible();
  await expect(mark).toContainText("Agent");
  await expect(mark).toContainText("Agent page");

  // It is a report and not a control: nothing in the panel writes the Agent's
  // selection.
  await expect(page.getByTestId("browser-panel")).not.toContainText("webui-browser-target");
  const wrote = await page.evaluate(() =>
    window.__fixture.requests.some((request) => request.operation === "selectBrowserTarget"),
  );
  expect(wrote).toBe(false);
});

test("a gesture names the page in front, not the page the Agent is on", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setBrowserTabs([
      { id: "tab-1", title: "Person page", url: "https://person.test/" },
      { id: "tab-2", title: "Agent page", url: "https://agent.test/", selected: true },
    ]);
  });
  await openApp(page);
  await openPanel(page);
  await page.getByRole("tab", { name: "Person page" }).click();
  await expect(page.getByTestId("browser-toolbar-url")).toHaveText("https://person.test/");

  await page.getByTestId("browser-panel-input").click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const sent = window.__fixture.requests.filter((request) => request.operation === "sendBrowserInput");
        return sent.length > 0 ? sent[sent.length - 1].body : null;
      }),
    )
    .not.toBeNull();
  const sent = await page.evaluate(() => {
    const all = window.__fixture.requests.filter((request) => request.operation === "sendBrowserInput");
    return all[all.length - 1].body;
  });
  expect(sent.target.targetId).toBe("tab-1");
  expect(sent.target.targetId).not.toBe("tab-2");
  // The Agent's page was never named, and nothing wrote its selection.
  const wrote = await page.evaluate(() =>
    window.__fixture.requests.some((request) => request.operation === "selectBrowserTarget"),
  );
  expect(wrote).toBe(false);
});

test("a surface that is switched off refuses the page, and says so", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setBrowserAuthorization({ isolatedChromium: false });
  });
  await openApp(page);
  await openPanel(page);

  await openPage(page, "https://example.test/");

  // The runtime refused, and the launcher says what happened instead of
  // opening a page that will never exist.
  await expect(page.getByTestId("workspace-launcher-error")).toBeVisible();
  const opened = await page.evaluate(() =>
    window.__fixture.browserTabs().length,
  );
  expect(opened).toBe(0);
});
