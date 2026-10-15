import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { findWebuiMentionRange, removeWebuiSlashToken, type WebuiMentionRange, type WebuiSlashRange } from "../projection/composer-interactions.js";
import { resolveWebuiComposerEnterAction } from "../projection/composer-state.js";
import { shouldRecallWebuiHistory, startWebuiHistoryBrowse, stepWebuiHistoryBrowse, type WebuiHistoryBrowse } from "../application/composer-history.js";
import { evaluateOutsideClose } from "../../../projection/common/outside-close.js";

export interface ComposerInputKeyOptions {
  readonly draft: string;
  readonly history: readonly string[];
  readonly mentionRange?: WebuiMentionRange;
  readonly mentionCount: number;
  readonly commandRange?: WebuiSlashRange;
  readonly commandCount: number;
  readonly composerMenu?: string;
  readonly permissionMenuOpen: boolean;
  readonly goalMode: boolean;
  readonly planMode: boolean;
  readonly submitBlocked: boolean;
  readonly setMentionRange: (range: WebuiMentionRange | undefined) => void;
  readonly setComposerMenu: (menu: undefined) => void;
  readonly setPermissionMenuOpen: (open: boolean) => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onHistoryDraftChange?: (draft: string) => void;
  readonly onCancelGoal: () => void;
  readonly onCancelPlan: () => void;
  readonly chooseMention: (index: number) => void;
  readonly chooseCommand: (index: number) => void;
}

export interface ComposerInput {
  readonly textareaRef: RefObject<HTMLTextAreaElement>;
  readonly caret: number;
  readonly setCaret: (caret: number) => void;
  readonly mentionIndex: number;
  readonly setMentionIndex: (index: number | ((current: number) => number)) => void;
  readonly commandIndex: number;
  readonly setCommandIndex: (index: number | ((current: number) => number)) => void;
  readonly historyBrowse: WebuiHistoryBrowse | undefined;
  readonly setHistoryBrowse: (browse: WebuiHistoryBrowse | undefined) => void;
  readonly setPendingCaret: (caret: number) => void;
  readonly edit: (input: {
    readonly value: string;
    readonly caret: number;
    readonly changeDraft: (draft: string) => void;
    readonly mentionRange: WebuiMentionRange | undefined;
    readonly setMentionRange: (range: WebuiMentionRange | undefined) => void;
    readonly setComposerMenu: (menu: undefined) => void;
    readonly setPermissionMenuOpen: (open: boolean) => void;
  }) => void;
  readonly updateCaret: (value: string, caret: number, mentionRange: WebuiMentionRange | undefined, setMentionRange: (range: WebuiMentionRange | undefined) => void) => void;
  readonly applyHistoryDraft: (text: string, changeDraft: (draft: string) => void) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, options: ComposerInputKeyOptions) => void;
}

export function useComposerInput(draft: string, sessionId?: string): ComposerInput {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number>();
  const mentionCaret = useRef<number>();
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [historyBrowse, setHistoryBrowse] = useState<WebuiHistoryBrowse>();

  useEffect(() => setHistoryBrowse(undefined), [sessionId]);

  useLayoutEffect(() => {
    const next = pendingCaret.current;
    const textarea = textareaRef.current;
    if (next === undefined || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(next, next);
    pendingCaret.current = undefined;
    setCaret(next);
  }, [draft]);

  const edit: ReturnType<typeof useComposerInput>["edit"] = useCallback((input) => {
    input.changeDraft(input.value);
    setHistoryBrowse(undefined);
    mentionCaret.current = input.caret;
    setCaret(input.caret);
    const nextRange = findWebuiMentionRange(input.value, input.caret);
    if (nextRange) {
      input.setComposerMenu(undefined);
      input.setPermissionMenuOpen(false);
    }
    input.setMentionRange(nextRange);
  }, []);

  const updateCaret: ReturnType<typeof useComposerInput>["updateCaret"] = useCallback((value, nextCaret, _mentionRange, setMentionRange) => {
    setCaret(nextCaret);
    setMentionRange(findWebuiMentionRange(value, nextCaret));
  }, []);

  const applyHistoryDraft = useCallback((text: string, changeDraft: (draft: string) => void) => {
    changeDraft(text);
    setCaret(text.length);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(text.length, text.length));
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>, options: ComposerInputKeyOptions) => {
    if (options.mentionRange && options.mentionCount > 0) {
      if (event.key === "Escape") { event.preventDefault(); options.setMentionRange(undefined); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % options.mentionCount); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + options.mentionCount) % options.mentionCount); return; }
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); options.chooseMention(mentionIndex); return; }
    }
    if (event.key === "Escape" && options.composerMenu) { event.preventDefault(); options.setComposerMenu(undefined); return; }
    if (event.key === "Escape" && options.permissionMenuOpen) { event.preventDefault(); options.setPermissionMenuOpen(false); return; }
    if (event.key === "Escape" && (options.goalMode || options.planMode)) {
      event.preventDefault();
      if (options.goalMode) options.onCancelGoal(); else options.onCancelPlan();
      return;
    }
    if (event.key === "Escape" && options.commandRange) {
      event.preventDefault();
      const next = removeWebuiSlashToken(options.draft, options.commandRange);
      options.onDraftChange(next);
      setCaret(next.length);
      return;
    }
    if (event.key === "Escape" && historyBrowse) {
      event.preventDefault();
      setHistoryBrowse(undefined);
      applyHistoryDraft(historyBrowse.draft, options.onHistoryDraftChange ?? options.onDraftChange);
      return;
    }
    if (options.commandCount === 0 && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const position = event.currentTarget.selectionStart ?? 0;
      if (event.key === "ArrowUp") {
        const next = historyBrowse
          ? stepWebuiHistoryBrowse(historyBrowse, "prev", options.history)
          : shouldRecallWebuiHistory(options.draft, position)
            ? startWebuiHistoryBrowse(options.history, options.draft)
            : undefined;
        if (next) {
          event.preventDefault();
          setHistoryBrowse(next);
          applyHistoryDraft(options.history[next.index] ?? "", options.onHistoryDraftChange ?? options.onDraftChange);
          return;
        }
      } else if (historyBrowse) {
        const next = stepWebuiHistoryBrowse(historyBrowse, "next", options.history);
        event.preventDefault();
        setHistoryBrowse(next);
        applyHistoryDraft(next ? options.history[next.index] ?? "" : historyBrowse.draft, options.onHistoryDraftChange ?? options.onDraftChange);
        return;
      }
    }
    if (event.key === "Enter" && options.commandCount === 0) {
      const action = resolveWebuiComposerEnterAction({
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        isComposing: event.nativeEvent.isComposing,
        submitBlocked: options.submitBlocked,
      });
      if (action === "submit") {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
        return;
      }
    }
    if (options.commandCount === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCommandIndex((current) => (current + 1) % options.commandCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCommandIndex((current) => (current - 1 + options.commandCount) % options.commandCount);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      options.chooseCommand(commandIndex);
    }
  }, [applyHistoryDraft, commandIndex, historyBrowse, mentionIndex]);

  return {
    textareaRef, caret, setCaret, mentionIndex, setMentionIndex, commandIndex, setCommandIndex,
    historyBrowse, setHistoryBrowse, setPendingCaret: (value) => { pendingCaret.current = value; },
    edit, updateCaret, applyHistoryDraft, handleKeyDown,
  };
}

export function useComposerSlashDismiss(input: {
  readonly listenForPointerDown: (listener: (event: PointerEvent) => void) => () => void;
  readonly regionRef: RefObject<HTMLElement>;
  readonly draft: string;
  readonly range: WebuiSlashRange | undefined;
  readonly enabled: boolean;
  readonly onDraftChange: (draft: string) => void;
}): void {
  const draftRef = useRef(input.draft);
  const rangeRef = useRef(input.range);
  useEffect(() => {
    draftRef.current = input.draft;
    rangeRef.current = input.range;
  });
  useEffect(() => {
    if (!input.enabled) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const range = rangeRef.current;
      const region = input.regionRef.current;
      if (!range || !region || !(event.target instanceof Node)) return;
      if (evaluateOutsideClose({
        surface: "slashPopover",
        kind: "pointerdown",
        insideContainer: region.contains(event.target),
      }) !== "close") return;
      input.onDraftChange(removeWebuiSlashToken(draftRef.current, range));
    };
    return input.listenForPointerDown(onPointerDown);
  }, [input.enabled, input.listenForPointerDown, input.onDraftChange, input.regionRef]);
}
