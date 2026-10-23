// End-to-end transcript recovery through the built browser client, loopback
// service, production runtime host, session store and a controlled model server.
// The model endpoint is the only controlled edge; messages are created by a real
// UI send and flow through the runtime instead of being injected as demo frames.
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect as browserExpect, type Browser } from "@playwright/test";
import { expect, it } from "vitest";

const MODEL_ID = "stub-model";
const PROVIDER_NAME = "stub";
const PROVIDER_ID = `custom_provider:${PROVIDER_NAME}`;

function frame(delta: Record<string, unknown>, finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-agent-transcript",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/**
 * The browser this case drives.
 *
 * This file belongs to the `test:webui` Vitest gate, which runs before the
 * `test:webui-browser` gate installs playwright's own chromium — so on CI the
 * pinned browser is not on disk yet. The runner's own Chrome is, and playwright
 * drives it through the `chrome` channel. A launch that fails for any other
 * reason is the failure it looks like, and is not retried.
 */
async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    const missingBrowser = error instanceof Error && error.message.includes("Executable doesn't exist");
    if (!missingBrowser) throw error;
    return await chromium.launch({ headless: true, channel: "chrome" });
  }
}

it("a real agent turn resumes after refresh and drains a queued message in order", async () => {
  let releaseAnswer: () => void = () => undefined;
  const answerGate = new Promise<void>((resolve) => { releaseAnswer = resolve; });
  let reasoningSent: () => void = () => undefined;
  const reasoningGate = new Promise<void>((resolve) => { reasoningSent = resolve; });
  let queuedTurnStarted: () => void = () => undefined;
  const queuedTurnGate = new Promise<void>((resolve) => { queuedTurnStarted = resolve; });
  const modelRequests: { url: string | undefined; authorization: string | undefined; body: string }[] = [];
  const modelServer = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString("utf8"); });
    request.on("end", async () => {
      modelRequests.push({ url: request.url, authorization: request.headers.authorization, body });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const parsed = JSON.parse(body) as { messages?: { role?: string; content?: unknown }[] };
      const latestUserMessage = [...(parsed.messages ?? [])].reverse().find((message) => message.role === "user");
      const latestUserContent = JSON.stringify(latestUserMessage?.content ?? "");
      let completedWithToolCall = false;
      if (latestUserContent.includes("Summarize the referenced project file.")) {
        response.write(frame({ role: "assistant", content: "Reference and attachment reached the runtime." }));
      } else if (latestUserContent.includes("Send this after the active answer.")) {
        queuedTurnStarted();
        response.write(frame({ role: "assistant", content: "Queued follow-up delivered." }));
      } else if (latestUserContent.includes("Create a task checklist.")) {
        const hasToolResult = parsed.messages?.some((message) => message.role === "tool") === true;
        if (hasToolResult) {
          response.write(frame({ role: "assistant", content: "The runtime checklist is ready." }));
        } else {
          completedWithToolCall = true;
          response.write(frame({
            role: "assistant",
            tool_calls: [{
              index: 0,
              id: "call-todowrite-e2e",
              type: "function",
              function: {
                name: "todowrite",
                arguments: JSON.stringify({ todos: [
                  { content: "Visible task from runtime tool", status: "in_progress", priority: "high" },
                ] }),
              },
            }],
          }, "tool_calls"));
        }
      } else if (latestUserContent.includes("Please reason, then answer.")) {
        response.write(frame({ role: "assistant", reasoning_content: "Reasoning before refresh." }));
        reasoningSent();
        await answerGate;
        response.write(frame({ content: "Final answer after refresh." }));
      } else {
        response.write(frame({ role: "assistant", content: "Unexpected request body." }));
      }
      if (!completedWithToolCall) response.write(frame({}, "stop"));
      response.write("data: [DONE]\n\n");
      response.end();
    });
  });
  await new Promise<void>((resolve) => { modelServer.listen(0, "127.0.0.1", () => resolve()); });
  const modelAddress = modelServer.address();
  if (!modelAddress || typeof modelAddress === "string") throw new Error("model stub did not bind");

  const dataDir = await mkdtemp(path.join(tmpdir(), "webui-agent-transcript-e2e-"));
  const previousDataDir = process.env.MINIMAX_DATA_DIR;
  const workspaceDir = path.join(dataDir, "workspace");
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(path.join(workspaceDir, "reference-target.md"), "Synthetic workspace reference body.\n");
  await writeFile(path.join(dataDir, "config.yaml"), [
    `defaultModel: ${PROVIDER_ID}/${MODEL_ID}`,
    "custom_provider:",
    `  ${PROVIDER_NAME}:`,
    "    name: Transcript E2E Stub",
    "    api: openai-completions",
    "    options:",
    `      baseURL: http://127.0.0.1:${modelAddress.port}/v1`,
    "      apiKey: e2e-stub-key",
    "    models:",
    `      ${MODEL_ID}:`,
    `        id: ${MODEL_ID}`,
    "        name: Transcript E2E Model",
    "        tool_call: true",
    "        reasoning: true",
    "        interleaved: { field: reasoning_content }",
    "        limit:",
    "          context: 100000",
    "          output: 4096",
    "        modalities:",
    "          input: [text]",
    "          output: [text]",
    "",
  ].join("\n"), { mode: 0o600 });

  let assembled;
  let service;
  let browser;
  try {
    process.env.MINIMAX_DATA_DIR = dataDir;
    (await import("@mavis/config")).resetConfig();
    const { createWebuiRuntimeHost } = await import("../../src/runtime/assembly.js");
    const { createHarnessPortFromHost } = await import("../../src/runtime/harness/adapter.js");
    const { WebuiTerminalManager } = await import("../../src/runtime/index.js");
    const { WebuiService, createOperationRegistry } = await import("../../src/server/index.js");
    assembled = await createWebuiRuntimeHost({
      dataDir,
      appVersion: "agent-transcript-e2e",
      mcodeTools: { prepare: async () => ({
        requested: false,
        ready: false,
        category: "disabled",
        ensureCommandPath: () => undefined,
        dispose: async () => undefined,
      }) },
    });
    const port = createHarnessPortFromHost(assembled.host);
    const created = await port.createSession({ name: "main", workspaceDir });
    const sessionId = created.session?.sessionId;
    if (!sessionId) throw new Error("runtime host did not create the test session");
    const terminal = new WebuiTerminalManager();
    service = new WebuiService({
      port,
      operations: createOperationRegistry(port, terminal),
      terminal,
      tcpPort: 0,
      credential: { token: "agent-transcript-e2e-token" },
      dev: true,
      clientDir: path.resolve("dist-webui/client"),
    });
    const info = await service.start();

    browser = await launchBrowser();
    const page = await browser.newPage({ locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const requests: {
      requestId?: string;
      operation?: string;
      kind?: string;
      body?: Record<string, unknown>;
    }[] = [];
    const received: { requestId?: string; kind?: string; body?: unknown }[] = [];
    page.on("websocket", (socket) => {
      socket.on("framesent", ({ payload }) => {
        try {
          const request = JSON.parse(String(payload)) as {
            requestId?: string;
            operation?: string;
            kind?: string;
            body?: Record<string, unknown>;
          };
          if (request.kind === "request") requests.push(request);
        } catch { /* Ignore protocol frames that are not JSON requests. */ }
      });
      socket.on("framereceived", ({ payload }) => {
        try {
          const response = JSON.parse(String(payload)) as {
            requestId?: string;
            kind?: string;
            body?: unknown;
          };
          received.push(response);
        } catch { /* Ignore protocol frames that are not JSON responses. */ }
      });
    });
    const url = `http://127.0.0.1:${info.tcpPort}/?token=${info.credential.token}#session=${sessionId}`;
    await page.goto(url);
    await browserExpect(page.locator("#webui-root")).toBeVisible();
    const composer = page.getByPlaceholder("输入消息…（输入 / 唤起命令）");
    await browserExpect(composer).toBeVisible();
    await composer.fill("Please reason, then answer.");
    await page.getByRole("button", { name: "发送" }).click();

    await reasoningGate;
    await browserExpect(page.getByText("Reasoning before refresh.")).toBeVisible();
    await browserExpect(page.getByText("Please reason, then answer.")).toBeVisible();
    await composer.fill("Send this after the active answer.");
    await composer.press("Enter");
    await browserExpect.poll(() => requests.some((request) => request.operation === "enqueueMessage" &&
      request.body?.content === "Send this after the active answer.")).toBe(true);
    await browserExpect(page.locator("[data-webui-queue-item]")).toHaveCount(1);
    await page.reload();
    await browserExpect(page.locator("#webui-root")).toBeVisible();
    await browserExpect(page.getByText("Please reason, then answer.")).toBeVisible();
    await browserExpect.poll(() => requests.some((request) => request.operation === "resumeSession"))
      .toBe(true);
    const resumeRequest = requests.find((request) => request.operation === "resumeSession");
    expect(resumeRequest?.body?.afterMsgId).toEqual(expect.any(String));
    await browserExpect(page.locator("[data-webui-queue-item]")).toHaveCount(1);
    await browserExpect.poll(() => received.some((response) =>
      response.requestId === resumeRequest?.requestId &&
      response.kind === "event" &&
      JSON.stringify(response.body).includes("Reasoning before refresh."),
    )).toBe(true);
    await page.waitForTimeout(1_000);
    const resumedThinkingVisible = await page.getByText("Reasoning before refresh.").isVisible();

    releaseAnswer();
    await browserExpect(page.getByText("Final answer after refresh.")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await page.locator("body").textContent()) ?? "")
      .toContain("Reasoning before refresh.");
    await queuedTurnGate;
    await expect.poll(async () => {
      const history = await port.getMessages({ id: sessionId });
      return (history.messages ?? []).filter((message) => message.role === "assistant")
        .map((message) => message.msgContent);
    }, { timeout: 30_000 }).toContain("Queued follow-up delivered.");
    try {
      await browserExpect(page.getByText("Queued follow-up delivered.")).toBeVisible({ timeout: 5_000 });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({
        requests: requests.slice(-12).map((request) => request.operation),
        received: received.slice(-20).map((response) => ({
          kind: response.kind,
          body: JSON.stringify(response.body ?? null).slice(-320),
        })),
        lifecycleEvents: received
          .map((response) => JSON.stringify(response))
          .filter((frame) => frame.includes("session.start") || frame.includes("queued-drain") ||
            frame.includes("session.queue.updated") || frame.includes("Queued follow-up delivered."))
          .map((frame) => frame.slice(-600)),
        visibleTail: ((await page.locator("body").textContent()) ?? "").slice(-1_000),
      })}`);
    }
    await expect.poll(async () => (await port.listQueueMessages({ id: sessionId })).items ?? [])
      .toEqual([]);
    try {
      await browserExpect(page.locator("[data-webui-queue-item]")).toHaveCount(0, { timeout: 5_000 });
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({
        queueReads: requests
          .filter((request) => request.operation === "listQueueMessages")
          .map((request) => request.body),
        queueEvents: received
          .map((response) => JSON.stringify(response))
          .filter((frame) => frame.includes("session.queue.updated"))
          .map((frame) => frame.slice(-500)),
        queueRows: await page.locator("[data-webui-queue-item]").allTextContents(),
      })}`);
    }
    const todoPanel = page.getByRole("button", { name: "进度", exact: true });
    await browserExpect(todoPanel).toBeVisible();
    await composer.fill("Create a task checklist.");
    await composer.press("Enter");
    await browserExpect(page.getByTestId("progress-overview-card").getByText("Visible task from runtime tool"))
      .toBeVisible({ timeout: 30_000 });
    await browserExpect(page.locator("span.webui-tool-label").filter({ hasText: "todowrite" }))
      .toHaveText("todowrite");
    await browserExpect(page.getByText("The runtime checklist is ready.")).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const history = await port.getMessages({ id: sessionId });
      return JSON.stringify(history.messages ?? []);
    }).toContain("Visible task from runtime tool");
    await expect.poll(async () => {
      const history = await port.getMessages({ id: sessionId });
      const messages = history.messages ?? [];
      return messages.filter((message) => (message.role === "user" || message.role === "assistant") &&
        typeof message.msgContent === "string" && message.msgContent.length > 0)
        .map((message) => `${message.role}:${message.msgContent}`);
    }, { timeout: 30_000 }).toEqual([
      "user:Please reason, then answer.",
      "assistant:Final answer after refresh.",
      "user:Send this after the active answer.",
      "assistant:Queued follow-up delivered.",
      "user:Create a task checklist.",
      "assistant:The runtime checklist is ready.",
    ]);

    const transcript = (await page.locator("body").textContent()) ?? "";
    const positions = [
      transcript.indexOf("Please reason, then answer."),
      transcript.indexOf("Reasoning before refresh."),
      transcript.indexOf("Final answer after refresh."),
      transcript.indexOf("Send this after the active answer."),
      transcript.indexOf("Queued follow-up delivered."),
      transcript.indexOf("Create a task checklist."),
      transcript.indexOf("Visible task from runtime tool"),
      transcript.indexOf("The runtime checklist is ready."),
    ];
    const finalHistory = await port.getMessages({ id: sessionId });
    expect(positions.every((position) => position >= 0), JSON.stringify({
      missingIndexes: positions.map((position, index) => position < 0 ? index : undefined).filter((index) => index !== undefined),
      route: await page.evaluate(() => location.hash),
      outgoingTurns: requests
        .filter((request) => request.operation === "sendMessage" || request.operation === "enqueueMessage")
        .map((request) => ({ operation: request.operation, body: request.body })),
      persisted: (finalHistory.messages ?? []).map((message) => ({
        role: message.role,
        content: message.msgContent,
        attachmentNames: Array.isArray(message.attachments)
          ? (message.attachments as { meta?: { fileName?: string } }[])
            .map((attachment) => attachment.meta?.fileName)
          : [],
      })),
      visibleTail: transcript.slice(-2_000),
    })).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(resumedThinkingVisible).toBe(true);
    expect(modelRequests.length).toBeGreaterThanOrEqual(2);
    expect(modelRequests.every((request) => request.url === "/v1/chat/completions" &&
      request.authorization === "Bearer e2e-stub-key")).toBe(true);
    expect(modelRequests.some((request) => request.body.includes("Please reason, then answer."))).toBe(true);
    expect(modelRequests.some((request) => request.body.includes("Send this after the active answer."))).toBe(true);
    expect(modelRequests.some((request) => request.body.includes("Create a task checklist.") &&
      request.body.includes("todowrite"))).toBe(true);

    const attachmentInput = page.locator('input.webui-composer-hidden-file-input[aria-label="添加文件或图片"]');
    await attachmentInput.setInputFiles({
      name: "runtime-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic attachment body."),
    });
    await browserExpect(page.locator('[data-webui-composer-attachments="true"]')
      .getByText("runtime-note.txt")).toBeVisible();
    await composer.fill("Summarize the referenced project file. @reference-target");
    const mention = page.getByRole("option", { name: "reference-target.md", exact: true });
    await browserExpect(mention).toBeVisible();
    await mention.click();
    await browserExpect(composer).toHaveValue("Summarize the referenced project file. @reference-target.md ");
    await page.getByRole("button", { name: "发送" }).click();
    await browserExpect(page.getByText("Reference and attachment reached the runtime.")).toBeVisible({ timeout: 30_000 });
    await browserExpect.poll(async () => (await page.locator("body").textContent()) ?? "")
      .toContain("Summarize the referenced project file.");
    const referenceRequest = modelRequests.find((request) =>
      request.body.includes("Summarize the referenced project file."));
    const referenceSend = requests.find((request) => request.operation === "sendMessage" &&
      request.body?.content === "Summarize the referenced project file. @reference-target.md");
    expect(referenceSend).toBeDefined();
    expect(referenceRequest).toBeDefined();
    expect(referenceRequest?.body).toContain("@reference-target.md");
    expect(referenceRequest?.body).toContain("runtime-note.txt");
    const referencePayload = JSON.parse(referenceRequest?.body ?? "{}") as {
      messages?: readonly { content?: unknown }[];
    };
    const referencePrompt = (referencePayload.messages ?? [])
      .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content))
      .join("\n");
    const runtimeAttachmentPath = /<attachment name=\\?"runtime-note\.txt\\?"[^>]* path=\\?"([^"\\]+)\\?"/u
      .exec(referencePrompt)?.[1];
    expect(runtimeAttachmentPath).toBeDefined();
    expect(await readFile(runtimeAttachmentPath!, "utf8")).toBe("Synthetic attachment body.");
    await expect.poll(async () => {
      const history = await port.getMessages({ id: sessionId });
      return JSON.stringify(history.messages ?? []);
    }, { timeout: 15_000 }).toContain("runtime-note.txt");
    await expect.poll(async () => JSON.stringify((await port.getMessages({ id: sessionId })).messages ?? []))
      .toContain("Reference and attachment reached the runtime.");
    await expect.poll(async () => JSON.stringify((await port.getMessages({ id: sessionId })).messages ?? []))
      .toContain("@reference-target.md");
    const completedReferenceTranscript = (await page.locator("body").textContent()) ?? "";
    const referencePromptPosition = completedReferenceTranscript.indexOf("Summarize the referenced project file.");
    const referenceAnswerPosition = completedReferenceTranscript.indexOf("Reference and attachment reached the runtime.");
    expect(referencePromptPosition).toBeGreaterThanOrEqual(0);
    expect(referenceAnswerPosition).toBeGreaterThan(referencePromptPosition);

    // Open the actual management surface against the same isolated production
    // host. This covers the MCP operation shape through the mounted client,
    // beyond the raw WebSocket codec assertion in real-host-loopback.test.ts.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "插件" }).first().click();
    await page.locator(".webui-plugin-manage-trigger").click();
    await page.locator('.webui-plugin-category-filter button', { hasText: "MCP" }).click();
    await browserExpect(page.getByPlaceholder("搜索MCP...")).toBeVisible();
    await browserExpect(page.getByText("暂无内容")).toBeVisible();
    await browserExpect(page.getByText(/pluginManagement returned a body/u)).toHaveCount(0);
    const mcpListRequest = requests.find((request) => request.operation === "pluginManagement" &&
      request.body?.action === "listMcpServers");
    expect(mcpListRequest).toBeDefined();
    await browserExpect.poll(() => received.some((response) =>
      response.requestId === mcpListRequest?.requestId && response.kind === "response" &&
      JSON.stringify(response.body).includes('"servers":[]'),
    )).toBe(true);
    const mcpListResponse = received.find((response) => response.requestId === mcpListRequest?.requestId);
    expect(mcpListResponse?.body).toEqual({ servers: [] });

    await page.locator(".webui-plugin-create-trigger").click();
    await page.getByRole("button", { name: "添加 MCP server" }).click();
    const mcpDialog = page.getByRole("dialog", { name: "MCP Server" });
    await browserExpect(mcpDialog).toBeVisible();
    const mcpGeometry = await mcpDialog.evaluate((node) => {
      const backdrop = node.parentElement;
      const rect = node.getBoundingClientRect();
      const backdropRect = backdrop!.getBoundingClientRect();
      const fields = node.querySelector(".webui-mcp-form-fields")!;
      const controls = [...fields.querySelectorAll("input:not([type=checkbox]), select")];
      return {
        backdropFixed: getComputedStyle(backdrop!).position === "fixed",
        backdropCoversViewport: backdropRect.left <= 0 && backdropRect.top <= 0 &&
          backdropRect.right >= innerWidth && backdropRect.bottom >= innerHeight,
        centered: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 3 &&
          Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 3,
        insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        fieldsGrid: getComputedStyle(fields).display === "grid",
        controlsAligned: controls.length >= 3 && controls.every((control) => {
          const input = control.getBoundingClientRect();
          const label = control.closest("label")!.getBoundingClientRect();
          return Math.abs(input.left - label.left) < 3 && Math.abs(input.width - label.width) < 3;
        }),
      };
    });
    expect(mcpGeometry).toEqual({
      backdropFixed: true,
      backdropCoversViewport: true,
      centered: true,
      insideViewport: true,
      fieldsGrid: true,
      controlsAligned: true,
    });
    await mcpDialog.getByLabel("名称").fill("synthetic-disabled-mcp");
    await mcpDialog.getByLabel("命令").fill("synthetic-mcp-command");
    await mcpDialog.getByLabel("启用").uncheck();
    await mcpDialog.getByRole("button", { name: "添加服务器" }).click();
    await browserExpect(mcpDialog).toHaveCount(0);
    await browserExpect(page.locator(".webui-plugin-row").filter({ hasText: "synthetic-disabled-mcp" }))
      .toBeVisible();
    const mcpCreate = requests.find((request) => request.operation === "pluginManagement" &&
      request.body?.action === "createMcpServer");
    expect(mcpCreate?.body).toMatchObject({
      action: "createMcpServer",
      input: {
        name: "synthetic-disabled-mcp",
        enabled: false,
        config: { transport: "stdio", command: "synthetic-mcp-command" },
      },
    });
  } finally {
    releaseAnswer();
    await browser?.close();
    await service?.close().catch(() => undefined);
    await assembled?.host.apiHost.close().catch(() => undefined);
    await new Promise((resolve) => modelServer.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.MINIMAX_DATA_DIR;
    else process.env.MINIMAX_DATA_DIR = previousDataDir;
    (await import("@mavis/config")).resetConfig();
  }
}, 120_000);
