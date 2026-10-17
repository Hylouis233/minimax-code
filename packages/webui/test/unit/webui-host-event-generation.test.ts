import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const script = path.join(root, "packages/webui/scripts/host-event-catalogue.mjs");

describe("host-derived event types", () => {
  it("rejects stale source projection and requires regenerating a new host event", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "webui-event-types-"));
    try {
      const source = path.join(directory, "producer.ts");
      const output = path.join(directory, "events.ts");
      const args = [script, `--host-root=${directory}`, `--output=${output}`];
      writeFileSync(source, 'declare function publish(value: object): void; publish({type: "session.created" as const}); // type: "session.fake_comment"\n');
      execFileSync(process.execPath, [...args, "--write"]);
      expect(readFileSync(output, "utf8")).toContain('"session.created"');
      expect(readFileSync(output, "utf8")).not.toContain("fake_comment");
      writeFileSync(source, 'const future = "session.future_fact"; declare function publish(value: object): void; publish({type: "session.created" as const}); publish({type: future}); interface TypedProducer {type: "session.union_a" | "session.union_b";}');
      expect(() => execFileSync(process.execPath, args, { stdio: "pipe" })).toThrow();
      execFileSync(process.execPath, [...args, "--write"]);
      expect(readFileSync(output, "utf8")).toContain('"session.future_fact"');
      expect(readFileSync(output, "utf8")).toContain('"session.union_a"');
      expect(readFileSync(output, "utf8")).toContain('"session.union_b"');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("fails compilation at the production decoder when a generated host fact has no decision", () => {
    const configPath = path.join(root, "packages/webui/tsconfig.client.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    const generated = path.join(root, "packages/webui/src/shared/contracts/host-event-types.generated.ts");
    const reader = path.join(root, "packages/webui/src/client/features/turn/application/session-fact.ts");
    function diagnostics(mutate: boolean) {
      const host = ts.createCompilerHost(parsed.options);
      const read = host.readFile.bind(host);
      host.readFile = (filename) => {
        const source = read(filename);
        return mutate && filename === generated && source !== undefined
          ? source.replace("] as const;", '  "session.future_fact",\n] as const;')
          : source;
      };
      const program = ts.createProgram(parsed.fileNames, parsed.options, host);
      return program.getSemanticDiagnostics(program.getSourceFile(reader)!);
    }
    expect(diagnostics(false)).toEqual([]);
    const failures = diagnostics(true).map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toContain('"session.future_fact"');
  }, 30_000);
});
