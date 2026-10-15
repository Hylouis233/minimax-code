// WebuiContextMenu — the floating right-click menu, plus the placement helper
// and item shape that drive it.
//
// W3 tier 2 lift: `placeWebuiContextMenu` (placement helper), `WebuiContextMenuItem`
// (item type), and `WebuiContextMenu` (renderer) were moved verbatim out of the
// module that used to hold the shell — `app.tsx`, since replaced by
// `WebuiClientFoundationApp.tsx`. The bodies are byte-identical to what used to
// live there; the lift was move-only, and consumers import them from this file.

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { WebuiIconContextChevron } from "../shell/icons.js";
import { evaluateOutsideClose } from "../../projection/common/outside-close.js";
import { useWebuiBrowserCapabilities } from "../../bindings/browser-capabilities.js";
import { placeWebuiContextMenu } from "../../projection/common/context-menu.js";

export type WebuiContextMenuItem =
  | { readonly kind: "divider"; readonly key: string }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly label: string;
      readonly icon?: ReactElement;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly onSelect?: () => void | Promise<void>;
      readonly submenu?: readonly WebuiContextMenuItem[];
    };

export function WebuiContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly items: readonly WebuiContextMenuItem[];
  readonly onClose: () => void;
}): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string>();
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    setPosition({ left: x, top: y });
  }, [x, y]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof window === "undefined") return;
    const next = placeWebuiContextMenu({
      x,
      y,
      width: menu.offsetWidth,
      height: menu.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  }, [items, x, y]);
  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const insideContainer =
        menuRef.current?.contains(event.target as Node) ?? false;
      // ContextMenu's per-surface variant subscribes to `mousedown` (NOT
      // `pointerdown` — desktop parity) + `keydown`; Escape closes. Routing
      // through `evaluateOutsideClose` keeps the four call sites
      // consistent without changing the original close semantics.
      if (
        evaluateOutsideClose({
          surface: "contextMenu",
          kind: "mousedown",
          insideContainer,
        }) === "close"
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        evaluateOutsideClose({
          surface: "contextMenu",
          kind: "keydown",
          key: event.key,
          insideContainer: false,
        }) === "close"
      ) {
        onClose();
      }
    };
    const stopMouseDown = dom.listenForMouseDown(handlePointerDown);
    const stopKeyDown = dom.listenForKeyDown(handleKeyDown);
    return () => {
      stopMouseDown();
      stopKeyDown();
    };
  }, [dom, onClose]);
  const renderItems = (menuItems: readonly WebuiContextMenuItem[]) =>
    menuItems.map((item) => {
      if (item.kind === "divider") {
        return <div key={item.key} className="webui-context-menu-divider" role="separator" />;
      }
      const hasSubmenu = Boolean(item.submenu?.length);
      return (
        <div
          key={item.key}
          className="webui-context-menu-item-wrap"
          onMouseEnter={() => hasSubmenu && setOpenSubmenu(item.key)}
          onMouseLeave={() => hasSubmenu && setOpenSubmenu(undefined)}
        >
          <button
            type="button"
            className={`webui-context-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            aria-disabled={item.disabled ? "true" : undefined}
            onClick={() => {
              if (hasSubmenu) {
                setOpenSubmenu((current) => (current === item.key ? undefined : item.key));
                return;
              }
              onClose();
              void item.onSelect?.();
            }}
          >
            <span className="webui-context-menu-item-icon">{item.icon ?? null}</span>
            <span className="webui-context-menu-item-label">{item.label}</span>
            {hasSubmenu ? <WebuiIconContextChevron className="webui-context-menu-chevron" /> : null}
          </button>
          {hasSubmenu && openSubmenu === item.key ? (
            <div className="webui-context-menu-submenu" role="menu">
              {renderItems(item.submenu ?? [])}
            </div>
          ) : null}
        </div>
      );
    });
  const menu = (
    <div
      ref={menuRef}
      role="menu"
      data-webui-context-menu="true"
      className="webui-context-menu"
      style={{ left: position.left, top: position.top }}
    >
      {renderItems(items)}
    </div>
  );
  const portalTarget = dom.portalTarget();
  return portalTarget ? createPortal(menu, portalTarget) : menu;
}
