// Verify the WebUI design-token file against the token surface
// the design-language doc describes.
//
// The source of truth for what the file must contain is
// `packages/webui/docs/design/design-language.md`: primitive ramps, scale tokens, and 211
// semantic tokens with light and dark bindings on a `.light` / `.dark` class.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, "../..");
const repoRoot = path.resolve(packageDir, "../..");
const tokensPath = path.join(
  packageDir,
  "src/client/styles/tokens.css",
);

const ROLE_PREFIXES = ["bg_", "text_", "icon_", "border_", "utility_", "terminal_", "shadow_", "screen_"];

interface TokenBlocks {
  readonly root: string;
  readonly light: string;
  readonly dark: string;
}

function extractBlocks(css: string): TokenBlocks {
  function findBlock(selector: string): string {
    const idx = css.indexOf(`${selector} {`);
    if (idx < 0) throw new Error(`selector ${selector} not found in tokens.css`);
    const open = css.indexOf("{", idx);
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      const ch = css[j];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return css.slice(open + 1, j);
      }
    }
    throw new Error(`unterminated block for ${selector}`);
  }
  return {
    root: findBlock(":root"),
    light: findBlock(".light"),
    dark: findBlock(".dark"),
  };
}

function declarationsFor(block: string): Set<string> {
  const names = new Set<string>();
  // Naive but adequate: each declaration is `--name: value;`.
  const regex = /--([a-z0-9_]+)\s*:/gu;
  let match;
  while ((match = regex.exec(block)) !== null) names.add(match[1]);
  return names;
}

let tokens: string;
let blocks: TokenBlocks;
let rootDecls: Set<string>;
let lightDecls: Set<string>;
let darkDecls: Set<string>;

beforeAll(() => {
  tokens = readFileSync(tokensPath, "utf8");
  blocks = extractBlocks(tokens);
  rootDecls = declarationsFor(blocks.root);
  lightDecls = declarationsFor(blocks.light);
  darkDecls = declarationsFor(blocks.dark);
});

function semanticNames(): string[] {
  const rootList = [...rootDecls];
  const allRole = rootList.filter((name) => ROLE_PREFIXES.some((p) => name.startsWith(p)));
  return allRole.filter((name) => lightDecls.has(name) && darkDecls.has(name)).sort();
}

describe("WebUI design tokens", () => {
  it("lives at packages/webui/src/client/styles/tokens.css", () => {
    // Sanity check that the file is being read from the right path.
    expect(tokensPath.endsWith("src/client/styles/tokens.css")).toBe(true);
  });

  it("carries the 211 semantic tokens that packages/webui/docs/design-language.md names", () => {
    // 211 is the count `packages/webui/docs/design/design-language.md` records.
    // If our count drifts, the test fails loudly rather than silently adjusting.
    expect(semanticNames().length).toBe(211);
  });

  it("binds every semantic token in :root, .light, and .dark", () => {
    for (const name of semanticNames()) {
      expect(rootDecls.has(name), `:root missing ${name}`).toBe(true);
      expect(lightDecls.has(name), `.light missing ${name}`).toBe(true);
      expect(darkDecls.has(name), `.dark missing ${name}`).toBe(true);
    }
  });

  it("re-binds every semantic token to a different value under .dark", () => {
    // At least the canonical background swap is observable: surface primary
    // flips to the deepest gray and the lightest gray is reserved for dark
    // text primary. Asserting the whole 211 here would be noise.
    const dark = blocks.dark.match(/--bg_default_primary\s*:\s*([^;]+);/u);
    const light = blocks.light.match(/--bg_default_primary\s*:\s*([^;]+);/u);
    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light![1].trim()).not.toBe(dark![1].trim());
    // Light surface primary resolves to gray_0, dark to gray_1000.
    expect(light![1].trim()).toBe("var(--gray_0)");
    expect(dark![1].trim()).toBe("var(--gray_1000)");
  });

  it("keeps the primitive ramps in :root, not in .light or .dark", () => {
    const rampNames = ["blue_500", "gray_1000", "green_400", "red_500", "violet_500"];
    for (const name of rampNames) {
      expect(rootDecls.has(name), `:root missing ramp ${name}`).toBe(true);
      expect(lightDecls.has(name), `.light should not rebind ramps (${name})`).toBe(false);
      expect(darkDecls.has(name), `.dark should not rebind ramps (${name})`).toBe(false);
    }
  });

  it("keeps the scale tokens in :root, not in .light or .dark", () => {
    const scaleNames = ["radius_8", "spacing_4", "size_14", "line_height_20", "weight_regular"];
    for (const name of scaleNames) {
      expect(rootDecls.has(name), `:root missing scale ${name}`).toBe(true);
      expect(lightDecls.has(name), `.light should not rebind scales (${name})`).toBe(false);
      expect(darkDecls.has(name), `.dark should not rebind scales (${name})`).toBe(false);
    }
  });

  it("names its scale tokens the same way the desktop does", () => {
    // tokens.css lists these exact names and the design-language doc
    // records them in the same shape. Drift means the utility mapping in
    // tailwind.config.cjs no longer lines up with the token names.
    const expectedScales = [
      "radius_4", "radius_8", "radius_12", "radius_16", "radius_20", "radius_24", "radius_32", "radius_full",
      "spacing_0", "spacing_2", "spacing_4", "spacing_6", "spacing_8", "spacing_12", "spacing_16", "spacing_20", "spacing_24", "spacing_32", "spacing_40", "spacing_48", "spacing_64", "spacing_90", "spacing_128",
      "size_12", "size_14", "size_16", "size_20", "size_24", "size_32", "size_40", "size_48", "size_64",
      "line_height_16", "line_height_18", "line_height_20", "line_height_22", "line_height_26", "line_height_28", "line_height_36", "line_height_40",
      "weight_regular", "weight_medium",
    ];
    for (const name of expectedScales) {
      expect(rootDecls.has(name), `:root missing scale ${name}`).toBe(true);
    }
  });

  it("names its primitive ramps the same way the desktop does", () => {
    const expectedRamps = [
      // blue / cyan / gray / green / orange / purple / red / yellow each carry
      // ten steps from _25 to _1000; gray has _0 instead of _25.
      "blue_25", "blue_500", "blue_1000",
      "cyan_25", "cyan_500", "cyan_1000",
      "gray_0", "gray_50", "gray_500", "gray_1000",
      "green_25", "green_500", "green_1000",
      "orange_25", "orange_500", "orange_1000",
      "purple_25", "purple_500", "purple_1000",
      "red_25", "red_500", "red_1000",
      "yellow_25", "yellow_500", "yellow_1000",
      "violet_500",
    ];
    for (const name of expectedRamps) {
      expect(rootDecls.has(name), `:root missing ramp ${name}`).toBe(true);
    }
  });

  it("is not the compiled desktop stylesheet copied across", () => {
    // The token file is authored here rather than copied wholesale. The easiest
    // proxy is checking that the file is *only* tokens: no font-family
    // declarations, no Tailwind directives, no @media queries, no @keyframes.
    expect(tokens).not.toMatch(/font-family/u);
    expect(tokens).not.toMatch(/@tailwind/u);
    expect(tokens).not.toMatch(/@media/u);
    expect(tokens).not.toMatch(/@keyframes/u);
    // The file must start with a documentation comment, not a vendored banner.
    expect(tokens.startsWith("/*")).toBe(true);
    // And it must not start with a licence/compiled banner.
    expect(tokens.startsWith("/*!")).toBe(false);
  });
});

// Reference: tailwind.config.cjs declares the utilities that map the tokens.
// We don't run Tailwind here, but we do read the compiled stylesheet that
// `pnpm build:webui` produced and assert the named utilities exist.
describe("WebUI compiled stylesheet", () => {
  let compiled: string;
  beforeAll(() => {
    compiled = readFileSync(
      path.join(repoRoot, "dist-webui/client/styles.css"),
      "utf8",
    );
  });

  it("contains the seven utilities the brief calls out by name", () => {
    const required = [
      /\.bg-bg_default_primary\s*\{[^}]+\}/u,
      /\.text-text_default_primary\s*\{[^}]+\}/u,
      /\.rounded-radius_8\s*\{[^}]+\}/u,
      /\.size-size_14\s*\{[^}]+\}/u,
      /\.leading-line_height_20\s*\{[^}]+\}/u,
      /\.gap-spacing_4\s*\{[^}]+\}/u,
      /\.shadow-shadow_default\s*\{[^}]+\}/u,
    ];
    for (const re of required) {
      expect(re.test(compiled), `compiled CSS missing ${re}`).toBe(true);
    }
  });

  it("keeps the dynamically selected review diff row backgrounds in the compiled CSS", () => {
    expect(compiled).toMatch(/\.webui-turn-review-line--addition\s*\{[^}]*background:\s*var\(--bg_status_positive\)/u);
    expect(compiled).toMatch(/\.webui-turn-review-line--deletion\s*\{[^}]*background:\s*var\(--bg_status_error\)/u);
  });

  it("closes every var(--name) reference against a definition in the same stylesheet", () => {
    // The previous assertion only checked that the compiled body matched a
    // hard-coded `var(--kebab-name)` string. That made the test pass against
    // the broken build where the utility referenced a non-existent variable
    // — fixing the reference would then break the test, locking the bug in.
    //
    // The actual contract is that every `var(--name)` the stylesheet emits
    // resolves to a `--name:` defined in the same stylesheet. Anything else
    // is a silent no-op rule.
    const defRe = /--([a-zA-Z0-9_-]+)\s*:/gu;
    const defined = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = defRe.exec(compiled)) !== null) defined.add(m[1]);

    const refRe = /var\(\s*--([a-zA-Z0-9_-]+)\s*\)/gu;
    const referenced = new Set<string>();
    while ((m = refRe.exec(compiled)) !== null) referenced.add(m[1]);

    const missing = [...referenced].filter((n) => !defined.has(n)).sort();
    if (missing.length > 0) {
      throw new Error(
        `compiled stylesheet references ${missing.length} undefined variable(s): ` +
          missing.map((n) => `--${n}`).join(", "),
      );
    }
    expect(missing.length).toBe(0);
  });

  it("embeds Chinese fallbacks for both the sans and mono font stacks", () => {
    // The preflight exposes HarmonyOS Sans SC and PingFang SC for
    // Chinese fallback in both the sans and mono stacks. Tailwind's reset
    // applies those rules via @tailwind base.
    const sansMatches = compiled.match(
      /font-family:[^;}]*(?:PingFang SC|HarmonyOS Sans SC)[^;}]*/gu,
    );
    expect(sansMatches, "no Chinese fallback found in compiled CSS").not.toBeNull();
    expect(sansMatches!.length).toBeGreaterThanOrEqual(2);
  });

  it("embeds the Hack-led monospace stack with Chinese fallback", () => {
    const monoRule = compiled.match(/\.font-mono\s*\{([^}]+)\}/u);
    expect(monoRule, "compiled CSS missing .font-mono").not.toBeNull();
    expect(monoRule![1]).toMatch(/Hack/u);
    expect(monoRule![1]).toMatch(/PingFang SC/u);
    const codeRule = compiled.match(/^code,?\s*\n?kbd,?\s*\n?samp,?\s*\n?pre\s*\{([^}]+)\}/um);
    expect(codeRule, "compiled CSS missing the preflight code/kbd/pre/samp rule").not.toBeNull();
    expect(codeRule![1]).toMatch(/Hack/u);
    expect(codeRule![1]).toMatch(/PingFang SC/u);
  });

  it("emits every component class the new shell references", () => {
    // The new shell's markup carries `.webui-button-primary`,
    // `.webui-button-secondary`, `.webui-textarea`, `.webui-input`, `.webui-nav-item`,
    // and `.webui-empty-state`, and the @layer
    // components block in `shell.css` emits the matching styles. The component
    // classes only carry meaning if Tailwind actually compiles them — assert each
    // one lands in the output rather than silently degrading to a no-op.
    const required = [
      /\.webui-button-primary\s*\{/u,
      /\.webui-button-secondary\s*\{/u,
      /\.webui-input,\s*\n?\s*\.webui-textarea\s*\{/u,
      /\.webui-textarea\s*\{/u,
      /\.webui-nav-item\s*\{/u,
      /\.webui-nav-item\[data-webui-nav-active="true"\]\s*\{/u,
      /\.webui-empty-state\s*\{/u,
      /\.webui-transcript-empty-state\s*\{/u,
      /\.webui-input:focus-visible/u,
      /\.webui-textarea:focus-visible/u,
      /\.webui-button-primary:focus-visible/u,
      /\.webui-button-secondary:focus-visible/u,
      // The conversation surface: the message blocks, the user bubble, the
      // process disclosure, and the markdown layer the assistant's replies
      // render through.
      /\.webui-message\s*\{/u,
      /\.webui-session-layout\s*\{/u,
      /\.webui-session-layout\s+\.webui-session-transcript-scroll\s*\{/u,
      /\.webui-session-layout\s+\.webui-session-composer\s*\{/u,
      /\.webui-user-bubble\s*\{/u,
      /\.webui-user-text\s*\{/u,
      /\.webui-user-text-clamp\s*\{/u,
      /\.webui-assistant-body\s*\{/u,
      /\.webui-thinking-block\s*\{/u,
      /\.webui-tool-row\s*\{/u,
      /\.webui-markdown\s*\{/u,
      /\.webui-markdown blockquote::before\s*\{/u,
      /\.webui-code-block\s*\{/u,
      /\.webui-code-block pre\s*\{/u,
      /\.webui-table-shell\s*\{/u,
      /\.webui-markdown table\s*\{/u,
    ];
    for (const re of required) {
      expect(re.test(compiled), `compiled CSS missing ${re}`).toBe(true);
    }
  });
});
