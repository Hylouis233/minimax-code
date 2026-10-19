// Settings › 用量 › 自定义模型 — the provider form against the built client.
//
// The plan's P05 exit asks for browser evidence of this surface, and until now nothing
// covered it: the unit suite pins the editor's policy and the panel's wiring at the source
// level, and neither can show what a user sees. What only a browser can answer is here — that
// the discovery control renders at all (it never did before D04, because it read a field the
// read does not send), that a saved provider's header row starts blank over its persisted
// name, and that the form's controls drive the same requests the editor's unit tests assert on.
//
// Every answer is the fixture's, so nothing here claims anything about a real runtime: the
// candidate operations are asserted through the recorded requests, which is also why the
// fixture never mutates its provider list on a write — the workflow reloads the truth after
// one, and a fixture list that pretended otherwise would be asserting a server the client
// cannot have.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

// Injected into the page, so its literals must be self-contained: it cannot close over
// anything in this module.
function seedProviderSurface() {
  window.__fixture.setModelProviders([
    {
      providerId: "provider-synthetic",
      name: "Synthetic Provider",
      source: "user",
      kind: "apiKey",
      enabled: true,
      baseUrl: "https://synthetic.example/v1",
      apiFormat: "openai-completions",
      hasApiKey: true,
      maskedApiKey: "sk-synthetic-0000",
      headerNames: ["X-Api-Key"],
      configRevision: "rev-1",
      models: [{ modelId: "gpt-x", displayName: "GPT X", enabled: true }],
    },
  ]);
  window.__fixture.setProviderPresets([
    {
      providerId: "preset-openai",
      name: "OpenAI 兼容",
      baseUrl: "https://api.openai.example/v1",
      apiFormat: "openai-completions",
    },
  ]);
}

function seedNewProviderSurface() {
  window.__fixture.setModelProviders([]);
  window.__fixture.setProviderPresets([
    {
      providerId: "preset-openai",
      name: "OpenAI 兼容",
      baseUrl: "https://api.openai.example/v1",
      apiFormat: "openai-completions",
    },
  ]);
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER_CONSOLE_ERROR", message.text()); });
});

const settingsDialog = (page) => page.locator('[role="dialog"][aria-label="设置"]');
const customPanel = (page) => page.locator('[data-testid="settings-custom-models-panel"]');
const formDialog = (page) => page.locator('[role="dialog"][aria-label="添加模型"], [role="dialog"][aria-label="编辑提供商"]');

/** Opens settings the way a user does, then the Usage page's custom-model tab. */
async function openCustomModels(page) {
  await openApp(page, "#session=A");
  await page.locator('[data-testid="sidebar-user-menu-trigger"]').click();
  await page.locator('[data-testid="user-menu-settings"]').click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.locator('.webui-settings-nav [data-menu-key="usage"]').click();
  await page.getByRole("button", { name: "自定义模型" }).click();
  await expect(customPanel(page)).toBeVisible();
}

/** The body of the last request the fixture recorded for `operation`. */
function lastRequestBody(page, operation) {
  return page.evaluate((op) => {
    const found = window.__fixture.requests.filter((request) => request.operation === op);
    return found.length ? found[found.length - 1].body : undefined;
  }, operation);
}

/** Fills a new provider the way a user would, stopping short of the connection test. */
async function fillNewProvider(page, dialog) {
  await dialog.getByRole("button", { name: "提供商" }).click();
  await dialog.locator('[role="listbox"][aria-label="提供商列表"]').getByRole("option", { name: /其他/ }).click();
  await dialog.getByLabel("提供商名称").fill("Synthetic Draft");
  await dialog.getByLabel("接口地址").fill("https://draft.example/v1");
  await dialog.getByLabel("API Key").fill("sk-draft-synthetic");
  await dialog.getByLabel("模型名称").fill("draft-model");
}

test("the custom tab lists the saved provider and its model row", async ({ page }) => {
  await configureFixture(page, seedProviderSurface);
  await openCustomModels(page);

  const panel = customPanel(page);
  await expect(panel.getByText("Synthetic Provider")).toBeVisible();
  await expect(panel.locator('[data-testid="settings-custom-model-row-gpt-x"]')).toBeVisible();
  // The row is the read's: the page asked the owner, and the owner asked the runtime.
  await expect
    .poll(() => page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "listUserModelProviders").length))
    .toBeGreaterThan(0);
});

test("V10 rapid model toggles serialize semantic intent without restoring stale rows", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setModelProviders([{ providerId: "rapid", name: "Rapid", source: "user", kind: "apiKey", enabled: true, hasApiKey: true,
      models: [{ modelId: "first", displayName: "First", enabled: true }, { modelId: "second", displayName: "Second", enabled: true }] }]);
    window.__fixture.delayEvery("updateUserModelProvider", {});
  });
  await openCustomModels(page);
  await page.getByRole("switch", { name: "禁用 First", exact: true }).click();
  await page.getByRole("switch", { name: "禁用 Second", exact: true }).click();
  const writes = () => page.evaluate(() => window.__fixture.requests.filter(r => r.operation === "updateUserModelProvider"));
  await expect.poll(async () => (await writes()).length).toBe(1);
  await page.evaluate(() => {
    window.__fixture.setModelProviders([{ providerId: "rapid", name: "Rapid", source: "user", kind: "apiKey", enabled: true, hasApiKey: true,
      models: [{ modelId: "first", displayName: "First", enabled: false }, { modelId: "second", displayName: "Second", enabled: true }] }]);
    window.__fixture.resolve("updateUserModelProvider", {}, { ok: true });
  });
  await expect.poll(async () => (await writes()).length).toBe(2);
  expect((await writes())[1].body.models.map(m => ({ modelId: m.modelId, enabled: m.enabled }))).toEqual([
    { modelId: "first", enabled: false }, { modelId: "second", enabled: false },
  ]);
  await page.evaluate(() => {
    window.__fixture.setModelProviders([{ providerId: "rapid", name: "Rapid", source: "user", kind: "apiKey", enabled: true, hasApiKey: true,
      models: [{ modelId: "first", displayName: "First", enabled: false }, { modelId: "second", displayName: "Second", enabled: false }] }]);
    window.__fixture.resolve("updateUserModelProvider", {}, { ok: true });
  });
  await expect(page.getByRole("switch", { name: "启用 First", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: "启用 Second", exact: true })).toHaveAttribute("aria-checked", "false");
});

test("a save stays refused until the draft is proven or the test is skipped", async ({ page }) => {
  await configureFixture(page, seedNewProviderSurface);
  await openCustomModels(page);

  await customPanel(page).getByRole("button", { name: "添加模型" }).click();
  const dialog = formDialog(page);
  await expect(dialog).toBeVisible();
  await fillNewProvider(page, dialog);

  // The draft is filled and nothing has proven it: the save is offered, not enabled.
  await expect(dialog.getByRole("button", { name: "保存" })).toBeDisabled();
  await dialog.getByLabel("跳过连通检测").check();
  await expect(dialog.getByRole("button", { name: "保存" })).toBeEnabled();
});

test("a proven draft saves the candidate the editor built, and the form closes", async ({ page }) => {
  await configureFixture(page, seedNewProviderSurface);
  await openCustomModels(page);

  await customPanel(page).getByRole("button", { name: "添加模型" }).click();
  const dialog = formDialog(page);
  await fillNewProvider(page, dialog);

  await dialog.getByRole("button", { name: "连通检测" }).click();
  await expect.poll(() => lastRequestBody(page, "testUserModelCandidate")).toBeTruthy();
  const tested = await lastRequestBody(page, "testUserModelCandidate");
  expect(tested.candidate).toMatchObject({
    name: "Synthetic Draft",
    baseUrl: "https://draft.example/v1",
    apiKey: "sk-draft-synthetic",
    apiFormat: "openai-completions",
    models: [{ modelId: "draft-model" }],
  });
  expect(tested.modelId).toBe("draft-model");

  await dialog.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => lastRequestBody(page, "saveUserModelProviderCandidate")).toBeTruthy();
  const saved = await lastRequestBody(page, "saveUserModelProviderCandidate");
  expect(saved).toMatchObject({ modelId: "draft-model", saveAndUse: false, skipConnectionTest: false });
  expect(saved.candidate).toMatchObject({ name: "Synthetic Draft", models: [{ modelId: "draft-model" }] });
  await expect(dialog).toHaveCount(0);
});

test("an edit writes with the revision the read reported, and offers discovery with it", async ({ page }) => {
  await configureFixture(page, seedProviderSurface);
  await openCustomModels(page);

  await customPanel(page).getByRole("button", { name: "编辑提供商" }).click();
  const dialog = formDialog(page);
  await expect(dialog).toBeVisible();

  // Reveal-on-open reaches the field, and the row starts blank over the stored name.
  await expect(dialog.getByLabel("API Key")).toHaveValue("synthetic-revealed-key");
  const headerValue = dialog.getByLabel("Header 值");
  await expect(headerValue).toHaveValue("");
  await expect(headerValue).toHaveAttribute("placeholder", "留空保留原值");
  await expect(dialog.getByLabel("Header 名称")).toHaveValue("X-Api-Key");

  // D04: the control exists because the read carries `configRevision`, and it sends that same
  // revision — which is what the button never did before, because it read a field the read does
  // not send and therefore never rendered at all.
  await page.evaluate(() => window.__fixture.setDiscoveredModels([{ modelId: "discovered-1" }, { modelId: "discovered-2" }]));
  await dialog.getByRole("button", { name: "自动获取" }).click();
  await expect.poll(() => lastRequestBody(page, "discoverUserModelsCandidate")).toBeTruthy();
  expect(await lastRequestBody(page, "discoverUserModelsCandidate")).toMatchObject({
    providerId: "provider-synthetic",
    expectedRevision: "rev-1",
    baseUrl: "https://synthetic.example/v1",
  });
  await expect(dialog.getByLabel("模型名称")).toHaveValue("discovered-1\ndiscovered-2");

  await dialog.getByRole("button", { name: "连通检测" }).click();
  await expect.poll(() => lastRequestBody(page, "testUserModelCandidate")).toBeTruthy();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => lastRequestBody(page, "saveUserModelProviderCandidate")).toBeTruthy();
  // The write carries the identity and the revision the view reported (D04's field).
  expect(await lastRequestBody(page, "saveUserModelProviderCandidate")).toMatchObject({
    candidate: { providerId: "provider-synthetic", expectedRevision: "rev-1" },
  });
  await expect(dialog).toHaveCount(0);
});
