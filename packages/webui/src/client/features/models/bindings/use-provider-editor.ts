// The Models provider editor's React edge (plan §5.5).
//
// One editor per Usage page visit, hosted *above* the `sourceTab === "custom"`
// conditional so switching source tabs does not discard a draft and so the
// editor's memory of "this draft was tested" survives the panel unmounting. The
// component that calls this hook therefore owns the lifetime: it disposes on its
// own unmount, which is leaving the Usage category or unmounting Settings.
//
// The commands are read through a live facade rather than captured, because the
// composition builds the workflow's command object per render and an editor that
// captured one instance would drive a stale closure after the first re-render.

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import {
  createWebuiProviderEditor,
  type WebuiProviderEditor,
  type WebuiProviderEditorCommands,
  type WebuiProviderEditorSnapshot,
} from "../application/provider-editor.js";

export interface WebuiProviderEditorHandle {
  readonly editor: WebuiProviderEditor;
  readonly snapshot: WebuiProviderEditorSnapshot;
}

export function useWebuiProviderEditor(
  commands: WebuiProviderEditorCommands,
): WebuiProviderEditorHandle {
  const commandsRef = useRef(commands);
  commandsRef.current = commands;

  const editor = useMemo(() => {
    const live: WebuiProviderEditorCommands = {
      get canManageProviders() {
        return commandsRef.current.canManageProviders;
      },
      revealApiKey: (providerId) => commandsRef.current.revealApiKey(providerId),
      createProvider: (body) => commandsRef.current.createProvider(body),
      updateProvider: (body) => commandsRef.current.updateProvider(body),
      deleteProvider: (providerId) => commandsRef.current.deleteProvider(providerId),
      discoverCandidate: (body) => commandsRef.current.discoverCandidate(body),
      saveCandidate: (body) => commandsRef.current.saveCandidate(body),
      testCandidate: (body) => commandsRef.current.testCandidate(body),
    };
    return createWebuiProviderEditor({ commands: live });
  }, []);

  const snapshot = useSyncExternalStore(
    editor.subscribe,
    editor.getSnapshot,
    editor.getSnapshot,
  );

  useEffect(() => () => editor.dispose(), [editor]);

  return { editor, snapshot };
}
