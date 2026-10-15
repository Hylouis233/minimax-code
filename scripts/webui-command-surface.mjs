import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import { renderCommandSurface } from "./lib/webui-source-index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputPath = path.join(root, "docs/webui/command-surface.md");
const config = ts.getParsedCommandLineOfConfigFile(path.join(root, "packages/webui/tsconfig.client.json"), {}, {
  ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
});
if (!config || config.errors.length) throw new Error("Cannot read WebUI client compiler configuration");
const { values } = parseArgs({ options: { write: { type: "boolean", default: false } } });
const rendered = renderCommandSurface(path.join(root, "packages/webui/src/client"), config.options);
if (values.write) writeFileSync(outputPath, rendered);
else if (readFileSync(outputPath, "utf8") !== rendered) throw new Error("WebUI exported surface is stale; run pnpm gen:webui-commands");
console.log("WebUI exported application and contract surface is current");
