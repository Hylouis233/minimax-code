// The capability/readiness manifest carried by the handshake.
//
// A complete client method table is not evidence that the host implements
// anything: the browser's table names every operation the protocol defines, so
// "the method exists" answers a question about this build rather than about the
// service in front of it. Reading presence as support is how a surface offered a
// control the host would refuse forever, and how a host that was merely *not
// ready* looked identical to one that lacked the feature.
//
// The manifest is therefore derived on the service side from what it actually
// registered and wired: for each family, the members that prove support and the
// companion members that prove readiness. It is additive — an older service
// simply does not send it, and that means **unknown**, not all-supported:
//
//   * `supported` — the family's members are wired.
//   * `absent` — this host does not provide the family at all. Nothing to retry.
//   * `not-ready` — the family is present but a companion it needs is not (a
//     bridge without its frame stream, say). The surface exists and will not
//     work yet, which is a different message from "unsupported".
//
// An unknown capability name is kept rather than dropped: forward compatibility
// means a newer service may advertise families this build has never heard of, and
// discarding them would make the next version's manifest unreadable here.

export const WEBUI_CAPABILITY_NAMES = [
  "sessions",
  "transcript",
  "turn",
  "interactions",
  "workspace",
  "terminal",
  "models",
  "plugins",
  "settings",
  "account",
  "commands",
] as const;

export type WebuiCapabilityName = (typeof WEBUI_CAPABILITY_NAMES)[number];

/**
 * Whether a capability family can be used, and why not when it cannot.
 *
 * `unknown` exists for the client side and is never sent: it is what a client
 * holds when the service sent no manifest at all, and it is the state that keeps
 * the historical attempt path available instead of fabricating either support or
 * absence.
 */
export type WebuiCapabilityState = "supported" | "absent" | "not-ready";

/** The manifest, as it travels on the handshake. */
export type WebuiCapabilityManifest = Readonly<Record<string, WebuiCapabilityState>>;

/**
 * What proves each family, as member names of the assembled service port.
 *
 * `required` — the family is present when these are all wired.
 * `ready` — these must also be present for the family to work; when they are not,
 * the family is `not-ready` rather than absent, because the surface is real and
 * only its prerequisite is missing.
 *
 * The table is a *derivation*, not a hand-maintained per-feature boolean: it names
 * port members, and the members come from the same adapters the operations are
 * bound to, so a capability cannot be advertised without the wiring behind it.
 */
/**
 * What proves each family on the **service** side: the operations it bound.
 *
 * This is the derivation the handshake uses. The harness object says what the adapter
 * *could* forward, which is a different question: a wrapper can exist around a host
 * service that is not there, and a family advertised from a shape alone is a surface
 * offered for a call that cannot work. Naming operation names here lets the service
 * answer from its own binding table — was this operation declared, and is the port member
 * behind it callable?
 *
 * The second list is prerequisites rather than proof of existence: a terminal roster
 * whose frame stream is not wired is `not-ready`, not `absent`.
 */
export const WEBUI_CAPABILITY_REGISTRY_PROOFS: Readonly<
  Record<
    WebuiCapabilityName,
    { readonly operations: readonly string[]; readonly ready?: readonly string[] }
  >
> = {
  sessions: { operations: ["listSessions", "updateSession", "deleteSession"] },
  transcript: { operations: ["getMessages"] },
  turn: { operations: ["sendMessage", "resumeSession"], ready: ["abortSession"] },
  interactions: {
    operations: ["listPendingPermissions", "replyPermission"],
    ready: ["getPendingQuestionnaire", "replyQuestionnaire"],
  },
  workspace: { operations: ["listWorkspaceFileTree", "getWorkspaceEnvironment"] },
  terminal: {
    operations: ["listTerminals", "createTerminal", "disposeTerminal"],
    ready: ["watchTerminal", "writeTerminal", "resizeTerminal"],
  },
  models: { operations: ["listModels", "selectModel"] },
  plugins: { operations: ["pluginManagement"] },
  settings: { operations: ["getGlobalInstructions", "getPermissionMode"] },
  account: { operations: ["getAccountStatus", "beginAccountLogin"] },
  commands: { operations: ["runCommand"] },
};

/** What is known about one operation, as a service's binding table reports it. */
export interface WebuiOperationAvailability {
  /** The service declares this operation: a binding exists for it. */
  readonly declared: boolean;
  /** The port member the binding calls is callable. */
  readonly wired: boolean;
}

/**
 * Derives the handshake manifest from the operations a service actually bound.
 *
 * `availability` is asked about each operation name, and the service answers from its own
 * binding table plus the port behind it. A family is:
 *
 *   * `supported` — every operation it needs is declared and wired, and every
 *     prerequisite is wired;
 *   * `not-ready` — the operations are declared and wired, and a prerequisite is not: the
 *     surface exists and will not work yet;
 *   * `absent` — an operation the family needs is not declared, or the port member it
 *     calls is not callable.
 *
 * Families this build has never heard of are carried through as `supported`, so a client
 * can see what a newer service advertises without this derivation inventing a verdict.
 */
export function deriveWebuiCapabilityManifestFromBindings(
  availability: (operation: string) => WebuiOperationAvailability,
  extensions: readonly string[] = [],
): WebuiCapabilityManifest {
  const manifest: Record<string, WebuiCapabilityState> = {};
  const wired = (operation: string): boolean => {
    const known = availability(operation);
    return known.declared && known.wired;
  };
  for (const name of WEBUI_CAPABILITY_NAMES) {
    const proof = WEBUI_CAPABILITY_REGISTRY_PROOFS[name];
    if (!proof.operations.every(wired)) {
      manifest[name] = "absent";
      continue;
    }
    const ready = proof.ready ?? [];
    manifest[name] = ready.every(wired) ? "supported" : "not-ready";
  }
  for (const name of extensions) manifest[name] = "supported";
  return manifest;
}

/**
 * The client's view of a manifest that may not have arrived.
 *
 * `undefined` means the service sent none: an older server, and therefore
 * **unknown**, never "everything works" and never "nothing works". Callers keep
 * their legacy attempt path in that case rather than inventing an answer.
 */
export type WebuiCapabilityView = WebuiCapabilityManifest | undefined;

export function readWebuiCapability(
  manifest: WebuiCapabilityView,
  name: string,
): WebuiCapabilityState | "unknown" {
  const state = manifest?.[name];
  return state ?? "unknown";
}
