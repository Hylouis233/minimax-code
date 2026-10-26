import { describe, expect, it, vi } from 'vitest';

import {
  createMiniAppPresenter,
  followSelection,
} from '../../src/server/miniapp/presenter.js';

function build(onClosed?: (input: { readonly pluginId: string }) => void) {
  const selected: Array<{ sessionId: string; pluginId: string }> = [];
  const view = createMiniAppPresenter({
    selectSession: (input) => selected.push({ ...input }),
    ...(onClosed ? { onClosed } : {}),
  });
  return { view, selected };
}

describe('Mini App presenter', () => {
  it('selects the session and records what the panel is showing', async () => {
    const { view, selected } = build();

    expect(view.presented()).toBeUndefined();
    await view.presenter.open({ sessionId: 'session-1', pluginId: 'fixture.miniapp' });

    expect(selected).toEqual([{ sessionId: 'session-1', pluginId: 'fixture.miniapp' }]);
    expect(view.presented()).toEqual({ sessionId: 'session-1', pluginId: 'fixture.miniapp' });
  });

  it('refuses to open when the caller has already aborted', async () => {
    const { view, selected } = build();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      view.presenter.open({ sessionId: 'session-1', pluginId: 'p', signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(selected).toHaveLength(0);
    expect(view.presented()).toBeUndefined();
  });

  it('keeps one presentation: a second open replaces the first', async () => {
    const { view } = build();

    await view.presenter.open({ sessionId: 'session-1', pluginId: 'first' });
    await view.presenter.open({ sessionId: 'session-2', pluginId: 'second' });

    expect(view.presented()).toEqual({ sessionId: 'session-2', pluginId: 'second' });
  });

  it('closes only the Mini App it is showing, and only once', async () => {
    const onClosed = vi.fn();
    const { view } = build(onClosed);
    await view.presenter.open({ sessionId: 'session-1', pluginId: 'shown' });

    await view.presenter.close({ pluginId: 'other' });
    expect(view.presented()).toEqual({ sessionId: 'session-1', pluginId: 'shown' });
    expect(onClosed).not.toHaveBeenCalled();

    await view.presenter.close({ pluginId: 'shown' });
    expect(view.presented()).toBeUndefined();
    expect(onClosed).toHaveBeenCalledTimes(1);

    await view.presenter.close({ pluginId: 'shown' });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('stops showing the Mini App when the person selects another session', async () => {
    const closed: string[] = [];
    const { view } = build((input) => closed.push(input.pluginId));
    await view.presenter.open({ sessionId: 'session-1', pluginId: 'fixture.miniapp' });

    followSelection({ view, selectedSessionId: 'session-1' });
    expect(view.presented()).toBeDefined();
    expect(closed).toHaveLength(0);

    followSelection({ view, selectedSessionId: 'session-2' });
    expect(closed).toEqual(['fixture.miniapp']);
  });
});
