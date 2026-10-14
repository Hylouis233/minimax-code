/**
 * A-001's compile-time binding between the WebUI's host surface and the runtime
 * it talks to.
 *
 * `WebuiRuntimeCliService` is still hand-written: the WebUI declares the members
 * it forwards and the wire shape it expects back. That declaration is only worth
 * anything if a change on the runtime side reaches it, so this file pins the
 * three ways the two can drift, at the type level:
 *
 * - a member the WebUI forwards that the runtime no longer declares;
 * - a member the WebUI started or stopped forwarding;
 * - a forwarded result the runtime no longer hands back in the wire's shape.
 *
 * The three lists are `as const satisfies`: their element types are the exact
 * names *and* every name is checked against the union it claims to enumerate.
 * The `AssertEmpty` aliases then make the enumeration exhaustive in both
 * directions, so a name on one side only fails `pnpm typecheck:test` with that
 * name in the message. This file is in `tsconfig.test.json`'s `include` for
 * exactly that reason: a probe in a file no gate compiles proves nothing.
 *
 * What this does not do: remove the mirror. The 22 results below are still
 * declared twice, and `assembly.ts` still states the difference with one cast.
 * Deriving them member by member and converting runtime -> wire explicitly is
 * A-001's remaining work; until it lands, this file makes the difference
 * measured instead of assumed.
 */
import { describe, expect, it } from "vitest";

import type { CliService } from "@mavis/local-runtime-v2/cli-service";
import type { WebuiRuntimeCliService } from "../../src/runtime/harness/host-contract.js";

type Keys<T> = keyof T & string;
type ResultOf<M> = M extends (...args: never[]) => infer R ? Awaited<R> : never;

/** Members the WebUI forwards that the runtime's cliService does not declare. */
type WebuiOnlyNames = Exclude<Keys<WebuiRuntimeCliService>, Keys<CliService>>;
/** Members the runtime declares that the WebUI does not forward. */
type NotForwardedNames = Exclude<Keys<CliService>, Keys<WebuiRuntimeCliService>>;
/** Forwarded members whose result the runtime does not hand back in the wire's shape. */
type MismatchedResultNames = {
  [K in Keys<WebuiRuntimeCliService>]: K extends Keys<CliService>
    ? [ResultOf<CliService[K]>] extends [ResultOf<WebuiRuntimeCliService[K]>]
      ? never
      : K
    : never;
}[Keys<WebuiRuntimeCliService>];

/**
 * The two capabilities the WebUI's host adds on top of the runtime's service.
 * They are WebUI features, not a mirror of anything the runtime has.
 */
const WEBUI_ONLY_NAMES = [
  "readWorkspaceArchive",
  "extractWorkspaceArchive",
] as const satisfies readonly WebuiOnlyNames[];

/**
 * The forwarded results that still need an explicit runtime -> wire conversion.
 * This is A-001's remaining work, named member by member.
 */
const MISMATCHED_RESULT_NAMES = [
  "listSessions",
  "getSessionTree",
  "createSession",
  "updateSession",
  "forkSession",
  "sendMessage",
  "getMessages",
  "getSessionUsage",
  "resumeSession",
  "requestCompaction",
  "listPendingPermissions",
  "watchEvents",
  "listWorkspaceFileTree",
  "readCanvas",
  "applyCanvas",
  "getSessionDiff",
  "getTurnDiff",
  "revertTurnDiff",
  "reapplyTurnDiff",
  "listModels",
  "listProviderPresets",
  "getCodexOAuthStatus",
] as const satisfies readonly MismatchedResultNames[];

/** A sample of what the runtime declares and the WebUI deliberately does not forward. */
const NOT_FORWARDED_NAMES = [
  "steer",
  "steerSession",
  "getPeekContext",
  "listRuntimeSkills",
  "listBackgroundTasks",
  "getRuntimeDiagnostics",
  "collectSessionReport",
  "refreshPlugins",
  "setModelFavorite",
] as const satisfies readonly NotForwardedNames[];

// Exhaustive in both directions, so growth fails as loudly as a swap. The aliases
// are referenced in the first test below: an unreferenced type alias is not
// resolved, and a probe nobody resolves proves nothing.
type AssertEmpty<T extends never> = T;
type WebuiOnlyMissing = AssertEmpty<Exclude<WebuiOnlyNames, (typeof WEBUI_ONLY_NAMES)[number]>>;
type WebuiOnlyExtra = AssertEmpty<Exclude<(typeof WEBUI_ONLY_NAMES)[number], WebuiOnlyNames>>;
type MismatchedMissing = AssertEmpty<
  Exclude<MismatchedResultNames, (typeof MISMATCHED_RESULT_NAMES)[number]>
>;
type MismatchedExtra = AssertEmpty<
  Exclude<(typeof MISMATCHED_RESULT_NAMES)[number], MismatchedResultNames>
>;

describe("the WebUI host surface against the runtime it forwards to", () => {
  it("names each union exactly, in both directions", () => {
    const missing: readonly WebuiOnlyMissing[] = [];
    const extra: readonly WebuiOnlyExtra[] = [];
    const mismatchedMissing: readonly MismatchedMissing[] = [];
    const mismatchedExtra: readonly MismatchedExtra[] = [];
    // Empty by construction: the four aliases above are `never`, so a name that
    // stopped belonging — or started belonging — is a compile error here.
    expect([missing, extra, mismatchedMissing, mismatchedExtra]).toHaveLength(4);
  });

  it("adds exactly two capabilities of its own", () => {
    expect(WEBUI_ONLY_NAMES).toHaveLength(2);
    // The membership check has teeth: a name the runtime does declare is not
    // WebUI-only.
    // @ts-expect-error the runtime declares `listSessions`
    const notWebuiOnly: WebuiOnlyNames = "listSessions";
    expect(notWebuiOnly).toBe("listSessions");
  });

  it("names every forwarded result that still needs a conversion", () => {
    expect(MISMATCHED_RESULT_NAMES).toHaveLength(22);
    // A compatible result is not in the list, so the list cannot be padded.
    // @ts-expect-error `archiveSession`'s result already satisfies the wire type
    const alreadyCompatible: MismatchedResultNames = "archiveSession";
    expect(alreadyCompatible).toBe("archiveSession");
  });

  it("forwards a subset, and every forwarded name still exists on the runtime", () => {
    // The WebUI deliberately forwards a subset of the runtime's service; what it
    // must not do is forward a name the runtime has dropped, which the
    // exhaustive lists above catch.
    expect(NOT_FORWARDED_NAMES.length).toBeGreaterThan(0);
  });
});
