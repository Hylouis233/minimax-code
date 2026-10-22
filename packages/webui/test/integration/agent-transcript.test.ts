// End-to-end transcript recovery through the built browser client, loopback
// service, production runtime host, session store and a controlled model server.
// The model endpoint is the only controlled edge; messages are created by a real
// UI send and flow through the runtime instead of being injected as demo frames.
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect as browserExpect } from "@playwright/test";
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

it("a real agent turn keeps thinking and order across browser refresh and resume", async () => {
  let releaseAnswer: () => void = () => undefined;
  const answerGate = new Promise<void>((resolve) => { releaseAnswer = resolve; });
  let reasoningSent: () => void = () => undefined;
  const reasoningGate = new Promise<void>((resolve) => { reasoningSent = resolve; });
  const modelRequests: { url: string | undefined; authorization: string | undefined; body: string }[] = [];
  const modelServer = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString("utf8"); });
    request.on("end", async () => {
      modelRequests.push({ url: request.url, authorization: request.headers.authorization, body });
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(frame({ role: "assistant", reasoning_content: "Reasoning before refresh." }));
      reasoningSent();
      await answerGate;
      response.write(frame({ content: "Final answer after refresh." }));
      response.write(frame({}, "stop"));
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

    browser = await chromium.launch({ headless: true });
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
    await page.reload();
    await browserExpect(page.locator("#webui-root")).toBeVisible();
    await browserExpect(page.getByText("Please reason, then answer.")).toBeVisible();
    await browserExpect.poll(() => requests.some((request) => request.operation === "resumeSession"))
      .toBe(true);
    const resumeRequest = requests.find((request) => request.operation === "resumeSession");
    expect(resumeRequest?.body?.afterMsgId).toEqual(expect.any(String));
    await browserExpect.poll(() => received.some((response) =>
      response.requestId === resumeRequest?.requestId &&
      response.kind === "event" &&
      JSON.stringify(response.body).includes("Reasoning before refresh."),
    )).toBe(true);
    await page.waitForTimeout(1_000);
    const resumedThinkingVisible = await page.getByText("Reasoning before refresh.").isVisible();

    releaseAnswer();
    await browserExpect(page.getByText("Final answer after refresh.")).toBeVisible({ timeout: 30_000 });
    await browserExpect(page.getByText("Reasoning before refresh.")).toBeVisible();
    await expect.poll(async () => {
      const history = await port.getMessages({ id: sessionId });
      const messages = history.messages ?? [];
      const user = messages.find((message) => message.role === "user");
      const assistant = messages.find((message) => message.role === "assistant");
      return { user: user?.msgContent, answer: assistant?.msgContent, thinking: assistant?.thinkingContent };
    }, { timeout: 30_000 }).toEqual({
      user: "Please reason, then answer.",
      answer: "Final answer after refresh.",
      thinking: "Reasoning before refresh.",
    });

    const transcript = (await page.locator("body").textContent()) ?? "";
    const positions = [
      transcript.indexOf("Please reason, then answer."),
      transcript.indexOf("Reasoning before refresh."),
      transcript.indexOf("Final answer after refresh."),
    ];
    expect(positions.every((position) => position >= 0), transcript).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(resumedThinkingVisible).toBe(true);
    expect(modelRequests).toHaveLength(1);
    expect(modelRequests[0]).toMatchObject({ url: "/v1/chat/completions", authorization: "Bearer e2e-stub-key" });
    expect(modelRequests[0].body).toContain("Please reason, then answer.");
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
