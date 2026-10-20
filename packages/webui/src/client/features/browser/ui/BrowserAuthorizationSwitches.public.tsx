// The four browser authorization switches, as Settings renders them.
//
// Three browser switches and one Full CDP switch, and the separation is the
// point rather than the layout. A browser switch says *a browser may be launched
// or reached*; Full CDP says *a caller may send any DevTools command the provider
// supports*. They are different risks — the second widens the command set of a
// browser that is already on — so Full CDP lives in its own section, is described
// in terms of the command set, and is never folded into the surface rows. The
// ADR forbids the combined switch precisely because it would make it impossible
// to grant one without granting the rest.
//
// Every switch is off by default, from the shared
// `WEBUI_BROWSER_AUTHORIZATION_DEFAULT` rather than from four literals here: the
// default is a product decision that already lives in one place, and a second
// copy is a second answer to it.
//
// A switch with no baseline is *disabled*, not merely rendered off. The person
// cannot see what they are changing, and a write on top of a state nobody read is
// how a setting gets flipped by accident.
//
// `.public` because the Settings surface mounts it — the browser business owns
// the vocabulary, and a settings-local copy of these switches is a second answer
// to the same authorization question.

import type { ReactElement } from "react";
import {
  WEBUI_BROWSER_AUTHORIZATION_DEFAULT,
  type WebuiBrowserAuthorization,
  type WebuiBrowserSurface,
} from "../../../../shared/contracts/browser.js";
import type { WebuiBrowserAuthorizationToggle } from "../contracts/browser-port.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import { SettingsRow, SettingsSection } from "../../../ui/settings-layout.js";

const SURFACE_ROWS: readonly { readonly surface: WebuiBrowserSurface; readonly title: string; readonly description: string }[] = [
  {
    surface: "isolated-chromium",
    title: "隔离浏览器",
    description: "允许启动本进程自带的隔离浏览器，并在浏览器面板中显示它的画面。",
  },
  {
    surface: "edge",
    title: "Microsoft Edge",
    description: "允许通过扩展连接你已经打开的 Edge，并显示它可访问的标签页。",
  },
  {
    surface: "chrome",
    title: "Google Chrome",
    description: "允许通过扩展连接你已经打开的 Chrome，并显示它可访问的标签页。",
  },
];

const FULL_CDP_DESCRIPTION =
  "扩大可发送的 DevTools 命令范围，包含诊断与浏览器内部的敏感能力。打开它不会启用任何浏览器：每个浏览器仍需单独授权，且关闭它不会影响已启用浏览器上的普通浏览器操作。";

export interface BrowserAuthorizationSwitchesProps {
  /** The four switches as they stand. Absent means "never read". */
  readonly authorization?: WebuiBrowserAuthorization;
  /**
   * Called with the one switch that moved, not with a whole authorization — the
   * caller maps it through `webuiBrowserAuthorizationChange()` and sends it, so
   * this component never has to know the wire's shape.
   */
  readonly onChange?: (toggle: WebuiBrowserAuthorizationToggle) => void;
  /** Held off while a write is in flight, or when the host cannot take one. */
  readonly disabled?: boolean;
}

export function BrowserAuthorizationSwitches({
  authorization,
  onChange,
  disabled = false,
}: BrowserAuthorizationSwitchesProps): ReactElement {
  // The documented default stands in for a read that has not happened, and the
  // switches stay disabled so nothing can be written over it.
  const current = authorization ?? WEBUI_BROWSER_AUTHORIZATION_DEFAULT;
  const readOnly = disabled || !authorization || !onChange;

  const value = (surface: WebuiBrowserSurface): boolean =>
    surface === "isolated-chromium"
      ? current.isolatedChromium
      : surface === "edge"
        ? current.edge
        : current.chrome;

  return (
    <>
      <SettingsSection title="浏览器" testId="browser-authorization-surfaces" hint="每个浏览器单独授权，默认全部关闭。">
        {SURFACE_ROWS.map((row) => (
          <SettingsRow
            key={row.surface}
            title={row.title}
            description={row.description}
            testId={`browser-authorization-${row.surface}-row`}
          >
            <ToggleSwitch
              checked={value(row.surface)}
              label={row.title}
              testId={`browser-authorization-${row.surface}`}
              disabled={readOnly}
              onChange={(checked) => onChange?.({ surface: row.surface, enabled: checked })}
            />
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Full CDP 访问" testId="browser-authorization-full-cdp">
        <SettingsRow
          title="Full CDP 访问"
          description={FULL_CDP_DESCRIPTION}
          testId="browser-authorization-full-cdp-row"
        >
          <ToggleSwitch
            checked={current.fullCdp}
            label="Full CDP 访问"
            testId="browser-authorization-full-cdp"
            disabled={readOnly}
            onChange={(checked) => onChange?.({ surface: "full-cdp", enabled: checked })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
