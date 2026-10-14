export interface ProviderHeaderDraft {
  readonly id: string;
  readonly name: string;
  readonly value: string;
  readonly persistedName?: string;
}

export interface ProviderHeadersProjection {
  readonly headers?: Readonly<Record<string, string>>;
  readonly removeHeaders?: readonly string[];
  readonly error?: "duplicate-name" | "missing-value";
}

export function getActiveSourceBadge(
  loaded: boolean,
  source: "token_plan" | "minimax_api_key" | undefined,
  hasTokenPlan: boolean,
): "使用中" | "未启用" | undefined {
  if (!loaded || !hasTokenPlan || source === undefined) return undefined;
  return source === "token_plan" ? "使用中" : "未启用";
}

/** Keep saved header values unless their row is renamed or removed. */
export function projectProviderHeaders(
  rows: readonly ProviderHeaderDraft[],
  originalNames: readonly string[],
): ProviderHeadersProjection {
  const names = rows.map((row) => row.name.trim()).filter(Boolean);
  const normalized = names.map((name) => name.toLowerCase());
  if (new Set(normalized).size !== normalized.length) return { error: "duplicate-name" };
  if (rows.some((row) => row.name.trim() && !row.value.trim() && (!row.persistedName || row.name.trim().toLowerCase() !== row.persistedName.toLowerCase()))) {
    return { error: "missing-value" };
  }

  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (name && value) headers[name] = value;
  }
  const keptNames = new Set(rows.map((row) => row.name.trim().toLowerCase()));
  const removeHeaders = originalNames.filter((name) => !keptNames.has(name.toLowerCase()));
  return {
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(removeHeaders.length ? { removeHeaders } : {}),
  };
}

function formatRemainingTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}分${seconds ? `${seconds}秒` : ""}`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}小时${minutes ? `${minutes}分` : ""}`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}天${remainingHours ? `${remainingHours}小时` : ""}`;
}

/** Desktop reset_after wording, with its under-one-minute time-only branch. */
export function formatResetLabel(resetAtMs: number | undefined, nowMs: number): string | undefined {
  if (resetAtMs === undefined || !Number.isFinite(resetAtMs)) return undefined;
  const remainingSeconds = Math.ceil((resetAtMs - nowMs) / 1000);
  if (remainingSeconds <= 0) return undefined;
  const time = formatRemainingTime(remainingSeconds);
  return remainingSeconds < 60 ? time : `${time}后重置`;
}
