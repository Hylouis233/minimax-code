// Two stroke glyphs the settings dialog and the workspace review page both use.
//
// They were declared inside `SettingsModal.tsx`; the review page moved to
// `components/workspace/` (plan §5.6's `workspace` row) and needs the same two,
// so they live here rather than being copied. `client/icons.tsx` has a folder and
// a search icon, but they are filled paths with different geometry — substituting
// them would change what the user sees, which this programme does not do to save
// a file.

import type { ReactElement } from "react";

export function SearchIcon(): ReactElement { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="8.8" cy="8.8" r="6.1" stroke="currentColor" strokeWidth="1.4" /><path d="m13.3 13.3 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>; }
export function FolderIcon(): ReactElement { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M2.7 5.7c0-.7.5-1.2 1.2-1.2h4l1.6 1.8h6.6c.7 0 1.2.5 1.2 1.2v7.1c0 .7-.5 1.2-1.2 1.2H3.9c-.7 0-1.2-.5-1.2-1.2V5.7Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /></svg>; }
