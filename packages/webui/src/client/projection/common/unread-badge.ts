// The unread badge rule.
//
// It decides how many unread turns to draw, nothing else; the counts themselves
// are stored by `platform/storage.ts`.

/** Above this the badge says "99+" -- a 4-digit pill has nowhere to go. */
export const SESSION_UNREAD_BADGE_MAX = 99;

/** The number to draw. `0` and `undefined` both render as no badge at all. */
export function formatWebuiUnreadBadge(count: number | undefined): string {
  if (!count || count <= 0) return "";
  return count > SESSION_UNREAD_BADGE_MAX ? `${SESSION_UNREAD_BADGE_MAX}+` : String(count);
}
