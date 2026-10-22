// webui-mermaid.tsx — Mermaid diagram rendering for the transcript.
//
// The acceptance table carried a "markdown-图表(mmd) 通过" row while the
// source had zero Mermaid support: a ```mermaid fence fell through to the
// plain code path, so a model-drawn flowchart or sequence diagram arrived as
// an unreadable blob of text. This file closes that row the same way the
// renderer's other two languages already work — katex owns the math fences,
// highlight.js owns the registered code languages, and Mermaid owns its own
// fence word.
//
// Four deliberate choices, all driven by the acceptance contract:
//
//   1. `mermaid` is loaded with a dynamic `import()` and never referenced
//      statically. The package is large, and the transcript shows a Mermaid
//      fence only occasionally, so it must not sit in the main chunk. The
//      import happens on the first fence that actually needs it.
//   2. Rendering is imperative (`mermaid.render`), not declarative
//      (`<pre class="mermaid">` + `mermaid.run`). `run()` swaps the DOM
//      itself and renders its own error box on a bad diagram; `render()`
//      rejects, which is what lets every failure — invalid syntax, an empty
//      body, a thrown render, a hung render — fall back to the plain fence
//      this component would have produced before Mermaid existed.
//   3. The component is split into a pure presentational block
//      (`WebuiMermaidBlock`) and a thin effectful wrapper (`WebuiMermaid`).
//      The webui suite runs in Node with `renderToStaticMarkup`, which never
//      runs effects, so the block carries each state as a plain prop and the
//      wrapper only wires the async render into it.
//   4. The rendered SVG is sanitized before it is injected, and the diagram is
//      drawn with the theme the app is actually showing. Both are load-bearing
//      — see the two sections below.

import { useEffect, useState, type ReactElement } from "react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";

/** The fence language words that select the Mermaid branch, compared lower-cased. */
const MERMAID_FENCE_LANGUAGES = new Set(["mermaid", "mmd"]);

/**
 * How long a single `mermaid.render` may take before the diagram is abandoned
 * for the plain-fence fallback. Generous on purpose: the browser suite renders
 * the real library on CI hardware, and a tight budget turns a slow machine
 * into a red build rather than a diagram.
 */
export const WEBUI_MERMAID_RENDER_TIMEOUT_MS = 10_000;

/**
 * Whether a fence tag names the Mermaid diagram language. The caller passes
 * the fence's first language word (see `codeFenceLanguage` in
 * `markdown.public.tsx`, which already strips trailing attributes such as
 * `title="a.mmd"`), so a ```mermaid title="a.mmd"``` fence is recognised the
 * same as a bare one. Comparison is case-insensitive because fence tags are
 * conventionally lower case but nothing enforces it.
 */
export function isWebuiMermaidFence(language: string | undefined): boolean {
  return language !== undefined && MERMAID_FENCE_LANGUAGES.has(language.toLowerCase());
}

/* Theme ------------------------------------------------------------------ */

/** The two themes the app can be showing. */
export type WebuiMermaidTheme = "light" | "dark";

/**
 * The theme the app is currently showing.
 *
 * Read through the injected DOM adapter, not from `document`: the dependency
 * rules confine the ambient document to the platform layer, and a component
 * that reaches for it directly is a violation the gate reports. The adapter
 * reads the `dark` class the app's own appearance effect puts on the
 * document element — the theme the reader is looking at, including a
 * preference of "system" resolved at this moment.
 */
export function readWebuiDocumentTheme(
  readTheme: () => "dark" | "light",
): WebuiMermaidTheme {
  try {
    return readTheme();
  } catch {
    // No DOM (SSR, a Node test): light is the library's own default.
    return "light";
  }
}

/* Sanitization ----------------------------------------------------------- */

/**
 * Strip the markup that must never reach the DOM from a rendered diagram.
 *
 * Mermaid runs with `securityLevel: "strict"`, which is its own sanitizing
 * mode and the primary control: labels are escaped and the library emits no
 * scripts. This filter is the second layer, and it exists because the input
 * is model output — a diagram body can be steered by whatever the model read
 * (a repository file, a web page) — and because a rendered SVG is injected
 * with `dangerouslySetInnerHTML`, where a `<script>`, an `on*` handler or a
 * `javascript:` URL would run.
 *
 * It is a conservative text filter, not a full HTML sanitizer: it removes the
 * constructs that can execute or embed foreign documents, and leaves the
 * drawing itself alone. The SVG is produced by the library from a diagram
 * body, not assembled from user HTML, so the surface is small — but small is
 * not zero, and the filter is what makes "the SVG carries no script" a
 * property of this component rather than a property of the library version.
 */
export function sanitizeWebuiMermaidSvg(svg: string): string {
  return svg
    // Script elements, with their content.
    .replace(/<script\b[\s\S]*?<\/script\s*>/giu, "")
    .replace(/<script\b[^>]*\/?>/giu, "")
    // Foreign documents: <foreignObject> can carry arbitrary HTML.
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/giu, "")
    .replace(/<foreignObject\b[^>]*\/?>/giu, "")
    // Frame-like embeds.
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1\s*>/giu, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/giu, "")
    // Event handler attributes (onload=, onclick=, …) in any spelling.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/giu, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/giu, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/giu, "")
    // Script-ish URLs in href / xlink:href / src.
    .replace(/\s(xlink:href|href|src)\s*=\s*"\s*javascript:[^"]*"/giu, "")
    .replace(/\s(xlink:href|href|src)\s*=\s*'\s*javascript:[^']*'/giu, "")
    .replace(/\s(xlink:href|href|src)\s*=\s*javascript:[^\s>]*/giu, "");
}

/* Rendering -------------------------------------------------------------- */

/** Mermaid is configured once per document; `initialize` is not cheap to repeat. */
let mermaidConfigured = false;

/** The theme the library was configured with, so a theme switch re-configures. */
let mermaidTheme: WebuiMermaidTheme | undefined;

/** Mermaid hands every render a DOM id; a monotonic counter keeps them unique. */
let diagramSequence = 0;

type MermaidModule = typeof import("mermaid");

async function loadMermaid(theme: WebuiMermaidTheme): Promise<MermaidModule> {
  const module = await import("mermaid");
  if (!mermaidConfigured || mermaidTheme !== theme) {
    // `startOnLoad: false` matters: the default scans the document for
    // `.mermaid` elements on import, which would race the first explicit
    // render. Nothing in this component uses that class, so the scan is
    // disabled outright.
    //
    // `theme` is the app's own theme, not the library's default: Mermaid
    // bakes its palette into the SVG it returns, so a diagram drawn with the
    // light palette is a light diagram even on a dark page. Re-initializing
    // on a theme change is what lets the next diagram follow the switch.
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      // `htmlLabels: false` keeps the diagram pure SVG. Mermaid's default
      // puts node labels in a `<foreignObject>` holding HTML, which is both a
      // foreign-document surface the sanitizer has to strip (stripping it
      // would take the labels with it) and a place where the label is HTML
      // rather than escaped text. With it off the labels are SVG `<text>`.
      htmlLabels: false,
      theme: theme === "dark" ? "dark" : "default",
    });
    mermaidConfigured = true;
    mermaidTheme = theme;
  }
  return module;
}

export interface WebuiMermaidRenderOptions {
  /**
   * Override for {@link WEBUI_MERMAID_RENDER_TIMEOUT_MS}. Exists so a test can
   * drive the timeout path with a real clock instead of faking one; production
   * callers never pass it.
   */
  readonly timeoutMs?: number;
  /** The theme to draw with; defaults to the app's current theme. */
  readonly theme?: WebuiMermaidTheme;
}

/**
 * Render one Mermaid diagram body to an SVG string.
 *
 * Rejects — rather than returning a fallback — on every failure so the caller
 * decides what the user sees: an empty body, invalid syntax, a thrown render
 * and a render that outlives the timeout all end here. The empty-body check
 * runs before the dynamic import so an empty fence never pulls the library
 * down the wire.
 */
export async function renderWebuiMermaidSvg(text: string, options?: WebuiMermaidRenderOptions): Promise<string> {
  if (text.trim() === "") throw new Error("webui-mermaid: empty diagram body");
  const theme = options?.theme ?? "light";
  const mermaid = (await loadMermaid(theme)).default;
  diagramSequence += 1;
  const diagramId = `webui-mermaid-${diagramSequence}`;
  const timeoutMs = options?.timeoutMs ?? WEBUI_MERMAID_RENDER_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      mermaid.render(diagramId, text),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`webui-mermaid: render timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return sanitizeWebuiMermaidSvg(result.svg);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** What the fence currently shows. See {@link WebuiMermaidBlock}. */
export type WebuiMermaidState =
  | { readonly status: "pending" }
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "failed" };

export interface WebuiMermaidBlockProps {
  readonly state: WebuiMermaidState;
  /** The fence body, verbatim. */
  readonly text: string;
  /** The fence tag as marked reported it, attributes included. */
  readonly lang: string | undefined;
}

/**
 * The fence's markup for each state, with no effect of its own:
 *
 *   pending — the `webui-mermaid` container holding the raw diagram text. The
 *     container is present from the first paint, so a slow chunk load shows
 *     the source rather than an empty box, and the unit suite can assert the
 *     container without ever running an effect.
 *   rendered — the same container with Mermaid's SVG inside it.
 *   failed — the plain fence, byte for byte: a `webui-code-block` wrapper, a
 *     `pre`, a `code` carrying the original text, and no gutter, because a
 *     Mermaid fence never shows line numbers in any of its states. This is
 *     the markup the fence had before Mermaid existed, minus the gutter.
 */
export function WebuiMermaidBlock({ state, text, lang }: WebuiMermaidBlockProps): ReactElement {
  if (state.status === "rendered") {
    return (
      <div className="webui-mermaid" data-webui-mermaid-state="rendered" dangerouslySetInnerHTML={{ __html: state.svg }} />
    );
  }
  if (state.status === "failed") {
    return (
      <div className="webui-code-block">
        <pre>
          <code data-language={lang}>{text}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="webui-mermaid" data-webui-mermaid-state="pending">
      <pre>{text}</pre>
    </div>
  );
}

export interface WebuiMermaidProps {
  /** The fence body, verbatim. */
  readonly text: string;
  /** The fence tag as marked reported it, attributes included. */
  readonly lang: string | undefined;
}

/**
 * The effectful half: renders the diagram once per body and repaints the block
 * with the outcome. `cancelled` guards the state updates so a fence that
 * unmounts mid-render — a session switch, a trimmed transcript — writes
 * nothing. The dependency is the body alone: a re-render with the same text
 * must not re-run the library.
 */
export function WebuiMermaid({ text, lang }: WebuiMermaidProps): ReactElement {
  const [state, setState] = useState<WebuiMermaidState>({ status: "pending" });
  const { dom } = useWebuiBrowserCapabilities();
  useEffect(() => {
    let cancelled = false;
    const theme = readWebuiDocumentTheme(() => dom.readDocumentTheme());
    renderWebuiMermaidSvg(text, { theme })
      .then((svg) => {
        if (!cancelled) setState({ status: "rendered", svg });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [dom, text]);
  return <WebuiMermaidBlock state={state} text={text} lang={lang} />;
}
