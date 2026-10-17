// The Composer-facing plugin catalogue.
//
// The composer needed two things from this business and had to reach past the
// owner for both:
//
//   * it called `pluginManagement({ action: "listInstalledPlugins", ... })`
//     directly — a raw wire verb, spelled by a caller that had no business
//     knowing it — and then re-derived the rows it wanted out of whatever came
//     back, with its own copy of the "the runtime spells this list three ways"
//     rule;
//   * it read runtime skills through the port's own `listSkills` member and
//     cached them in a ref inside the component, so the skills the composer
//     showed and the skills the plugin manager listed were two unrelated
//     requests with two unrelated lifetimes.
//
// Both are the same mistake: the composer's view of what is installed is a
// business fact, so it is answered here and the composer asks a question.
//
// The identity rule matters here. This read is keyed and cached
// under its own key, deliberately not shared with the management owner's
// selection: opening the composer menu must not overwrite what the plugin
// manager is showing, and a management reload must not blank the mention list.
// Two readers, two identities, one wire.
//
// The catalogue SHAPE — `WebuiComposerPluginCatalogue`, `WebuiComposerPluginSummary`
// and `WebuiComposerSkillSummary` — lives in the published sibling
// `composer-catalogue.public.ts`, so the composer and its `+` menu read the
// owner's published types rather than a peer's private module. The creator and
// the runtime cache stay here because a peer reads the catalogue, it does not
// build one.

import {
  webuiPluginRows,
  type WebuiPluginActions,
} from "../contracts/plugin-actions.js";
import type {
  WebuiComposerPluginCatalogue,
  WebuiComposerPluginSummary,
  WebuiComposerSkillSummary,
} from "./composer-catalogue.public.js";

/** How many installed plugins the composer asks for. */
const COMPOSER_PLUGIN_LIMIT = 200;

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export function createWebuiComposerPluginCatalogue(deps: {
  readonly actions: WebuiPluginActions;
  /** The port's own `listSkills`, absent on a runtime that predates it. */
  readonly listSkills?: (request?: {
    readonly agentName?: string;
  }) => Promise<{
    readonly skills: readonly {
      readonly name: string;
      readonly displayName?: string;
      readonly description?: string;
    }[];
  }>;
}): WebuiComposerPluginCatalogue {
  const { actions } = deps;
  // Separate maps, separate keys: the two readers below must not share a slot.
  //
  // Each map is a cache with no clock, so something has to say when a slot went
  // stale. That is the `invalidate*` pair below, and the assembly calls it off
  // the plugin writes themselves — the catalogue is a reader, and the fact that
  // something it reads changed is owned by whoever wrote it, not by whichever
  // view happens to be looking at a cached answer when it does.
  const pluginReads = new Map<string, Promise<readonly WebuiComposerPluginSummary[]>>();
  const skillReads = new Map<string, Promise<readonly WebuiComposerSkillSummary[]>>();

  return {
    available: actions.available,

    installedPlugins: () => {
      const key = `installed:${COMPOSER_PLUGIN_LIMIT}`;
      const started = pluginReads.get(key);
      if (started) return started;
      const request = actions
        .invoke("listInstalledPlugins", { limit: COMPOSER_PLUGIN_LIMIT })
        .then((result) =>
          webuiPluginRows(result, "plugins").map((row): WebuiComposerPluginSummary => {
            // The runtime spells a plugin's name three ways; the menu only ever
            // needed one, and which one it picked was decided here.
            const name = text(row, "name") || text(row, "pluginName");
            const displayName = text(row, "displayName") || name;
            const description = text(row, "description");
            return { name, displayName, ...(description ? { description } : {}) };
          }).filter((plugin) => plugin.name),
        )
        .catch((reason: unknown) => {
          // A failed read must not be cached as the answer, or the menu would
          // stay empty until the page reloaded.
          pluginReads.delete(key);
          throw reason;
        });
      pluginReads.set(key, request);
      return request;
    },

    invalidatePlugins: () => {
      pluginReads.clear();
    },

    invalidateSkills: (agentName) => {
      skillReads.delete(agentName ?? "");
    },

    runtimeSkills: (agentName) => {
      const listSkills = deps.listSkills;
      if (!listSkills) {
        return Promise.reject(new Error("技能目录暂不可用"));
      }
      const key = agentName ?? "";
      const started = skillReads.get(key);
      if (started) return started;
      const request = listSkills({ agentName })
        .then((result) => result.skills)
        .catch((reason: unknown) => {
          skillReads.delete(key);
          throw reason;
        });
      skillReads.set(key, request);
      return request;
    },
  };
}