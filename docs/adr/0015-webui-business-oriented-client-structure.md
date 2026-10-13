# The WebUI client is organized by business within its existing layers

**Status: Superseded as the future target by [ADR 0016](0016-webui-business-first-modules-and-application-owned-lifetimes.md).** The implementation and historical decision recorded below remain unchanged.
**Date: 2026-10-13**
**Supersedes:** none. This decision supplements the layer and process boundaries in
[ADR 0014](0014-webui-splits-its-internal-capability-and-orchestration-layers.md); it does not amend them.

## Context

ADR 0014 assigns responsibility to the WebUI's runtime, browser application, shared protocol, and
server layers. Within the browser client, however, each layer still mixed unrelated user-facing
businesses. A change to the session rail, composer, or workspace therefore crossed files whose paths
did not tell the reader which business owned the behavior.

The approved reorganization changes the client layout and selected module seams while preserving
the layer responsibilities, dependency direction, single-writer state model, process boundary, and
observable behavior. The implementation and its evidence are recorded in
[`docs/webui/PLAN-webui-business-reorganization.md`](../webui/PLAN-webui-business-reorganization.md).

## Decision

Keep the existing `client/` layers and file each business under its owning layer:

- `client/application/<business>/` owns browser orchestration and writable state.
- `client/projection/<business>/` owns pure derivations and state transitions, with no React or
  transport dependency.
- `client/components/<business>/` owns presentation for that business.
- `client/contracts/<business>/` owns the browser-facing capability and view contracts for that
  business.

The twelve browser businesses are `sessions`, `composer`, `transcript`, `workspace`, `interactions`,
`goal`, `models`, `plugins`, `settings`, `account`, `shell`, and `turn`. `turn` is a business even
though it has no standalone screen: its attach-to-settle lifecycle and generation-fenced identity
outlive any one screen. A capability such as terminal or review may be presented by a business
without becoming a separate business.

An enduring entity with its own lifecycle and identity is a business; a capability presented by a
business is not. When ownership appears nested, distinguish a single lifecycle with nested fences
from independent owners that merely share a module. The plan's criterion C and bag/nesting test
apply this distinction to the twelve businesses and to the `review`, `terminal`, and `turn` cases.

## Invariants

1. ADR 0014's runtime, application, protocol, and server responsibilities remain in force. This
   decision changes client organization, not the meaning of those layers or the browser-to-loopback
   process boundary.
2. Every persistent or in-flight state slice has one writer. Components submit named commands and
   do not receive generic store writers, business transport, or a second state owner.
3. Existing dependency direction remains in force as enforced by the WebUI dependency checks and
   documented in the plan. The browser does not import `server/` or `runtime/`, and application and
   projection modules do not import infrastructure.
4. A business consumes another business through its published read model or command surface. The
   one cross-business write, session deletion purging the composer's slot, is a call to the
   composer's published command.
5. A filing change preserves the existing behavior and ordering. A behavior change requires its
   own decision and acceptance evidence.
6. A path is the module's home. Moved modules have no compatibility re-export shim left behind.

## Consequences

The business name is visible at every layer, making a business's modules discoverable without
changing the layer model. Pure projections stay testable without a DOM; application workflows keep
the browser's command and state ownership; React modules remain presentation. Client contract files
are filed by business, while `shared/contracts/` remains the sole home for cross-process wire DTOs.

The directory depth increases by one segment for business-owned files. That cost is accepted because
the layer remains visible in each path and existing dependency checks retain their meaning. File
count and file size are not success measures; the plan's ownership, seam, extension-scope, and
behavior-preservation criteria are.

## Out of scope

- Changing runtime, application, server, or protocol responsibilities.
- Redesigning the WebSocket protocol or moving browser orchestration into the server.
- Changing product behavior, visual design, or the supported WebUI capability set.
- Reorganizing `packages/tui` or aligning its paths with WebUI.
- Splitting a file solely to reduce its line count.
