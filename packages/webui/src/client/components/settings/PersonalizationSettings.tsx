import { useMemo, type ReactElement } from "react";
import type { WebuiAgentMemoryView, WebuiGlobalInstructionsView, WebuiMemorySettingsView, WebuiUserProfileFields, WebuiUserProfileView } from "../../../shared/contracts/personalization.js";
import { useWebuiSettingsWorkflows, useWebuiSettingsWorkflowsState } from "../../bindings/use-query-state.js";
import type { MemoryHandoff } from "./MemoryManagerDialog.js";
import { GlobalInstructionsSection } from "./GlobalInstructionsSection.js";
import { UserProfileSection } from "./UserProfileSection.js";
import { MemorySection } from "./MemorySection.js";

/**
 * Personalization panel — the three blocks the desktop surface ships:
 * 自定义指令, 关于你, 记忆.
 *
 * Shape note for reviewers: the desktop presents 记忆 as a card of three rows
 * (two switches plus a 管理 action that opens the memory manager), not as a
 * single textarea. The earlier revision rendered a standalone 长期记忆 editor;
 * it was the same file and the same operations, just a different surface, and
 * the roadmap's "管理 UI 未见" is only closed by the row that points at a
 * manager.
 *
 * Scope note: this lands in the same settings modal that the P area (设置中心)
 * also touches, but the two do not overlap in behaviour. P owns the shell — tab
 * list, groups, search filtering. This component owns one tab body and the
 * transport calls behind it. The only shared line is the `disabled` flag on the
 * `custom-instructions` tab definition in `SettingsModal.tsx`, which the earlier
 * PR removed.
 */

/**
 * The delete confirmation's copy, copied from the desktop word for word.
 *
 * The half-width `?` is the desktop's, not a typo to tidy up: a full-width
 * `？` carries a full em of advance and visibly opens a gap after 忆, and the
 * measured dialog does not have one. The body deliberately carries no byte
 * count — the desktop's does not either, and the row above the button already
 * shows the figure the user would compare it against.
 */
export const MEMORY_DELETE_CONFIRM = {
  title: "删除记忆?",
  body: "MiniMax Code 将不再记住关于你的重要信息，你的使用体验将少一些个性化。",
  cancel: "取消",
  confirm: "删除",
} as const;

export interface PersonalizationSettingsProps {
  /** 「在会话中创建」. Optional on purpose: without a host that can receive the
   *  hand-off the menu item is not rendered at all, rather than rendered and
   *  quietly doing nothing when clicked. */
  readonly onCreateInSession?: (input: MemoryHandoff) => void;
}

/**
 * Personalization panel — the settings owner's per-surface consumer.
 *
 * Every read and write below is derived from the settings workflow owner
 * (ticket #52): this component calls the owner's commands and reads its
 * snapshot, and hands the three section components the same read/write
 * callback shape they always took. The sections keep their own uncommitted
 * editor state; only what was submitted belongs to the application.
 */
export function PersonalizationSettings({ onCreateInSession }: PersonalizationSettingsProps = {}): ReactElement {
  const settings = useWebuiSettingsWorkflows();
  // Subscribe so a settings write anywhere re-renders this consumer. The
  // sections hold their own editor state and read the snapshot imperatively,
  // so the values themselves are not threaded through here.
  useWebuiSettingsWorkflowsState();

  const sections = useMemo(() => {
    const s = settings;
    const getGlobalInstructions = s && s.canReadInstructions
      ? async (): Promise<WebuiGlobalInstructionsView> => {
          await s.loadInstructions();
          const state = s.getSnapshot().instructions;
          if (state.value === undefined) throw new Error(state.error ?? "当前运行时不支持自定义指令读写。");
          return state.value;
        }
      : undefined;
    const setGlobalInstructions = s && s.canWriteInstructions
      ? async (request: { readonly content: string }): Promise<WebuiGlobalInstructionsView> => s.saveInstructions(request.content)
      : undefined;
    const getUserProfile = s && s.canReadProfile
      ? async (): Promise<WebuiUserProfileView> => {
          await s.loadProfile();
          const state = s.getSnapshot().profile;
          if (state.value === undefined) throw new Error(state.error ?? "当前运行时不支持「关于你」读写。");
          return state.value;
        }
      : undefined;
    const setUserProfile = s && s.canWriteProfile
      ? async (request: WebuiUserProfileFields): Promise<WebuiUserProfileView> => s.saveProfile(request)
      : undefined;
    const getAgentMemory = s && s.canReadMemory
      ? async (request?: { readonly includeContent?: boolean }): Promise<WebuiAgentMemoryView> => {
          await s.loadAgentMemory(request?.includeContent);
          const state = s.getSnapshot().agentMemory;
          if (state.value === undefined) throw new Error(state.error ?? "当前运行时不支持长期记忆读写。");
          return state.value;
        }
      : undefined;
    const setAgentMemory = s && s.canWriteMemory
      ? async (request: { readonly content: string }): Promise<WebuiAgentMemoryView> => s.saveAgentMemory(request.content)
      : undefined;
    const getMemorySettings = s && s.canReadMemorySettings
      ? async (): Promise<WebuiMemorySettingsView> => {
          await s.loadMemorySettings();
          const state = s.getSnapshot().memorySettings;
          if (state.value === undefined) throw new Error(state.error ?? "当前运行时不支持记忆开关。");
          return state.value;
        }
      : undefined;
    const setMemorySettings = s && s.canWriteMemorySettings
      ? async (request: { readonly enabled?: boolean; readonly proactive?: boolean }): Promise<WebuiMemorySettingsView> => s.saveMemorySettings(request)
      : undefined;
    return {
      getGlobalInstructions,
      setGlobalInstructions,
      getUserProfile,
      setUserProfile,
      getAgentMemory,
      setAgentMemory,
      getMemorySettings,
      setMemorySettings,
    };
  }, [settings]);

  return (
    <div data-testid="content-body" className="webui-personalization-page">
      <GlobalInstructionsSection
        getGlobalInstructions={sections.getGlobalInstructions}
        setGlobalInstructions={sections.setGlobalInstructions}
      />
      <UserProfileSection
        getUserProfile={sections.getUserProfile}
        setUserProfile={sections.setUserProfile}
      />
      <MemorySection
        getAgentMemory={sections.getAgentMemory}
        setAgentMemory={sections.setAgentMemory}
        getMemorySettings={sections.getMemorySettings}
        setMemorySettings={sections.setMemorySettings}
        {...(onCreateInSession ? { onCreateInSession } : {})}
      />
    </div>
  );
}
