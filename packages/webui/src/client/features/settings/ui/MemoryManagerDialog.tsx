// The memory manager dialog (ticket #73; §15.1's `MemoryManagerDialog.tsx` row, 427 lines estimated).
//
// It is the body behind 记忆's 管理 row, and §16.10 keeps it a target in its own right because it owns
// eleven states plus its own save and delete-confirm — it is not part of `MemorySection`. It is
// mounted conditionally by that section (`{managing ? … : null}`), so it appears when the user asks
// for it and not before.
//
// **It also owns the memory feature's shared pieces**, and the direction matters: `MemorySection`
// renders this dialog, so the dialog must not import the section back. `isMemorySaveable`,
// `formatMemoryTimestamp`, `MEMORY_HANDOFF_PROMPT` and the `MemoryHandoff` payload live here and the
// section reads them, which keeps the edge one-way.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { basenamePath } from "../../../projection/common/paths.js";
import type { WebuiAgentMemoryView, WebuiMemorySettingsView } from "../../../../shared/contracts/personalization.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";

/**
 * The delete confirmation's copy, word for word.
 *
 * The half-width `?` is deliberate, not a typo to tidy up: a full-width
 * `？` carries a full em of advance and visibly opens a gap after 忆, and the
 * dialog does not have one. The body deliberately carries no byte
 * count either, and the row above the button already
 * shows the figure the user would compare it against.
 */
export const MEMORY_DELETE_CONFIRM = {
  title: "删除记忆?",
  body: "MiniMax Code 将不再记住关于你的重要信息，你的使用体验将少一些个性化。",
  cancel: "取消",
  confirm: "删除",
} as const;

/**
 * The save predicate, lifted out so it can be tested directly:
 * `!loading && !saving && draft !== baseline && draft.length > 0`.
 *
 * All four clauses matter. Without the dirty check the button is live the moment
 * the dialog opens, offering a write that rewrites the file byte-for-byte;
 * without the length check an emptied editor would save a delete from a control
 * that is not the delete control, behind no confirmation.
 */
export function isMemorySaveable(input: {
  readonly draft: string | undefined;
  readonly baseline: string | undefined;
  readonly loading: boolean;
  readonly saving: boolean;
}): boolean {
  return (
    !input.loading &&
    !input.saving &&
    input.draft !== undefined &&
    input.draft !== input.baseline &&
    input.draft.length > 0
  );
}

export function formatMemoryTimestamp(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number): string => String(part).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `更新于 ${stamp}`;
}

/** What 「在会话中创建」 leaves in the composer, beside the attached file.
 *  The home surface opens with exactly this one line already
 *  typed, so the user's next action is to add what they actually want changed. */
export const MEMORY_HANDOFF_PROMPT = "我想调整下这个记忆文件";

/** What 「在会话中创建」 carries across: the body plus the identity the composer
 *  chip needs. `token` makes the hand-off one-shot — the composer remembers the
 *  last token it consumed, so a re-render cannot double-attach a 74KB file. */
export interface MemoryHandoff {
  readonly token: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly content: string;
}

export interface MemoryManagerDialogProps {  readonly getAgentMemory?: (request?: {
    readonly includeContent?: boolean;
  }) => Promise<WebuiAgentMemoryView>;
  readonly setAgentMemory?: (request: {
    readonly content: string;
  }) => Promise<WebuiAgentMemoryView>;
  readonly onClose: () => void;
  /** Hand the memory to a conversation instead of editing it here. Omitted when
   *  the host has nowhere to put it — the item then stays out of the menu rather
   *  than opening a composer the shell cannot reach. */
  readonly onCreateInSession?: (input: MemoryHandoff) => void;
}

/**
 * The body behind 管理.
 *
 * Summary first, body on request: the first paint must not already contain the
 * editor, because a live main file runs past the runtime's 64KB cleanup
 * threshold and the row that opened the manager only needed the size.
 *
 * This is main memory, not `writeMemorySummary` — the runtime rejects summary
 * content over 4KB, so a textarea wired to the summary would reject exactly the
 * content this panel exists to show.
 */
export function MemoryManagerDialog({
  getAgentMemory,
  setAgentMemory,
  onClose,
  onCreateInSession,
}: MemoryManagerDialogProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const [draft, setDraft] = useState<string>();
  // The text the server last returned, as opposed to what is in the box now.
  // Without it there is no way to tell an edit from a re-render, and the save
  // button sits live on open — offering a write that rewrites the file
  // byte-for-byte.
  const [baseline, setBaseline] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [filePath, setFilePath] = useState<string>();
  const [fileSize, setFileSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The document-level Escape handler below is keyed on `onClose` alone so it
  // never tears down and re-steals focus on every keystroke. It therefore
  // cannot close over `menuOpen`; this ref is how it still sees the flag.
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  // Same reason as `menuOpenRef`: the Escape handler below is keyed on `onClose`
  // alone, so it cannot close over the confirmation's state.
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = confirmingDelete;

  const load = useCallback(async (reader: NonNullable<MemoryManagerDialogProps["getAgentMemory"]>) => {
    setLoading(true);
    setError(undefined);
    try {
      const value = await reader({ includeContent: true });
      if (!value) return;
      setDraft(value.content ?? "");
      setBaseline(value.content ?? "");
      setUpdatedAt(value.updatedAt);
      setFilePath(value.path);
      setFileSize(value.sizeBytes);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The body loads on open. 管理 goes straight into the editor,
   * and a second click to start reading is a step the user has to learn for
   * nothing — the file is the whole point of opening the dialog.
   *
   * The reader is reached through a ref and the effect is keyed on nothing, on
   * purpose. Keyed on `getAgentMemory`, any parent that hands down a fresh
   * closure would re-run this after every keystroke and replace the text being
   * typed: the editor would look like it was refreshing, and the edit would be
   * silently discarded. A load that can fire more than once per open is worse
   * than no load at all.
   */
  const readerRef = useRef(getAgentMemory);
  useEffect(() => {
    readerRef.current = getAgentMemory;
  }, [getAgentMemory]);
  useEffect(() => {
    const reader = readerRef.current;
    if (reader) void load(reader);
  }, [load]);

  /**
   * The save predicate: `!loading && !saving && draft !== baseline &&
   * draft.length > 0`. All four matter — a live button on open offers a write
   * that rewrites the file byte-for-byte, and an empty draft is the delete
   * path, which lives behind the ⋯ menu.
   */
  const saveable = isMemorySaveable({ draft, baseline, loading, saving });

  const save = useCallback(async () => {
    // `saveable` already rules an undefined draft out, but it is a plain boolean
    // to the type checker, so the narrowing has to be restated here or `draft`
    // reaches the write as `string | undefined`.
    if (!setAgentMemory || !saveable || draft === undefined) return;
    setSaving(true);
    setError(undefined);
    try {
      const written = await setAgentMemory({ content: draft });
      // Whatever came back is the new baseline; a save that the server
      // normalised must not leave the button live on a file that already matches.
      setBaseline(written?.content ?? draft);
      setSaved(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [draft, saveable, saving, setAgentMemory]);

  /**
   * 删除记忆 is a blank write, not a new capability.
   *
   * `writeAgentMemory` already treats empty content as "remove the file" — the
   * runtime's own write contract does the same — so the menu item is a named
   * shortcut for something the editor could already do by emptying the textarea
   * and saving. That is worth stating plainly, because it is also the reason
   * this needs a confirmation: the path it takes is the one that unlinks a
   * 74KB file of accumulated lessons, with nothing to undo it from.
   */
  const remove = useCallback(async () => {
    if (!setAgentMemory || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await setAgentMemory({ content: "" });
      setBaseline("");
      setDraft("");
      setDraft(undefined);
      setUpdatedAt(undefined);
      setFileSize(0);
      setConfirmingDelete(false);
      setMenuOpen(false);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [saving, setAgentMemory]);

  const handoffSequence = useRef(0);
  const handoff = useCallback(() => {
    if (!onCreateInSession || draft === undefined || !filePath) return;
    const fileName = basenamePath(filePath) || "MEMORY.md";
    handoffSequence.current += 1;
    onCreateInSession({
      token: `${fileName}:${fileSize}:${handoffSequence.current}`,
      fileName,
      mimeType: fileName.toLowerCase().endsWith(".md") ? "text/markdown" : "text/plain",
      sizeBytes: fileSize,
      content: draft,
    });
    setMenuOpen(false);
    onClose();
  }, [draft, filePath, fileSize, onClose, onCreateInSession]);

  /**
   * Escape has to be heard on the document, and focus has to be moved in by
   * hand. The dialog is portalled to `document.body`, so it is not a DOM
   * descendant of the row that opened it: a `keydown` handler on the surface
   * only ever sees keys typed after focus happens to land inside, and on open
   * focus is still on 管理. Listening on the surface alone therefore left the
   * one key every modal is expected to honour doing nothing.
   *
   * Unmount restores focus to whatever held it before, so closing with Escape
   * leaves the keyboard on the row the user came from.
   */
  const surfaceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const restoreTo = dom.getActiveElement();
    surfaceRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      // Two layers sit above the editor, and Escape sheds the topmost one so
      // that a second press has to be a second press. Dismissing the editor
      // instead would throw away the draft behind an open menu or an open
      // confirmation, which is not what pressing Escape once means.
      if (confirmOpenRef.current) {
        setConfirmingDelete(false);
        return;
      }
      if (menuOpenRef.current) {
        setMenuOpen(false);
        return;
      }
      onClose();
    };
    const stopKeyDown = dom.listenForKeyDown(onKeyDown);
    return () => {
      stopKeyDown();
      restoreTo?.focus();
    };
  }, [dom, onClose]);

  const dialog = (
    <div
      data-testid="agent-memory-manager"
      className="webui-memory-manager-mask"
      onMouseDown={(event) => {
        // Shed the menu before the dialog: a click on the scrim with a menu
        // open means "put that away", not "discard the memory editor".
        if (event.target !== event.currentTarget) return;
        if (menuOpenRef.current) {
          setMenuOpen(false);
          return;
        }
        onClose();
      }}
    >
      <section
        ref={surfaceRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="记忆摘要"
        className="webui-memory-manager-surface"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="webui-personalization-header">
          <h3>记忆摘要</h3>
          <div className="webui-memory-manager-header-actions">
            <button
              type="button"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-testid="agent-memory-menu"
              className="webui-settings-icon-button"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="3" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="13" cy="8" r="1.4" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="关闭"
              data-testid="agent-memory-close"
              className="webui-settings-icon-button"
              onClick={onClose}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {menuOpen ? (
            <div role="menu" aria-label="记忆操作" data-testid="agent-memory-menu-panel" className="webui-memory-manager-menu">
              {onCreateInSession ? (
                <button type="button" role="menuitem" data-testid="agent-memory-create-in-session" onClick={handoff}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className="webui-memory-manager-menu-icon">
                    <path d="M14 10.5a2 2 0 0 1-2 2H6l-3.5 2.5V4.5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 2 2v6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  </svg>
                  在会话中创建
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                data-testid="agent-memory-delete"
                className="is-danger"
                disabled={!setAgentMemory || draft === undefined}
                onClick={() => {
                  // Shed the menu as it opens the confirmation: leaving it up
                  // puts a second copy of 删除记忆 on top of the thing it just
                  // opened, so the panel looks like it has two delete buttons.
                  setMenuOpen(false);
                  setConfirmingDelete(true);
                }}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className="webui-memory-manager-menu-icon">
                  <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                删除记忆
              </button>
            </div>
          ) : null}
        </div>
        {loading ? (
          <p data-testid="agent-memory-loading" className="webui-personalization-meta">
            加载中…
          </p>
        ) : draft === undefined ? null : (
          <div className="webui-memory-manager-editor">
            <textarea
              data-testid="agent-memory-textarea"
              className="webui-personalization-textarea"
              value={draft}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
            />
            <span data-testid="agent-memory-chars" className="webui-memory-manager-count">
              {draft.length}
            </span>
          </div>
        )}
        {error ? (
          <p role="alert" data-testid="agent-memory-error" className="webui-settings-error">
            {error}
          </p>
        ) : null}
        {error && draft === undefined && getAgentMemory ? (
          <button
            type="button"
            data-testid="agent-memory-retry"
            className="webui-mavis-button webui-mavis-button-gray"
            disabled={loading}
            onClick={() => void load(getAgentMemory)}
          >
            重试
          </button>
        ) : null}
        {saved && !saving ? (
          <p data-testid="agent-memory-saved" className="webui-personalization-saved">
            已保存
          </p>
        ) : null}
        <footer className="webui-memory-manager-footer">
          <span data-testid="agent-memory-updated" className="webui-personalization-meta">
            {formatMemoryTimestamp(updatedAt)}
          </span>
          <div className="webui-memory-manager-actions">
            <button type="button" className="webui-mavis-button webui-mavis-button-gray" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              data-testid="agent-memory-save"
              className="webui-mavis-button webui-mavis-button-black"
              disabled={!saveable || !setAgentMemory}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  /**
   * The confirmation is a second modal, not a panel inside the first.
   *
   * The confirmation dims the editor behind a centred dialog with its own title, a
   * × and a right-aligned footer. Rendering it inline — which is what this used
   * to do — cannot get there: an inline block cannot dim what is behind it, and
   * a scrim over the editor has to be portalled for the same reason the editor
   * is. The scrim sits above `.webui-memory-manager-mask` (120) because it is a
   * layer above that dialog rather than part of it.
   *
   * Focus moves in on open and back out on close for the same portal reason as
   * the editor above: the confirm is not a DOM descendant of the button that
   * opened it, so nothing focuses it and the keyboard stays on a menu item that
   * has since unmounted.
   */
  const confirmRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!confirmingDelete) return;
    const restoreTo = dom.getActiveElement();
    confirmRef.current?.focus();
    return () => {
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [confirmingDelete, dom]);

  const confirm = confirmingDelete ? (
    <div
      className="webui-memory-confirm-mask"
      data-testid="agent-memory-delete-confirm"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        setConfirmingDelete(false);
      }}
    >
      <div
        ref={confirmRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="webui-memory-confirm-title"
        tabIndex={-1}
        className="webui-memory-confirm"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="webui-memory-confirm-title" className="webui-memory-confirm-title">
          {MEMORY_DELETE_CONFIRM.title}
        </h2>
        <button
          type="button"
          aria-label="关闭"
          data-testid="agent-memory-delete-dismiss"
          className="webui-memory-confirm-close"
          onClick={() => setConfirmingDelete(false)}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
          </svg>
        </button>
        <p className="webui-memory-confirm-body">{MEMORY_DELETE_CONFIRM.body}</p>
        <div className="webui-memory-confirm-actions">
          <button
            type="button"
            className="webui-mavis-button webui-mavis-button-gray"
            data-testid="agent-memory-delete-cancel"
            onClick={() => setConfirmingDelete(false)}
          >
            {MEMORY_DELETE_CONFIRM.cancel}
          </button>
          <button
            type="button"
            className="webui-mavis-button webui-mavis-button-danger"
            data-testid="agent-memory-delete-confirm-button"
            disabled={saving}
            onClick={() => void remove()}
          >
            {saving ? "删除中…" : MEMORY_DELETE_CONFIRM.confirm}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  /**
   * Portalled to the body on purpose. The settings shell is a `z-index: 100`
   * fixed overlay, and anything with a position and a z-index becomes a
   * stacking context — a dialog rendered inside it can never paint above the
   * shell no matter how large its own z-index is. The same reason
   * `UserMenu` portals the settings modal itself out of the rail.
   */
  const portalTarget = dom.portalTarget();
  return portalTarget ? createPortal(<>{dialog}{confirm}</>, portalTarget) : dialog;
}
