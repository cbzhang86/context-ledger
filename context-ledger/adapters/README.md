# Adapters 索引

context-ledger 是标准 MCP server（stdio + streamable HTTP 双传输），任何支持 MCP 的宿主都能接入。
各宿主配置格式差异较大（键名、字段名、路径约定都不同），本目录为每个主流宿主提供经过核对的配置片段。

| 宿主 | 配置文件 | 传输方式 | 文档 |
| --- | --- | --- | --- |
| ChatGPT Desktop | Plugins UI（需 HTTPS） | HTTP + tunnel | [主 README](../README.md#connect-to-chatgpt-desktop) |
| Hermes Agent | `~/.hermes/config.yaml` | stdio / HTTP | [hermes](../hermes/README.md) |
| Claude Desktop | `claude_desktop_config.json` | stdio / http | [claude-desktop](../claude-desktop/README.md) |
| Claude Code | `claude mcp add` / `.mcp.json` | stdio / http | [claude-code](../claude-code/README.md) |
| Codex CLI | `~/.codex/config.toml` | stdio / http | [codex](../codex/README.md) |
| Cursor | `~/.cursor/mcp.json` | stdio / url | [cursor](../cursor/README.md) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | stdio / serverUrl | [windsurf](../windsurf/README.md) |
| Cline | `cline_mcp_settings.json` | stdio / streamableHttp | [cline](../cline/README.md) |
| Gemini CLI | `~/.gemini/settings.json` | stdio / httpUrl | [gemini-cli](../gemini-cli/README.md) |
| VSCode Copilot | `.vscode/mcp.json`（`servers` 键） | stdio / http | [vscode-copilot](../vscode-copilot/README.md) |
| Zed | settings.json `context_servers` | stdio / url | [zed](../zed/README.md) |
| OpenCode | `opencode.json` `mcp.servers` | local / remote | [opencode](../opencode/README.md) |
| OpenClaw | `~/.openclaw/openclaw.json` `mcp.servers` | stdio / streamable-http | [openclaw](../openclaw/README.md) |

## 接入深度分级（MCP 工具面 vs 原生扩展）

MCP 工具面（上表）是通用底座；部分宿主还有**原生扩展通道**，自动化程度更高：

| 深度 | 宿主 | 原生通道 | 说明 |
| --- | --- | --- | --- |
| **替换上下文级**（真·全自动无感知压缩） | OpenClaw | context-engine 插件（`kind: "context-engine"` + `before_prompt_build`） | [openclaw-plugin-context-ledger](../../../openclaw-plugin-context-ledger/) — 每轮自动镜像+注入压缩视图，模型零操作 |
| 同上 | Hermes Agent | ContextEngine ABC（`context.engine: "context-ledger"`） | [hermes-plugin-context-ledger](../../../hermes-plugin-context-ledger/) — should_compress/compress 全自动，附 ledger_status/search/decompress 工具 |
| **注入提醒级**（半自动：宿主提醒，模型调 MCP compress） | Claude Code | hooks：UserPromptSubmit `additionalContext` + PreCompact/PostCompact 观察 | [claude-code-hook-context-ledger](../../../claude-code-hook-context-ledger/) — 平台边界：hooks 只能注入不能改写 transcript |
| 同上 | Cursor | hooks.json：beforeSubmitPrompt + preCompact 观察 | [cursor-hook-context-ledger](../../../cursor-hook-context-ledger/) — 同 Claude Code 边界 |
| 仅 MCP | ChatGPT Desktop / Claude Desktop / Codex / Windsurf / Cline / Gemini CLI / VSCode Copilot / Zed / OpenCode | 无原生扩展面（或未提供上下文替换通道） | 用上表 MCP 配置 + 工具 description 引导模型主动压缩 |

> 原生插件与 MCP 工具面可共存：装了原生插件的宿主仍可同时挂 MCP server（原生插件负责提醒/注入，MCP 工具负责 compress/decompress 执行面）。

## 通用注意点

1. **路径必须是绝对路径**——各宿主展开 `~` 的行为不一致，Windows 一律用正斜杠 `C:/...`。
2. **stdio 推荐**：本地使用延迟最低、无鉴权问题；HTTP 仅在需要共享/远程时使用。
3. **数据目录**：默认 `~/.context-ledger`，可用 `CONTEXT_LEDGER_DATA` 覆盖（多宿主共用同一账本时指向同一目录即可）。
4. **免确认建议**：`acp_status` / `acp_view` / `search_context` 是只读工具，可在宿主里设为自动批准；`compress` / `decompress` 涉及写账本，建议保留确认。
5. **验证**：接入后在宿主里触发一次 `acp_status`（对模型说「查看上下文账本状态」），能返回 token 统计即接入成功。
