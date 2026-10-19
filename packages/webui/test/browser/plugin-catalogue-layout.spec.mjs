import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";

import { openApp, test } from "./harness.mjs";

test("plugin marketplace keeps its card grid and expand/collapse count", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMarketplacePlugins", {
        pluginTotal: 10,
        plugins: Array.from({ length: 10 }, (_, index) => ({
          name: `market-plugin-${index + 1}`,
          displayName: `Market plugin ${index + 1}`,
          description: "Marketplace card",
        })),
      });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", {
        plugins: [],
      });
    });
  });

  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();

  const cards = page.locator(".webui-plugin-grid .webui-plugin-row");
  await expect(cards).toHaveCount(10);
  await expect(page.getByRole("heading", { name: "插件" }).last()).toBeVisible();

  const captureDir = process.env.WEBUI_DECOMPOSITION_SCREENSHOT_DIR;
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({
      path: join(captureDir, "d06-plugin-market-expanded.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "收起插件" }).click();
  await expect(cards).toHaveCount(8);
  await expect(page.getByRole("button", { name: "查看全部 10 个" })).toBeVisible();
  if (captureDir) {
    await page.screenshot({
      path: join(captureDir, "d06-plugin-market-collapsed.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "查看全部 10 个" }).click();
  await expect(cards).toHaveCount(10);
});
