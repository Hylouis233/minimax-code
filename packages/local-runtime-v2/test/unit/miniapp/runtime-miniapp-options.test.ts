import { describe, expect, it } from 'vitest';

import { resolveRuntimeMiniAppOptions } from '../../../src/service/miniapp/composition.js';

describe('resolveRuntimeMiniAppOptions', () => {
  it('starts the service when the owner policy carries the cell', () => {
    expect(resolveRuntimeMiniAppOptions({ miniAppService: true })).toEqual({});
  });

  it('leaves the service off when the cell is absent or false', () => {
    expect(resolveRuntimeMiniAppOptions({})).toBeUndefined();
    expect(resolveRuntimeMiniAppOptions({ miniAppService: false })).toBeUndefined();
  });

  it('keeps explicit options reachable, including with no declared owner kind', () => {
    const miniApp = { dataDir: '/tmp/miniapp' } as Parameters<
      typeof resolveRuntimeMiniAppOptions
    >[0]['miniApp'];

    expect(resolveRuntimeMiniAppOptions({ miniApp })).toBe(miniApp);
    expect(resolveRuntimeMiniAppOptions({ miniApp, miniAppService: false })).toBe(miniApp);
  });

  it('no longer reads the owner kind directly, so a row cannot disagree with the cell', () => {
    // The cell is the only owner-derived input: an electron runtime whose row does not carry it
    // gets no service, which is what makes the capability flag and the service agree.
    expect(
      resolveRuntimeMiniAppOptions({ runtimeOwnerKind: 'electron', miniAppService: false }),
    ).toBeUndefined();
  });
});
