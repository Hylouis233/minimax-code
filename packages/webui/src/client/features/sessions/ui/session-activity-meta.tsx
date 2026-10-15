// SessionActivityMeta — extracted from `SessionRail.tsx` (T07's responsibility cut of the rail).
// The declaration body is verbatim; the `export` keyword, this header and the
// import specifiers are the only differences.

import { type ReactElement } from "react";
import { WebuiIconSessionPinMark, WebuiIconSessionStarMark } from "../../../shell/icons.js";
import {
  formatWebuiSessionAge,
  type WebuiSessionActivityMap,
} from "../projection/session-activity.js";
import { formatWebuiUnreadBadge } from "../../../projection/common/unread-badge.js";
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
  pinned = false,
  starred = false,
}: {
  readonly session: WebuiClientSession;
  readonly activity?: WebuiSessionActivityMap;
  readonly now?: number;
  /** Draws the standing pin mark. Independent of the live state below it. */
  readonly pinned?: boolean;
  /** Draws the standing star mark. Also independent of the live state. */
  readonly starred?: boolean;
}): ReactElement | null {
  // `pinned` and `starred` join the guard rather than riding on it. A host that
  // passes neither an activity map nor a clock is the rail rendered outside the
  // app (SSR fixtures, and any host that does not subscribe) -- exactly the case
  // where a marked row has no running/unread signal to read its state against,
  // so swallowing the mark there loses the only thing the row was saying.
  if (!activity && now === undefined && !pinned && !starred) return null;
  const entry = activity?.[session.sessionId];
  const busy = entry?.busy;
  const badge = formatWebuiUnreadBadge(entry?.unread);
  return (
    <span className="webui-rail-session-meta">
      {pinned ? (
        <span
          className="webui-rail-pin-mark"
          data-webui-pin-mark="true"
          title="已置顶"
          aria-label="已置顶"
          role="img"
        >
          <WebuiIconSessionPinMark />
        </span>
      ) : null}
      {starred ? (
        <span
          className="webui-rail-star-mark"
          data-webui-star-mark="true"
          title="已收藏"
          aria-label="已收藏"
          role="img"
        >
          <WebuiIconSessionStarMark />
        </span>
      ) : null}
      {badge ? (
        <span
          className="webui-rail-unread-badge"
          role="status"
          aria-label={`${badge} 条未读`}
          data-webui-unread-badge={entry?.unread}
        >
          {badge}
        </span>
      ) : null}
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
