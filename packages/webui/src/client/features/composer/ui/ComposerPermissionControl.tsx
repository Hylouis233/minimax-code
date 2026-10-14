// The composer's permission-mode control: the pill and the popover it opens
// (T13 criterion 5 — part of the toolbar unit).
//
// The pill, its option table and the popover were 58 lines of the composer
// render plus four module constants that only this control reads. They live
// here now, together with the one glyph-per-mode helper, so what the control
// can say is defined beside the control.
//
// Two pieces deliberately stayed with the composer and arrive as props: the
// open flag and the wrap ref, because the composer's dismiss group coordinates
// this surface with the `+` menu and the mention range in one listener, and the
// trigger's click also closes those. The control therefore reports the intent
// (`onToggleRequest`, `onClose`) instead of owning that coordination.

import type { ReactElement, Ref } from "react";

import type { WebuiPermissionMode } from "../../../features/settings/contracts/settings-port.js";
import type { WebuiIconProps } from "../../../components/shell/icons.js";
import {
  WebuiIconCheck,
  WebuiIconChevronDown,
  WebuiIconPermissionAuto,
  WebuiIconPermissionFull,
  WebuiIconPermissionRequest,
} from "../../../components/shell/icons.js";

type WebuiComposerPermissionMode = WebuiPermissionMode;

const PERMISSION_MODE_ORDER = ["default", "auto", "bypassPermissions"] as const;

interface WebuiComposerPermissionOption {
  readonly label: string;
  readonly description: string;
  readonly Icon: (props: WebuiIconProps) => ReactElement;
}

/** The popover's own question, and where "了解更多" points. The docs page is the
 *  public one the README already links; `/permission` is documented there. */
const PERMISSION_MODE_QUESTION = "应如何批准 minimax code 操作?";
const PERMISSION_MODE_LEARN_MORE = "了解更多";
const PERMISSION_MODE_DOCS_URL = "https://agent.minimax.io/docs/cli/features";

/** Ordered most-restrictive first, mirroring the `ask` / `auto` / `full` actions
 *  the `/permission` command takes. */
const PERMISSION_MODE_OPTION: Readonly<Record<WebuiComposerPermissionMode, WebuiComposerPermissionOption>> = {
  default: {
    label: "请求批准",
    description: "编辑外部文件和使用互联网时始终询问",
    Icon: WebuiIconPermissionRequest,
  },
  auto: {
    label: "帮我批准",
    description: "仅对检测到的风险操作请求批准",
    Icon: WebuiIconPermissionAuto,
  },
  bypassPermissions: {
    label: "完全访问权限",
    description: "可不受限制地访问互联网和你电脑上的任何文件",
    Icon: WebuiIconPermissionFull,
  },
};

/** The trigger and the rows share one glyph per mode, so the pill always
 *  previews the icon the popover marks as selected. */
function PermissionModeIcon({ mode }: { readonly mode: WebuiComposerPermissionMode }): ReactElement {
  const { Icon } = PERMISSION_MODE_OPTION[mode];
  return <Icon className="webui-composer-permission-icon" />;
}

export interface WebuiComposerPermissionControlProps {
  /** The live mode; `undefined` while the settings read has not answered. */
  readonly mode: WebuiComposerPermissionMode | undefined;
  readonly busy: boolean;
  readonly unavailable: boolean;
  readonly menuOpen: boolean;
  /** The wrap the composer's dismiss group tests containment against. */
  readonly wrapRef: Ref<HTMLDivElement>;
  /** The trigger was pressed: the composer closes the other surfaces and toggles. */
  readonly onToggleRequest: () => void;
  readonly onClose: () => void;
  readonly onChangeMode: (mode: WebuiComposerPermissionMode) => void;
}

export function WebuiComposerPermissionControl({
  mode,
  busy,
  unavailable,
  menuOpen,
  wrapRef,
  onToggleRequest,
  onClose,
  onChangeMode,
}: WebuiComposerPermissionControlProps) {
  return (
    <div className="webui-composer-permission-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`webui-composer-permission-button${mode === "bypassPermissions" ? " webui-composer-permission-button--warning" : ""}`}
        aria-label={mode ? `授权模式：${PERMISSION_MODE_OPTION[mode].label}` : "授权模式"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={unavailable || busy || !mode}
        title={unavailable ? "授权模式当前不可用" : undefined}
        data-testid="composer-permission-mode"
        onClick={onToggleRequest}
      >
        {mode ? <PermissionModeIcon mode={mode} /> : <WebuiIconPermissionRequest className="webui-composer-permission-icon" />}
        <span>{mode ? PERMISSION_MODE_OPTION[mode].label : unavailable ? "授权不可用" : "读取授权模式…"}</span>
        <WebuiIconChevronDown className="webui-composer-permission-chevron" />
      </button>
      {menuOpen ? <div className="webui-composer-permission-menu" role="menu" aria-label={PERMISSION_MODE_QUESTION} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
        <div className="webui-composer-permission-header">
          <span className="webui-composer-permission-question">{PERMISSION_MODE_QUESTION}</span>
          <a
            className="webui-composer-permission-learn-more"
            href={PERMISSION_MODE_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {PERMISSION_MODE_LEARN_MORE}
          </a>
        </div>
        {PERMISSION_MODE_ORDER.map((option) => {
          const { label, description, Icon } = PERMISSION_MODE_OPTION[option];
          const active = mode === option;
          return (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              className="webui-composer-permission-option"
              disabled={busy}
              onClick={() => onChangeMode(option)}
            >
              <Icon className="webui-composer-permission-icon" />
              <span className="webui-composer-permission-copy">
                <span className="webui-composer-permission-label">{label}</span>
                <span className="webui-composer-permission-description">{description}</span>
              </span>
              {active ? <WebuiIconCheck className="webui-composer-permission-check" /> : null}
            </button>
          );
        })}
      </div> : null}
    </div>
  );
}
