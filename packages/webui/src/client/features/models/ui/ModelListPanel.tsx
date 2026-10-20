// The panel's SECOND state: the catalogue, grouped by provider.
//
//   ┌───────────────────────────────┐
//   │ 选择模型                       │
//   │ ── OpenAI ──                   │
//   │   GPT-6.1 Sol                  │
//   │   GPT-6 Astra                  │
//   │   GPT-6 Luna              ✓    │
//   │ ── Anthropic ──                │
//   │   Claude …                     │
//   └───────────────────────────────┘
//
// It is the same popup as the panel state, with its content swapped, not a
// second popup beside the first. That is the whole reason the picker works:
// two popups meant two dismissal listeners racing for the same pointerdown,
// and the one that won retracted a layer before the click landed — which is
// what made a model row feel unclickable.
//
// The list is the catalogue in the catalogue's own order, grouped by provider.
// Nothing is hoisted above the providers and nothing is filtered out of them,
// so the row a pointer is on stays the row it was on.

import type { ReactElement } from "react";

import { WebuiIconCheck, WebuiIconChevronLeft } from "../../../shell/icons.js";
import type {
  WebuiModelPickerEntry,
  WebuiModelProviderGroup,
} from "../contracts/model-view.js";
import { modelKey } from "../projection/model-picker-rows.js";

export interface WebuiModelListPanelProps {
  readonly groups: readonly WebuiModelProviderGroup[];
  /** The model in use, which carries the tick. */
  readonly selected: WebuiModelPickerEntry | undefined;
  /** Choose a model. */
  readonly onSelect: (model: WebuiModelPickerEntry) => void;
  /** Back to the panel state. */
  readonly onBack: () => void;
}

export function WebuiModelListPanel({
  groups,
  selected,
  onSelect,
  onBack,
}: WebuiModelListPanelProps): ReactElement {
  const selectedKey = selected ? modelKey(selected) : undefined;
  return (
    <div className="webui-model-list" data-webui-model-list="true">
      <div className="webui-model-list-head">
        <button
          type="button"
          className="webui-model-list-back"
          data-webui-model-list-back="true"
          aria-label="返回"
          title="返回"
          onClick={onBack}
        >
          <WebuiIconChevronLeft className="webui-model-list-back-icon" />
        </button>
        <span className="webui-model-list-title">选择模型</span>
      </div>
      <div className="webui-model-list-groups">
        {groups.length === 0 ? (
          <p className="webui-model-list-empty">没有可用模型</p>
        ) : null}
        {groups.map((group) => (
          <div
            key={group.id}
            className="webui-model-list-group"
            data-webui-model-list-group={group.id}
          >
            <div className="webui-model-list-group-header">{group.label}</div>
            {group.models.map((model) => {
              const active = modelKey(model) === selectedKey;
              return (
                <button
                  key={modelKey(model)}
                  type="button"
                  className={`webui-model-list-row ${active ? "is-active" : ""}`}
                  data-webui-model-list-row={modelKey(model)}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(model)}
                >
                  <span className="webui-model-list-row-name">
                    {model.displayName ?? model.modelId}
                  </span>
                  {active ? (
                    <span className="webui-model-list-row-check">
                      <WebuiIconCheck />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
