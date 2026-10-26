// The three published surfaces, and the proxy listeners behind them.
//
// The surfaces are server-rendered here rather than mounted: this package has no
// DOM framework by design, so a render branch is asserted through its markup.
// What that proves and what it does not is worth stating — it proves the panel
// frames the URL the open operation answered with, that a row renders the
// runtime's state and the surface's refusals, and that the capacity refusal names
// the running applications. It does not prove the page inside the frame loads, or
// that a click reaches a handler; the browser suite owns that.
//
// The registry half is real: an actual upstream `http.Server`, an actual listener,
// and a close that has to free its port — because the whole reason it exists is
// that a leaked listener holds a port the next start derives again.

import http from "node:http";

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WebuiMiniAppWorkflowsProvider } from "../../src/client/features/miniapp/bindings/use-miniapp-workflows.js";
import {
  createWebuiMiniAppWorkflows,
  type WebuiMiniAppPortSlice,
} from "../../src/client/features/miniapp/application/miniapp-workflows.js";
import { MiniAppAppsList } from "../../src/client/features/miniapp/ui/MiniAppAppsList.public.js";
import { MiniAppPicker } from "../../src/client/features/miniapp/ui/MiniAppPicker.public.js";
import { MiniAppView } from "../../src/client/features/miniapp/ui/MiniAppView.public.js";
import { createMiniAppProxyRegistry } from "../../src/server/miniapp/proxy-registry.js";
import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import type { WebuiMiniAppSummary } from "../../src/shared/contracts/miniapp.js";

function summary(
  pluginId: string,
  status: WebuiMiniAppSummary["runtime"]["status"],
  runtime: Partial<WebuiMiniAppSummary["runtime"]> = {},
): WebuiMiniAppSummary {
  return {
    pluginId,
    displayName: `${pluginId} 应用`,
    description: "说明",
    runtime: { kind: "process", status, ...runtime },
  };
}

function port(input: {
  readonly miniApps: readonly WebuiMiniAppSummary[];
  readonly open?: (pluginId: string) => Promise<{ pluginId: string; viewUrl: string }>;
  readonly stop?: () => Promise<void>;
}): WebuiMiniAppPortSlice {
  return {
    listMiniApps: async () => ({ miniApps: input.miniApps }),
    openMiniApp: async ({ pluginId }) =>
      input.open ? input.open(pluginId) : { pluginId, viewUrl: "http://127.0.0.1:49152" },
    stopMiniApp: async () => {
      await input.stop?.();
      return { success: true as const };
    },
  };
}

function render(element: ReturnType<typeof MiniAppAppsList> | ReturnType<typeof MiniAppPicker> | ReturnType<typeof MiniAppView>, workflows: ReturnType<typeof createWebuiMiniAppWorkflows>): string {
  return renderToStaticMarkup(
    createElement(WebuiMiniAppWorkflowsProvider, { workflows }, element),
  );
}

describe("the plugin catalogue's apps area", () => {
  it("lists the runtime's state and offers the lifecycle actions", async () => {
    const workflows = createWebuiMiniAppWorkflows({
      port: port({
        miniApps: [
          summary("dashboard", "running"),
          summary("failed-one", "failed", { errorCode: "RUNNER_START_FAILED" }),
        ],
      }),
    });
    await workflows.loadListing();
    const markup = render(createElement(MiniAppAppsList, {}), workflows);
    expect(markup).toContain("dashboard 应用");
    expect(markup).toContain("运行中");
    expect(markup).toContain("启动失败（RUNNER_START_FAILED）");
    // stop, uninstall and the enable switch are all reachable from the row.
    expect(markup).toContain("停止");
    expect(markup).toContain("卸载");
    expect(markup).toContain("启用 dashboard 应用");
  });

  it("reports an app another client owns, naming that client and its pid", async () => {
    const workflows = createWebuiMiniAppWorkflows({
      port: port({
        miniApps: [summary("shared", "stopped")],
        open: async () => {
          throw Object.assign(
            new Error("Mini App shared is already running in electron (pid 4242)"),
            { code: "OWNED_ELSEWHERE" },
          );
        },
      }),
    });
    await workflows.loadListing();
    await workflows.open("shared");
    const markup = render(createElement(MiniAppAppsList, {}), workflows);
    expect(markup).toContain("electron");
    expect(markup).toContain("4242");
    expect(markup).toContain("已在其他客户端运行");
  });

  it("says the capability is absent rather than showing an empty list", () => {
    const workflows = createWebuiMiniAppWorkflows({ port: { pluginManagement: async () => undefined } });
    const markup = render(createElement(MiniAppAppsList, {}), workflows);
    expect(markup).toContain("没有提供 Mini App 能力");
  });
});

describe("the launcher's picker", () => {
  it("names the three running apps when a fourth start is refused", async () => {
    const running = [summary("one", "running"), summary("two", "running"), summary("three", "running")];
    const workflows = createWebuiMiniAppWorkflows({
      port: port({
        miniApps: running,
        open: async () => {
          throw Object.assign(new Error("Mini App surface action failed"), { code: "BUSY" });
        },
      }),
    });
    await workflows.loadListing();
    await workflows.open("fourth");
    const markup = render(
      createElement(MiniAppPicker, { onOpened: () => undefined }),
      workflows,
    );
    expect(markup).toContain("同时最多运行 3 个 Mini App");
    expect(markup).toContain("one 应用");
    expect(markup).toContain("three 应用");
    expect(markup).toContain("请先停止一个");
    // Each running row carries the stop button that frees the capacity.
    expect(markup).toContain("停止");
  });

  it("lists the installed Mini Apps and says so when there are none", async () => {
    const empty = createWebuiMiniAppWorkflows({ port: port({ miniApps: [] }) });
    await empty.loadListing();
    expect(render(createElement(MiniAppPicker, { onOpened: () => undefined }), empty)).toContain(
      "暂无已安装的 Mini App",
    );
  });
});

describe("the Mini App view the panel frames", () => {
  it("frames the view URL the open operation answered with, and nothing else", async () => {
    const workflows = createWebuiMiniAppWorkflows({
      port: port({ miniApps: [summary("dashboard", "running")] }),
    });
    await workflows.open("dashboard");
    const markup = render(
      createElement(MiniAppView, { pluginId: "dashboard", sessionId: "session-1" }),
      workflows,
    );
    expect(markup).toContain('data-testid="miniapp-view-frame"');
    expect(markup).toContain('src="http://127.0.0.1:49152"');
    expect(markup).toContain('data-state="open"');
    // No credential, origin or surface path reaches the markup.
    expect(markup).not.toContain("token");
    expect(markup).not.toContain("surface/");
  });

  it("renders a cleared view with its reason and a button, and starts nothing on its own", async () => {
    let opens = 0;
    const workflows = createWebuiMiniAppWorkflows({
      port: {
        listMiniApps: async () => ({ miniApps: [summary("dashboard", "running")] }),
        openMiniApp: async ({ pluginId }) => {
          opens += 1;
          return { pluginId, viewUrl: "http://127.0.0.1:49152" };
        },
        stopMiniApp: async () => ({ success: true as const }),
      },
    });
    await workflows.open("dashboard");
    await workflows.stop("dashboard");
    const markup = render(
      createElement(MiniAppView, { pluginId: "dashboard", sessionId: "session-1" }),
      workflows,
    );
    expect(markup).toContain('data-state="stopped"');
    expect(markup).toContain("运行已停止。");
    expect(markup).toContain("重新打开");
    expect(markup).not.toContain("miniapp-view-frame");
    // A render is not a restart: the person's button is.
    expect(opens).toBe(1);
  });

  it("reports a refusal instead of an empty frame", async () => {
    const workflows = createWebuiMiniAppWorkflows({
      port: port({
        miniApps: [summary("shared", "stopped")],
        open: async () => {
          throw Object.assign(new Error("Mini App shared is already running in electron (pid 99)"), {
            code: "OWNED_ELSEWHERE",
          });
        },
      }),
    });
    await workflows.loadListing();
    await workflows.open("shared");
    const markup = render(
      createElement(MiniAppView, { pluginId: "shared", sessionId: "session-1" }),
      workflows,
    );
    expect(markup).toContain("pid 99");
    expect(markup).not.toContain("miniapp-view-frame");
  });
});

describe("the proxy registry", () => {
  it("binds a listener per plugin, serves the bridge, and frees every port on close", async () => {
    const upstream = http.createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><head></head><body>dashboard</body></html>");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    const upstreamPort = typeof address === "object" && address ? address.port : 0;

    const registry = createMiniAppProxyRegistry();
    const proxy = await registry.start({
      target: {
        pluginId: "registry.case",
        upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
        credential: "credential-value",
        credentialHeader: "x-mavis-miniapp-token",
      },
      bridge: miniAppPageBridge(),
      port: 0,
    });
    expect(registry.running()).toHaveLength(1);

    const body = await new Promise<string>((resolve, reject) => {
      http.get(`${proxy.viewUrl}/`, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }).on("error", reject);
    });
    // The bridge is in the document, before the page's own scripts.
    expect(body).toContain("/__miniapp/bridge.js");
    expect(body.indexOf("/__miniapp/bridge.js")).toBeLessThan(body.indexOf("dashboard"));

    const freedPort = proxy.port;
    await registry.closeAll();
    expect(registry.running()).toHaveLength(0);

    // The port is free again: that is the property the shutdown path buys.
    const rebound = http.createServer(() => undefined);
    await new Promise<void>((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(freedPort, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => rebound.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });
});
