// Test the WebUI internal dependency-direction rules (ADR 0014, plan §3/§7.5).
//
// These fixtures exist because `check:webui-boundary` (the esbuild metafile
// check) cannot catch what this check catches: it sees a build input only if it
// reaches the bundle, it cannot see `import type` edges at all (they are erased
// from build output), and it proves *presence*, never direction. Every negative
// fixture below is written to a temporary directory and parsed and resolved by
// the same code path the CLI uses, so the assertion is about real AST resolution
// rather than a hand-built adjacency list.
//
// The fixtures live under the OS temp directory, never in the repository, so
// `scripts/source-inventory.mjs` never sees them.

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import {
  BROWSER_ONLY_MODULES_RE,
  KNOWN_AMBIGUOUS_FILES,
  buildDependencyGraph,
  canonicalCycle,
  classifyLayers,
  collectModuleReferences,
  collectProvisionalJudgements,
  compareBaseline,
  detectCycles,
  evaluateGraph,
  isAllowedEdge,
  normaliseSourcePath,
  pairKey,
  toBaselineShape,
  touchesAmbiguousFile,
} from "../../../../scripts/lib/webui-dependency-rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const cliPath = path.join(repoRoot, "scripts/check-webui-dependency.mjs");
const realBaselinePath = path.join(
  repoRoot,
  "scripts/lib/webui-dependency-baseline.json",
);

// Resolution options for the synthetic trees. Bundler resolution mirrors the
// client program and maps the `.js` specifiers these fixtures use onto `.ts`
// sources, exactly as the real tsconfig does.
const compilerOptions: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  allowImportingTsExtensions: true,
};

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots)
    rmSync(root, { recursive: true, force: true });
});

/**
 * Writes a synthetic `${repositoryRoot}/packages/webui/src` tree and returns the
 * parsed, resolved evaluation, using the same builder and rules as the CLI.
 */
function evaluateFixture(
  files: Record<string, string>,
  options: ts.CompilerOptions = compilerOptions,
  approved: readonly { readonly from: string; readonly to: string }[] = [],
) {
  const root = mkdtempSync(path.join(os.tmpdir(), "webui-dependency-"));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, "packages/webui/src");
  const absoluteFiles: string[] = [];
  for (const [relative, body] of Object.entries(files)) {
    const absolute = path.join(sourceRoot, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
    absoluteFiles.push(absolute);
  }
  const graph = buildDependencyGraph({
    repositoryRoot: root,
    compilerOptions: { ...options, baseUrl: options.baseUrl ?? sourceRoot },
    files: absoluteFiles,
  });
  // A fixture graph states its own approved peers: the repository's list names
  // files the fixture does not contain, which the rule would report as stale.
  return { graph, result: evaluateGraph(graph, { approvedPeerImports: approved, roleExceptions: [] }) };
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const widget =
  "export interface Widget { readonly id: string }\nexport const widget = 1;\n";
const leaf = "export const leaf = 1;\n";

describe("layer matrix", () => {
  it("allows application to import its client contracts", () => {
    expect(isAllowedEdge(["application"], ["contracts"])).toBe(true);
  });

  it("denies a pure projection importing a component", () => {
    expect(isAllowedEdge(["view"], ["bindings"])).toBe(false);
    expect(isAllowedEdge(["domain"], ["bindings"])).toBe(false);
  });

  it("denies application and domain reaching the concrete transport", () => {
    expect(isAllowedEdge(["application"], ["infrastructure"])).toBe(false);
    expect(isAllowedEdge(["domain"], ["infrastructure"])).toBe(false);
  });

  it("denies shared contracts reaching either execution side", () => {
    expect(isAllowedEdge(["shared"], ["application"])).toBe(false);
    expect(isAllowedEdge(["shared"], ["server"])).toBe(false);
    expect(isAllowedEdge(["shared"], ["runtime"])).toBe(false);
  });

  it("denies the Node runtime importing a browser-only layer", () => {
    expect(isAllowedEdge(["runtime"], ["bindings"])).toBe(false);
    expect(isAllowedEdge(["runtime"], ["view"])).toBe(false);
  });

  it("requires every classification pair to allow an edge", () => {
    expect(isAllowedEdge(["runtime", "server"], ["server"])).toBe(false);
  });

  it("classifies current paths by their target layer, not the directory", () => {
    expect(classifyLayers("runtime/port.ts")).toEqual(["runtime-port"]);
    expect(classifyLayers("client/contracts/transport.ts")).toEqual(["contracts"]);
    // The reducer is a pure `view` projection now that the stream loop and the
    // test-only instrumentation take it by injection instead of importing it.
    // `client/projection/` classifies by basename, so the `turn/` sub-directory
    // does not change the verdict.
    expect(classifyLayers("client/features/turn/projection/stream-state.ts")).toEqual(["view"]);
    // The migrated modules are decided by their directory now, so no
    // provenance entry is needed for them.
    expect(classifyLayers("client/mechanisms/stream-loop.ts")).toEqual(["mechanisms"]);
    expect(classifyLayers("client/infrastructure/transport.ts")).toEqual([
      "infrastructure",
    ]);
  });

  it("classifies the business-first homes by the layers their files carry", () => {
    // The target homes (plan §5.1) carry the same layers as the technical homes
    // the files come from, so a direction rule is not re-spelled when a file
    // moves. Without these mappings a moved path would classify `unknown`, which
    // is reported rather than constrained: the gate would look green while
    // enforcing less than it did before the move. These assertions fail if the
    // mapping is dropped.
    expect(classifyLayers("client/features/transcript/contracts/message-view.ts")).toEqual([
      "contracts",
    ]);
    expect(classifyLayers("client/features/transcript/projection/message-projection.ts")).toEqual([
      "view",
    ]);
    expect(classifyLayers("client/features/transcript/application/history.ts")).toEqual([
      "application",
    ]);
    expect(classifyLayers("client/features/transcript/bindings/session.ts")).toEqual(["bindings"]);
    expect(classifyLayers("client/features/transcript/ui/SessionTranscript.tsx")).toEqual([
      "bindings",
    ]);
    // The conversation substrate takes the layer the mechanisms home carries.
    expect(classifyLayers("client/conversation/transcript-history.ts")).toEqual(["mechanisms"]);
    expect(classifyLayers("client/platform/transport.ts")).toEqual(["infrastructure"]);
    expect(classifyLayers("client/ui/markdown.tsx")).toEqual(["bindings"]);
    // A feature path with no role directory is not silently given one.
    expect(classifyLayers("client/features/transcript/whatever.ts")).toEqual(["unknown"]);
  });

  it("classifies the two client-root files by path rule alone", () => {
    // These are the only two files plan §6.1 keeps at the client root. Their
    // `root` layer used to come from `CLIENT_FILE_PROVENANCE`, which C-fin
    // deleted, so it is now stated as a path rule — and these assertions exist
    // to fail if that rule is ever dropped.
    expect(classifyLayers("client/main.tsx")).toEqual(["root"]);
    expect(classifyLayers("client/global.d.ts")).toEqual(["root"]);
  });

  it("classifies every relocated module from its own path", () => {
    // Phase 4 moved each former client-root module under a layer directory. None
    // of these has a provenance entry any more; each is decided by its prefix,
    // or — under `client/projection/` — by its basename.
    expect(classifyLayers("client/infrastructure/team-mode.ts")).toEqual(["infrastructure"]);
    expect(classifyLayers("client/infrastructure/no-project.ts")).toEqual(["infrastructure"]);
    expect(classifyLayers("client/contracts/value-readers.ts")).toEqual(["contracts"]);
    expect(classifyLayers("client/projection/common/paths.ts")).toEqual(["view"]);
    expect(classifyLayers("client/projection/common/router.ts")).toEqual(["view"]);
    expect(classifyLayers("client/projection/sessions/rail-buckets.ts")).toEqual(["view"]);
    expect(classifyLayers("client/components/composer/slash-palette.ts")).toEqual(["bindings"]);
    expect(classifyLayers("client/features/transcript/ui/markdown.tsx")).toEqual(["bindings"]);
    expect(classifyLayers("client/components/shell/icons.tsx")).toEqual(["bindings"]);
    expect(classifyLayers("client/components/shell/ConnectionStatus.tsx")).toEqual(["bindings"]);
  });

  it("classifies the two re-filed projections as application by prefix", () => {
    // `composer-history` and `effect-reducer` were the only two modules the gate
    // classified `application` while they sat in `client/projection/`
    // (plan §7.2). They moved under `client/application/`, so the prefix rule now
    // carries that verdict and `PROJECTION_SPLIT` is gone.
    expect(classifyLayers("client/application/composer/composer-history.ts")).toEqual(["application"]);
    expect(classifyLayers("client/features/turn/application/effect-reducer.ts")).toEqual(["application"]);
    expect(classifyLayers("client/application/transcript/transcript-request-ownership.ts")).toEqual(["application"]);
  });

  it("classifies a client-root file with no rule as unknown", () => {
    // With the provenance table deleted, a file re-created at an old client-root
    // path classifies `unknown` — whose allowed-edge set is empty — instead of
    // silently inheriting a layer its deleted entry used to assert.
    expect(classifyLayers("client/team-mode.ts")).toEqual(["unknown"]);
    expect(classifyLayers("client/projection/nothing-here.ts")).toEqual(["view"]);
  });

  it("recognises the post-migration layout too", () => {
    expect(classifyLayers("client/application/session-store.ts")).toEqual([
      "application",
    ]);
    expect(classifyLayers("runtime/harness/adapter.ts")).toEqual(["runtime"]);
    expect(classifyLayers("shared/contracts/session.ts")).toEqual(["shared"]);
  });

  it("keeps the plan section 7.5 mixed-file list empty", () => {
    // The list is empty because each of the four entries was resolved, not
    // because the check was relaxed: `runtime/port.ts` and `client/slash-palette.ts`
    // lost their contract re-export shells, and `server/envelope.ts` /
    // `server/service.ts` were re-read and hold a single layer. The reasoning is
    // recorded on `KNOWN_AMBIGUOUS_FILES` in `scripts/lib/webui-dependency-rules.mjs`.
    // The symbol-level ownership check §7.5 asks for is still not implemented —
    // an empty list means nothing left to judge, not that judgement is automatic.
    expect(KNOWN_AMBIGUOUS_FILES).toEqual([]);
    // The four resolved entries must not come back: each is now judged by its
    // path, and listing it again would assert a mixture that no longer exists.
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("runtime/port.ts");
    // Both names are asserted: the path the file used to sit at, and the one it
    // occupies now. A relocated entry must not come back under either spelling.
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("client/slash-palette.ts");
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("client/components/composer/slash-palette.ts");
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("server/envelope.ts");
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("server/service.ts");
    // Entries removed earlier stay removed.
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain(
      "client/features/turn/projection/stream-state.ts",
    );
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("client/stream.ts");
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain("client/contracts.ts");
    expect(KNOWN_AMBIGUOUS_FILES).not.toContain(
      "client/session-runtime-store.ts",
    );
  });

  // Each resolved file is still classified, and still by a single layer — that
  // is what makes an empty list truthful rather than merely empty. If one of
  // these starts mixing again, its classification or this assertion is what
  // should fail first.
  it("classifies the files the empty list removed", () => {
    expect(classifyLayers("runtime/port.ts")).toEqual(["runtime-port"]);
    expect(classifyLayers("client/components/composer/slash-palette.ts")).toEqual(["bindings"]);
    expect(classifyLayers("server/envelope.ts")).toEqual(["server"]);
    expect(classifyLayers("server/service.ts")).toEqual(["server"]);
  });

  // Every entry the list retains must still be a file the checker recognises
  // and classifies, and each must genuinely be path-ambiguous: if the matrix
  // gives it one clean layer, the entry is asserting a mixture that is gone.
  it("retains only files the matrix classifies", () => {
    // Vacuously satisfied while the list is empty, and kept deliberately: the
    // moment someone adds an entry, this is the loop that has to start holding
    // it to the classifier.
    for (const file of KNOWN_AMBIGUOUS_FILES) {
      expect(classifyLayers(file).length).toBeGreaterThan(0);
    }
  });
});

describe("provisional judgements for plan section 7.5 mixed files", () => {
  // A violation that touches a mixed-responsibility file may or may not be a
  // real defect: the file's layer is an assumption until it is split. The list
  // has to surface those judgements (plan §7.5 promises the CLI reports every
  // violation touching one) without turning them into a new gate.
  const violation = (from: string, to: string) => ({
    from,
    to,
    category: "unclassified",
  });

  // The real `KNOWN_AMBIGUOUS_FILES` is empty, so these drive the collector with
  // a fixture list. The paths are the ones the list used to hold — keeping them
  // means these assertions still describe the real rule, and if the collector
  // regressed they would still fail. The collector's default argument is what
  // the CLI uses; "the empty real list reports nothing" is asserted separately
  // in the block above.
  const FIXTURE_AMBIGUOUS_FILES = ["runtime/port.ts", "server/envelope.ts"];

  it("reports a violation whose source is an ambiguous file", () => {
    expect(
      collectProvisionalJudgements(
        [violation("runtime/port.ts", "server/x.ts")],
        FIXTURE_AMBIGUOUS_FILES,
      ),
    ).toEqual([
      {
        from: "runtime/port.ts",
        to: "server/x.ts",
        category: "unclassified",
        ambiguous: ["runtime/port.ts"],
      },
    ]);
  });

  it("reports a violation whose destination is an ambiguous file", () => {
    expect(
      collectProvisionalJudgements(
        [violation("server/x.ts", "server/envelope.ts")],
        FIXTURE_AMBIGUOUS_FILES,
      ),
    ).toEqual([
      {
        from: "server/x.ts",
        to: "server/envelope.ts",
        category: "unclassified",
        ambiguous: ["server/envelope.ts"],
      },
    ]);
  });

  it("names both endpoints when the edge is ambiguous at both ends", () => {
    expect(
      collectProvisionalJudgements(
        [violation("runtime/port.ts", "server/envelope.ts")],
        FIXTURE_AMBIGUOUS_FILES,
      ),
    ).toEqual([
      {
        from: "runtime/port.ts",
        to: "server/envelope.ts",
        category: "unclassified",
        ambiguous: ["runtime/port.ts", "server/envelope.ts"],
      },
    ]);
  });

  it("leaves a violation between two unambiguous files out", () => {
    expect(
      collectProvisionalJudgements(
        [violation("client/x.ts", "client/y.ts")],
        FIXTURE_AMBIGUOUS_FILES,
      ),
    ).toEqual([]);
  });

  it("reports nothing for the real list, which is empty", () => {
    // The collector's default argument is the shipped list. Today that list has
    // no entries, so no violation can be provisional — asserted so the default
    // wiring stays covered even though the fixtures above pass their own list.
    expect(
      collectProvisionalJudgements([
        violation("runtime/port.ts", "server/envelope.ts"),
      ]),
    ).toEqual([]);
    expect(touchesAmbiguousFile("runtime/port.ts", "server/envelope.ts")).toBe(
      false,
    );
  });

  it("does not report a violation merely because the removed file was ambiguous", () => {
    // The blind spot this fixes: the removed `stream-state.ts` entry would have
    // made every one of its edges look provisional. It is a plain `view` file
    // now, so its violations (if any) are ordinary judgements.
    expect(touchesAmbiguousFile("client/features/turn/projection/stream-state.ts", "client/y.ts"))
      .toBe(false);
    // Same for the four entries resolved by this refactor: with the real list
    // empty, none of them makes an edge provisional.
    expect(touchesAmbiguousFile("client/components/composer/slash-palette.ts", "server/service.ts"))
      .toBe(false);
  });

  it("surfaces the judgement through the CLI without feeding the gate", () => {
    // The real tree has no violation touching an ambiguous file, so the
    // collector is exercised directly above. What has to hold here is the
    // wiring: the CLI publishes the report, and its pass/fail condition never
    // reads it — a mixed-file judgement is advisory and cannot fail CI.
    const source = readFileSync(
      path.join(repoRoot, "scripts/check-webui-dependency.mjs"),
      "utf8",
    );
    expect(source).toContain("collectProvisionalJudgements(result.direction)");
    // The summary is what `--json` emits, so the field is reachable there.
    const summaryBlock = source.slice(source.indexOf("const summary = {"));
    expect(summaryBlock).toContain("provisionalJudgements,");
    // …and the gate is computed before it, from the enforced lists alone.
    const failedBlock = source.slice(
      source.indexOf("const failed ="),
      source.indexOf("const summary = {"),
    );
    expect(failedBlock).not.toContain("provisionalJudgement");
  });
});

describe("normaliser", () => {
  it("maps an in-package path to a src-relative form and rejects out-of-tree", () => {
    const inside = path.join(
      repoRoot,
      "packages/webui/src/client/main.tsx",
    );
    expect(normaliseSourcePath(repoRoot, inside)).toBe("client/main.tsx");
    expect(normaliseSourcePath(repoRoot, "/tmp/elsewhere.ts")).toBeNull();
  });
});

describe("reference collection", () => {
  it("distinguishes a type-only import from a value import", () => {
    const typed = collectModuleReferences(
      "x.ts",
      'import type { W } from "./w.js";\n',
    );
    expect(typed.references[0]).toMatchObject({
      specifier: "./w.js",
      kind: "import-type",
    });
    const value = collectModuleReferences(
      "x.ts",
      'import { W } from "./w.js";\n',
    );
    expect(value.references[0]?.kind).toBe("import");
  });

  it("records a type query and a non-literal dynamic import", () => {
    const collected = collectModuleReferences(
      "x.ts",
      'type T = import("./w.js").W;\nconst p = name; await import(p);\n',
    );
    expect(collected.references[0]?.kind).toBe("type-query");
    expect(collected.nonLiteralDynamic).toHaveLength(1);
  });

  it("collects literal require calls as module references", () => {
    const collected = collectModuleReferences("x.ts", 'const widget = require("./widget.js");\n');
    expect(collected.references).toContainEqual({ specifier: "./widget.js", line: 1, kind: "require" });
  });
});

describe("direction fixtures", () => {
  it("accepts an allowed application -> contracts edge", () => {
    const { result } = evaluateFixture({
      "client/contracts/session-port.ts": leaf,
      "client/application/app.ts": 'import { leaf } from "../contracts/session-port.js";\nexport const use = leaf;\n',
    });
    expect(result.direction).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it("rejects application -> components", () => {
    const { result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/app.ts": 'import { widget } from "../components/Widget.js";\nexport const use = widget;\n',
    });
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      from: "client/application/app.ts",
      to: "client/components/Widget.tsx",
      layerFrom: ["application"],
      layerTo: ["bindings"],
    });
  });

  it("rejects an application -> React import", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": 'import { useState } from "react";\nexport const use = useState;\n',
    });
    expect(result.browserOnly).toHaveLength(1);
    expect(result.browserOnly[0]).toMatchObject({
      kind: "browser-only",
      file: "client/application/app.ts",
      specifier: "react",
    });
    expect(BROWSER_ONLY_MODULES_RE.test("react-dom/client")).toBe(true);
  });

  it("keeps a React host dependency when TypeScript resolves it outside the WebUI source tree", () => {
    const reactTypes = path.join(repoRoot, "node_modules/@types/react/index.d.ts");
    expect(readFileSync(reactTypes, "utf8")).toContain("export = React");
    const { graph, result } = evaluateFixture({
      "client/application/app.ts": 'import { useState } from "react";\nexport const use = useState;\n',
    }, {
      ...compilerOptions,
      paths: { react: [reactTypes] },
    });
    expect(graph.hostImports).toContainEqual(expect.objectContaining({
      specifier: "react",
      target: reactTypes,
    }));
    expect(result.browserOnly).toContainEqual(expect.objectContaining({
      file: "client/application/app.ts",
      specifier: "react",
    }));
    expect(result.pass).toBe(false);
  });

  it("resolves a tsconfig alias to an actual component edge", () => {
    const { graph, result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/app.ts": 'import { widget } from "@/components/Widget.js";\nexport const use = widget;\n',
    }, { ...compilerOptions, paths: { "@/*": ["client/*"] } });
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: "client/application/app.ts",
      to: "client/components/Widget.tsx",
      kind: "import",
    }));
    expect(result.direction).toHaveLength(1);
  });

  it("rejects an unresolved configured alias instead of treating it as a package import", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": 'import { missing } from "@/components/Missing.js";\nexport const use = missing;\n',
    }, { ...compilerOptions, paths: { "@/*": ["client/*"] } });
    expect(result.unresolved).toHaveLength(1);
    expect(result.pass).toBe(false);
  });

  it("rejects direct document and storage globals in application and components", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": 'export const current = document.title;\n',
      "client/components/Widget.tsx": 'export const saved = localStorage.getItem("k");\n',
      "client/bindings/Other.ts": 'export const tab = sessionStorage.getItem("k");\n',
    });
    expect(result.browserGlobals.map((entry) => entry.global)).toEqual([
      "document", "localStorage", "sessionStorage",
    ]);
  });

  it("catches ambient window and globalThis accesses in application and projection", () => {
    // Bidirectional fixture set: globals on `window`/`globalThis` previously
    // slipped past the property-name filter; ambient resolution via the
    // TypeScript program confirms each hit. The local-`document` parameter
    // is *not* a violation because its declaration is in the same file, not
    // in a TypeScript lib `*.d.ts`.
    const { result } = evaluateFixture({
      "client/application/window.ts": 'export const title = window.document.title;\n',
      "client/application/global-storage.ts":
        'export const saved = globalThis.localStorage.getItem("k");\n',
      "client/projection/title.ts": 'export const title = document.title;\n',
      "client/application/local-shielded.ts":
        'export function title(document: { readonly title: string }) {\n  return document.title;\n}\n',
    });
    expect(result.browserGlobals).toEqual([
      expect.objectContaining({
        file: "client/application/window.ts",
        global: "window",
      }),
      // The restricted member of the same chain is reported on its own entry:
      // `window.document` is a `document` access, judged by `document`'s policy
      // rather than `window`'s. Both are violations in application, and both
      // entries are required — collapsing the chain to one name would let a
      // member through wherever its base object happens to be allowed.
      expect.objectContaining({
        file: "client/application/window.ts",
        global: "document",
      }),
      expect.objectContaining({
        file: "client/application/global-storage.ts",
        global: "globalThis",
      }),
      expect.objectContaining({
        file: "client/application/global-storage.ts",
        global: "localStorage",
      }),
      expect.objectContaining({
        file: "client/projection/title.ts",
        global: "document",
      }),
    ]);
  });

  it("rejects bare and node:-prefixed Node builtins in client and shared code", () => {
    const { result } = evaluateFixture({
      "client/application/fs.ts": 'import fs from "fs";\nexport const read = fs.readFileSync;\n',
      "client/application/node-fs.ts":
        'import { readFileSync } from "node:fs";\nexport const read = readFileSync("/x");\n',
      "shared/contracts/path.ts":
        'import path from "path";\nexport const join = path.join;\n',
    });
    expect(result.nodeBuiltins.map((entry) => ({
      file: entry.file,
      specifier: entry.specifier,
    })).sort((left, right) => left.file.localeCompare(right.file))).toEqual([
      { file: "client/application/fs.ts", specifier: "fs" },
      { file: "client/application/node-fs.ts", specifier: "node:fs" },
      { file: "shared/contracts/path.ts", specifier: "path" },
    ]);
  });

  it("rejects a runtime transfer implementation importing the server", () => {
    const { result } = evaluateFixture({
      "server/http/route.ts": leaf,
      "runtime/session-transfer.ts": 'import { leaf } from "../server/http/route.js";\nexport const use = leaf;\n',
    });
    expect(classifyLayers("runtime/session-transfer.ts")).toEqual(["runtime"]);
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      from: "runtime/session-transfer.ts",
      to: "server/http/route.ts",
      layerFrom: ["runtime"],
    });
  });

  it("rejects shared Node builtins", () => {
    const { result } = evaluateFixture({
      "shared/contracts/node.ts": 'import { readFileSync } from "node:fs";\nexport const read = readFileSync("/x");\n',
    });
    expect(result.sharedNodeBuiltins).toHaveLength(1);
    expect(result.sharedNodeBuiltins[0]).toMatchObject({
      file: "shared/contracts/node.ts",
      specifier: "node:fs",
    });
  });

  it("keeps the relative component negative control rejected", () => {
    const { result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/app.ts": 'import { widget } from "../components/Widget.js";\nexport const use = widget;\n',
    });
    expect(result.direction).toHaveLength(1);
  });

  it("rejects a runtime -> browser-only import", () => {
    const { result } = evaluateFixture({
      "runtime/harness/adapter.ts": 'import { createElement } from "react";\nexport const use = createElement;\n',
    });
    expect(result.browserOnly).toHaveLength(1);
    expect(result.browserOnly[0]).toMatchObject({ file: "runtime/harness/adapter.ts" });
  });

  it("rejects shared -> client", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": leaf,
      "shared/contracts/session.ts": 'import { leaf } from "../../client/application/app.js";\nexport const use = leaf;\n',
    });
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      layerFrom: ["shared"],
      layerTo: ["application"],
    });
  });

  it("rejects a pure domain projection -> concrete transport", () => {
    const { result } = evaluateFixture({
      "client/infrastructure/transport.ts": leaf,
      "client/projection/plan-mode.ts": 'import { leaf } from "../infrastructure/transport.js";\nexport const use = leaf;\n',
    });
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      layerFrom: ["domain"],
      layerTo: ["infrastructure"],
    });
  });
});

describe("require() direction fixtures", () => {
  it("rejects a cross-layer dependency hidden behind require()", () => {
    const { graph, result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/consumer.ts": 'const Widget = require("../components/Widget.js");\nexport { Widget };\n',
    });
    expect(graph.edges).toContainEqual(expect.objectContaining({
      from: "client/application/consumer.ts",
      to: "client/components/Widget.tsx",
      kind: "require",
    }));
    expect(result.direction).toHaveLength(1);
  });
});

describe("what the metafile cannot see", () => {
  it("rejects a violation expressed only as an import type", () => {
    const { result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/app.ts": 'import type { Widget } from "../components/Widget.js";\nexport type Use = Widget;\n',
    });
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      referenceKind: "import-type",
      layerFrom: ["application"],
      layerTo: ["bindings"],
    });
  });

  it("rejects a forbidden edge hidden behind a type-only re-export barrel", () => {
    const { result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/contracts/barrel.ts": 'export type { Widget } from "../components/Widget.js";\n',
      "client/application/consumer.ts": 'import type { Widget } from "../contracts/barrel.js";\nexport type Use = Widget;\n',
    });
    // The application -> barrel edge is legal (application may import contracts)…
    expect(
      result.direction.some(
        (violation) => violation.to === "client/contracts/barrel.ts",
      ),
    ).toBe(false);
    // …but the barrel's own type-only re-export of a component is caught.
    expect(
      result.direction.some(
        (violation) =>
          violation.from === "client/contracts/barrel.ts" &&
          violation.to === "client/components/Widget.tsx" &&
          violation.layerFrom.join() === "contracts",
      ),
    ).toBe(true);
  });

  it("rejects a violation expressed as a literal dynamic import", () => {
    const { result } = evaluateFixture({
      "client/components/Widget.tsx": widget,
      "client/application/app.ts": 'export const load = async () => import("../components/Widget.js");\n',
    });
    expect(result.direction).toHaveLength(1);
    expect(result.direction[0]).toMatchObject({
      referenceKind: "dynamic",
      layerTo: ["bindings"],
    });
  });
});

// The ambient-member rule: a restricted member is judged by its own policy
// wherever it is read from, so a base object that the layer may touch does not
// carry its restricted members with it.
describe("the ambient-member rule", () => {
  const rows: ReadonlyArray<{
    readonly label: string;
    readonly file: string;
    readonly body: string;
    readonly names: readonly string[];
  }> = [
    {
      label: "a component reading window.localStorage",
      file: "client/components/Widget.tsx",
      body: "export const s = window.localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "a binding reading window.localStorage",
      file: "client/bindings/hash.ts",
      body: "export const s = window.localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "a binding reading self.localStorage",
      file: "client/bindings/hash.ts",
      body: "export const s = self.localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "application reading self.localStorage",
      file: "client/application/app.ts",
      body: "export const s = self.localStorage;\n",
      names: ["self", "localStorage"],
    },
    {
      label: "window[\"localStorage\"] as an element access",
      file: "client/components/Widget.tsx",
      body: 'export const s = window["localStorage"];\n',
      names: ["localStorage"],
    },
    {
      label: "destructuring localStorage off window",
      file: "client/components/Widget.tsx",
      body: "const { localStorage } = window;\nexport const s = localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "reading localStorage off an alias of window",
      file: "client/bindings/hash.ts",
      body: "const g = window;\nexport const s = g.localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "a chained base object globalThis.window.localStorage",
      file: "client/application/app.ts",
      body: "export const s = globalThis.window.localStorage;\n",
      names: ["globalThis", "localStorage"],
    },
    {
      label: "a nested pattern reading window.localStorage off globalThis",
      file: "client/components/Widget.tsx",
      body: "const { window: { localStorage } } = globalThis;\nexport const s = localStorage;\n",
      names: ["localStorage"],
    },
    {
      label: "an assignment pattern reading window.localStorage",
      file: "client/components/Widget.tsx",
      body: "let s: Storage;\n({ localStorage: s } = window);\nexport const read = (): Storage => s;\n",
      names: ["localStorage"],
    },
    {
      label: "a template element access of window.localStorage",
      file: "client/components/Widget.tsx",
      body: "export const s = window[`localStorage`];\n",
      names: ["localStorage"],
    },
  ];

  for (const row of rows) {
    it(`rejects ${row.label}`, () => {
      const { result } = evaluateFixture({ [row.file]: row.body });
      expect(result.browserGlobals.map((entry) => entry.global).sort()).toEqual(
        [...row.names].sort(),
      );
      expect(result.pass).toBe(false);
    });
  }

  it("keeps a local name that merely matches a restricted member", () => {
    // `window.name` is a string: the pattern reads the `name` property and only
    // *binds* it to a local called `localStorage`, so neither the pattern nor the
    // local reads the storage capability.
    const { result } = evaluateFixture({
      "client/components/Widget.tsx":
        "const { name: localStorage } = window;\nexport const read = (): string => localStorage;\n",
      "client/components/Other.tsx":
        "let sessionStorage: string | undefined;\n({ name: sessionStorage } = globalThis);\nexport const read = (): string | undefined => sessionStorage;\n",
    });
    expect(result.browserGlobals).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it("keeps every legitimate base-object access, including the IO owner's", () => {
    // The anchors: the storage adapter's own ambient read, the composition
    // root's, a binding listening to window events, the shell's URL sync, and a
    // locally typed object that happens to own a `document` property.
    const { result } = evaluateFixture({
      "client/infrastructure/storage.ts": "export const s = globalThis.localStorage;\n",
      "client/main.tsx": "export const d = globalThis.document;\n",
      "client/bindings/navigation.ts": "export const h = window.location.hash;\n",
      "client/components/WebuiClientFoundationApp.tsx":
        'export function sync(): void {\n  const p = window.location.pathname;\n  window.history.replaceState(null, "", p);\n}\n',
      "client/components/Widget.tsx":
        'export function boot(): void {\n  window.addEventListener("hashchange", () => {});\n}\n',
      "client/components/Local.tsx":
        "const local: { document: number } = { document: 1 };\nexport const d = local.document;\n",
    });
    expect(result.browserGlobals).toHaveLength(0);
    expect(result.pass).toBe(true);
  });
});

// The resolved-host rule: an import that *resolves* to a browser-only module is
// one, even when the specifier it was authored with says nothing of the sort.
describe("the resolved-host rule", () => {
  it("rejects a React dependency that arrives through a path alias", () => {
    const reactTypes = path.join(repoRoot, "node_modules/@types/react/index.d.ts");
    const { graph, result } = evaluateFixture(
      {
        "client/application/app.ts":
          'import { useState } from "@webui/react";\nexport const use = useState;\n',
      },
      { ...compilerOptions, paths: { "@webui/react": [reactTypes] } },
    );
    expect(graph.hostImports).toContainEqual(
      expect.objectContaining({ specifier: "@webui/react", target: reactTypes }),
    );
    expect(result.browserOnly).toContainEqual(
      expect.objectContaining({
        file: "client/application/app.ts",
        specifier: "@webui/react",
      }),
    );
    expect(result.pass).toBe(false);
  });
});

describe("structural failures", () => {
  it("rejects an unresolved intra-package import", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": 'import { missing } from "../components/Missing.js";\nexport const use = missing;\n',
    });
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0]).toMatchObject({ kind: "unresolved" });
    expect(result.pass).toBe(false);
  });

  it("rejects a non-literal dynamic import", () => {
    const { result } = evaluateFixture({
      "client/application/app.ts": 'export const load = async (name: string) => import(name);\n',
    });
    expect(result.nonLiteralDynamic).toHaveLength(1);
    expect(result.nonLiteralDynamic[0]).toMatchObject({ kind: "non-literal-dynamic" });
  });

  it("detects an import cycle even when every edge is directionally legal", () => {
    const { graph, result } = evaluateFixture({
      "client/components/A.tsx": 'import { b } from "./B.js";\nexport const a = b;\n',
      "client/components/B.tsx": 'import { a } from "./A.js";\nexport const b = a;\n',
    });
    expect(result.direction).toHaveLength(0);
    expect(result.cycles).toHaveLength(1);
    const [cycle] = detectCycles(graph.edges);
    expect(cycle).toBeDefined();
    expect(canonicalCycle(cycle as string[])).toContain("client/components/A.tsx");
    expect(canonicalCycle(cycle as string[])).toContain("client/components/B.tsx");
  });
});

describe("baseline comparison", () => {
  it("reports a new violation and a stale entry", () => {
    const violation = {
      kind: "direction" as const,
      from: "client/application/app.ts",
      to: "client/components/Widget.tsx",
      line: 1,
      referenceKind: "import",
      layerFrom: ["application"],
      layerTo: ["bindings"],
      rule: "application -> bindings",
      category: "unclassified",
      detail: "",
    };
    const entry = toBaselineShape([violation])[0];
    expect(entry).toBeDefined();
    const staleEntry = {
      ...(entry as NonNullable<typeof entry>),
      from: "client/other.ts",
      to: "client/gone.ts",
    };
    const { newViolations, staleEntries } = compareBaseline(
      [violation],
      [entry as NonNullable<typeof entry>, staleEntry],
    );
    expect(newViolations).toHaveLength(0);
    expect(staleEntries.map((item) => pairKey(item.from, item.to))).toEqual([
      "client/other.ts -> client/gone.ts",
    ]);
    const invented = {
      ...violation,
      from: "client/application/other.ts",
    };
    expect(compareBaseline([violation, invented], [entry as NonNullable<typeof entry>]).newViolations)
      .toHaveLength(1);
  });

  it("counts a pair's occurrences from a definite base, so the entry survives a JSON round trip", () => {
    // The count used to accumulate onto an absent field: `undefined + 1` is
    // NaN, every later occurrence kept it NaN, and `JSON.stringify(NaN)` writes
    // `null` — so a persisted entry never round-tripped, and any equality-based
    // reader saw a field that kept changing.
    const violation = (line: number) => ({
      kind: "direction" as const,
      from: "client/application/app.ts",
      to: "client/components/Widget.tsx",
      line,
      referenceKind: "import",
      layerFrom: ["application"],
      layerTo: ["bindings"],
      rule: "application -> bindings",
      category: "projection-to-components",
      detail: "",
    });

    expect(toBaselineShape([violation(1)])[0]?.occurrences).toBe(1);
    expect(toBaselineShape([violation(1), violation(2)])[0]?.occurrences).toBe(2);

    const [entry] = toBaselineShape([violation(1), violation(2), violation(3)]);
    expect(entry?.occurrences).toBe(3);
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });
});

// The declaration file is the contract every consumer of these rules compiles
// against: this test, and `scripts/check-webui-dependency.mjs`. A declaration
// that drifts from the implementation is worse than no declaration at all — it
// type-checks at the call site and fails at runtime, which is exactly how
// `collectModuleReferences(...).browserGlobalUses.length` read a member the
// collector never returned. These read the *declared* member names out of the
// `.d.mts` and compare them with the keys the runtime object actually carries,
// in both directions.
describe("declared shapes match the runtime shapes", () => {
  const declaredPath = path.join(
    repoRoot,
    "scripts/lib/webui-dependency-rules.d.mts",
  );

  /** Required property names of one interface, read from the declaration. */
  function declaredMembers(interfaceName: string): string[] {
    const sourceFile = ts.createSourceFile(
      declaredPath,
      readFileSync(declaredPath, "utf8"),
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    let members: string[] | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
        members = node.members.flatMap((member) =>
          ts.isPropertySignature(member) && ts.isIdentifier(member.name)
            ? [member.name.text]
            : [],
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(
      members,
      `no interface ${interfaceName} declared in webui-dependency-rules.d.mts`,
    ).toBeDefined();
    return members ?? [];
  }

  function expectShapeMatches(interfaceName: string, value: object, label: string): void {
    expect(
      Object.keys(value).sort(),
      `${label}: runtime keys vs the declared ${interfaceName}`,
    ).toEqual([...declaredMembers(interfaceName)].sort());
  }

  it("matches the collector, graph and evaluation shapes", () => {
    const { graph, result } = evaluateFixture({
      "client/application/app.ts": leaf,
    });
    expectShapeMatches(
      "CollectedReferences",
      collectModuleReferences("x.ts", leaf),
      "collector",
    );
    expectShapeMatches("DependencyGraph", graph, "graph");
    expectShapeMatches("GraphEvaluation", result, "evaluation");
  });

  it("returns the collector's candidates under the declared names", () => {
    const collected = collectModuleReferences(
      "client/application/app.ts",
      'export const title = document.title;\nexport const saved = localStorage.getItem("k");\n',
    );
    // The two candidate lists the program pass consumes. Reading them by the
    // declared names is the property the declaration-drift bug broke.
    expect(collected.browserGlobalCandidates.map((entry) => entry.name)).toEqual([
      "document",
      "localStorage",
    ]);
    expect(collected.callCandidates).toHaveLength(1);
  });

  it("carries the graph's call sites and ambient global uses", () => {
    const { graph } = evaluateFixture({
      "client/application/app.ts":
        'export const title = document.title;\nexport const store = {} as { setItem(k: string): void };\nstore.setItem("k");\n',
    });
    expect(graph.browserGlobalUses.map((entry) => entry.name)).toContain("document");
    expect(
      graph.callSites.some((site) => site.method === "setItem"),
      `no call site for setItem in ${JSON.stringify(graph.callSites)}`,
    ).toBe(true);
  });
});

// The capability-call rule. `classifyLayers` maps `client/components/` and
// `client/bindings/` to the same `bindings` layer, so these fixtures exist to
// pin the half of the judgement the layer set cannot express: the bridge may
// hold a writer factory, a component may not.
describe("the capability-call rule", () => {
  const storeContract =
    "export interface WebuiSessionStore { createSessionWriter(kind: string): void }\n";
  const transportContract =
    "export interface WebuiTransport { sendMessage(body: unknown): Promise<void> }\n";
  const caller = (contractPath: string, typeName: string, body: string) =>
    `import type { ${typeName} } from "${contractPath}";\n` +
    `export function use(port: ${typeName}): void {\n  ${body}\n}\n`;

  it("rejects a capability call from a component, whose layer is bindings", () => {
    const { result } = evaluateFixture({
      "client/application/session-store.ts": storeContract,
      "client/components/Widget.tsx": caller(
        "../application/session-store.js",
        "WebuiSessionStore",
        'port.createSessionWriter("session");',
      ),
    });
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      kind: "forbidden-call",
      file: "client/components/Widget.tsx",
      target: "WebuiSessionStore.createSessionWriter",
    });
    expect(result.pass).toBe(false);
  });

  it("rejects any method on a capability port from a component", () => {
    const { result } = evaluateFixture({
      "client/contracts/transport.ts": transportContract,
      "client/components/Widget.tsx": caller(
        "../contracts/transport.js",
        "WebuiTransport",
        "void port.sendMessage({});",
      ),
    });
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      file: "client/components/Widget.tsx",
      target: "WebuiTransport.sendMessage",
    });
  });

  it("keeps the same call allowed in the bindings bridge and in the application", () => {
    const { result } = evaluateFixture({
      "client/application/session-store.ts": storeContract,
      "client/bindings/use-session-state.ts": caller(
        "../application/session-store.js",
        "WebuiSessionStore",
        'port.createSessionWriter("session");',
      ),
      "client/application/turn-coordinator.ts": caller(
        "./session-store.js",
        "WebuiSessionStore",
        'port.createSessionWriter("session");',
      ),
    });
    expect(result.forbiddenCalls).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it("still rejects a capability call from a lower layer", () => {
    const { result } = evaluateFixture({
      "client/application/session-store.ts": storeContract,
      "client/mechanisms/stream-loop.ts": caller(
        "../application/session-store.js",
        "WebuiSessionStore",
        'port.createSessionWriter("session");',
      ),
    });
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      file: "client/mechanisms/stream-loop.ts",
      target: "WebuiSessionStore.createSessionWriter",
    });
  });

  // A capability method can be invoked without ever writing a property access.
  // The rule resolves the *invoked method's declaration*, so the form the call
  // was written in does not matter, and neither does the name of whatever the
  // caller held the method through.
  const portContract =
    "export interface SessionPort { deleteSession(id: string): Promise<void> }\n";
  const portCaller = (body: string, header = "") =>
    'import type { SessionPort } from "../contracts/session-port.js";\n' +
    `${header}export function use(port: SessionPort): Promise<void> {\n  ${body}\n}\n`;
  const invocationForms: ReadonlyArray<{ readonly label: string; readonly body: string }> = [
    { label: "an element access", body: 'return port["deleteSession"]("x");' },
    {
      label: "a destructured binding",
      body: 'const { deleteSession } = port;\n  return deleteSession("x");',
    },
    {
      label: "a renamed destructured binding",
      body: 'const { deleteSession: drop } = port;\n  return drop("x");',
    },
    {
      label: "a variable assigned the method",
      body: 'const drop = port.deleteSession;\n  return drop("x");',
    },
  ];

  for (const form of invocationForms) {
    it(`rejects a capability call through ${form.label}`, () => {
      const { result } = evaluateFixture({
        "client/contracts/session-port.ts": portContract,
        "client/projection/probe.ts": portCaller(form.body),
      });
      expect(result.forbiddenCalls).toHaveLength(1);
      expect(result.forbiddenCalls[0]).toMatchObject({
        file: "client/projection/probe.ts",
        target: "SessionPort.deleteSession",
      });
      expect(result.pass).toBe(false);
    });
  }

  it("rejects a capability call through a Pick alias of the port", () => {
    const { result } = evaluateFixture({
      "client/contracts/session-port.ts": portContract,
      "client/projection/probe.ts":
        'import type { SessionPort } from "../contracts/session-port.js";\n' +
        'type Commands = Pick<SessionPort, "deleteSession">;\n' +
        'export function use(commands: Commands): Promise<void> {\n' +
        '  return commands.deleteSession("x");\n}\n',
    });
    // The holder is called `Commands`, so only the declaration the property
    // resolves to can name the capability the call belongs to.
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      file: "client/projection/probe.ts",
      target: "SessionPort.deleteSession",
    });
  });

  // A capability call must be judged by whether it is *invoked*, not by whether
  // its result is awaited, chained or stored. When its result was consumed by a
  // chain (`port.m().then(cb)`), the call and the chain that wraps it started at
  // the same character; the resolving pass looked the candidate up by start
  // offset alone, recovered the *outer* chain, and judged `then` instead of `m`.
  // The capability call then went unjudged and was recorded twice. Each shape
  // below is anchored on the call's whole span so the nested call is recovered
  // whatever it is nested inside.
  const chainedForms: ReadonlyArray<{ readonly label: string; readonly body: string }> = [
    { label: "a .then chain", body: 'void port.sendMessage({}).then(() => {});' },
    { label: "a .catch chain", body: 'void port.sendMessage({}).catch(() => {});' },
    { label: "a .finally chain", body: 'void port.sendMessage({}).finally(() => {});' },
    {
      label: "an optional-call chain",
      body: 'void port?.sendMessage({}).then(() => {});',
    },
    {
      label: "an awaited capability call",
      body: 'return port.sendMessage({}).then(() => {});',
    },
    {
      label: "a capability call assigned to a variable",
      body: 'const pending = port.sendMessage({});\n  void pending;',
    },
  ];

  for (const form of chainedForms) {
    it(`rejects a capability call whose result is consumed by ${form.label}`, () => {
      const { result } = evaluateFixture({
        "client/contracts/transport.ts": transportContract,
        "client/components/Widget.tsx": caller(
          "../contracts/transport.js",
          "WebuiTransport",
          form.body,
        ),
      });
      expect(result.forbiddenCalls).toHaveLength(1);
      expect(result.forbiddenCalls[0]).toMatchObject({
        file: "client/components/Widget.tsx",
        target: "WebuiTransport.sendMessage",
      });
      expect(result.pass).toBe(false);
    });
  }

  it("rejects a chained capability call reached through a destructured binding", () => {
    // The binding form and the chained form together: the collector records a
    // bare-identifier callee, and the inner capability call is still nested in
    // the chain that consumes its result.
    const { result } = evaluateFixture({
      "client/contracts/transport.ts": transportContract,
      "client/components/Widget.tsx":
        'import type { WebuiTransport } from "../contracts/transport.js";\n' +
        'export function use(port: WebuiTransport): void {\n' +
        "  const { sendMessage } = port;\n" +
        "  void sendMessage({}).then(() => {});\n}\n",
    });
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      target: "WebuiTransport.sendMessage",
    });
    expect(result.pass).toBe(false);
  });

  it("judges a chained capability call once, not once per enclosing call", () => {
    // The duplicate-candidate symptom of the same defect: the inner call and
    // the chain that wraps it used to both resolve to the outer node, so the
    // site was recorded twice.
    const { graph } = evaluateFixture({
      "client/contracts/transport.ts": transportContract,
      "client/components/Widget.tsx": caller(
        "../contracts/transport.js",
        "WebuiTransport",
        'void port.sendMessage({}).then(() => {});',
      ),
    });
    expect(
      graph.callSites.filter((site) => site.method === "sendMessage"),
    ).toHaveLength(1);
  });

  it("keeps a chained call allowed in the bindings bridge and in the application", () => {
    // The control for the shapes above: the *same* chained shape is legal where
    // the capability is legitimately held, so the fixtures reject the chain
    // rather than the chain-shaped syntax.
    const { result } = evaluateFixture({
      "client/contracts/transport.ts": transportContract,
      "client/bindings/use-transport.ts":
        'import type { WebuiTransport } from "../contracts/transport.js";\n' +
        'export function use(port: WebuiTransport): void {\n' +
        "  void port.sendMessage({}).then(() => {});\n}\n",
      "client/application/send.ts":
        'import type { WebuiTransport } from "../contracts/transport.js";\n' +
        'export function use(port: WebuiTransport): void {\n' +
        "  void port.sendMessage({}).then(() => {});\n}\n",
    });
    expect(result.forbiddenCalls).toHaveLength(0);
    expect(result.pass).toBe(true);
  });

  it("keeps a same-named local function and an indexed lookup out of the rule", () => {
    // Resolving identifier calls must not turn every call named like a
    // capability method into a violation: a local function has no capability
    // declaration behind it, and an index signature has no member to resolve.
    const { result } = evaluateFixture({
      "client/components/Widget.tsx":
        'function deleteSession(id: string): void {\n  void id;\n}\n' +
        'export function use(): void {\n  deleteSession("x");\n}\n',
      "client/components/Table.tsx":
        'const handlers: Record<string, () => void> = { deleteSession: () => {} };\n' +
        'export function use(): void {\n  handlers["deleteSession"]();\n}\n',
    });
    expect(result.forbiddenCalls).toHaveLength(0);
    expect(result.pass).toBe(true);
  });
});

describe("the gate runs and matches the frozen baseline", () => {
  it("passes with all component browser globals routed through injected adapters", { timeout: 60_000 }, () => {
    const baseline = JSON.parse(readFileSync(realBaselinePath, "utf8"));
    const run = runCli(["--json"]);
    const summary = JSON.parse(run.stdout);
    expect(run.status).toBe(0);
    expect(summary.ok).toBe(true);
    expect(summary.browserGlobals).toHaveLength(0);
    expect(summary.baselinePairs).toBe((baseline.entries ?? []).length);
    expect(summary.cycles).toHaveLength((baseline.cycles ?? []).length);
    expect(summary.newViolations).toHaveLength(0);
    expect(summary.staleEntries).toHaveLength(0);
    expect(summary.newCycles).toHaveLength(0);
    expect(summary.staleCycles).toHaveLength(0);
  });

  it("fails on a stale baseline entry", { timeout: 60_000 }, () => {
    const baseline = JSON.parse(
      spawnSync(process.execPath, [
        "-e",
        `process.stdout.write(require("fs").readFileSync(${JSON.stringify(realBaselinePath)},"utf8"))`,
      ], { encoding: "utf8" }).stdout,
    );
    baseline.entries.push({
      from: "client/does-not-exist.ts",
      to: "client/also-missing.ts",
      layerFrom: "view",
      layerTo: "bindings",
      rule: "view -> bindings",
      category: "projection-to-components",
      stage: 1,
      reason: "synthetic stale entry for the stale-entry test",
    });
    const fixtureBaseline = path.join(
      mkdtempSync(path.join(os.tmpdir(), "webui-dependency-baseline-")),
      "baseline.json",
    );
    temporaryRoots.push(path.dirname(fixtureBaseline));
    writeFileSync(fixtureBaseline, JSON.stringify(baseline));
    const run = runCli(["--json", "--baseline", fixtureBaseline]);
    expect(run.status).toBe(1);
    const summary = JSON.parse(run.stdout);
    expect(summary.ok).toBe(false);
    expect(summary.staleEntries.map((entry: { from: string }) => entry.from)).toContain(
      "client/does-not-exist.ts",
    );
  });
});
