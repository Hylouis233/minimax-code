---
name: webui-docs-maintainer
description: Audit and update `packages/webui` documentation and its `AGENTS.md` against the current source and tests. Use for documentation drift, stale architecture decisions, or developer-guide updates; not for implementing WebUI product changes or drafting a new architecture plan.
---

# WebUI documentation maintainer

Keep the WebUI documentation useful as a guide to the checked-out implementation. Make documentation changes only unless the user separately asks for product-code work.

## Workflow

1. **Establish the checkout and scope.** Read repository `AGENTS.md` and `CONTRIBUTING.md`, inspect `git status`, and preserve unrelated edits. Follow the publication rules for this public projection: review every added or moved path, and regenerate `release/public-source.json` for file-set changes. Content-only edits to existing documents do not require inventory regeneration.
2. **Load the WebUI map.** Read `packages/webui/AGENTS.md` and `packages/webui/docs/README.md`. Follow the README to the relevant architecture, client, runtime, design, verification, gap, ADR, and reference documents. Read `packages/webui/docs/agents/domain.md` and the relevant `CONTEXT.md` entries when domain terms or decisions are involved.
3. **Scan the full documentation set.** Enumerate `packages/webui/docs/**/*.md` and `packages/webui/AGENTS.md`, then search across them for duplicated claims, old paths, removed capabilities, stale command names, counts, dates, baselines, test evidence, and contradictory wording. Use the index to find related pages, but do not limit the scan to pages directly named by the request.
4. **Check claims against the current tree.** Trace architecture and lifecycle claims to their implementations; check contracts against their producers and consumers; check gate claims against scripts, package commands, suite declarations, and the tests that exercise them. Use documentation and prior decision memory as navigation and historical context, not as proof of current behavior. When project decision memory is available, inspect relevant entries and verify them against the checkout.
5. **Separate current behavior from decision history.** Keep dated rationale recognizable as historical. Update stale status and implementation claims when the decision remains relevant. When a decision is no longer in force, follow the WebUI documentation index's retirement rule instead of leaving a superseded decision presented as current. If the code and an ADR conflict in a way that requires a new product or architecture decision, surface the conflict rather than silently choosing one in prose.
6. **Make the smallest complete documentation update.** Edit every affected document that owns or duplicates the changed fact, including the index and operating guide when needed. Prefer one authoritative explanation with links over repeated copies. Preserve source paths and verification boundaries precisely; distinguish unit, assembled, loopback, built-browser, native-host, platform, and live-service evidence.
7. **Validate the documentation change.** Run `git diff --check`; verify relative links and referenced paths in the changed pages; search again for the stale claim. Do not run product tests for prose-only edits unless the repository provides a documentation-specific check or the change affects executable examples. Do not assume a documentation-only CI profile applies to `packages/webui` or `.agents/skills`; check the current classifier and verification rules. If adding, moving, or deleting files, regenerate and check the source inventory.

## Completion report

Summarize the documents reviewed and changed, the source or test evidence used for consequential corrections, and the checks actually run. Mark unverified runtime or platform behavior explicitly. Do not describe a static source inspection as runtime verification.
