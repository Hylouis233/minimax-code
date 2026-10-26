/** What the panel is showing: one Mini App of one session. */
export interface MiniAppPresentation {
  readonly sessionId: string;
  readonly pluginId: string;
}

/**
 * The browser implementation of the host-owned Mini App presenter.
 *
 * The desktop client's presenter moves a native view; there is no such view here. ADR 0020 maps the
 * page's `open` onto the session rail plus the standalone presentation: `open` selects that session
 * through the client's ordinary selection path and records that the panel is showing that Mini App,
 * and `close` stops showing it. Selection is what makes a Mini-App-created session's permission asks
 * answerable, so the record has to follow the selection rather than the page's wishes.
 */
export interface MiniAppPresenterLike {
  open(input: {
    readonly sessionId: string;
    readonly pluginId: string;
    readonly signal?: AbortSignal;
  }): Promise<void>;
  close(input: { readonly pluginId: string }): Promise<void>;
}

export interface MiniAppPresenterView {
  /** The Mini App the panel is showing, or undefined when it shows none. */
  presented(): MiniAppPresentation | undefined;
  readonly presenter: MiniAppPresenterLike;
}

export interface CreateMiniAppPresenterInput {
  /**
   * The client's ordinary selection path, where there is one.
   *
   * Optional because selection belongs to the client document: the WebUI's rail
   * is browser state, and this presenter runs on the server, which cannot select
   * anything. What it records is the presentation — which session's panel is
   * showing which Mini App — and the client reads that through the view it
   * mounts. A host that does own a selection path supplies it.
   */
  readonly selectSession?: (input: { readonly sessionId: string; readonly pluginId: string }) => void;
  /** Reports the panel as closed when its Mini App stops being shown. */
  readonly onClosed?: (input: { readonly pluginId: string }) => void;
}

/**
 * One presenter per service. It holds one presentation, because the panel shows one session at a time:
 * a second `open` replaces the first, and `close` only clears the record when it names the Mini App
 * currently presented.
 */
export function createMiniAppPresenter(input: CreateMiniAppPresenterInput): MiniAppPresenterView {
  let presentation: MiniAppPresentation | undefined;

  return {
    presented: () => presentation,
    presenter: {
      async open(openInput) {
        openInput.signal?.throwIfAborted();
        presentation = { sessionId: openInput.sessionId, pluginId: openInput.pluginId };
        input.selectSession?.({ sessionId: openInput.sessionId, pluginId: openInput.pluginId });
      },
      async close(closeInput) {
        if (presentation?.pluginId !== closeInput.pluginId) return;
        presentation = undefined;
        input.onClosed?.({ pluginId: closeInput.pluginId });
      },
    },
  };
}

/**
 * The panel stops showing a Mini App when the person selects another session or closes the panel, and
 * the record has to follow, or the service would keep reporting a presentation that no longer exists.
 */
export function followSelection(input: {
  readonly view: MiniAppPresenterView;
  readonly selectedSessionId: string | undefined;
}): void {
  const presentation = input.view.presented();
  if (!presentation) return;
  if (presentation.sessionId === input.selectedSessionId) return;
  // The presenter's own `onClosed` reports the closure; reporting here too would say it twice.
  void input.view.presenter.close({ pluginId: presentation.pluginId });
}
