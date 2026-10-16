# Boundaries and gates

One facet of the architecture design: [`design.md`](design.md) is the whole. This document covers the
rules that keep the four boundaries from collapsing, and the generated artifacts that depend on them.

## Dependency rules

These are ownership rules as well as import rules. Judge an edge by the role of the target module; a
cross-feature call through an approved public contract or command is not automatically a violation.

| Caller role | May depend on | Boundary |
| --- | --- | --- |
| `client/shell/` and `client/ui/` | feature public UI/bindings and shared contracts | Compose or present; do not create owners, call transport business methods or write application state. |
| Feature `ui/` | its own public bindings/contracts and explicitly approved peer public UI/commands | Present data and dispatch application commands; do not call IO ports, instantiate owners or access generic store writers. |
| Feature `application/` | its own contracts/projections, conversation public APIs, injected capabilities and approved peer contracts | Own business workflows and state; do not depend on browser globals or concrete transport. |
| `client/application/` | feature application APIs, platform adapters and shared contracts | Compose owners and bind transport capabilities to application commands. |
| `client/platform/` and `client/bindings/` | browser APIs and capability contracts | Adapt IO and React/browser effects; business decisions stay with application owners. |
| `server/` | `runtime/port.ts`, `shared/` and server modules | Validate and dispatch loopback requests without importing runtime implementations. |
| `runtime/` | `runtime/port.ts`, `shared/` and runtime modules | Implement the process-local host adapter without depending on browser or server implementation. |
| `shared/` | leaf dependencies only | Wire contracts and shared values import neither execution side. |

Within a layer, feature implementation is private by default. A feature may use another feature's
public `contracts/`; any other peer edge needs an explicit reviewed entry in
`scripts/lib/webui-peer-imports.json`, and an entry whose edge is gone fails the check, so an
exception cannot outlive its reason.

A business that decides *when* another business's state moves is handed that business's published
narrow contract, and the composition that holds the writer builds it. The interaction flow is the
worked example: it drives `WebuiInteractionPhaseIntents` (published from `features/turn/contracts/`)
and never sees Turn's stream state or the factories that need Turn's transforms.

Hard rules:

- **Never import `packages/tui`** (ADR 0003). Read it as a specification, compose the equivalent here.
- No client module in the server bundle and no server module in the client bundle —
  `pnpm check:webui-boundary` enforces this from the build graph.
- **One module, one path.** When a file moves, repoint every importer (including relative `../`
  specifiers, which a naive grep misses) and delete any `export * from` shim.
- Application modules own business RPCs and writable state. Components must not call transport
  methods for business workflows or receive a generic store writer.
- Storage and DOM access live in `client/platform/` or `client/bindings/`; application and projection
  modules receive capabilities or values instead.
- No new module imports the shell, and no two modules own the same Map or state.

## Role enforcement

Roles are checked, not just layers. `classifyRole` in `scripts/lib/webui-dependency-rules.mjs` reads
the role a file owns (assembly, conversation, a feature's `application` / `projection` / `bindings` /
`ui` / `contracts`, platform, generic ui, shell, entry), the business that owns it and its home, and
reports zero violations today. It fails on:

- a business holding the same role in two homes at once — a move that left its previous copy behind;
- the conversation substrate reaching feature implementation, the assembly or `client/platform/`;
  presentation or shell reaching the assembly or the platform adapters; `client/ui/` reaching any
  business at all;
- a feature reaching another business's *private* role. A feature's `contracts/` is public and needs
  no entry; anything else needs a reviewed entry in `scripts/lib/webui-peer-imports.json`.

`pnpm check:webui-dependency` runs this over the source, so it sees `import type` edges that the
metafile check cannot (type-only edges are erased from build output). Its exception baseline is
`scripts/lib/webui-dependency-baseline.json` and is currently empty apart from one declared
`non-literal-dynamic-import` allowance at `runtime/mcode-tools-entry.ts`, whose runtime URL targets a
generated embedded artifact with no source-tree path for the resolver.

## Build outputs and generated artifacts

| Artifact | Produced by | Checked by |
| --- | --- | --- |
| `dist-webui/` incl. `metafile.json` | `pnpm build:webui` (`scripts/build-webui.mjs`) | `pnpm check:webui-boundary` |
| `release/public-source.json` | `node scripts/source-inventory.mjs --write` | `pnpm check:source` |

`pnpm build:webui` prints its server/client input counts; a new file that does not raise them has been
written but never wired. [`../verification/gates.md`](../verification/gates.md) states what each gate proves.
