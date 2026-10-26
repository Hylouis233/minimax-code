// The Mini App catalogue, projected for the two surfaces that render it.
//
// Pure functions: a row list in, what a row says out. The picker and the plugin
// catalogue's apps area read the same projection, which is what makes them the
// same rows rather than two readings of the runtime that can disagree
// (ADR 0020, "Its rows and the plugin catalogue's apps area are the same rows").
//
// The runtime names five states and the row offers a different action for each,
// so the decision lives here rather than being re-derived in two components.

import type {
  WebuiMiniAppCatalogueRow,
  WebuiMiniAppRuntimeStatus,
} from "../../../../shared/contracts/miniapp.js";

/**
 * How many Mini Apps run at once.
 *
 * The runtime enforces it (`at most three run at once`, ADR 0020) and refuses a
 * fourth with `BUSY`. The number is repeated here only to say so in words before
 * the refusal arrives; it is not this client's rule to enforce.
 */
export const WEBUI_MINIAPP_CAPACITY = 3;

export interface WebuiMiniAppRow {
  readonly pluginId: string;
  /** The catalogue's display name, or the plugin id when it has none. */
  readonly name: string;
  readonly description: string;
  readonly iconUrl?: string;
  readonly status: WebuiMiniAppRuntimeStatus;
  /** The runtime's own failure code, when the row failed. */
  readonly errorCode?: string;
  /** The state in words, for the row. */
  readonly statusLabel: string;
  /** True while the runtime is up, which is when the row offers "stop". */
  readonly running: boolean;
  /**
   * False for a package that is installed but disabled.
   *
   * Such a row can be enabled but not started: the runtime refuses to launch a
   * disabled package, so offering "open" on it would be an action that always
   * fails.
   */
  readonly enabled: boolean;
  /**
   * True while a standalone presentation of this Mini App is live (ADR 0020).
   *
   * The inline view reports it and offers to switch; it does not start a second
   * presentation of the same app while this is true.
   */
  readonly detached: boolean;
  /** How many times a standalone presentation has been acquired. Moves on each. */
  readonly presentationRevision: number;
}

/** The state in words. A closed union in, a label out — never "unknown". */
export function webuiMiniAppStatusLabel(status: WebuiMiniAppRuntimeStatus): string {
  switch (status) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "failed":
      return "启动失败";
    case "stopped":
      return "已停止";
  }
}

/** One catalogue answer, as the surfaces render it. */
export function webuiMiniAppRows(
  miniApps: readonly WebuiMiniAppCatalogueRow[],
): readonly WebuiMiniAppRow[] {
  return miniApps.map((miniApp) => {
    // A disabled package has no runtime state to report: it is installed and not
    // startable, which is a fact about the package rather than about a process.
    const enabled = miniApp.enabled !== false;
    return {
      pluginId: miniApp.pluginId,
      name: miniApp.displayName || miniApp.pluginId,
      description: miniApp.description ?? "",
      ...(miniApp.iconUrl !== undefined ? { iconUrl: miniApp.iconUrl } : {}),
      status: miniApp.runtime.status,
      ...(miniApp.runtime.errorCode !== undefined ? { errorCode: miniApp.runtime.errorCode } : {}),
      statusLabel: enabled ? webuiMiniAppStatusLabel(miniApp.runtime.status) : "已停用",
      running: enabled && miniApp.runtime.status === "running",
      enabled,
      detached: miniApp.detached,
      presentationRevision: miniApp.presentationRevision,
    };
  });
}

/**
 * The browsing-context name a Mini App's standalone tab claims.
 *
 * `window.open` with a name either creates that context or focuses the one that
 * already has it, so this is the whole mechanism behind "switch to the tab
 * instead of opening a second document": the standalone surface sets its
 * `window.name` to this on mount, and the inline view opens or focuses the same
 * name. Deterministic from the plugin id because the two documents share nothing
 * but the service and this convention.
 */
export function webuiMiniAppWindowName(pluginId: string): string {
  return `webui-miniapp:${pluginId}`;
}

/** The rows that are up, in catalogue order. */
export function webuiMiniAppRunningRows(
  rows: readonly WebuiMiniAppRow[],
): readonly WebuiMiniAppRow[] {
  return rows.filter((row) => row.running);
}

/**
 * What a capacity refusal says: the limit, and which applications are using it.
 *
 * The person's next action is to stop one of them, so the refusal names them
 * rather than reporting a count — "3 running" is not something anyone can act on.
 */
export function webuiMiniAppCapacityText(rows: readonly WebuiMiniAppRow[]): string {
  const names = webuiMiniAppRunningRows(rows).map((row) => row.name);
  const running = names.length > 0 ? names.join("、") : "其他应用";
  return `同时最多运行 ${WEBUI_MINIAPP_CAPACITY} 个 Mini App，正在运行：${running}。请先停止一个再打开。`;
}

/**
 * What a refusal says, in words the person can act on.
 *
 * `OWNED_ELSEWHERE` is the runtime's answer when another client holds the app —
 * the message it carries names that client and its pid, and this client cannot
 * discover either on its own: the credential that reaches the app never leaves
 * the process that minted it, so "is it running elsewhere?" is answered by
 * trying to start it. The message is kept rather than replaced, because the
 * runtime is the only party that knows who the other client is.
 */
export function webuiMiniAppRefusalText(input: {
  readonly code: string;
  readonly message: string;
  readonly rows: readonly WebuiMiniAppRow[];
}): string {
  if (input.code === "BUSY") return webuiMiniAppCapacityText(input.rows);
  if (input.code === "OWNED_ELSEWHERE") return `已在其他客户端运行：${input.message}`;
  return input.message;
}

/** Why a view was cleared, in words. `undefined` means "still up". */
export function webuiMiniAppStopReason(row: WebuiMiniAppRow | undefined): string | undefined {
  if (!row) return "该应用已不在应用列表中。";
  if (row.status === "failed") {
    return row.errorCode ? `运行失败（${row.errorCode}）。` : "运行失败。";
  }
  if (row.status === "stopped") return "运行已停止。";
  return undefined;
}
