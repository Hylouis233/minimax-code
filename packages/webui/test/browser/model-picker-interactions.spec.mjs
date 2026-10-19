import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

function setPickerModels() {
  window.__fixture.setModels([
    {
      providerId: "fixture-provider",
      providerName: "Fixture Provider",
      modelId: "fixture-configurable",
      displayName: "Fixture Configurable",
      effortOptions: ["default", "low", "high"],
      contextWindowOptions: [128_000, 1_000_000],
    },
    {
      providerId: "fixture-provider",
      providerName: "Fixture Provider",
      modelId: "fixture-plain",
      displayName: "Fixture Plain",
    },
  ]);
}

test.beforeEach(async ({ page }) => {
  await configureFixture(page, setPickerModels);
});

test("hover opens the settings fly-out after a delay and outside pointer closes the menu", async ({ page }) => {
  await openApp(page, "#session=A");
  const selector = page.locator("[data-webui-model-selector]");
  await expect(selector.getByRole("button", { name: "Model" })).toBeEnabled();
  await selector.getByRole("button", { name: "Model" }).click();
  const menu = page.getByRole("dialog");
  const row = menu.getByRole("option", { name: /Fixture Configurable/ });
  await row.hover();
  await expect(selector.locator('[data-webui-model-tier="settings"]')).toBeVisible();
  await expect(selector.locator('[data-webui-model-flyout="tier-one"]')).toBeVisible();
  if (process.env.WEBUI_DECOMPOSITION_SCREENSHOT) {
    await page.screenshot({ path: process.env.WEBUI_DECOMPOSITION_SCREENSHOT });
  }
  await page.mouse.click(8, 8);
  await expect(menu).toHaveCount(0);
});

test("keyboard activates a row immediately and search focus retracts its fly-out", async ({ page }) => {
  await openApp(page, "#session=A");
  const selector = page.locator("[data-webui-model-selector]");
  await selector.getByRole("button", { name: "Model" }).click();
  const menu = page.getByRole("dialog");
  const search = menu.getByRole("searchbox", { name: "搜索模型" });
  await search.focus();
  await search.press("ArrowDown");
  await expect(selector.locator('[data-webui-model-tier="settings"]')).toBeVisible();
  await menu.getByRole("option", { name: /Fixture Configurable/ }).focus();
  await search.focus();
  await expect(selector.locator('[data-webui-model-tier="list"]')).toBeVisible();
  await expect(selector.locator('[data-webui-model-flyout="tier-one"]')).toHaveCount(0);
});
