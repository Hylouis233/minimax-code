/**
 * What the shell reports about a terminal's size, and when a report is worth
 * sending.
 *
 * The terminal is opened at a fixed 80x24 and then fitted to the element it was
 * mounted in. Fitting moves the browser's viewport and tells the runtime
 * nothing, so the pseudo-terminal behind the tab went on wrapping and answering
 * size queries as 80x24 for the whole session: full-screen programs drew
 * themselves into a grid the browser was not showing, and long lines broke at
 * the wrong column.
 *
 * Two rules keep the report from turning into chatter.
 *
 *   - A fit runs on every observer callback, and the observer fires throughout
 *     a drag that changes the panel's width. Reporting each one would put a
 *     request per frame on the wire for a grid nobody reads until the drag
 *     stops, so the caller waits out `TERMINAL_RESIZE_DEBOUNCE_MS` after the
 *     last measurement before sending.
 *   - Only a size the runtime does not already hold is worth a request. The
 *     cache is keyed by terminal, because changing the active tab re-mounts the
 *     terminal and a fresh pseudo-terminal starts back at 80x24: a cache that
 *     ignored the id would read the previous terminal's size as "already
 *     reported" and leave the new one at the default.
 *
 * The observer and the timers that feed these rules live in
 * `components/WorkspacePanels.tsx`, in the same split `model-picker-hover.ts`
 * uses: the decision is data, the scheduling belongs to the surface that owns
 * the clock.
 */
import type { WebuiTerminalSize } from "../../contracts/workspace/terminal-port.js";

/**
 * How long a measured size must hold still before the runtime hears about it.
 *
 * A panel drag measures per frame, so without a delay a drag would spend tens
 * of requests a second on a size that is still moving. Short enough that a
 * settled terminal feels immediate, long enough to collapse one drag into one
 * report.
 */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 150;

/**
 * The request to send for a fresh measurement, or `undefined` when the runtime
 * has nothing to learn.
 *
 * `undefined` covers three cases, and they are one value because the caller's
 * action is the same for all three:
 *
 *   - the runtime already holds this size for this terminal;
 *   - the measurement is zero or negative, which is what a host that is hidden,
 *     detached or mid-unmount measures and is not a size a pseudo-terminal can
 *     take;
 *   - the measurement is not a whole number of cells. `Number.isInteger`
 *     rejects `NaN` and the infinities in the same breath, so a terminal that
 *     managed to measure nothing cannot resize a pseudo-terminal to nothing.
 */
export function terminalResizeRequest(params: {
  readonly terminalId: string;
  readonly cols: number;
  readonly rows: number;
  readonly reported: WebuiTerminalSize | undefined;
}): WebuiTerminalSize | undefined {
  if (!Number.isInteger(params.cols) || !Number.isInteger(params.rows)) return undefined;
  if (params.cols <= 0 || params.rows <= 0) return undefined;
  const { reported } = params;
  if (
    reported !== undefined &&
    reported.terminalId === params.terminalId &&
    reported.cols === params.cols &&
    reported.rows === params.rows
  ) {
    return undefined;
  }
  return { terminalId: params.terminalId, cols: params.cols, rows: params.rows };
}
