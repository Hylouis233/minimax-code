// The WebUI role rules: who may reach whom, judged by ownership rather than by
// dependency direction (plan §5.1, §5.3; Spec decisions 20–22).
//
// The layer matrix cannot express these, and neither can a directory prefix:
// `client/components/composer/` and `client/features/composer/ui/` are the same
// presentation in two spellings, while `client/application/session-store.ts`
// (assembly) and `client/application/models/models-workflows.ts` (a business
// owner) share a prefix but not an owner. Every fixture below is built in a
// temporary tree and resolved by the same code path the CLI uses, so the
// assertion is about real AST resolution rather than a hand-built edge list.
//
// The positive fixtures matter as much as the negative ones: a rule that rejects
// everything is worthless, so each illegal case is paired with the legal shape it
// must keep allowing — a feature's own internals, a peer's published contracts,
// the composition root, and the reviewed entry a deliberate peer import needs.

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  ROLES,
  buildDependencyGraph,
  classifyRole,
  evaluateGraph,
  isPresentationRole,
  roleRule,
} from "../../../../scripts/lib/webui-dependency-rules.mjs";

// Resolution options for the synthetic trees, mirroring the client program
// (bundler resolution, `.js` specifiers onto `.ts`/`.tsx` sources).
const compilerOptions: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  allowImportingTsExtensions: true,
};

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

/** Writes a synthetic `${repositoryRoot}/packages/webui/src` tree and resolves it. */
function buildFixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "webui-role-"));
  temporaryRoots.push(root);
  const sourceRoot = path.join(root, "packages/webui/src");
  const absoluteFiles: string[] = [];
  for (const [relative, body] of Object.entries(files)) {
    const absolute = path.join(sourceRoot, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
    absoluteFiles.push(absolute);
  }
  return buildDependencyGraph({
    repositoryRoot: root,
    compilerOptions: { ...compilerOptions, baseUrl: sourceRoot },
    files: absoluteFiles,
  });
}

const leaf = "export const leaf = 1;\n";

/**
 * The `rule` of each violation, sorted, so an assertion names which judgement
 * fired rather than how many fired.
 */
function rulesOf(violations: readonly { readonly rule: string }[]): string[] {
  return violations.map((violation) => violation.rule).sort();
}

describe("the role classifier", () => {
  it("reads the same business and role from both spellings", () => {
    const spellings: ReadonlyArray<readonly [string, string, string | null]> = [
      ["client/features/composer/ui/WebuiComposer.tsx", "feature-ui", "composer"],
      ["client/components/composer/WebuiComposer.tsx", "feature-ui", "composer"],
      ["client/features/composer/application/submit.ts", "feature-application", "composer"],
      ["client/application/composer/composer-workflows.ts", "feature-application", "composer"],
      ["client/features/models/projection/groups.ts", "feature-projection", "models"],
      ["client/projection/models/groups.ts", "feature-projection", "models"],
      ["client/features/models/contracts/models-port.ts", "feature-contracts", "models"],
      ["client/contracts/models/models-port.ts", "feature-contracts", "models"],
      ["client/features/models/bindings/use-models.ts", "feature-bindings", "models"],
      ["client/features/models/ui/ModelPicker.tsx", "feature-ui", "models"],
    ];
    for (const [file, role, business] of spellings) {
      expect(classifyRole(file), file).toMatchObject({ role, business });
    }
  });

  it("separates the assembly, the shared mechanics and the moved homes from businesses", () => {
    expect(classifyRole("client/application/session-store.ts")).toEqual({
      role: "assembly",
      business: null,
      home: "current",
    });
    expect(classifyRole("client/contracts/transport.ts")).toMatchObject({
      role: "contracts-shared",
      business: null,
    });
    expect(classifyRole("client/projection/common/router.ts")).toMatchObject({
      role: "projection-common",
      business: null,
    });
    // The homes that move without changing what they are, so one rule holds
    // before and after the move.
    expect(classifyRole("client/infrastructure/transport.ts")).toMatchObject({
      role: "platform",
      home: "current",
    });
    expect(classifyRole("client/platform/transport.ts")).toMatchObject({
      role: "platform",
      home: "target",
    });
    expect(classifyRole("client/mechanisms/stream-lease.ts")).toMatchObject({
      role: "conversation",
      home: "current",
    });
    expect(classifyRole("client/conversation/stream-lease.ts")).toMatchObject({
      role: "conversation",
      home: "target",
    });
    expect(classifyRole("client/components/shell/WebuiClientFoundationApp.tsx")).toMatchObject({
      role: "shell",
      business: null,
    });
    expect(classifyRole("client/shell/FoundationApp.tsx")).toMatchObject({
      role: "shell",
      business: null,
    });
    expect(classifyRole("client/components/shared/ContextMenu.tsx")).toMatchObject({
      role: "ui",
      business: null,
    });
    expect(classifyRole("client/main.tsx")).toMatchObject({ role: "entry", business: null });
    expect(classifyRole("server/service.ts")).toMatchObject({ role: "outside", business: null });
    expect(classifyRole("client/mystery.ts")).toMatchObject({ role: "unknown" });
  });

  it("keeps every declared role reachable, so a typo cannot silently match nothing", () => {
    const produced = new Set(
      [
        "client/main.tsx",
        "client/application/session-store.ts",
        "client/conversation/stream-lease.ts",
        "client/features/a/contracts/port.ts",
        "client/features/a/application/workflows.ts",
        "client/features/a/projection/view.ts",
        "client/features/a/bindings/use-a.ts",
        "client/features/a/ui/A.tsx",
        "client/features/a/root.ts",
        "client/platform/transport.ts",
        "client/ui/Button.tsx",
        "client/shell/App.tsx",
        "client/bindings/use-session-state.ts",
        "client/projection/common/router.ts",
        "client/contracts/transport.ts",
        "client/styles/shell.css",
        "client/mystery.ts",
        "server/service.ts",
      ].map((file) => classifyRole(file).role),
    );
    expect([...produced].sort()).toEqual([...ROLES].sort());
  });

  it("treats both presentation spellings as presentation, and a bridge as not", () => {
    expect(isPresentationRole("client/components/composer/WebuiComposer.tsx")).toBe(true);
    expect(isPresentationRole("client/features/composer/ui/WebuiComposer.tsx")).toBe(true);
    expect(isPresentationRole("client/components/shell/WebuiClientFoundationApp.tsx")).toBe(true);
    expect(isPresentationRole("client/shell/FoundationApp.tsx")).toBe(true);
    expect(isPresentationRole("client/ui/Overlay.tsx")).toBe(true);
    expect(isPresentationRole("client/bindings/use-session-state.ts")).toBe(false);
    expect(isPresentationRole("client/features/composer/bindings/use-composer.ts")).toBe(false);
    expect(isPresentationRole("client/features/composer/application/submit.ts")).toBe(false);
  });
});

describe("the duplicate-owner rule", () => {
  it("rejects a business role held in both homes at once", () => {
    const graph = buildFixture({
      "client/components/composer/WebuiComposer.tsx": leaf,
      "client/features/composer/ui/WebuiComposer.tsx": leaf,
    });
    const { violations } = roleRule(graph, []);
    expect(rulesOf(violations)).toEqual(["duplicate-owner"]);
    expect(violations[0]?.detail).toContain("client/components/composer/WebuiComposer.tsx");
    expect(violations[0]?.detail).toContain("client/features/composer/ui/WebuiComposer.tsx");
  });

  it("rejects a duplicated contracts or application role too", () => {
    const graph = buildFixture({
      "client/contracts/models/models-port.ts": leaf,
      "client/features/models/contracts/models-port.ts": leaf,
      "client/application/goal/goal-coordinator.ts": leaf,
      "client/features/goal/application/goal-coordinator.ts": leaf,
    });
    expect(rulesOf(roleRule(graph, []).violations)).toEqual([
      "duplicate-owner",
      "duplicate-owner",
    ]);
  });

  it("keeps one owner per role, and each business's own roles, legal", () => {
    const graph = buildFixture({
      "client/features/composer/ui/WebuiComposer.tsx": leaf,
      "client/features/composer/application/submit.ts": leaf,
      "client/features/models/ui/ModelPicker.tsx": leaf,
      // A business still waiting to migrate keeps its current home while another
      // business has already moved: the rule compares business and role, so two
      // different businesses never collide across homes.
      "client/components/transcript/SessionTranscript.tsx": leaf,
      "client/application/models/models-workflows.ts": leaf,
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });

  it("reports a target home for a business that never had a current home", () => {
    // The rule is symmetric: a duplicate is two homes, whichever one arrived
    // second. A business whose target home appears while its current home still
    // exists is the migration leftover this gate is for.
    const graph = buildFixture({
      "client/projection/transcript/timestamps.ts": leaf,
      "client/features/transcript/projection/timestamps.ts": leaf,
    });
    expect(rulesOf(roleRule(graph, []).violations)).toEqual(["duplicate-owner"]);
  });
});

describe("the conversation substrate", () => {
  it("rejects conversation importing feature implementation", () => {
    const graph = buildFixture({
      "client/features/goal/application/goal-coordinator.ts": leaf,
      "client/conversation/history.ts":
        'import { leaf } from "../features/goal/application/goal-coordinator.js";\nexport const use = leaf;\n',
    });
    const { violations } = roleRule(graph, []);
    expect(rulesOf(violations)).toEqual(["role-import"]);
    expect(violations[0]?.detail).toContain("conversation may not import feature-application");
  });

  it("rejects the same import written as a type-only reference", () => {
    const graph = buildFixture({
      "client/features/goal/application/goal-coordinator.ts": leaf,
      "client/conversation/history.ts":
        'import type { WebuiGoalCoordinator } from "../features/goal/application/goal-coordinator.js";\n' +
        "export type Use = WebuiGoalCoordinator;\n",
    });
    expect(rulesOf(roleRule(graph, []).violations)).toEqual(["role-import"]);
  });

  it("rejects conversation reaching the assembly or the platform adapters", () => {
    const graph = buildFixture({
      "client/application/session-store.ts": leaf,
      "client/platform/transport.ts": leaf,
      "client/conversation/a.ts": 'export { leaf } from "../application/session-store.js";\n',
      "client/conversation/b.ts": 'export { leaf } from "../platform/transport.js";\n',
    });
    expect(roleRule(graph, []).violations).toHaveLength(2);
  });

  it("keeps conversation importing shared DTOs and a feature's published contracts", () => {
    const graph = buildFixture({
      "shared/contracts/turn.ts": leaf,
      "client/features/goal/contracts/goal-port.ts": leaf,
      "client/conversation/history.ts":
        'import { leaf } from "../../../shared/contracts/turn.js";\n' +
        'import type { WebuiGoalPort } from "../features/goal/contracts/goal-port.js";\n' +
        "export const use = leaf;\nexport type Port = WebuiGoalPort;\n",
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });
});

describe("presentation reaching for IO or an owner", () => {
  it("rejects a feature UI importing the platform adapter or the assembly", () => {
    const graph = buildFixture({
      "client/platform/transport.ts": leaf,
      "client/application/session-store.ts": leaf,
      "client/features/composer/ui/a.ts": 'export { leaf } from "../../../platform/transport.js";\n',
      "client/features/composer/ui/b.ts":
        'export { leaf } from "../../../application/session-store.js";\n',
    });
    expect(rulesOf(roleRule(graph, []).violations)).toEqual(["role-import", "role-import"]);
  });

  it("rejects the shell importing the platform adapter", () => {
    const graph = buildFixture({
      "client/platform/transport.ts": leaf,
      "client/shell/FoundationApp.tsx": 'export { leaf } from "../platform/transport.js";\n',
    });
    expect(rulesOf(roleRule(graph, []).violations)).toEqual(["role-import"]);
  });

  it("rejects the generic UI home reaching a business at all", () => {
    const graph = buildFixture({
      "client/features/models/ui/ModelPicker.tsx": leaf,
      "client/ui/Overlay.tsx": 'export { leaf } from "../features/models/ui/ModelPicker.js";\n',
    });
    const { violations } = roleRule(graph, []);
    expect(rulesOf(violations)).toEqual(["role-import"]);
    expect(violations[0]?.detail).toContain("ui may not import feature-ui");
  });

  it("keeps a feature's UI importing its own application and bindings roles", () => {
    const graph = buildFixture({
      "client/features/composer/application/workflows.ts": leaf,
      "client/features/composer/bindings/use-composer.ts":
        'export { leaf } from "../application/workflows.js";\n',
      "client/features/composer/ui/WebuiComposer.tsx":
        'export { leaf } from "../bindings/use-composer.js";\n',
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });

  it("keeps the shell composing a feature's public UI", () => {
    const graph = buildFixture({
      "client/features/transcript/ui/SessionTranscript.tsx": leaf,
      "client/shell/FoundationApp.tsx":
        'export { leaf } from "../features/transcript/ui/SessionTranscript.js";\n',
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });
});

describe("cross-business imports", () => {
  const goalOwner = { "client/features/goal/application/goal-coordinator.ts": leaf };
  const goalContracts = { "client/features/goal/contracts/goal-port.ts": leaf };

  it("allows a peer's published contracts without an entry", () => {
    const graph = buildFixture({
      ...goalContracts,
      "client/features/composer/application/submit.ts":
        'import type { WebuiGoalPort } from "../../goal/contracts/goal-port.js";\nexport type Port = WebuiGoalPort;\n',
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });

  it("rejects a peer's private owner, and the same import written as a type reference", () => {
    const value = buildFixture({
      ...goalOwner,
      "client/features/composer/application/submit.ts":
        'import { leaf } from "../../goal/application/goal-coordinator.js";\nexport const use = leaf;\n',
    });
    expect(rulesOf(roleRule(value, []).violations)).toEqual(["private-peer-import"]);

    const typed = buildFixture({
      ...goalOwner,
      "client/features/composer/application/submit.ts":
        'import type { WebuiGoalCoordinator } from "../../goal/application/goal-coordinator.js";\n' +
        "export type Use = WebuiGoalCoordinator;\n",
    });
    expect(rulesOf(roleRule(typed, []).violations)).toEqual(["private-peer-import"]);
  });

  it("rejects a peer import of a still-current home, so a partial migration is judged too", () => {
    const graph = buildFixture({
      "client/application/goal/goal-coordinator.ts": leaf,
      "client/features/composer/application/submit.ts":
        'export { leaf } from "../../../application/goal/goal-coordinator.js";\n',
    });
    const { violations } = roleRule(graph, []);
    expect(rulesOf(violations)).toEqual(["private-peer-import"]);
    expect(violations[0]?.detail).toContain("client/application/goal/goal-coordinator.ts");
  });

  it("accepts a deliberate peer import once it is reviewed, and only for that pair", () => {
    const graph = buildFixture({
      ...goalOwner,
      "client/features/composer/application/submit.ts":
        'import { leaf } from "../../goal/application/goal-coordinator.js";\nexport const use = leaf;\n',
      "client/features/composer/ui/Composer.tsx":
        'import { leaf } from "../../goal/application/goal-coordinator.js";\nexport const use = leaf;\n',
    });
    const approved = [
      {
        from: "client/features/composer/application/submit.ts",
        to: "client/features/goal/application/goal-coordinator.ts",
        reason: "the goal owner is the only writer of the goal slice",
      },
    ];
    const { violations } = roleRule(graph, approved);
    // The reviewed pair is accepted; the second file is not covered by it, which
    // is what stops one entry from becoming an exemption for the whole business.
    expect(rulesOf(violations)).toEqual(["private-peer-import"]);
    expect(violations[0]?.from).toBe("client/features/composer/ui/Composer.tsx");
  });

  it("rejects an approval whose edge is gone, and one naming a deleted file", () => {
    const graph = buildFixture({
      "client/features/composer/application/submit.ts": leaf,
      "client/features/goal/application/goal-coordinator.ts": leaf,
    });
    const { violations } = roleRule(graph, [
      {
        from: "client/features/composer/application/submit.ts",
        to: "client/features/goal/application/goal-coordinator.ts",
        reason: "no longer imported",
      },
      {
        from: "client/features/composer/application/gone.ts",
        to: "client/features/goal/application/deleted.ts",
        reason: "file removed by a rename",
      },
    ]);
    expect(rulesOf(violations)).toEqual(["stale-peer-approval", "stale-peer-approval"]);
    expect(violations[0]?.detail).toContain("no longer measured");
    expect(violations[1]?.detail).toContain("no longer exists");
  });

  it("keeps the entry and the assembly out of the peer rule", () => {
    // `client/main.tsx` is the composition root and the assembly constructs the
    // owners, so a feature-private destination is legal for them; their own
    // contract is expressed by the roles `entry` and `assembly`, not by an
    // approval entry.
    const graph = buildFixture({
      "client/features/composer/ui/WebuiComposer.tsx": leaf,
      "client/features/composer/application/submit.ts": leaf,
      "client/main.tsx": 'export { leaf } from "./features/composer/ui/WebuiComposer.js";\n',
      "client/application/create-application.ts":
        'export { leaf } from "../features/composer/application/submit.js";\n',
    });
    expect(roleRule(graph, []).violations).toEqual([]);
  });
});

describe("the call-site rule follows the role, not the prefix", () => {
  const composerPort =
    "export interface ComposerPort { submitTurn(body: unknown): Promise<void> }\n";
  const caller = (contractPath: string, body: string) =>
    `import type { ComposerPort } from "${contractPath}";\n` +
    `export function use(port: ComposerPort): void {\n  ${body}\n}\n`;

  it("rejects a capability call from a feature's UI in its target home", () => {
    const graph = buildFixture({
      "client/features/composer/contracts/composer-port.ts": composerPort,
      "client/features/composer/ui/ComposerPanel.tsx": caller(
        "../contracts/composer-port.js",
        "void port.submitTurn({});",
      ),
    });
    const result = evaluateGraph(graph);
    expect(result.forbiddenCalls).toHaveLength(1);
    expect(result.forbiddenCalls[0]).toMatchObject({
      file: "client/features/composer/ui/ComposerPanel.tsx",
      target: "ComposerPort.submitTurn",
    });
    expect(result.pass).toBe(false);
  });

  it("rejects the capability however presentation got hold of it", () => {
    // A port passed as a prop, a prop renamed, and a method lifted into a local
    // all resolve to the same declaration, so the shape of the hand-off does not
    // decide the judgement.
    const forms: ReadonlyArray<readonly [string, string]> = [
      ["the port prop itself", "void port.submitTurn({});"],
      [
        "a destructured method",
        "const { submitTurn } = port;\n  void submitTurn({});",
      ],
      [
        "a method lifted into a local",
        "const submit = port.submitTurn;\n  void submit({});",
      ],
    ];
    for (const [label, body] of forms) {
      const graph = buildFixture({
        "client/features/composer/contracts/composer-port.ts": composerPort,
        "client/features/composer/ui/ComposerPanel.tsx": caller(
          "../contracts/composer-port.js",
          body,
        ),
      });
      expect(
        evaluateGraph(graph).forbiddenCalls.map((violation) => violation.target),
        label,
      ).toEqual(["ComposerPort.submitTurn"]);
    }
  });

  it("keeps a plain callable prop legal", () => {
    // The rule rejects a capability reached with its own declaration behind it,
    // not callables in general: a component that submits through a callback it
    // was given is the shape the target design asks for.
    const graph = buildFixture({
      "client/features/composer/ui/ComposerPanel.tsx":
        "export function use(onSubmit: (body: unknown) => Promise<void>): void {\n" +
        "  void onSubmit({});\n}\n",
    });
    expect(evaluateGraph(graph).forbiddenCalls).toEqual([]);
    expect(evaluateGraph(graph).pass).toBe(true);
  });

  it("keeps a feature's bindings and application free to hold the capability", () => {
    const graph = buildFixture({
      "client/features/composer/contracts/composer-port.ts": composerPort,
      "client/features/composer/bindings/use-composer.ts": caller(
        "../contracts/composer-port.js",
        "void port.submitTurn({});",
      ),
      "client/features/composer/application/submit.ts": caller(
        "../contracts/composer-port.js",
        "void port.submitTurn({});",
      ),
    });
    expect(evaluateGraph(graph).forbiddenCalls).toEqual([]);
  });

  it("rejects a writer factory held by presentation, in either spelling", () => {
    const store =
      "export interface WebuiSessionStore { createSessionWriter(kind: string): void }\n";
    const graph = buildFixture({
      "client/application/session-store.ts": store,
      "client/components/composer/WebuiComposer.tsx":
        'import type { WebuiSessionStore } from "../../application/session-store.js";\n' +
        'export function use(store: WebuiSessionStore): void {\n  store.createSessionWriter("session");\n}\n',
      "client/features/composer/ui/WebuiComposer.tsx":
        'import type { WebuiSessionStore } from "../../../application/session-store.js";\n' +
        'export function use(store: WebuiSessionStore): void {\n  store.createSessionWriter("session");\n}\n',
    });
    expect(
      evaluateGraph(graph)
        .forbiddenCalls.map((violation) => violation.file)
        .sort(),
    ).toEqual([
      "client/components/composer/WebuiComposer.tsx",
      "client/features/composer/ui/WebuiComposer.tsx",
    ]);
  });
});
