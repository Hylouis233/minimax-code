// Unit tests for the settings workflow owner (ticket #52).
//
// The owner is framework-free, so these run the real decision logic the
// settings dialog delegates to: that a superseded read is dropped rather than
// applied over a newer one, and that a successful write invalidates exactly the
// caches it affects.
//
// The catalogue, the selection and the provider list are `models`' owner since
// the §5.6 carve, so their cases live in `models-workflows.test.ts`.

import { describe, expect, it } from "vitest";

import { createWebuiSettingsWorkflows } from "../../src/client/application/settings/settings-workflows.js";
import type { WebuiGlobalInstructionsView } from "../../src/shared/contracts/personalization.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const instructions = (content: string): WebuiGlobalInstructionsView => ({
  content,
  exists: true,
  path: "/data/AGENTS.md",
  maxBytes: 32 * 1024,
});

describe("the settings owner discards a superseded read", () => {
  it("keeps the newest instructions answer when an older one lands later", async () => {
    let resolveFirst: (value: WebuiGlobalInstructionsView) => void = () => undefined;
    let call = 0;
    const workflows = createWebuiSettingsWorkflows({
      port: {
        getGlobalInstructions: () => {
          call += 1;
          if (call === 1) {
            return new Promise<WebuiGlobalInstructionsView>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve(instructions("second"));
        },
      },
    });

    void workflows.loadInstructions();
    await workflows.loadInstructions();
    resolveFirst(instructions("first"));
    await flush();

    expect(workflows.getSnapshot().instructions.value?.content).toBe("second");
  });

  it("records an unavailable capability as one error, not a silent empty", async () => {
    const workflows = createWebuiSettingsWorkflows({ port: {} });
    await workflows.loadInstructions();
    expect(workflows.getSnapshot().instructions).toEqual({
      status: "error",
      error: "当前运行时不支持自定义指令读写。",
    });
  });
});

describe("a settings write invalidates exactly what it affects", () => {
  it("refreshes the cached read and bumps the revision on save", async () => {
    let stored = "old";
    const workflows = createWebuiSettingsWorkflows({
      port: {
        getGlobalInstructions: async () => instructions(stored),
        setGlobalInstructions: async ({ content }) => {
          stored = content;
          return instructions(content);
        },
      },
    });

    await workflows.loadInstructions();
    expect(workflows.getSnapshot().instructions.value?.content).toBe("old");
    const before = workflows.getSnapshot().revision;

    await workflows.saveInstructions("new");
    expect(workflows.getSnapshot().instructions.value?.content).toBe("new");
    expect(workflows.getSnapshot().revision).toBe(before + 1);
  });

  it("surfaces a write against an unwired capability as an error", async () => {
    const workflows = createWebuiSettingsWorkflows({ port: {} });
    await expect(workflows.saveInstructions("x")).rejects.toThrow(
      "当前运行时不支持自定义指令读写。",
    );
  });
});

