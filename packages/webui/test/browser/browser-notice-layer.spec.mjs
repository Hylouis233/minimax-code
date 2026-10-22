// The browser panel's notice is a bubble over the page's own corner.
//
// It is easy to believe the bubble is there: it is in the DOM, it has a
// background, and the client renders it. But the panel's stage is opaque and
// the input surface covers the picture, and the notice is rendered *before*
// both of them. Being positioned is therefore not enough for a person to see
// it — the stage and the input surface paint over it in tree order unless the
// notice carries a layer of its own.
//
// This asserts what the person actually gets: at the bubble's own centre, the
// thing on top is the bubble. A notice that is present but painted over is
// not a notice, and no other test in the suite looks at this.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

const openBrowserPanel = async (page) => {
  await page
    .getByTestId("workspace-panel-controls")
    .getByRole("button", { name: "工作区文件侧栏" })
    .click();
  await expect(page.getByTestId("workspace-panel")).toBeVisible();
  await page.getByTestId("workspace-add-tab").click();
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await page.getByTestId("workspace-launcher-url").fill("https://example.test/");
  await page.getByTestId("workspace-launcher-url-submit").click();
  await expect(page.getByTestId("browser-toolbar")).toBeVisible();
};

test("the browser panel's notice is drawn over the page, not under it", async ({
  page,
}) => {
  await configureFixture(page, () => undefined);
  await openApp(page);
  await openBrowserPanel(page);

  const notice = page.locator(".webui-browser-notice").first();
  await expect(notice).toBeVisible();

  // What a person sees at the bubble's own centre is the bubble. The stage
  // under it and the input surface over the picture are both candidates to
  // be on top instead, and both have won before.
  const onTop = await notice.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const element = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return element
      ? {
          className: String(element.className),
          testId: element.getAttribute("data-testid"),
        }
      : null;
  });

  expect(onTop).not.toBeNull();
  expect(onTop.className).toContain("webui-browser-notice");
});
