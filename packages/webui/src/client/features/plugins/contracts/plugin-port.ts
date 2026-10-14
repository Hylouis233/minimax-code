// Plugin capability port.
//
// Plugin management and the skill catalogue. Split from the monolithic
// `WebuiTransport` in the former `client/contracts.ts`; `transport.ts` composes
// it. Every method stays optional — `undefined` means "the operation is not
// wired".
//
// `listSkills` was declared on `SettingsPort` until the port re-file (plan §9,
// ticket #59). The operator's decision of 2026-10-12 files it here: the skill
// catalogue is `plugins`' surface, and §9's "count the port's actions, not its
// members" rule is why a one-member port is not a reason to leave it where the
// server's own grouping happens to put it.
//
// `pluginManagement` carries 29 actions behind its one member
// (`docs/webui/plugin-action-inventory.md`), which is the figure this port's
// business scope is measured by rather than its member count.

import type { WebuiPluginManagementRequest } from "../../../../shared/plugin-management.js";

export interface PluginPort {
  readonly pluginManagement?: (request: WebuiPluginManagementRequest) => Promise<unknown>;
  readonly listSkills?: (request?: {
    readonly agentName?: string;
  }) => Promise<{
    readonly skills: readonly {
      readonly name: string;
      readonly displayName?: string;
      readonly description?: string;
    }[];
  }>;
}
