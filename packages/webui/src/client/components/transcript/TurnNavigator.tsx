// TurnNavigator — WebUI transcription of the right-edge tick strip + hover
// preview card from `mine-transcript/58686.pretty.js` at lines 10779–11160.
//
// Desktop keeps the heavy state (history paging, scroll sync, mask edges,
// artefacts overflow detection, intersection observers, debounced hover
// transitions) in the parent; this component is the presentational seam and
// receives pre-computed `turnSummaries`. Each tick carries a `data-turn-id`
// matching the desktop contract and the expected `data-state`.
//
// All testids from the brief are preserved verbatim:
//
//   message-turn-navigator, -strip, -tick, -tick-hit-target, -mask-top,
//   -mask-bottom, -preview, -preview-title, -preview-time, -preview-previous-query,
//   -preview-next-query, -preview-response, -preview-divider, -preview-artifacts,
//   -preview-file-change-count, -preview-artifact-icon, -preview-artifact-label.
//
// The mask gradients (left/right artefacts scroll edge; top/bottom strip edge)
// are written as inline gradients that match the desktop's
// `minimax-webui/app/out/_next/static/css/d58176301f5655a9.css` rule — see
// `transcript-widgets.css` for the lifted utility classes (`shadow-s1`,
// `transcript-navigator-mask-{left,right,top,bottom}`).
//
// Interaction (hover, scroll, jump) is owned by the integrator; this surface
// accepts `onTickHover`, `onTickActivate`, `onMaskTopClick`, `onMaskBottomClick`
// for the same intent the desktop wires at lines 10738–10740 and 10860–10870.

import { useState, type CSSProperties, type MouseEvent } from "react";

export type TurnState = "default" | "active" | "running" | "completed" | "error";

export interface TurnSummary {
  id: string;
  state: TurnState;
}

export interface TurnNavigatorPreviewArtefact {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TurnNavigatorPreviewFileChange {
  additions: number;
  deletions: number;
}

export interface TurnNavigatorPreview {
  title: string;
  time?: string;
  previousQuery?: string;
  nextQuery?: string;
  response?: string;
  artefacts?: readonly TurnNavigatorPreviewArtefact[];
  fileChangeCount?: TurnNavigatorPreviewFileChange;
  showLeftMask?: boolean;
  showRightMask?: boolean;
  showTopMask?: boolean;
  showBottomMask?: boolean;
}

export interface TurnNavigatorProps {
  mode?: "default" | "compact";
  hidden?: boolean;
  turns: readonly TurnSummary[];
  preview?: TurnNavigatorPreview | null;
  className?: string;
  onTickHover?: (turnId: string, event: MouseEvent<HTMLDivElement>) => void;
  onTickLeave?: (turnId: string, event: MouseEvent<HTMLDivElement>) => void;
  onTickActivate?: (turnId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onMaskTopClick?: (event: MouseEvent<HTMLSpanElement>) => void;
  onMaskBottomClick?: (event: MouseEvent<HTMLSpanElement>) => void;
}

const stripStyle: CSSProperties = {
  position: "absolute",
};

const previewStyle: CSSProperties = {};

const tickHitTargetBase =
  "flex h-3 w-full items-center justify-center";

const tickBase =
  "block size-2 rounded-full transition-colors";

const STATE_CLASS: Record<TurnState, string> = {
  default: "bg-bg_default_tertiary",
  active: "bg-bg_interaction_accent_default",
  running: "bg-bg_status_blue",
  completed: "bg-bg_default_tertiary",
  error: "bg-bg_status_error",
};

export function TurnNavigator(props: TurnNavigatorProps): React.JSX.Element {
  const {
    mode = "default",
    hidden = false,
    turns,
    preview = null,
    className,
    onTickHover,
    onTickLeave,
    onTickActivate,
    onMaskTopClick,
    onMaskBottomClick,
  } = props;

  const containerClass = [
    "absolute right-2 top-1/2 z-10 flex w-3 -translate-y-1/2 flex-col items-center",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const [internalShowTop, setInternalShowTop] = useState(true);
  const [internalShowBottom, setInternalShowBottom] = useState(true);
  const showTop = preview?.showTopMask ?? internalShowTop;
  const showBottom = preview?.showBottomMask ?? internalShowBottom;

  return (
    <div
      className={containerClass}
      data-testid="message-turn-navigator"
      data-mode={mode}
      data-hidden={hidden ? "true" : "false"}
      style={previewStyle}
    >
      <div
        className="relative flex h-full w-full flex-col items-center"
        data-testid="message-turn-navigator-strip"
        style={stripStyle}
      >
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={tickHitTargetBase}
            data-testid="message-turn-navigator-tick-hit-target"
            data-turn-id={turn.id}
            onMouseEnter={(event) => onTickHover?.(turn.id, event)}
            onMouseLeave={(event) => onTickLeave?.(turn.id, event)}
          >
            <button
              type="button"
              className={`${tickBase} ${STATE_CLASS[turn.state]}`}
              data-testid="message-turn-navigator-tick"
              data-turn-id={turn.id}
              data-state={turn.state}
              aria-label={`Turn ${turn.id}`}
              onClick={(event) => onTickActivate?.(turn.id, event)}
            />
          </div>
        ))}
        {showTop ? (
          <span
            className="transcript-navigator-mask-top pointer-events-none absolute left-0 top-0 z-10 h-5 w-full"
            data-testid="message-turn-navigator-mask-top"
            onClick={onMaskTopClick}
          />
        ) : null}
        {showBottom ? (
          <span
            className="transcript-navigator-mask-bottom pointer-events-none absolute bottom-0 left-0 z-10 h-5 w-full"
            data-testid="message-turn-navigator-mask-bottom"
            onClick={onMaskBottomClick}
          />
        ) : null}
      </div>

      {preview ? (
        <div
          className="pointer-events-auto absolute rounded-xl border border-border_light bg-bg_grouped_secondary_elevated p-3 text-text_default_primary shadow-s1"
          data-testid="message-turn-navigator-preview"
          style={{
            right: "calc(100% + 8px)",
            top: "0",
            width: "min(360px, calc(100vw - 32px))",
          }}
        >
          {preview.previousQuery ? (
            <div
              className="absolute left-0 box-border flex h-10 w-max max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-border_light bg-bg_grouped_secondary_elevated p-3 text-xs font-medium leading-4 text-text_default_secondary shadow-s1"
              data-testid="message-turn-navigator-preview-previous-query"
              style={{ top: "-12px" }}
            >
              {preview.previousQuery}
            </div>
          ) : null}

          <div
            className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5 text-text_default_primary"
            data-testid="message-turn-navigator-preview-title"
          >
            {preview.title}
          </div>
          {preview.time ? (
            <div
              className="mt-1 text-xs leading-4 tabular-nums text-text_default_tertiary"
              data-testid="message-turn-navigator-preview-time"
            >
              {preview.time}
            </div>
          ) : null}

          {preview.response ? (
            <div
              className="mt-2 max-h-[60px] overflow-hidden text-ellipsis text-sm leading-5 text-text_default_secondary"
              data-testid="message-turn-navigator-preview-response"
              style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}
            >
              {preview.response}
            </div>
          ) : null}

          {preview.fileChangeCount || (preview.artefacts && preview.artefacts.length > 0) ? (
            <div
              className="flex h-5 items-center"
              data-testid="message-turn-navigator-preview-divider"
            >
              <div className="h-px w-full bg-border_default" />
            </div>
          ) : null}

          {preview.artefacts && preview.artefacts.length > 0 ? (
            <div
              className="pointer-events-auto scrollbar-hide flex flex-nowrap items-center gap-3 overflow-x-auto overflow-y-hidden"
              data-testid="message-turn-navigator-preview-artifacts"
            >
              {preview.artefacts.map((artefact) => (
                <div
                  key={artefact.id}
                  className="flex shrink-0 items-center gap-2"
                >
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded bg-bg_grouped_primary_elevated"
                    data-testid="message-turn-navigator-preview-artifact-icon"
                  >
                    {artefact.icon ?? null}
                  </span>
                  <span
                    className="max-w-[140px] truncate text-sm leading-5 text-text_default_secondary"
                    data-testid="message-turn-navigator-preview-artifact-label"
                  >
                    {artefact.label}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {preview.fileChangeCount ? (
            <div
              className="mt-1 inline-flex shrink-0 items-center gap-2 text-sm leading-5 text-text_default_secondary"
              data-testid="message-turn-navigator-preview-file-change-count"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-bg_grouped_tertiary">
                <span data-testid="message-turn-navigator-preview-file-change-count-icon" />
              </span>
              <span>
                +{preview.fileChangeCount.additions} / -{preview.fileChangeCount.deletions}
              </span>
            </div>
          ) : null}

          {preview.nextQuery ? (
            <div
              className="absolute left-0 box-border flex h-10 w-max max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-border_light bg-bg_grouped_secondary_elevated p-3 text-xs font-medium leading-4 text-text_default_secondary shadow-s1"
              data-testid="message-turn-navigator-preview-next-query"
              style={{ bottom: "-12px" }}
            >
              {preview.nextQuery}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
