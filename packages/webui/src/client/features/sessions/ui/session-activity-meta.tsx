// SessionActivityMeta — extracted from `SessionRail.tsx`.
// The declaration body is verbatim; the `export` keyword, this header and the
// import specifiers are the only differences.

import { type ReactElement } from "react";
import {
  formatWebuiSessionAge,
  type WebuiSessionActivityMap,
} from "../projection/session-activity.js";
import type { WebuiClientSession } from "../contracts/session-view.js";

/**
 * The right-hand end of a rail row: a spinner while a turn holds the session,
 * and how long ago it was last active.
 *
 * Shared by all three row shapes -- project rows, child rows, and the flat
 * "all sessions" list -- so a session reads the same wherever it is listed.
 * Renders nothing when the host passes neither map nor clock, which is what
 * keeps the existing snapshots and SSR fixtures byte-identical: the rail is
 * also rendered outside the app (`webui-w0-ssr-fixtures`), where there is no
 * subscription and no clock to format against.
 */
export function SessionActivityMeta({
  session,
  activity,
  now,
}: {
  readonly session: WebuiClientSession;
  readonly activity?: WebuiSessionActivityMap;
  readonly now?: number;
}): ReactElement | null {
  if (!activity && now === undefined) return null;
  const entry = activity?.[session.sessionId];
  const busy = entry?.busy;
  return (
    <span className="webui-rail-session-meta">
      {busy ? (
        <span
          className="webui-rail-spinner"
          role="status"
          aria-label={busy.busyReason === "compaction" ? "正在压缩上下文" : "正在运行"}
        />
      ) : null}
      <span data-webui-session-age="true">
        {formatWebuiSessionAge(entry?.lastActivityAt ?? session.updatedAt, now ?? session.updatedAt)}
      </span>
    </span>
  );
}
