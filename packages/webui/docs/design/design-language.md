# Design language

The WebUI's own design language: one token surface, one theme mechanism, one typographic stack, and
the layout conventions the shell follows. `src/client/styles/tokens.css` is the shipped authority for
every value; this document describes the structure around it and what `test/unit/webui-design-tokens.test.ts`
asserts.

## Token architecture

Three layers, all plain custom properties.

**1. Primitive ramps.** Ten-step ramps `--<hue>_25` … `--<hue>_1000` for `blue`, `cyan`, `gray`,
`green`, `orange`, `purple`, `red`, `yellow`, plus a single `--violet_500`, and the opacity ramps
`--opacity_black_1_*` and `--opacity_white_0_*`.

**2. Scale tokens.**

| Group | Tokens |
| --- | --- |
| Radius | `--radius_4` `_8` `_12` `_16` `_20` `_24` `_32` `_full` |
| Spacing | `--spacing_0` `_2` `_4` `_6` `_8` `_12` `_16` `_20` `_24` `_32` `_40` `_48` `_64` `_90` `_128` |
| Type size | `--size_12` `_14` `_16` `_20` `_24` `_32` `_40` `_48` `_64` |
| Line height | `--line_height_16` `_18` `_20` `_22` `_26` `_28` `_36` `_40` |
| Weight | `--weight_regular` `--weight_medium` |

**3. Semantic tokens.** 211 of them, named `<role>_<group>_<component>_<state>`:

- roles `bg`, `text`, `icon`, `border`, `utility`, `terminal`, `shadow`, `screen`
- groups `default`, `grouped`, `interaction`, `label`, `status`
- states `default`, `hover`, `press`, `inactive`, `selected`, `focus`, `elevated`

Representative names: `bg_default_primary`, `bg_grouped_secondary`,
`bg_interaction_primary_hover`, `text_default_tertiary`, `text_label_danger_primary_press`,
`icon_interaction_accent_selected`, `border_status_warning`, `utility_popover`, `utility_scrim`,
`terminal_ansi_bright_magenta`, `shadow_default`.

## Theme mechanism

`:root` carries the ramps and the light values. `.light` and `.dark` each rebind the semantic tokens,
and neither block contains anything but custom properties, so either can be lifted whole. The
rebinding is a swap onto the ramps:

| Token | Light | Dark |
| --- | --- | --- |
| `--bg_default_primary` | `var(--gray_0)` | `var(--gray_1000)` |
| `--bg_default_secondary` | `var(--gray_75)` | `var(--gray_900)` |
| `--text_default_primary` | `var(--gray_1000)` | `var(--gray_100)` |
| `--text_default_secondary` | `var(--gray_500)` | `var(--gray_400)` |
| `--border_default` | `var(--opacity_black_1_8)` | `var(--opacity_white_0_8)` |
| `--utility_popover` | `var(--opacity_black_1_90)` | `var(--opacity_white_0_95)` |

Which of the two is applied comes from one derivation
(`client/features/settings/projection/settings-view.ts`); the preference is applied as a class on a
root element.

## Typography

The stack is declared in `tailwind.config.cjs`; no font file is bundled for it, so the browser
resolves system faces:

- **Sans**: `HarmonyOS Sans`, then `Segoe UI` / `SF Pro Display` and the system stack, with
  `HarmonyOS Sans SC` / `PingFang SC` for Chinese.
- **Mono**: `Hack`, then `ui-monospace` / `SFMono-Regular` / `SF Mono` / `Menlo` / `Consolas`.
- `shell.css` carries one local `ui-monospace` fallback chain for the terminal surface.

KaTeX is the only bundled font family (`src/client/assets/fonts/katex/`, 20 ttf + 20 woff + 20 woff2
+ `LICENSE.katex-fonts`), and it is bundled because `katex/dist/katex.min.css` needs it.

## Utility naming

The stylesheet is Tailwind, configured so token names become utility names: `bg-bg_default_primary`,
`text-text_default_primary`, `border-border_default`, `rounded-radius_8`, `size-size_14`,
`leading-line_height_20`, `gap-spacing_4`, `shadow-shadow_default`. Roughly a thousand token-derived
utilities appear in the compiled output alongside the ordinary layout utilities, so a component is
styled with the same names the token file declares.

## Layout

- Two columns: a left rail at roughly 18% of the width on a surface one step darker than the main
  one, and the main surface at the lightest step.
- The conversation surface is a vertical stack: generous space at the top, the centred brand welcome
  as the visual anchor, the composer low on the screen.
- The composer is a large-radius field (16–20px) with a near-invisible 1px border, a leading attach
  button, a trailing model selector, and a solid dark circular send button — the highest-contrast
  element on the screen.
- Below it, a one-step-darker capsule row carries the workspace picker and a local tag; below that, a
  row of outlined suggestion chips.
- The emphasis colour is the bright blue from the ramp, used sparingly: a link, the accent bar on a
  card, small badges.
- The model picker opens one popup with two states, and it is the only place a thinking level is
  set. The panel names the level in the accent blue above the model name, the model name opens the
  catalogue grouped by provider, and the level is a blue rail with a white thumb whose stops are the
  model's own. A white thumb on a blue rail is the only such control in the client, and it stays
  that way: a second control for the same state is a second thing to disagree with the first.
- Density is low: menu rows sit around 13–14px with 12–14px gaps, and the composer is surrounded by
  empty space.
- The settings pages share one skeleton: `client/ui/settings-layout.tsx` renders the page column
  (704px, centred), the section title, the grouped-surface card and the row, and every settings
  page — including the code-review page the settings panel shows — renders that frame instead of
  a copy of it. A settings page brings its own content, never its own frame.
- The 用量与模型 page names the account's plan, it does not name a product: the plan name, the
  model-source label and the 限额重置 section all follow the account's own answer
  (`features/settings/projection/usage-plan.ts` and `features/settings/ui/UsageResetCards.tsx`).
  A hard-coded plan name is a bug, not a default — the legacy "Token Plan" label belongs to the
  legacy `token_plan` subscription kind alone.
- The settings pages share their controls too, not only their frame: `features/settings/ui/settings-atoms.tsx`
  owns the page's button (`SettingsButton`, with a `compact` size for a row action) and its dialog
  (`SettingsDialog` — a scrim, a surface, a header and a scrolling body). A control that each page
  re-authors is a control that drifts, and the first drift of a border was four cards that read as
  four separate products inside one section.

## Styling rules

- **One stylesheet.** `src/client/styles/index.css` is the only compiled entry; every other
  stylesheet is `@import`ed into it, including per-business CSS from `features/<business>/ui/`. Do
  not add a second `<link>` in `index.html`.
- **Business-owned styles live with the business**: `features/<business>/ui/<business>.css`. Shared
  shell and token authority stays in `client/styles/`.
- **Two stacked generations keep the *effective* declaration**, not the later block, and rules that
  differ in at-rule context (`@media`, `@container`) are conditional overrides, not duplicates. The
  compiled stylesheet's hash is expected to move when shadowed declarations are dropped.
- **CSS is compiled by `pnpm build:webui`** (or `pnpm --filter @mavis/webui build:styles` alone)
  through Tailwind + `postcss-import`; the dev server consumes the same artifact.
- **Math is rendered from marked tokens, never by scanning the DOM.** `features/transcript/ui/markdown.tsx`
  registers a marked extension that emits `katex.renderToString(...)` for `$…$` and `$$…$$`.
  `katex/contrib/auto-render` must not be introduced, and the KaTeX stylesheet must keep arriving
  through the single compiled entry rather than a second link.

## Assets

- `client/assets/img/` holds the marks and illustrations the shell, the settings pages and the
  account panel use; `client/assets/lottie/` the animated ones; `client/assets/fonts/` the bundled
  font family.
- Assets and styles in this package are authored here and reviewed as part of this repository's
  licence audit (`LICENSE-STATUS.md`, `release/dependency-licenses.json`).
- A new or renamed asset must reach `release/public-source.json` (`node scripts/source-inventory.mjs
  --write`, then `pnpm check:source`), and any new third-party asset needs its licence recorded in
  `release/dependency-licenses.json`. When an asset is added, keep a source→destination filename
  manifest beside it: a count is not a check, since two images can share a byte count.
