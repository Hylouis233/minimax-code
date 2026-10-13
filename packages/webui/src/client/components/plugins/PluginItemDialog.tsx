// The plugin item dialog (plan §15.1's `PluginItemDialog.tsx` row, ticket #72; §16.9: "the item
// dialog and the MCP form are **one dialog**, discriminated by `dialog === "mcp"`" — so this is one
// target, not two).
//
// It is the form the user edits a plugin's MCP server, an Agent, or a skill in, moved from
// `PluginManagement.tsx:1181-1476` of a 1594-line file containing a ternary tower over five areas.
// "Add a field to the MCP server form" is now `:1` of this file.
//
// **What it owns: nothing.** Every field, every setter and the three save paths are the catalogue's,
// passed in flat, so the moved JSX is the same JSX — the request timing (`saveMcp`/`saveAgent`/
// `saveSkill` fire on the same submit), the conditional branches and the error path are unchanged,
// and a failed save leaves the dialog open with the user's input exactly as it is. The parent keeps
// the `{dialog ? … : null}` conditional, so the mount boundary is the one it had.

import type { Dispatch, ReactElement, SetStateAction } from "react";

import { readWebuiPluginRow as read, type WebuiPluginRow as Row } from "../../projection/plugin-rows.js";
import { ToggleSwitch } from "../shared/ToggleSwitch.js";

export interface PluginItemDialogProps {
  readonly busy: boolean;
  readonly dialog: "mcp" | "agent" | "skill" | null;
  readonly editing: Row | undefined;
  readonly enabled: (item: Row) => boolean;
  readonly agentDescription: string;
  readonly agentModel: string;
  readonly agentName: string;
  readonly agentPrompt: string;
  readonly mcpArgs: string;
  readonly mcpCommand: string;
  readonly mcpDescription: string;
  readonly mcpEnabled: boolean;
  readonly mcpEnv: string;
  readonly mcpHeaders: string;
  readonly mcpJson: string;
  readonly mcpJsonMode: boolean;
  readonly mcpName: string;
  readonly mcpTimeoutMs: string;
  readonly mcpTransport: string;
  readonly mcpUrl: string;
  readonly skillContent: string;
  readonly skillDescription: string;
  readonly mcpAdvancedOpen: boolean;
  readonly setAgentDescription: Dispatch<SetStateAction<string>>;
  readonly setAgentModel: Dispatch<SetStateAction<string>>;
  readonly setAgentName: Dispatch<SetStateAction<string>>;
  readonly setAgentPrompt: Dispatch<SetStateAction<string>>;
  readonly setMcpArgs: Dispatch<SetStateAction<string>>;
  readonly setMcpCommand: Dispatch<SetStateAction<string>>;
  readonly setMcpDescription: Dispatch<SetStateAction<string>>;
  readonly setMcpEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setMcpEnv: Dispatch<SetStateAction<string>>;
  readonly setMcpHeaders: Dispatch<SetStateAction<string>>;
  readonly setMcpJson: Dispatch<SetStateAction<string>>;
  readonly setMcpJsonMode: Dispatch<SetStateAction<boolean>>;
  readonly setMcpName: Dispatch<SetStateAction<string>>;
  readonly setMcpTimeoutMs: Dispatch<SetStateAction<string>>;
  readonly setMcpTransport: Dispatch<SetStateAction<string>>;
  readonly setMcpUrl: Dispatch<SetStateAction<string>>;
  readonly setSkillContent: Dispatch<SetStateAction<string>>;
  readonly setSkillDescription: Dispatch<SetStateAction<string>>;
  readonly setMcpAdvancedOpen: Dispatch<SetStateAction<boolean>>;
  readonly setDialog: Dispatch<SetStateAction<"mcp" | "agent" | "skill" | null>>;
  readonly saveMcp: () => Promise<void>;
  readonly saveAgent: () => Promise<void>;
  readonly saveSkill: () => Promise<void>;
  readonly switchMcpToForm: () => void;
  readonly switchMcpToJson: () => void;
}

export function PluginItemDialog({
busy, dialog, editing, enabled, agentDescription, agentModel, agentName, agentPrompt, mcpArgs, mcpCommand, mcpDescription, mcpEnabled, mcpEnv, mcpHeaders, mcpJson, mcpJsonMode, mcpName, mcpTimeoutMs, mcpTransport, mcpUrl, skillContent, skillDescription, mcpAdvancedOpen, setAgentDescription, setAgentModel, setAgentName, setAgentPrompt, setMcpArgs, setMcpCommand, setMcpDescription, setMcpEnabled, setMcpEnv, setMcpHeaders, setMcpJson, setMcpJsonMode, setMcpName, setMcpTimeoutMs, setMcpTransport, setMcpUrl, setSkillContent, setSkillDescription, setMcpAdvancedOpen, setDialog, saveMcp, saveAgent, saveSkill, switchMcpToForm, switchMcpToJson
}: PluginItemDialogProps): ReactElement {
  return (
    <div
      className="webui-plugin-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setDialog(null);
      }}
    >
      <section
        className={`webui-plugin-dialog${dialog === "mcp" ? " webui-mcp-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugin-dialog-title"
      >
        <header>
          <div>
            <h2 id="plugin-dialog-title">
              {dialog === "mcp"
                ? editing
                  ? "编辑 MCP server"
                  : "添加 MCP server"
                : dialog === "skill"
                  ? "录入技能"
                  : editing
                    ? "编辑 Agent"
                    : "创建 Agent"}
            </h2>
            <p>{dialog === "mcp" ? "配置 MiniMax Code 如何连接到这个 server" : "配置 MiniMax Code 如何连接到该项"}</p>
          </div>
          <button onClick={() => setDialog(null)} aria-label="关闭">
            ×
          </button>
        </header>
        {dialog === "mcp" ? (
          <>
            <div className="webui-plugin-header-tabs">
              <button
                type="button"
                aria-pressed={!mcpJsonMode}
                onClick={switchMcpToForm}
              >
                表单
              </button>
              <button
                type="button"
                aria-pressed={mcpJsonMode}
                onClick={switchMcpToJson}
              >
                JSON
              </button>
            </div>
            {mcpJsonMode ? (
              <div className="webui-mcp-json-panel">
                <p>粘贴单个服务器配置或 <code>mcpServers</code> 对象。</p>
                <textarea
                  className="webui-plugin-json webui-mcp-json-editor"
                  aria-label="MCP 配置 JSON"
                  value={mcpJson}
                  onChange={(event) =>
                    setMcpJson(event.currentTarget.value)
                  }
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="webui-plugin-form webui-mcp-form">
                <label>
                  Server 名称
                  <input
                    value={mcpName}
                    onChange={(event) =>
                      setMcpName(event.currentTarget.value)
                    }
                    placeholder="my-server"
                  />
                </label>
                <label>
                  传输方式
                  <select
                    value={mcpTransport}
                    onChange={(event) =>
                      setMcpTransport(event.currentTarget.value)
                    }
                  >
                    <option value="stdio">stdio</option>
                    <option value="streamable-http">HTTP</option>
                    <option value="sse">SSE</option>
                  </select>
                </label>
                {mcpTransport === "stdio" ? (
                  <>
                    <label>
                      命令
                      <input
                        value={mcpCommand}
                        onChange={(event) =>
                          setMcpCommand(event.currentTarget.value)
                        }
                        placeholder="npx"
                      />
                    </label>
                    <label>
                      参数
                      <input
                        value={mcpArgs}
                        onChange={(event) =>
                          setMcpArgs(event.currentTarget.value)
                        }
                        placeholder="-y @example/mcp-server"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    URL
                    <input
                      value={mcpUrl}
                      onChange={(event) =>
                        setMcpUrl(event.currentTarget.value)
                      }
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                )}
                <label className="wide">
                  描述
                  <input
                    value={mcpDescription}
                    onChange={(event) =>
                      setMcpDescription(event.currentTarget.value)
                    }
                    placeholder="这个 server 提供什么能力？"
                  />
                </label>
                <div className="webui-mcp-enabled wide">
                  <div>
                    <strong>启用</strong>
                    <span>允许 MiniMax Code 使用此服务。</span>
                  </div>
                  <ToggleSwitch checked={mcpEnabled} label="启用 MCP server" onChange={setMcpEnabled} />
                </div>
                <div className="webui-mcp-advanced wide">
                  <button
                    type="button"
                    aria-expanded={mcpAdvancedOpen}
                    onClick={() => setMcpAdvancedOpen((value) => !value)}
                  >
                    <strong>高级选项</strong>
                    <span aria-hidden="true">{mcpAdvancedOpen ? "⌃" : "⌄"}</span>
                  </button>
                  {mcpAdvancedOpen ? (
                    <div className="webui-plugin-form webui-mcp-advanced-fields">
                      <label>
                        超时（毫秒）
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={mcpTimeoutMs}
                          onChange={(event) => setMcpTimeoutMs(event.currentTarget.value)}
                          placeholder="使用默认值"
                        />
                      </label>
                      {mcpTransport === "stdio" ? (
                        <label className="wide">
                          环境变量（JSON）
                          <textarea
                            value={mcpEnv}
                            onChange={(event) => setMcpEnv(event.currentTarget.value)}
                            spellCheck={false}
                            placeholder={'{\n  "API_KEY": "your-key"\n}'}
                          />
                        </label>
                      ) : (
                        <label className="wide">
                          请求头（JSON）
                          <textarea
                            value={mcpHeaders}
                            onChange={(event) => setMcpHeaders(event.currentTarget.value)}
                            spellCheck={false}
                            placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
                          />
                        </label>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </>
        ) : dialog === "skill" ? (
          <div className="webui-plugin-form">
            <label>
              名称
              <input
                value={agentName}
                onChange={(event) =>
                  setAgentName(event.currentTarget.value)
                }
                placeholder="my-skill"
              />
            </label>
            <label className="wide">
              描述
              <input
                value={skillDescription}
                onChange={(event) =>
                  setSkillDescription(event.currentTarget.value)
                }
              />
            </label>
            <label className="wide">
              技能内容
              <textarea
                value={skillContent}
                onChange={(event) =>
                  setSkillContent(event.currentTarget.value)
                }
                placeholder="编写技能指令"
              />
            </label>
          </div>
        ) : (
          <div className="webui-plugin-form">
            <label>
              名称
              <input
                value={agentName}
                onChange={(event) =>
                  setAgentName(event.currentTarget.value)
                }
                placeholder="my-agent"
              />
            </label>
            <label className="wide">
              介绍
              <input
                value={agentDescription}
                onChange={(event) =>
                  setAgentDescription(event.currentTarget.value)
                }
              />
            </label>
            {!editing ? (
              <label className="wide">
                模型 ID
                <input
                  value={agentModel}
                  onChange={(event) =>
                    setAgentModel(event.currentTarget.value)
                  }
                  placeholder="provider/model-name"
                />
              </label>
            ) : null}
            <label className="wide">
              系统提示词
              <textarea
                value={agentPrompt}
                onChange={(event) =>
                  setAgentPrompt(event.currentTarget.value)
                }
                placeholder="输入系统提示词"
              />
            </label>
          </div>
        )}
        <footer>
          <button onClick={() => setDialog(null)}>取消</button>
          <button
            disabled={
              busy ||
              (dialog === "mcp"
                ? !mcpJsonMode &&
                  (!mcpName.trim() ||
                    (mcpTransport === "stdio"
                      ? !mcpCommand.trim()
                      : !mcpUrl.trim()))
                : dialog === "skill"
                  ? !agentName.trim() || !skillContent.trim()
                  : !agentName.trim())
            }
            onClick={() =>
              void (dialog === "mcp"
                ? saveMcp()
                : dialog === "skill"
                  ? saveSkill()
                  : saveAgent())
            }
          >
            {dialog === "mcp" && !editing ? "添加服务器" : "保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}
