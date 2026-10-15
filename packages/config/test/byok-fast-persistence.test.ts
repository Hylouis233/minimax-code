import { describe, expect, it } from "vitest";
import { parseCustomProvidersConfig } from "../src/byok-config.js";

describe("BYOK Fast configuration normalization", () => {
  it("preserves explicit Fast independently when normalizing legacy reasoning", () => {
    const raw = {
      fixture: {
        api: "openai-responses",
        models: {
          synthetic: {
            fast: { enabled: true, mode: "openai-priority" },
            thinking: { effort: "ultra", defaultEffort: "max" },
          },
        },
      },
    };
    const parsed = parseCustomProvidersConfig(raw);
    expect(parsed?.fixture?.models?.synthetic).toMatchObject({
      fast: { enabled: true, mode: "openai-priority" },
      thinking: { effortOptions: ["ultra", "max"], defaultEffort: "max" },
    });
    expect(raw.fixture.models.synthetic.thinking.effort).toBe("ultra");
    expect(
      parseCustomProvidersConfig(JSON.parse(JSON.stringify(parsed))),
    ).toEqual(parsed);
  });
});
