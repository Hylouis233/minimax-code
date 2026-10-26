// The Mini App surfaces in the built client: launcher tile → picker → view.
//
// This is the acceptance the unit tests cannot give. They prove the reducer and
// the projection; this drives the assembled client — the real panel, the real
// launcher, the real published picker and view — against the suite's fixture
// transport, and asserts what a person sees: the tile opens a list, the row they
// choose starts the Mini App, and the panel frames the view URL the open
// operation answered with.
//
// The fixture stands in for the host, so what this does *not* prove is the
// runtime's own start path, the proxy, or that the Mini App's page renders inside
// the frame. Those are `miniapp-operations.test.ts`, `miniapp-surfaces.test.tsx`
// and the runtime's own suites.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

/** The catalogue row the fixture answers with. */
const MINI_APP = {
  pluginId: "demo.miniapp",
  displayName: "演示应用",
  description: "一个用于浏览器验收的 Mini App",
  runtime: { kind: "process", status: "stopped" },
};

/** Open the workspace panel, the way every other panel spec does. */
async function openWorkspacePanel(page) {
  await page
    .getByTestId("workspace-panel-controls")
    .getByRole("button", { name: "浏览器" })
    .click();
  await expect(page.getByTestId("workspace-panel")).toBeVisible();
}

test("the launcher's 应用 tile opens the picker and the chosen Mini App is framed", async ({
  page,
}) => {
  await configureFixture(page, () => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setResponse("listMiniApps", { miniApps: [{
        pluginId: "demo.miniapp",
        displayName: "演示应用",
        description: "一个用于浏览器验收的 Mini App",
        runtime: { kind: "process", status: "stopped" },
      }] });
      window.__fixture.setResponse("openMiniApp", {
        pluginId: "demo.miniapp",
        viewUrl: `${window.location.origin}/__miniapp-stub`,
      });
    });
  });
  await openApp(page);
  await openWorkspacePanel(page);

  // The tile is on the new tab page, beside the tool views.
  const tile = page.getByTestId("workspace-launcher-tile-miniapp");
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("应用");
  await tile.click();

  // The picker is fed by the same listing the catalogue's apps area reads.
  const picker = page.getByTestId("miniapp-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("演示应用");
  await expect(picker).toContainText("已停止");

  await picker.getByRole("button", { name: "打开" }).click();

  // The start went through the operation, and the panel frames its answer.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__fixture.requests.filter((request) => request.operation === "openMiniApp").length,
      ),
    )
    .toBe(1);
  const view = page.getByTestId("miniapp-view");
  await expect(view).toBeVisible();
  await expect(view).toHaveAttribute("data-plugin-id", MINI_APP.pluginId);
  await expect(view).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("miniapp-view-frame")).toHaveAttribute(
    "src",
    /\/__miniapp-stub$/u,
  );
  // The launcher tab became the Mini App tab; a second tab was not added.
  await expect(page.getByTestId("workspace-panel")).toHaveAttribute("data-active-tab", "miniapp");
});

test("a stopped Mini App clears its view and reopens only when the person asks", async ({ page }) => {
  await configureFixture(page, () => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setResponse("listMiniApps", { miniApps: [{
        pluginId: "demo.miniapp",
        displayName: "演示应用",
        runtime: { kind: "process", status: "stopped" },
      }] });
      window.__fixture.setResponse("openMiniApp", {
        pluginId: "demo.miniapp",
        viewUrl: `${window.location.origin}/__miniapp-stub`,
      });
    });
  });
  await openApp(page);
  await openWorkspacePanel(page);
  await page.getByTestId("workspace-launcher-tile-miniapp").click();
  await page.getByTestId("miniapp-picker").getByRole("button", { name: "打开" }).click();
  await expect(page.getByTestId("miniapp-view-frame")).toBeVisible();

  // The runtime stops it while the view is up. The catalogue now says so, and the
  // next reconcile clears the frame and reports the reason.
  await page.evaluate(() => {
    window.__fixture.setResponse("listMiniApps", { miniApps: [{
      pluginId: "demo.miniapp",
      displayName: "演示应用",
      runtime: { kind: "process", status: "stopped" },
    }] });
  });
  await expect
    .poll(() => page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "listMiniApps").length), {
      timeout: 10_000,
    })
    .toBeGreaterThan(1);
  const stopped = page.getByTestId("miniapp-view-stopped");
  await expect(stopped).toBeVisible();
  await expect(stopped).toContainText("运行已停止");
  await expect(page.getByTestId("miniapp-view-frame")).toHaveCount(0);
  // Nothing restarted it: reopening is the person's button.
  expect(
    await page.evaluate(() =>
      window.__fixture.requests.filter((request) => request.operation === "openMiniApp").length,
    ),
  ).toBe(1);
});
