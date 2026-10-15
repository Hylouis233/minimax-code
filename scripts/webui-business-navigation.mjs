import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { renderNavigation } from "./lib/webui-source-index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const guidePath = path.join(root, "packages/webui/AGENTS.md");
const begin = "<!-- BEGIN GENERATED WEBUI BUSINESS NAVIGATION -->";
const end = "<!-- END GENERATED WEBUI BUSINESS NAVIGATION -->";
const { values } = parseArgs({ options: { write: { type: "boolean", default: false } } });
const current = readFileSync(guidePath, "utf8");
const start = current.indexOf(begin);
const finish = current.indexOf(end);
if (start < 0 || finish < start) throw new Error("Business navigation block markers are missing");
const updated = `${current.slice(0, start + begin.length)}\n${renderNavigation(path.join(root, "packages/webui/src/client"))}\n${current.slice(finish)}`;
if (values.write) writeFileSync(guidePath, updated);
else if (updated !== current) throw new Error("WebUI module index is stale; run pnpm gen:webui-business-navigation");
console.log("WebUI module index matches the delivered source directories");
