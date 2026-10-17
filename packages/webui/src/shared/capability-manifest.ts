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
export const WEBUI_CAPABILITY_PROOFS: Readonly<
  Record<
    WebuiCapabilityName,
    { readonly required: readonly string[]; readonly ready?: readonly string[] }
  >
> = {
  sessions: { required: ["loadSessions", "updateSession", "deleteSession"] },
  transcript: { required: ["getMessages"] },
  turn: { required: ["sendMessage", "resumeSession"], ready: ["abortSession"] },
  interactions: {
    required: ["listPendingPermissions", "replyPermission"],
    ready: ["getPendingQuestionnaire", "replyQuestionnaire"],
  },
  workspace: { required: ["listWorkspaceFileTree", "getWorkspaceEnvironment"] },
  // The Terminal bridge is its own capability, and readiness is exactly the case
  // it exists for: a roster with no frame stream lists terminals nobody can use.
  terminal: {
    required: ["listTerminals", "createTerminal", "disposeTerminal"],
    ready: ["watchTerminal", "writeTerminal", "resizeTerminal"],
  },
  models: { required: ["listModels", "selectModel"] },
  plugins: { required: ["pluginManagement"] },
  settings: { required: ["getGlobalInstructions", "getPermissionMode"] },
  account: { required: ["getAccountStatus", "beginAccountLogin"] },
  commands: { required: ["runCommand"] },
};

/**
 * Derives the manifest from an assembled port.
 *
 * Structural input on purpose: the server, the runtime adapter and a test all
 * hold *some* object of wired members, and none of them should have to import the
 * others to answer "what is wired".
 */
export function deriveWebuiCapabilityManifest(
  source: Readonly<Record<string, unknown>>,
  extensions: readonly string[] = [],
): WebuiCapabilityManifest {
  const manifest: Record<string, WebuiCapabilityState> = {};
  for (const name of WEBUI_CAPABILITY_NAMES) {
    const proof = WEBUI_CAPABILITY_PROOFS[name];
    const present = (member: string): boolean => source[member] !== undefined;
    if (!proof.required.every(present)) {
      manifest[name] = "absent";
      continue;
    }
    const ready = proof.ready ?? [];
    manifest[name] = ready.every(present) ? "supported" : "not-ready";
  }
  // Extension families the caller knows about but this build does not name are
  // reported as supported when explicitly handed in.
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
