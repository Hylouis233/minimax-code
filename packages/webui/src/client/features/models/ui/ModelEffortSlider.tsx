// The thinking scale as a slider.
//
// The scale's SHAPE is the model's own (see `effort-scale.ts`); this is the
// control that draws it and moves it.
//
// The commit happens when the drag ENDS, not on every stop it crosses: a
// change of level is a `selectModel` round trip, so a drag across four stops
// would otherwise fire four of them, and four answers arriving in the order
// the runtime felt like answering them would leave the slider showing a level
// the user did not choose. The drag moves the thumb; the release commits it.

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import {
  effortStopIndex,
  effortStopPercent,
  type WebuiEffortScale,
} from "../projection/effort-scale.js";

export interface WebuiModelEffortSliderProps {
  readonly scale: WebuiEffortScale;
  /** The level the model is on now. */
  readonly value: string;
  /** Called once, when the drag ends on a level. */
  readonly onCommit: (value: string) => void;
}

export function WebuiModelEffortSlider({
  scale,
  value,
  onCommit,
}: WebuiModelEffortSliderProps): ReactElement {
  const railRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [preview, setPreview] = useState<string | undefined>(undefined);

  const total = scale.stops.length;
  const index = effortStopIndex(scale, preview ?? value);
  const percent = total > 0 ? effortStopPercent(Math.max(index, 0), total) : 0;

  /** The stop under a pointer, as the nearest one. */
  const stopAt = useCallback(
    (clientX: number): string | undefined => {
      const rail = railRef.current;
      if (!rail || total === 0) return undefined;
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return undefined;
      const ratio = (clientX - rect.left) / rect.width;
      const last = total - 1;
      const at = Math.min(last, Math.max(0, Math.round(ratio * last)));
      return scale.stops[at]?.value;
    },
    [scale, total],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (scale.disabled) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stop = stopAt(event.clientX);
    if (stop !== undefined) setPreview(stop);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    const stop = stopAt(event.clientX);
    if (stop !== undefined) setPreview(stop);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const stop = stopAt(event.clientX);
    setPreview(undefined);
    if (stop !== undefined && stop !== value) onCommit(stop);
  };

  /**
   * A cancelled gesture is not a choice.
   *
   * The browser took the pointer away — a scroll, a system gesture — so the
   * drag ends without committing: the thumb goes back to where the model
   * actually is.
   */
  const handlePointerCancel = (): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setPreview(undefined);
  };

  return (
    <div
      className="webui-model-effort-slider"
      data-webui-model-effort-slider="true"
      data-disabled={scale.disabled ? "true" : "false"}
    >
      <div
        ref={railRef}
        className="webui-model-effort-rail"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <div className="webui-model-effort-track" />
        <div
          className="webui-model-effort-fill"
          style={{ width: `${percent}%` }}
        />
        {scale.stops.map((stop, at) => (
          <span
            key={stop.value}
            className="webui-model-effort-dot"
            data-passed={at <= index ? "true" : "false"}
            style={{ left: `${effortStopPercent(at, total)}%` }}
          />
        ))}
        <span
          className="webui-model-effort-thumb"
          style={{ left: `${percent}%` }}
        />
      </div>
    </div>
  );
}
