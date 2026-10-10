// Structural type shim for `@mavis/mcode-tools-host`: the workspace package
// publishes `dist` types a source checkout does not build, so type-checking
// needs local declarations for the subset the WebUI uses. See
// `oauth-core.d.ts` in this directory for the full rationale.
//
// It lives beside its only consumer, `runtime/mcode-tools.ts`: plan §7.1 keeps
// the server layer to network ingress and nothing else.
declare module "@mavis/mcode-tools-host" {
  export interface McodeToolsAuthLeaseBroker {
    readonly endpoint: string;
    readonly capabilityFile: string;
    dispose(): Promise<void>;
  }

  export interface McodeToolsHostAuthSession {
    getStatus(): Promise<{
      readonly status: string;
      readonly generation: number;
      readonly expiresAtMs?: number;
    }>;
    getAccessToken(minValidityMs: number): Promise<{
      readonly accessToken: string;
      readonly expiresAtMs: number;
      readonly generation: number;
      readonly scopes: readonly ["agent.default"];
      readonly audience: "agent-backend";
    }>;
    handleUnauthorized(generation: number): Promise<"retry" | "logout">;
    watch(listener: (status: unknown) => void): () => void;
  }

  export interface McodeToolsHostLogger {
    info(message: string): void;
    warn(message: string): void;
  }

  export function startMcodeToolsAuthLeaseBroker(options: {
    readonly dataDir: string;
    readonly session: McodeToolsHostAuthSession;
    readonly logger?: McodeToolsHostLogger;
  }): Promise<McodeToolsAuthLeaseBroker>;

  export function validateMcodeToolsResource(options: {
    readonly resourceDir: string;
    readonly expectedBuildEnv: string;
  }): unknown;
}
