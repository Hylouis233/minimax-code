// Small presentation atoms the settings surfaces share: two stroke glyphs, an icon button and
// the close/refresh glyphs it and the provider form both use.
//
// They were declared inside `SettingsModal.tsx`; the review page moved to
// `components/workspace/` (plan §5.6's `workspace` row) and needs the same two,
// so they live here rather than being copied. `client/icons.tsx` has a folder and
// a search icon, but they are filled paths with different geometry — substituting
// them would change what the user sees, which this programme does not do to save
// a file.
//
// `IconButton`, `CloseIcon` and `RefreshIcon` moved here for the same reason when the
// provider form was carved out of `UsageModelSettings` (ticket #71): both files use
// them, and copying their markup into a second file is the duplication §5.1's fourth
// prohibition rules out.

import type { ReactElement, ReactNode } from "react";

export function SearchIcon(): ReactElement { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="8.8" cy="8.8" r="6.1" stroke="currentColor" strokeWidth="1.4" /><path d="m13.3 13.3 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>; }
export function FolderIcon(): ReactElement { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M2.7 5.7c0-.7.5-1.2 1.2-1.2h4l1.6 1.8h6.6c.7 0 1.2.5 1.2 1.2v7.1c0 .7-.5 1.2-1.2 1.2H3.9c-.7 0-1.2-.5-1.2-1.2V5.7Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /></svg>; }

export function IconButton({ label, disabled = false, onClick, children, viewBox = "0 0 16 16", svgFill = "currentColor" }: { readonly label: string; readonly disabled?: boolean; readonly onClick: () => void; readonly children: React.ReactNode; readonly viewBox?: "0 0 16 16" | "0 0 20 20"; readonly svgFill?: "none" | "currentColor" }): ReactElement {
  return <button type="button" aria-label={label} disabled={disabled} className="flex size-7 items-center justify-center text-icon_default_tertiary hover:text-icon_default_secondary disabled:cursor-default disabled:opacity-60" onClick={onClick}><svg aria-hidden="true" width="16" height="16" viewBox={viewBox} fill={svgFill}>{children}</svg></button>;
}

export function CloseIcon(): ReactElement {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.2636 4.02491C11.4587 3.82986 11.7754 3.83007 11.9706 4.02491C12.1658 4.22015 12.1658 4.5367 11.9706 4.73194L8.7099 7.99268L11.9706 11.2534C12.1657 11.4487 12.1659 11.7652 11.9706 11.9605C11.7754 12.1556 11.4589 12.1555 11.2636 11.9605L8.00287 8.69971L4.74213 11.9605C4.54688 12.1556 4.23033 12.1556 4.0351 11.9605C3.84027 11.7652 3.84008 11.4486 4.0351 11.2534L7.29584 7.99268L4.0351 4.73194C3.84024 4.53666 3.84 4.22004 4.0351 4.02491C4.23022 3.82978 4.54683 3.83005 4.74213 4.02491L8.00287 7.28565L11.2636 4.02491Z" fill="currentColor" /></svg>;
}

export function RefreshIcon(): ReactElement {
  return <path d="M17.1134 2.28793C17.4446 2.28807 17.714 2.55625 17.714 2.88754V6.83871C17.7139 6.90647 17.6986 6.97031 17.6778 7.0311C17.6737 7.04327 17.672 7.05627 17.6671 7.06821C17.6211 7.17887 17.543 7.2721 17.4444 7.33774C17.4279 7.34876 17.41 7.35685 17.3927 7.36606C17.3761 7.37488 17.3603 7.38516 17.3429 7.39243C17.3232 7.40058 17.3025 7.405 17.2823 7.41098C17.2645 7.41626 17.2471 7.42299 17.2286 7.42661C17.1905 7.43409 17.152 7.43925 17.1134 7.4393H13.1622C12.8309 7.4393 12.5627 7.17002 12.5626 6.83871C12.5627 6.50747 12.8309 6.23911 13.1622 6.23911H15.6641L14.9024 5.47739V5.47641C13.5816 4.21108 11.8278 3.48724 10.0001 3.48715C8.71218 3.48721 7.4528 3.86932 6.38192 4.58481C5.311 5.30039 4.47641 6.31773 3.98348 7.50766C3.49059 8.69761 3.36214 10.0071 3.61337 11.2704C3.86468 12.5336 4.48483 13.6946 5.39559 14.6053C6.30627 15.5158 7.46655 16.1363 8.72958 16.3875C9.99263 16.6387 11.3025 16.5101 12.4923 16.0174C13.6822 15.5245 14.6996 14.6889 15.4151 13.618C16.1306 12.5471 16.5128 11.2878 16.5128 9.99985C16.5129 9.66861 16.7821 9.40024 17.1134 9.40024C17.4443 9.40061 17.7128 9.66885 17.713 9.99985C17.7129 11.5252 17.2606 13.0167 16.4132 14.285C15.5658 15.5532 14.3613 16.5421 12.9522 17.1258C11.5432 17.7095 9.99206 17.8617 8.49618 17.5643C7.00027 17.2667 5.62552 16.5323 4.54696 15.4539C3.46838 14.3754 2.73325 13.0008 2.43563 11.5047C2.13807 10.0087 2.29135 8.45793 2.87508 7.04868C3.45884 5.63941 4.44759 4.4352 5.71591 3.58774C6.9841 2.74043 8.47489 2.28799 10.0001 2.28793C12.1508 2.28802 14.2035 3.14088 15.7423 4.61996L16.5138 5.39145V2.88754C16.5138 2.55626 16.7821 2.28808 17.1134 2.28793Z" fill="currentColor" />;
}
