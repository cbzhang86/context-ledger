# Adapters index

context-ledger is a standard MCP server (stdio + streamable HTTP) that works
with any MCP host. Every host spell its config differently — key names, field
names, and path conventions vary — so this directory holds verified config
snippets for each mainstream host.

| Host | Config file | Transport | Guide |
| --- | --- | --- | --- |
| ChatGPT Desktop | Plugins UI (needs HTTPS) | HTTP + tunnel | [main README](../README.md#connect-to-chatgpt-desktop) |
| Hermes Agent | `~/.hermes/config.yaml` | stdio / HTTP | [hermes](hermes/README.md) |
| Claude Desktop | `claude_desktop_config.json` | stdio / http | [claude-desktop](claude-desktop/README.md) |
| Claude Code | `claude mcp add` / `.mcp.json` | stdio / http | [claude-code](claude-code/README.md) |
| Codex CLI | `~/.codex/config.toml` | stdio / http | [codex](codex/README.md) |
| Cursor | `~/.cursor/mcp.json` | stdio / url | [cursor](cursor/README.md) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | stdio / serverUrl | [windsurf](windsurf/README.md) |
| Cline | `cline_mcp_settings.json` | stdio / streamableHttp | [cline](cline/README.md) |
| Gemini CLI | `~/.gemini/settings.json` | stdio / httpUrl | [gemini-cli](gemini-cli/README.md) |
| VSCode Copilot | `.vscode/mcp.json` (`servers` key) | stdio / http | [vscode-copilot](vscode-copilot/README.md) |
| Zed | settings.json `context_servers` | stdio / url | [zed](zed/README.md) |
| OpenCode | `opencode.json` `mcp.servers` | local / remote | [opencode](opencode/README.md) |
| OpenClaw | `~/.openclaw/openclaw.json` `mcp.servers` | stdio / streamable-http | [openclaw](openclaw/README.md) |

## Automation depth: MCP tools vs. native extensions

The MCP tool surface (table above) is the universal baseline. Some hosts also
offer **native extension channels** with deeper automation:

| Depth | Host | Native channel | Notes |
| --- | --- | --- | --- |
| **Context replacement** (true zero-touch compression) | OpenClaw | context-engine plugin (`kind: "context-engine"` + `before_prompt_build`) | [openclaw-plugin-context-ledger](../../openclaw-plugin-context-ledger/) — mirrors every turn and injects the compacted view; the model does nothing |
| Same | Hermes Agent | ContextEngine ABC (`context.engine: "context-ledger"`) | [hermes-plugin-context-ledger](../../hermes-plugin-context-ledger/) — compresses automatically at the threshold, plus ledger_status/search/decompress tools |
| **Reminder injection** (semi-auto: host nudges, model compresses via MCP) | Claude Code | hooks: UserPromptSubmit `additionalContext` + PreCompact/PostCompact observers | [claude-code-hook-context-ledger](../../claude-code-hook-context-ledger/) — platform boundary: hooks can inject but not rewrite the transcript |
| Same | Cursor | hooks.json: beforeSubmitPrompt + preCompact observer | [cursor-hook-context-ledger](../../cursor-hook-context-ledger/) — same boundary as Claude Code |
| MCP only | ChatGPT Desktop / Claude Desktop / Codex / Windsurf / Cline / Gemini CLI / VSCode Copilot / Zed / OpenCode | No native extension surface (or none that replaces context) | Use the MCP config above; the tool descriptions guide the model to compress proactively |

> Native plugins and the MCP server can coexist: install both and the native
> plugin handles reminders/injection while the MCP tools do the actual
> compress/decompress work.

## Universal notes

1. **Use absolute paths** — hosts expand `~` inconsistently; on Windows use
   forward slashes (`C:/...`).
2. **Prefer stdio** for local use: lowest latency, no auth questions. Use
   HTTP only when you need shared/remote access.
3. **Data directory**: defaults to `~/.context-ledger`; override with
   `CONTEXT_LEDGER_DATA`. Point multiple hosts at the same directory to share
   one ledger.
4. **Auto-approve read-only tools**: `acp_status` / `acp_view` /
   `search_context` are safe to allow-list; `compress` / `decompress` write
   the ledger, so keep confirmation on those if your host asks.
5. **Verify**: after connecting, ask the model "show the context ledger
   status" — if `acp_status` returns token totals, you're wired up.
