// The composer editor's staging row and its two typed popups (T13 criterion 5 —
// the editor/staging unit).
//
// This is the part of the composer that sits under the textarea: the attachment
// and URL-reference chips, the `@` mention list and the `/` command palette.
// Eighty-eight lines of the composer render read fifteen of its cells directly;
// they arrive here as named props instead — the chips report the three edits
// they can make rather than receiving store setters, and the two lists report
// the cursor intent they raise.
//
// What stayed with the composer is what the popups cannot own: the mention and
// command cursors, because the textarea's own key handling moves them; and the
// gate that decides whether the mention list shows at all, because it depends on
// the range the editor tracks.

import { Fragment } from "react";

import type { WebuiClientSession } from "../../sessions/contracts/session-view.js";
import {
  type WebuiComposerAttachment,
  type WebuiComposerUrlReference,
} from "../projection/composer-interactions.js";
import type { SlashCommandEntry } from "./slash-palette.js";

/** One row the `@` list can offer. */
export type WebuiComposerMentionChoice =
  | { readonly kind: "plugin"; readonly name: string; readonly label: string; readonly detail?: string; readonly section: string }
  | { readonly kind: "file"; readonly path: string; readonly label: string; readonly section: string }
  | { readonly kind: "local-file"; readonly label: string; readonly section: string }
  | { readonly kind: "local-folder"; readonly label: string; readonly section: string }
  | { readonly kind: "agent"; readonly session: WebuiClientSession; readonly label: string; readonly section: string };

/** One row the `/` palette can offer. */
export type WebuiComposerCommandSuggestion = SlashCommandEntry;

export interface WebuiComposerEditorStagingProps {
  readonly attachments: readonly WebuiComposerAttachment[];
  readonly urlReferences: readonly WebuiComposerUrlReference[];
  readonly attachmentBusy: boolean;
  readonly onRemoveAttachment: (id: string) => void;
  readonly onChangeReference: (id: string, url: string) => void;
  readonly onRemoveReference: (id: string) => void;
  /** Present only while the editor has a live mention range with choices. */
  readonly mention?: {
    readonly choices: readonly WebuiComposerMentionChoice[];
    readonly index: number;
    readonly onIndexChange: (index: number) => void;
    readonly onChoose: (choice: WebuiComposerMentionChoice) => void;
  };
  readonly commands: readonly WebuiComposerCommandSuggestion[];
  readonly commandIndex: number;
  readonly onCommandIndexChange: (index: number) => void;
  readonly onChooseCommand: (name: string) => void;
  /** Which side of the composer the palette opens on. */
  readonly commandPanelBelow: boolean;
}

export function WebuiComposerEditorStaging({
  attachments,
  urlReferences,
  attachmentBusy,
  onRemoveAttachment,
  onChangeReference,
  onRemoveReference,
  mention,
  commands,
  commandIndex,
  onCommandIndexChange,
  onChooseCommand,
  commandPanelBelow,
}: WebuiComposerEditorStagingProps) {
  const references = (key: string) =>
    urlReferences.map((reference) => (
      <div key={`${key}:${reference.id}`} className="webui-composer-url-reference">
        <span aria-hidden="true">↗</span>
        <input
          aria-label="URL 引用"
          value={reference.url}
          onChange={(event) => onChangeReference(reference.id, event.target.value)}
        />
        <button type="button" aria-label="移除 URL 引用" onClick={() => onRemoveReference(reference.id)}>×</button>
      </div>
    ));
  return (
    <>
      {attachments.length > 0 ? (
        <div className="webui-composer-attachments" data-webui-composer-attachments="true">
          {attachments.map((attachment) => (
            <div key={attachment.id} className={`webui-composer-attachment${attachment.kind === "image" ? " is-image" : ""}`}>
              {attachment.kind === "image" ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="webui-composer-attachment-type">{attachment.fileName.split(".").pop()?.toUpperCase() ?? "FILE"}</span>}
              <span className="webui-composer-attachment-name" title={attachment.fileName}>{attachment.fileName}</span>
              <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => onRemoveAttachment(attachment.id)}>×</button>
            </div>
          ))}
          {references("attached")}
          {attachmentBusy ? <span className="webui-composer-attachment-loading" role="status">正在读取文件…</span> : null}
        </div>
      ) : urlReferences.length > 0 ? (
        <div className="webui-composer-attachments" data-webui-composer-attachments="true">{references("lone")}</div>
      ) : null}
      {mention && mention.choices.length > 0 ? (
        <div className="webui-composer-mention-menu" role="listbox" aria-label="提及列表" data-webui-mention-menu="true">
          {mention.choices.map((choice, index) => (
            <Fragment key={`${choice.section}:${choice.kind}:${choice.kind === "agent" ? choice.session.sessionId : choice.label}`}>
              {index === 0 || mention.choices[index - 1]?.section !== choice.section ? <div className="webui-composer-mention-section">{choice.section}</div> : null}
              <button type="button" role="option" aria-selected={index === mention.index} className="webui-composer-mention-option" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => mention.onIndexChange(index)} onClick={() => mention.onChoose(choice)}>
                <span>{choice.label}</span>
                {choice.kind === "plugin" && choice.detail ? <small>{choice.detail}</small> : null}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
      {commands.length > 0 ? (
        <div
          role="listbox"
          aria-label="命令"
          data-webui-command-menu="true"
          data-webui-command-menu-placement={commandPanelBelow ? "below" : "above"}
          className="webui-command-menu"
        >
          {commands.map((command, index) => {
            const Icon = command.icon;
            const inert = !command.supported;
            const isFirstSkill =
              command.paletteSection === "skills" &&
              (index === 0 || commands[index - 1]?.paletteSection !== "skills");
            return (
              <Fragment key={command.name}>
                {isFirstSkill ? (
                  <div role="separator" data-webui-command-section="skills" className="webui-command-section-header">
                    技能
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  aria-disabled={inert || undefined}
                  disabled={inert}
                  data-webui-command-option-inert={inert ? "true" : undefined}
                  className="webui-command-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (inert) return;
                    onCommandIndexChange(index);
                  }}
                  onClick={() => {
                    if (inert) return;
                    onChooseCommand(command.name);
                  }}
                >
                  <Icon className="webui-command-option-icon text-icon_default_secondary" />
                  <span className="webui-command-option-label">{command.label}</span>
                  <span className="webui-command-option-description text-text_default_tertiary">{command.description}</span>
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
