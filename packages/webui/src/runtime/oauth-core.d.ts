// Structural type shim for `@mavis/oauth-core`, mirroring the pattern of
// `mcode-tools-host.d.ts`: the workspace package publishes `dist` types that
// a source checkout does not build, so type-checking against the module
// needs local declarations for the subset the WebUI actually uses. The
// runtime module resolves through `tsconfig.standalone.json` (tsx dev
// server) and the workspace-sources esbuild plugin (bundle) — both map the
// package export to `src/`.
//
// It sits here, beside its only consumers, because the runtime layer is the
// whole consumer set: `auth-context.ts`, `auth-session.ts`, `assembly.ts`,
// `account-login.ts` and `usage-quota.ts`. Plan §7.1 keeps the server layer to
// network ingress and nothing else, so a shim no server module reads does not
// belong under `server/`.
//
// Keep this file in sync with `packages/oauth-core/src/index.ts`; it is a
// deliberate structural subset (ADR 0003 also keeps the WebUI off the
// terminal client's wrapper `createMcodeSharedAuthSession` — the WebUI
// composes the oauth-core primitives itself).
declare module "@mavis/oauth-core" {
  export interface MCodeOAuthNamespaceContext {
    readonly buildEnv: "dev" | "test" | "staging" | "prod";
    readonly region: "cn" | "en";
  }

  export interface MCodeOAuthNamespaceInput extends MCodeOAuthNamespaceContext {
    readonly dataDir: string;
  }

  export interface MCodeAuthNamespace {
    readonly namespaceHome: string;
  }

  export const MCODE_OAUTH_SCOPES: readonly ["agent.default"];

  export function createAuthNamespace(
    input: MCodeOAuthNamespaceInput,
  ): MCodeAuthNamespace;

  export function migrateLegacyAuthNamespace(
    namespace: MCodeAuthNamespace,
  ): Promise<void>;

  export function createCredentialStore(options: {
    readonly authHome: string;
  }): unknown;

  export function resolveMCodeOAuthEndpointConfig(
    environment: Record<string, string | undefined>,
    context: MCodeOAuthNamespaceContext,
  ): unknown;

  export class HttpOAuthClient {
    constructor(options: unknown);
  }

  export interface MCodeAccessTokenLease {
    readonly accessToken: string;
    readonly loginEpoch?: string;
    readonly expiresAtMs: number;
    readonly generation: number;
    readonly scopes: readonly ["agent.default"];
    readonly audience: "agent-backend";
  }

  /** The device-authorization prompt `login()` emits before the human
   *  authorizes — the terminal client prints it; the WebUI renders it. */
  export interface DeviceAuthorizationPrompt {
    readonly userCode: string;
    readonly verificationUri: string;
    readonly verificationUriComplete?: string;
    readonly expiresInSec: number;
  }

  export interface AuthStatusSnapshot {
    readonly status: string;
    readonly generation: number;
    readonly scopes: readonly string[];
    readonly expiresAtMs?: number;
  }

  export class MCodeOAuthCore {
    constructor(options: {
      readonly namespace: unknown;
      readonly credentialStore: unknown;
      readonly oauthClient: unknown;
      readonly initialize?: () => unknown;
    });
    getAccessToken(options: {
      /**
       * Mirrors `AccessTokenOptions.requiredScopes` in
       * `packages/oauth-core/src/auth-core.ts:139`, which is a **mutable**
       * `string[]`. This shim previously declared it as the readonly
       * `MCODE_OAUTH_SCOPES` tuple, which accepted three call sites the real
       * package rejects. Declaring it the way the package does is what makes
       * this file a subset of the real surface rather than a substitute for it.
       */
      readonly requiredScopes: string[];
      readonly minValidityMs: number;
    }): Promise<MCodeAccessTokenLease>;
    handleUnauthorized(context: {
      readonly generation: number;
      readonly loginEpoch?: string;
    }): Promise<"retry" | "logout">;
    watch(listener: (status: { readonly status: string }) => void): () => void;
    /** Device-authorization login; resolves once the user authorizes.
     *  Concurrent calls share one attempt (the core's own dedupe). */
    login(options?: {
      onDeviceAuthorization?: (authorization: DeviceAuthorizationPrompt) => void;
    }): Promise<{ readonly status: "authenticated"; readonly generation: number }>;
    cancelLogin(): Promise<void>;
    /** Removes the credential. `revoke: true` also revokes it server-side;
     *  the local wipe happens either way. */
    logout(options: { readonly revoke: boolean }): Promise<{
      readonly status: "anonymous" | "logout_pending";
      readonly generation: number;
    }>;
    getStatus(): Promise<AuthStatusSnapshot>;
  }
}
