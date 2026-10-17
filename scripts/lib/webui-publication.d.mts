// Types for `webui-publication.mjs`, the publication visibility gate.
//
// The module is plain JavaScript, so its rule shapes live here instead of
// being inherited as `any` at every TypeScript call site — the dependency
// test (`packages/webui/test/unit/webui-dependency-check.test.ts`) drives
// `publicationRule` and `isPublicModulePath` through this declaration, and
// `scripts/check-webui-dependency.mjs` runs the same rule against the
// resolved file list.

/**
 * Whether a source path names a published module.
 *
 * The `.public` marker sits before the extension, so `foo.public.ts` and
 * `foo.public.tsx` are published while `foo.ts` and `public.ts` are not.
 */
export function isPublicModulePath(normalized: string): boolean;

/** The published module's kind, which decides what it may export. */
export function publicModuleKind(normalized: string): "component" | "derivation";

/**
 * One published-gate finding.
 *
 * `kind` names which judgement produced it, `detail` is the human-readable
 * rule the gate prints, and `index` is the character offset inside the source
 * text so a host with a richer view can anchor the violation.
 */
export interface PublicationViolation {
  readonly kind: string;
  readonly detail: string;
  readonly index: number;
}

export function findPublicationViolations(sourceText: string): PublicationViolation[];

/**
 * The specifiers a published module imports, in source order.
 *
 * Split out so a caller can resolve them against the same module resolution
 * the edge collector uses, rather than this gate re-implementing resolution.
 */
export function publishedModuleImportSpecifiers(sourceText: string): string[];

/** Read a published module's source, for callers that hold a repository root. */
export function readPublishedModuleSource(absolutePath: string): string;

/**
 * One judgement the caller's layer classifier returned for one out-of-module
 * import: a `false` `allowed` plus the rule name and detail so the publication
 * gate can surface the layer finding under its own violation namespace.
 */
export interface PublicationImportJudgement {
  readonly allowed: boolean;
  readonly rule?: string;
  readonly to?: string;
  readonly detail?: string;
}

/** What `publicationRule` judges: one finding per escape, plus the pass flag. */
export interface PublicationRuleResult {
  readonly pass: boolean;
  readonly violations: readonly { readonly kind: "role"; readonly rule: string; readonly file: string; readonly to?: string; readonly detail: string }[];
}

/** The injected collaborators and the file list the rule will judge. */
export interface PublicationRuleOptions {
  readonly files: readonly string[];
  readonly readFile: (absolutePath: string) => string;
  readonly absolute: (relativePath: string) => string;
  readonly classifyImport?: (
    from: string,
    to: string,
  ) => PublicationImportJudgement;
}

/** Judge every published module in a file list. */
export function publicationRule(options: PublicationRuleOptions): PublicationRuleResult;
