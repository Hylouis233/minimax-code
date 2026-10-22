// Small cross-business presentation atoms for icon-only form actions.

import type { ReactElement, ReactNode } from "react";
import { IconRefresh, IconX } from "@tabler/icons-react";

export function IconButton({ label, disabled = false, onClick, children }: { readonly label: string; readonly disabled?: boolean; readonly onClick: () => void; readonly children: ReactNode }): ReactElement {
  return <button type="button" aria-label={label} disabled={disabled} className="flex size-7 items-center justify-center text-icon_default_tertiary hover:text-icon_default_secondary disabled:cursor-default disabled:opacity-60" onClick={onClick}>{children}</button>;
}

export function CloseIcon(): ReactElement {
  return <IconX aria-hidden="true" size={16} stroke={1.7} />;
}

export function RefreshIcon(): ReactElement {
  return <IconRefresh aria-hidden="true" size={16} stroke={1.7} />;
}
