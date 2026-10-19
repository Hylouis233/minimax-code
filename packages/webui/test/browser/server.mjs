import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { installFixtureTransport } from "./fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../dist-webui/client");
const port = 4179;
const serverId = process.env.WEBUI_BROWSER_SERVER_ID ?? randomUUID();
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", serverId }));
    return;
  }
  const name = pathname === "/" || pathname === "/index.html" ? "index.html" : path.basename(pathname);
  if (!["index.html", "client.js", "styles.css"].includes(name)) {
    response.writeHead(404).end("not found");
    return;
  }
  try {
    let body = await readFile(path.join(root, name));
    if (name === "index.html") {
      const html = body.toString().replace(
        "</head>",
        `<script>window.__WEBUI_TEST_SERVER_ID__=${JSON.stringify(serverId)};window.__WEBUI_CONFIG__={websocketUrl:"ws://fixture.invalid",token:"synthetic-token"};(${installFixtureTransport.toString()})();for(const setup of window.__WEBUI_FIXTURE_SETUP__??[])setup();</script></head>`,
      );
      body = Buffer.from(html);
    }
    const contentType = name.endsWith(".js") ? "text/javascript; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(404).end("built WebUI artifact not found; run pnpm build:webui first");
  }
});

server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
