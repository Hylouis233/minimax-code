// Browser transport — the single bag of methods the foundation app and the
// composer consume.
//
// Composed from the eight capability ports, one per capability group. It
// declares no method of its own: every operation lives in exactly one port and
// this type only joins them. Every method stays optional — `undefined` means
// "the operation is not wired" (the panel renders the affected area
// conditionally), the transport itself is optional (so a test that renders the
// shell with no transport still gets a "no operations" view), and optional
// inputs stay optional.
//
// No React imports here — this is a pure type that lives in the contracts
// layer so the props layer (app.tsx) and the transport implementation
// (`client/infrastructure/transport.ts`) both import it without crossing
// boundaries.

import type { SessionPort } from "./sessions/session-port.js";
import type { TurnExecutionPort } from "./turn/execution-port.js";
import type { ComposerPort } from "./composer/composer-port.js";
import type { ShellEventPort } from "./shell/event-port.js";
import type { InteractionPort } from "./interactions/interaction-port.js";
import type { GoalPort } from "./goal/goal-port.js";
import type { WorkspacePort } from "./workspace/workspace-port.js";
import type { SettingsPort } from "./settings/settings-port.js";
import type { ModelsPort } from "./models/models-port.js";
import type { TranscriptPort } from "./transcript/transcript-port.js";
import type { AccountPort } from "./account/account-port.js";
import type { PluginPort } from "./plugins/plugin-port.js";
import type { TerminalPort } from "./workspace/terminal-port.js";

export interface WebuiTransport
  extends SessionPort,
    TranscriptPort,
    TurnExecutionPort,
    ComposerPort,
    ShellEventPort,
    InteractionPort,
    GoalPort,
    WorkspacePort,
    SettingsPort,
    ModelsPort,
    AccountPort,
    PluginPort,
    TerminalPort {}
