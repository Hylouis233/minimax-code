import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebuiClientFoundationApp } from "./shell/WebuiClientFoundationApp.js";
// The composition root may read the platform layer; the shell and the rail may
// not, so the label is resolved here and injected.
import { teamModeCopy } from "./platform/team-mode.js";
export { WebuiSessionList } from "./features/sessions/ui/SessionRail.js";
export { WebuiSessionTranscript } from "./features/transcript/ui/SessionTranscript.js";
export {
  WebuiClientFoundationApp,
} from "./shell/WebuiClientFoundationApp.js";
export { subscribeToSessionHash } from "./bindings/navigation.js";
import { createWebuiTransport } from "./platform/transport.js";
import { importWebuiSessionFile } from "./platform/session-import.js";
import { startWebuiSessionTransferDownload } from "./platform/session-transfer-download.js";
import { route } from "./projection/common/router.js";
import { NotFound } from "./shell/NotFound.js";
import { ArchonPage } from "./shell/ArchonPage.js";
import { WebuiErrorBoundary } from "./shell/WebuiErrorBoundary.js";
import { WebuiStartupFallback } from "./shell/StartupFallback.js";
import { WebuiBrowserCapabilitiesProvider } from "./bindings/browser-capabilities.js";
import { createWebuiBrowserDom } from "./platform/browser-dom.js";
import {
  createWebuiBrowserStorage,
  getWebuiBrowserStorage,
} from "./platform/storage.js";
import { createWebuiApplication } from "./application/create-application.js";
import { createWebuiComposerStore } from "./features/composer/application/composer-store.js";
import { createWebuiPortSlices } from "./application/port-slices.js";
import { createWebuiOpenEventChannel } from "./bindings/event-channel-adapter.js";
import { WebuiApplicationProvider } from "./bindings/application-context.js";
import { WebuiPortSlicesProvider } from "./bindings/port-slices-context.js";
import { WEBUI_PROTOCOL_VERSION, WebuiWireError, WebuiErrorCode } from "../shared/envelope.js";

declare const document: {
  getElementById(elementId: string): HTMLElement | null;
  createElement(tagName: string): HTMLElement;
  readonly body: HTMLElement;
};
declare const location: { readonly host: string; readonly pathname: string; readonly hash: string; href: string; reload(): void };

const rootElement = document.getElementById("webui-root");
interface WebuiRuntimeConfig {
  websocketUrl: string;
  token: string;
  dataDir?: string;
}
const config = (
  globalThis as unknown as { __WEBUI_CONFIG__?: WebuiRuntimeConfig }
).__WEBUI_CONFIG__;

/**
 * The composition root.
 *
 * It builds the one application for the page — the store, the event coordinator
 * and the single `watchEvents` channel — cuts the per-business port slices from
 * the transport, and provides them through the owner contexts. The shell below
 * adopts the instance rather than building its own, so a page has one store and
 * one channel instead of two.
 *
 * The transport stays at module scope and arrives as a prop: it is IO for the
 * page, it is constructed once, and its identity has to be stable across renders.
 * The application is constructed per mount and disposed on unmount, so a
 * remount cannot leave a second channel open.
 */
function WebuiClientRoot({
  transport,
  dataDir,
  storage,
  initialSessionId,
}: {
  readonly transport: ReturnType<typeof createWebuiTransport>;
  readonly dataDir?: string;
  readonly storage: ReturnType<typeof createWebuiBrowserStorage>;
  /** The session the initial route names, parsed from the hash by the entry. */
  readonly initialSessionId?: string;
}): JSX.Element {
  const slices = React.useMemo(
    () => createWebuiPortSlices(transport),
    [transport],
  );
  const composer = React.useMemo(
    () => createWebuiComposerStore({ storage }),
    [storage],
  );
  const application = React.useMemo(
    () =>
      createWebuiApplication({
        // The live ingress: the transport's `watchEvents` watcher, adapted to
        // the application channel shape. It is opened by `start` below, not
        // here: construction stays dormant so an SSR-shaped or test render can
        // build the same assembly without touching the network.
        openEventChannel: transport.watchEvents
          ? createWebuiOpenEventChannel(transport.watchEvents)
          : () => ({ subscribe: () => () => undefined }),
        // The goal capability: the application owns the goal owner, so an event
        // route commits for any session, mounted or not.
        goalPort: slices.goal,
        interactionsPort: slices.interactions,
        // The same storage adapter the shell used to inject by hand, so the
        // production boot persists and restores unread counts exactly as the
        // fixture assembly always did.
        unreadStorage: {
          read: storage.readUnreadCounts,
          write: storage.writeUnreadCounts,
        },
        // The persisted "no project" choice the new-task workspace reads and
        // writes. The use case owns the decision and the host owns the storage,
        // so it arrives the same way the unread counts do.
        workspacePreference: {
          readNoProjectFlag: storage.readNoProjectFlag,
          writeNoProjectFlag: storage.writeNoProjectFlag,
        },
        // The port slices this root cut above. The assembly builds every
        // business owner from them, so the shell composes screens instead of
        // constructing owners.
        slices,
        // The session-file import the session workflows submit through: the
        // application layer may not reach into `platform/` itself.
        sessionImport: importWebuiSessionFile,
        // The session-file export the session workflows submit through: the
        // navigation is platform IO, and the rail may not reach into
        // `platform/` itself.
        sessionExport: startWebuiSessionTransferDownload,
        turns: {
          resumeSession: transport.resumeSession ?? (async () => {}),
          ...(transport.loadMessages
            ? { loadMessages: transport.loadMessages }
            : {}),
        },
        turnCapabilities: transport,
        // The review families' capabilities. The application owns both owners,
        // so a surface reads a turn's diff through the application rather
        // than holding the transport.
        turnReview: {
          ...(transport.getTurnDiff ? { getTurnDiff: transport.getTurnDiff } : {}),
          ...(transport.revertTurnDiff ? { revertTurnDiff: transport.revertTurnDiff } : {}),
          ...(transport.reapplyTurnDiff ? { reapplyTurnDiff: transport.reapplyTurnDiff } : {}),
        },
        ...(transport.loadMessages
          ? { loadMessages: transport.loadMessages }
          : {}),
        composer,
      }),
    [composer, transport, storage],
  );
  // One lifecycle per mount: start once, dispose only when this instance is
  // replaced or the root unmounts. The initial route is read through a ref
  // because it is the *initial* route — a later hash change selects through the
  // shell, it does not restart the application.
  const initialSessionIdRef = React.useRef(initialSessionId);
  React.useEffect(() => {
    application.start({ initialSessionId: initialSessionIdRef.current });
    return () => application.dispose();
  }, [application]);

  return (

      <WebuiApplicationProvider application={application}>
        <WebuiPortSlicesProvider slices={slices}>
          <WebuiClientFoundationApp
          teamModeLabel={teamModeCopy().label}
            label="webui-foundation"
            hostLabel={location.host}
            dataDir={dataDir}
          />
        </WebuiPortSlicesProvider>
      </WebuiApplicationProvider>

  );
}

if (!rootElement || !config) {
  // Boot failures before this point used to be bare `throw`s, and the error
  // boundary cannot catch them: it lives inside the render that never
  // started, so a missing mount node or a missing runtime config left a
  // white page. Render the startup surface instead — into #webui-root when
  // the node exists (missing config), or a fresh node on body when even the
  // mount point is gone (torn-down or tampered document).
  const host =
    rootElement ?? document.body.appendChild(document.createElement("div"));
  createRoot(host).render(
    <WebuiStartupFallback
      reason={
        !rootElement
          ? "WebUI mount node #webui-root is missing"
          : "WebUI runtime configuration is missing (__WEBUI_CONFIG__)"
      }
      detail={
        !rootElement
          ? "页面结构加载不完整，可能是资源加载被中断或页面版本不匹配。"
          : "页面没有拿到启动所需的连接配置，通常是服务端启动异常。"
      }
      onReload={() => location.reload()}
    />,
  );
} else {
const runtimeConfig = config;
const transport = createWebuiTransport(runtimeConfig);
const sessionId = new URLSearchParams(location.hash.replace(/^#/u, "")).get("session") ?? undefined;
const root: Root = createRoot(rootElement);
const browserCapabilities = {
  dom: createWebuiBrowserDom(globalThis.document, globalThis.window),
  storage: createWebuiBrowserStorage(getWebuiBrowserStorage()),
};
// Pass the transport ONCE here so the React effect dependency
// identity is stable across renders. Each method is still optional
// on `WebuiTransport`, so the panel branches continue to gate on
// `transport?.X` just like they used to gate on `X`.
//
// The transport is the module-scope instance; the application, its store and
// the port slices are built by the root below, once per mount, and provided to
// the shell.
const app = <WebuiClientRoot transport={transport} dataDir={runtimeConfig.dataDir} storage={browserCapabilities.storage} />;
const currentRoute = route(location.pathname);
const renderApplication = (): void => root.render(
  // The boundary wraps the app, not the 404: a 404 is a legitimate render and
  // must not offer a "retry" that reloads the same missing path.
  currentRoute === "404" ? <NotFound /> : <WebuiBrowserCapabilitiesProvider value={browserCapabilities}><WebuiErrorBoundary><ArchonPage>{app}</ArchonPage></WebuiErrorBoundary></WebuiBrowserCapabilitiesProvider>,
);
if (currentRoute === "404") renderApplication();
else void transport.version().then((version) => {
  if (version.protocolVersion !== WEBUI_PROTOCOL_VERSION) {
    throw new WebuiWireError(WebuiErrorCode.protocolMismatch,
      `WebUI protocol ${version.protocolVersion} is incompatible with client protocol ${WEBUI_PROTOCOL_VERSION}`);
  }
  renderApplication();
}).catch((reason: unknown) => {
  root.render(<WebuiStartupFallback
    reason={reason instanceof Error ? reason.message : String(reason)}
    detail="页面与服务未能建立兼容连接，请检查服务版本或连接后刷新重试。"
    onReload={() => location.reload()}
  />);
});
}
