import { expect } from "@playwright/test";
import { configureFixture, openApp, requestCount, test } from "./harness.mjs";

async function pausedClock(page) {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
}

const sessionModels = (page) => page.evaluate(() => window.__fixture.requests.filter(r => r.operation === "listModels" && r.body.sessionId === "A").length);

async function openTerminal(page) {
  await page.getByTestId("workspace-panel-controls").getByRole("button", { name: "工作区文件侧栏" }).click();
  await page.getByRole("button", { name: "添加标签" }).click();
  await page.getByRole("menuitem", { name: "终端", exact: true }).click();
}

for (const state of ["absent", "not-ready"]) {
  test(`V19/V29/V35 terminal ${state} disables only its action and refreshes readiness after reconnect`, async ({ page }) => {
    await page.addInitScript((value) => {
      window.__WEBUI_FIXTURE_SETUP__ ??= [];
      window.__WEBUI_FIXTURE_SETUP__.push(() => window.__fixture.setResponse("version", { version: "fixture", protocolVersion: 1, capabilities: { terminal: value } }));
    }, state);
    await openApp(page);
    await openTerminal(page);
    await expect(page.getByRole("button", { name: "新建终端", exact: true })).toBeDisabled();
    await expect(page.getByTestId("workspace-panel")).toContainText(state === "absent" ? "未提供终端" : "终端服务尚未就绪");
    await expect(page.getByPlaceholder("输入消息…（输入 / 唤起命令）")).toBeEnabled();
    await page.evaluate(() => {
      window.__fixture.setResponse("version", { version: "fixture", protocolVersion: 1, capabilities: { terminal: "supported" } });
      window.__fixture.dropAll();
    });
    await expect(page.getByRole("button", { name: "新建终端", exact: true })).toBeEnabled();
  });
}

test("V19/V35 an older roster permits an unverified attempt and permission denial stays a call refusal", async ({ page }) => {
  await configureFixture(page, () => window.__fixture.refuseOperation("createTerminal", "permission_denied", "Synthetic terminal permission denied"));
  await openApp(page);
  await openTerminal(page);
  const create = page.getByRole("button", { name: "新建终端", exact: true });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByTestId("workspace-panel")).toContainText("Synthetic terminal permission denied");
  await expect(create).toBeEnabled();
  await expect(page.getByTestId("workspace-panel")).not.toContainText("未提供终端");
});

test("V29 protocol incompatibility is a startup failure before business ingress", async ({ page }) => {
  await configureFixture(page, () => window.__fixture.setResponse("version", { version: "future", protocolVersion: 99 }));
  await page.goto("/#session=A");
  await expect(page.getByTestId("webui-startup-fallback")).toBeVisible();
  await expect(page.getByTestId("webui-startup-fallback-reason")).toContainText("protocol");
  expect(await requestCount(page, "watchEvents")).toBe(0);
  expect(await requestCount(page, "listSessions")).toBe(0);
});

test("V28 search-only changes issue zero probes after the initial read", async ({ page }) => {
  await pausedClock(page);
  await openApp(page);
  await expect.poll(() => requestCount(page, "getActiveTurn")).toBeGreaterThan(0);
  await expect(page.locator('[data-webui-session-link="B"]')).toBeVisible();
  const before = await requestCount(page, "getActiveTurn");
  await page.locator('[data-webui-search="true"]').click();
  const input = page.locator('[data-webui-rail-search-input="true"]');
  for (const query of ["绿", "Demo", "不存在", "synthetic", ""]) {
    await input.fill(query);
    await expect(input).toHaveValue(query);
  }
  await expect(page.locator('[data-webui-session-link="B"]')).toBeVisible();
  expect(await requestCount(page, "getActiveTurn")).toBe(before);
});

test("V31/V34 inspection and authorization progress through a saturated activity queue", async ({ page }) => {
  await pausedClock(page);
  await configureFixture(page, () => {
    window.__fixture.setSessions(Array.from({ length: 20 }, (_, i) => ({
      sessionId: i === 0 ? "A" : `activity-${i}`, agentName: "main", title: `Activity ${i}`,
      createdAt: 1, updatedAt: i + 1, workspaceDir: "/synthetic/workspace",
    })));
    window.__fixture.delayEvery("getActiveTurn", {});
    window.__fixture.setResponse("getAccountStatus", { email: "before@example.invalid" });
    window.__fixture.setModels([{ providerId: "p", modelId: "before", displayName: "Before" }]);
  });
  await openApp(page);
  await expect.poll(() => page.evaluate(() => window.__fixture.pending.filter(r => r.operation === "getActiveTurn").length)).toBe(8);
  await expect(page.locator("[data-webui-model-selector]").getByRole("button").first()).toBeEnabled();
  await expect.poll(() => requestCount(page, "getAccountStatus")).toBeGreaterThan(0);
  const initialModels = await sessionModels(page);
  const initialAccount = await requestCount(page, "getAccountStatus");
  expect(initialModels).toBeGreaterThan(0);
  await page.clock.runFor(1_000);
  expect(await sessionModels(page)).toBe(initialModels);
  await page.evaluate(() => {
    window.__fixture.setModels([{ providerId: "p", modelId: "after", displayName: "External after" }]);
    window.__fixture.setResponse("getAccountStatus", { email: "after@example.invalid" });
  });
  await page.clock.runFor(1_100);
  await expect.poll(() => sessionModels(page)).toBe(initialModels + 1);
  await expect.poll(() => requestCount(page, "getAccountStatus")).toBe(initialAccount + 1);
  const picker = page.locator("[data-webui-model-selector]");
  await picker.getByRole("button").first().click();
  await expect(page.getByRole("option", { name: /External after/ })).toBeVisible();
  await page.mouse.click(8, 8);
  await page.locator('[data-testid="sidebar-user-menu-trigger"]').click();
  await page.getByTestId("user-menu-account-login").click();
  await expect(page.getByTestId("account-login-code")).toHaveText("TEST-CODE");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__fixture.setAccountLoginState({ state: "authenticated" });
  });
  const hidden = await sessionModels(page);
  await page.clock.runFor(10_000);
  await expect(page.getByTestId("account-login-dialog")).toHaveAttribute("data-webui-account-login-phase", "authenticated");
  expect(await sessionModels(page)).toBe(hidden);
  expect(await requestCount(page, "abortSession")).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => sessionModels(page)).toBe(hidden + 1);
  await page.clock.runFor(100);
  expect(await sessionModels(page)).toBe(hidden + 1);
});

test("V33 memory loads once per open and preserves dirty input across unrelated owner refreshes", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setResponse("getGlobalInstructions", { content: "", exists: true, path: "AGENTS.md", maxBytes: 32768 });
    window.__fixture.setResponse("getUserProfile", { nickname: "", occupation: "", moreAbout: "", exists: true, malformed: false, path: "user.md", sizeBytes: 0, maxChars: 10000 });
    window.__fixture.setResponse("getMemorySettings", { enabled: true, proactive: false });
    window.__fixture.setResponse("getAgentMemory", { agentName: "main", path: "memory.md", exists: true, sizeBytes: 11, content: "server body" });
  });
  await openApp(page);
  await page.getByTestId("sidebar-user-menu-trigger").click();
  await page.getByTestId("user-menu-settings").click();
  await page.locator('[data-menu-key="custom-instructions"]').click();
  expect(await requestCount(page, "getAgentMemory")).toBe(0);
  await page.getByTestId("memory-section").getByRole("button", { name: "管理" }).click();
  const editor = page.getByTestId("agent-memory-textarea");
  await expect(editor).toHaveValue("server body");
  await editor.fill("unsubmitted local draft");
  const before = await requestCount(page, "getAgentMemory");
  await page.evaluate(() => {
    window.__fixture.setResponse("getAgentMemory", { agentName: "main", path: "memory.md", exists: true, sizeBytes: 7, content: "changed" });
    window.__fixture.emitEvent({ type: "session.model_updated", payload: { sessionId: "A", model: "new" }, timestamp: Date.now(), source: "fixture" });
  });
  await expect(editor).toHaveValue("unsubmitted local draft");
  expect(await requestCount(page, "getAgentMemory")).toBe(before);
  expect(await requestCount(page, "setAgentMemory")).toBe(0);
  await page.getByTestId("agent-memory-close").click();
  await page.getByTestId("memory-section").getByRole("button", { name: "管理" }).click();
  await expect(editor).toHaveValue("changed");
  expect(await requestCount(page, "getAgentMemory")).toBe(before + 1);
});

test("V36 another page's rename/model/mode facts reach the installed ingress", async ({ page, context }) => {
  await openApp(page);
  const other = await context.newPage();
  try {
    await openApp(other, "#session=B");
    await expect.poll(() => requestCount(other, "watchEvents")).toBe(1);
    await page.evaluate(() => window.__fixture.publishSessionFact("A", { title: "Externally renamed" }, {
      type: "session.title_updated", payload: { sessionId: "A", title: "Externally renamed" }, timestamp: Date.now(), source: "fixture",
    }));
    await expect(other.locator('[data-webui-session-link="A"]')).toContainText("Externally renamed");
    const before = await requestCount(other, "listModels");
    await page.evaluate(() => window.__fixture.publishSessionFact("A", { model: "external" }, {
      type: "session.model_updated", payload: { sessionId: "A", model: "external" }, timestamp: Date.now(), source: "fixture",
    }));
    await expect.poll(() => requestCount(other, "listModels")).toBeGreaterThan(before);
    const pendingBefore = await requestCount(other, "getPendingQuestionnaire");
    await page.evaluate(() => window.__fixture.publishSessionFact("A", {}, {
      type: "session.interaction_mode.changed", payload: { sessionId: "A", mode: "plan" }, timestamp: Date.now(), source: "fixture",
    }));
    await expect.poll(() => requestCount(other, "getPendingQuestionnaire")).toBeGreaterThan(pendingBefore);
    await expect(other.locator('[data-webui-session-link="B"]')).toHaveAttribute("data-webui-session-active", "true");
  } finally { await other.close(); }
});

test("V15 cross-page deletion retains reachable unsent input and fences a late read", async ({ page, context }) => {
  await openApp(page);
  const composer = page.getByPlaceholder("输入消息…（输入 / 唤起命令）");
  await composer.fill("unsent A recovery");
  await page.evaluate(() => { window.__fixture.delayEvery("getMessages", { id: "A" }); window.location.hash = "session=B"; });
  await expect(composer).toHaveValue("");
  await composer.fill("unrelated B input");
  await page.evaluate(() => { window.location.hash = "session=A"; });
  await expect.poll(() => page.evaluate(() => window.__fixture.pending.filter(r => r.operation === "getMessages" && r.body.id === "A").length)).toBeGreaterThan(0);
  await page.evaluate(() => { window.location.hash = "session=B"; });
  await expect(composer).toHaveValue("unrelated B input");
  const other = await context.newPage();
  try {
    await openApp(other, "#session=A");
    await other.evaluate(() => window.__fixture.publishSessionFact("A", {}, {
      type: "session.deleted", payload: { sessionId: "A" }, timestamp: Date.now(), source: "fixture",
    }));
    const notice = page.getByTestId("external-deletion-draft-A");
    await expect(notice).toContainText("unsent A recovery");
    await expect(composer).toHaveValue("unrelated B input");
    await expect(page.locator('[data-webui-session-link="A"]')).toHaveCount(0);
    await page.evaluate(() => window.__fixture.resolveAllPending("getMessages", { id: "A" }, {
      messages: [{ msgId: "late-deleted-history", role: "user", msgContent: "late deleted history", timestamp: 1 }], hasMore: false,
    }));
    await other.evaluate(() => window.__fixture.publishSessionFact("A", { title: "late stale rename" }, {
      type: "session.title_updated", payload: { sessionId: "A", title: "late stale rename" }, timestamp: Date.now(), source: "fixture",
    }));
    await expect(page.locator('[data-webui-session-link="A"]')).toHaveCount(0);
    await expect(notice).toContainText("unsent A recovery");
    expect(await requestCount(page, "sendMessage")).toBe(0);
    await notice.getByRole("button", { name: "丢弃" }).click();
    await expect(notice).toHaveCount(0);
    await expect(composer).toHaveValue("unrelated B input");
  } finally { await other.close(); }
});

test("V13 manager install repairs a previously cached Composer menu on reopen", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [] });
    window.__fixture.setPluginManagementResult("listMarketplacePlugins", { pluginTotal: 1, plugins: [{ name: "cache-demo", displayName: "Cache Demo", description: "Synthetic plugin" }] });
    window.__fixture.setPluginManagementResult("installPlugin", { ok: true });
  });
  await openApp(page);
  const composer = page.getByPlaceholder("输入消息…（输入 / 唤起命令）");
  await composer.fill("@");
  await expect(page.locator('[data-webui-mention-menu="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.filter(r => r.operation === "pluginManagement" && r.body.action === "listInstalledPlugins").length)).toBeGreaterThan(0);
  await expect(page.locator('[data-webui-mention-menu="true"]')).not.toContainText("Cache Demo");
  await composer.fill("");
  await page.getByRole("button", { name: "插件", exact: true }).first().click();
  await page.evaluate(() => window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [{ name: "cache-demo", displayName: "Cache Demo" }] }));
  await page.getByRole("button", { name: "安装", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(r => r.operation === "pluginManagement" && r.body.action === "installPlugin"))).toBe(true);
  await page.locator('[data-webui-session-link="B"]').click({ position: { x: 20, y: 15 } });
  await expect(composer).toBeVisible();
  await composer.fill("@");
  await expect(page.locator('[data-webui-mention-menu="true"]')).toContainText("Cache Demo");
});
