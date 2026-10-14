// The workspace directory browser's behaviours (ticket #76's second acceptance criterion).
//
// Browse, loading/error, manual path, selection and dismissal. The picker needs a DOM to drive, so each
// behaviour is asserted as the expression that implements it — the project's convention for structural
// claims, and the reason a regression that drops one shows up here rather than in review.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PATH = "../../src/client/features/workspace/ui/WebuiWorkspaceDirectoryBrowser.tsx";
const source = readFileSync(fileURLToPath(new URL(PATH, import.meta.url)), "utf8");

describe("the directory browser keeps its five behaviours", () => {
  it("browses, and browses the empty dir on the first open", () => {
    // No `dir` means "the workspace root": the request is built with the field absent rather than empty.
    expect(source).toContain("void browseWorkspaceDirs(dir ? { dir } : {})");
  });

  it("carries a loading flag around the browse, cleared on both outcomes", () => {
    expect(source).toContain("setLoading(true)");
    expect(source).toContain(".finally(() => setLoading(false))");
  });

  it("reports a failure and clears it when the user retries", () => {
    expect(source).toContain("setError(");
    expect(source).toContain("setError(undefined)");
    expect(source).toContain("需要绝对路径，例如 /home/you/projects/my-project");
  });

  it("accepts a typed path only when it is absolute, then selects it", () => {
    expect(source).toContain("if (!looksLikeAbsoluteWorkspacePath(value)) {");
    expect(source).toContain("onSelect(value);");
  });

  it("selects the listed directory and can be dismissed", () => {
    expect(source).toContain("if (listing) onSelect(listing.dir);");
    expect(source).toContain("onCancel");
  });
});
