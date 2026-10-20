// The Browser panel's markup.
//
// Rendered with `renderToStaticMarkup`, which runs no effects — so the injected
// port acts purely as a capability-presence toggle here and none of its callbacks
// is invoked. What is asserted is what the panel says and shows in the frame a
// person sees before any load resolves, plus the two things a static render is
// uniquely good at proving: that the picture is an `<img>` over a `data:` URL and
// not an embedded document, and that the switch row a Settings page mounts is
// four independent switches with Full CDP apart from the other three.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import {
  WEBUI_BROWSER_AUTHORIZATION_DEFAULT,
  type WebuiBrowserAuthorization,
  type WebuiBrowserTargetState,
} from "../../src/shared/contracts/browser.js";
import type { BrowserPort } from "../../src/client/features/browser/contracts/browser-port.js";
import { initialWebuiBrowserPanelState, reduceWebuiBrowserPanelState } from "../../src/client/features/browser/projection/browser-state.js";
import { BrowserPanel } from "../../src/client/features/browser/ui/BrowserPanel.public.js";
import {
  BrowserAuthorizationSwitches,
  BrowserInstallationKey,
} from "../../src/client/features/browser/ui/BrowserAuthorizationSwitches.public.js";

function targetState(overrides: Partial<WebuiBrowserTargetState> = {}): WebuiBrowserTargetState {
  return {
    id: { surface: "isolated-chromium", browserId: "chromium-1", targetId: "tab-1", generation: 4 },
    title: "Example Domain",
    url: "https://example.test/",
    status: "open",
    selected: true,
    ...overrides,
  };
}

/** A panel state with one authorized surface, one selected tab and one frame. */
function loadedState() {
  const selected = targetState().id;
  const authorized: WebuiBrowserAuthorization = { ...WEBUI_BROWSER_AUTHORIZATION_DEFAULT, isolatedChromium: true };
  let state = reduceWebuiBrowserPanelState({ ...initialWebuiBrowserPanelState, authorization: authorized }, {
    type: "targets-loaded",
    list: { surface: "isolated-chromium", targets: [targetState()] },
    selected,
  });
  state = reduceWebuiBrowserPanelState(state, {
    type: "frame",
    frame: { target: selected, data: "QUJD", format: "png", sequence: 7 },
  });
  return state;
}

/** All-optional, like every port in this package: presence is the assertion. */
const wiredPort: BrowserPort = {
  getBrowserAuthorization: () => Promise.resolve(WEBUI_BROWSER_AUTHORIZATION_DEFAULT),
  listBrowserTargets: () => Promise.resolve({ surface: "isolated-chromium", targets: [] }),
  sendBrowserInput: () => Promise.resolve({ accepted: true }),
  watchBrowserFrames: () => () => {},
};

describe("the Browser panel", () => {
  it("shows the live frame as an image over a data URL, not an embedded page", () => {
    const markup = renderToStaticMarkup(
      <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "supported" }} />,
    );

    expect(markup).toContain('data-testid="browser-panel-frame"');
    expect(markup).toContain('src="data:image/png;base64,QUJD"');
    expect(markup).toContain('data-target-generation="4"');
    expect(markup).toContain('data-frame-sequence="7"');
  });

  it("embeds nothing: no iframe, no srcdoc, no blob URL, no inner HTML", () => {
    // The whole isolation story of this panel is that the target site is never a
    // document in this page. An iframe would give it the WebUI's origin and the
    // session token; the assertion is here because that mistake is silent — the
    // panel would still look right.
    const markup = renderToStaticMarkup(
      <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "supported" }} />,
    );

    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain("srcdoc");
    expect(markup).not.toContain("blob:");
    expect(markup).not.toContain("dangerouslySetInnerHTML");
  });

  it("says so in the source rather than only in the rendered markup", () => {
    // `renderToStaticMarkup` cannot see a forbidden API that a branch never
    // reached, so the file itself is checked for the three ways a document could
    // get in here. Comments are stripped first: this module explains *why* it
    // uses an image, and the word appears in that explanation.
    const source = readFileSync(
      new URL("../../src/client/features/browser/ui/BrowserPanel.public.tsx", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");

    expect(source).not.toContain("iframe");
    expect(source).not.toContain("srcdoc");
    expect(source).not.toContain("blob:");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("lists every target with its browser, generation and status", () => {
    const markup = renderToStaticMarkup(
      <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "supported" }} />,
    );

    expect(markup).toContain('data-testid="browser-target-list"');
    expect(markup).toContain('data-testid="browser-target-chromium-1-tab-1"');
    expect(markup).toContain("Example Domain");
    expect(markup).toContain("https://example.test/");
    expect(markup).toContain("第 4 代");
    expect(markup).toContain('aria-current="true"');
  });

  it("renders a closed target rather than hiding it", () => {
    // A closed target stays in the list so a stale reference is explainable.
    const state = reduceWebuiBrowserPanelState(loadedState(), {
      type: "targets-loaded",
      list: {
        surface: "isolated-chromium",
        targets: [targetState({ status: "closed" })],
      },
    });
    const markup = renderToStaticMarkup(<BrowserPanel port={wiredPort} state={state} />);

    expect(markup).toContain('data-target-status="closed"');
    expect(markup).toContain("已关闭");
  });

  it("says the browser is switched off instead of showing a dead frame", () => {
    const markup = renderToStaticMarkup(
      <BrowserPanel port={wiredPort} state={initialWebuiBrowserPanelState} capabilities={{ browser: "supported" }} />,
    );

    expect(markup).toContain('data-testid="browser-panel-unauthorized"');
    expect(markup).toContain('data-testid="browser-panel-frame-empty"');
    expect(markup).not.toContain('data-testid="browser-panel-frame"');
  });

  it("announces a target whose generation moved, so stale input is not silently kept", () => {
    const state = reduceWebuiBrowserPanelState(loadedState(), {
      type: "targets-loaded",
      list: {
        surface: "isolated-chromium",
        targets: [
          targetState({
            id: { surface: "isolated-chromium", browserId: "chromium-1", targetId: "tab-1", generation: 5 },
            selected: false,
          }),
        ],
      },
    });
    const markup = renderToStaticMarkup(<BrowserPanel port={wiredPort} state={state} />);

    expect(markup).toContain('data-testid="browser-panel-target-changed"');
    expect(markup).toContain("第 5 代");
    // The buffered picture belonged to generation 4, so it is not displayed.
    expect(markup).not.toContain('data-testid="browser-panel-frame"');
  });

  it("reports the stable error code alongside the message", () => {
    const state = reduceWebuiBrowserPanelState(initialWebuiBrowserPanelState, {
      type: "failed",
      error: { code: "browser_provider_unavailable", message: "浏览器提供方不可用。", retryable: true },
    });
    const markup = renderToStaticMarkup(<BrowserPanel port={wiredPort} state={state} />);

    expect(markup).toContain('data-error-code="browser_provider_unavailable"');
    expect(markup).toContain("浏览器提供方不可用。");
  });

  it("names each of the three browser surfaces and whether it is authorized", () => {
    const markup = renderToStaticMarkup(<BrowserPanel port={wiredPort} state={loadedState()} />);

    expect(markup).toContain('data-testid="browser-surface-isolated-chromium"');
    expect(markup).toContain('data-testid="browser-surface-edge"');
    expect(markup).toContain('data-testid="browser-surface-chrome"');
    expect(markup).toContain('data-authorized="true"');
    expect(markup).toContain('data-authorized="false"');
  });

  describe("capability states", () => {
    // A panel that renders as an empty box when the family is missing is
    // indistinguishable from one that is merely still loading, so each state gets
    // its own sentence.
    it("declines an absent family", () => {
      const markup = renderToStaticMarkup(
        <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "absent" }} />,
      );
      expect(markup).toContain('data-testid="browser-panel-absent"');
    });

    it("declines a not-ready family", () => {
      const markup = renderToStaticMarkup(
        <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "not-ready" }} />,
      );
      expect(markup).toContain('data-testid="browser-panel-not-ready"');
    });

    it("declines an unknown family rather than assuming support", () => {
      // No manifest at all is `unknown`, which is neither "everything works"
      // nor "nothing works" — and a panel that assumed support would render as
      // though a browser were available.
      const markup = renderToStaticMarkup(<BrowserPanel port={wiredPort} state={loadedState()} />);
      expect(markup).toContain('data-testid="browser-panel-unknown"');
    });

    it("keeps the input surface out of reach until a target is selected", () => {
      const markup = renderToStaticMarkup(
        <BrowserPanel port={wiredPort} state={loadedState()} capabilities={{ browser: "supported" }} />,
      );
      expect(markup).toContain('data-testid="browser-panel-input"');
      expect(markup).toContain('role="application"');
      expect(markup).toContain('data-testid="browser-panel-text-input"');
    });
  });
});

describe("the authorization switches a Settings page mounts", () => {
  it("renders four switches, all off before any read resolves", () => {
    const markup = renderToStaticMarkup(<BrowserAuthorizationSwitches />);

    expect(markup).toContain('data-testid="browser-authorization-isolated-chromium"');
    expect(markup).toContain('data-testid="browser-authorization-edge"');
    expect(markup).toContain('data-testid="browser-authorization-chrome"');
    expect(markup).toContain('data-testid="browser-authorization-full-cdp"');
    expect(markup).not.toMatch(/aria-checked="true"/u);
  });

  it("keeps every switch out of reach until a read gives them a baseline", () => {
    // Not merely rendered off: a switch showing an unknown state that still
    // accepts a click is how a setting gets flipped by accident.
    const markup = renderToStaticMarkup(<BrowserAuthorizationSwitches />);

    for (const id of [
      "browser-authorization-isolated-chromium",
      "browser-authorization-edge",
      "browser-authorization-chrome",
      "browser-authorization-full-cdp",
    ]) {
      expect(markup).toMatch(new RegExp(`<button[^>]*data-testid="${id}"[^>]*disabled=""`, "u"));
    }
  });

  it("shows one browser's switch moving without moving the other three", () => {
    const markup = renderToStaticMarkup(
      <BrowserAuthorizationSwitches authorization={{ ...WEBUI_BROWSER_AUTHORIZATION_DEFAULT, edge: true }} />,
    );

    expect(markup).toMatch(/<button[^>]*aria-checked="true"[^>]*data-testid="browser-authorization-edge"/u);
    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*data-testid="browser-authorization-chrome"/u);
    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*data-testid="browser-authorization-full-cdp"/u);
    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*data-testid="browser-authorization-isolated-chromium"/u);
  });

  it("keeps Full CDP off while a surface is on", () => {
    // The independence, seen in the markup: an authorized browser is not an
    // authorized command set.
    const markup = renderToStaticMarkup(
      <BrowserAuthorizationSwitches
        authorization={{ ...WEBUI_BROWSER_AUTHORIZATION_DEFAULT, isolatedChromium: true, edge: true, chrome: true }}
      />,
    );

    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*data-testid="browser-authorization-full-cdp"/u);
  });

  it("keeps Full CDP in its own section and describes it as widening the command set", () => {
    // The two are different risks — launching a browser versus sending any
    // DevTools command — so they are not one row, and the wording says which one
    // Full CDP is rather than describing it as enabling a browser.
    const markup = renderToStaticMarkup(
      <BrowserAuthorizationSwitches authorization={WEBUI_BROWSER_AUTHORIZATION_DEFAULT} />,
    );
    const fullCdpSection = markup.slice(markup.indexOf('data-testid="browser-authorization-full-cdp"'));
    const surfaceSection = markup.slice(
      0,
      markup.indexOf('data-testid="browser-authorization-full-cdp"'),
    );

    expect(surfaceSection).not.toContain("Full CDP");
    expect(fullCdpSection).toContain("DevTools 命令");
    expect(fullCdpSection).toContain("不会启用任何浏览器");
    expect(fullCdpSection).toContain('data-testid="browser-authorization-full-cdp-row"');
  });
});

describe("the installation key a Settings page mounts", () => {
  it("renders no key before one is asked for", () => {
    // A static render runs no effects, and the key is fetched on a click, so
    // there is nothing to leak into a first paint: the row exists, the value
    // does not.
    const markup = renderToStaticMarkup(<BrowserInstallationKey />);

    expect(markup).toContain('data-testid="browser-installation-key"');
    expect(markup).toContain('data-testid="browser-installation-key-edge-reveal"');
    expect(markup).toContain('data-testid="browser-installation-key-chrome-reveal"');
    expect(markup).not.toContain('data-testid="browser-installation-key-value"');
  });

  it("keeps the reveal buttons out of reach when the host wires no bridge", () => {
    const markup = renderToStaticMarkup(<BrowserInstallationKey />);

    for (const id of [
      "browser-installation-key-edge-reveal",
      "browser-installation-key-chrome-reveal",
    ]) {
      expect(markup).toMatch(new RegExp(`<button[^>]*data-testid="${id}"[^>]*disabled=""`, "u"));
    }
  });

  it("offers the reveal when the host does wire the bridge", () => {
    const markup = renderToStaticMarkup(
      <BrowserInstallationKey
        readKey={async () => ({
          present: false,
          surface: "edge",
          reason: "not_provisioned",
        })}
      />,
    );

    for (const id of [
      "browser-installation-key-edge-reveal",
      "browser-installation-key-chrome-reveal",
    ]) {
      expect(markup).not.toMatch(new RegExp(`<button[^>]*data-testid="${id}"[^>]*disabled=""`, "u"));
    }
    // Still no key on the first paint: the reader is only ever called from the
    // click handler, and nothing else can render one.
    expect(markup).not.toContain('data-testid="browser-installation-key-value"');
  });
});
