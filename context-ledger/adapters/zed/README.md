# Zed 适配指南

[context-ledger](../README.md) 可以作为 MCP context server 接入 [Zed](https://zed.dev)。

## 接入方式：stdio（推荐）

编辑 Zed settings（命令面板 → `zed: open settings file`），顶层加 `context_servers`：

```json
{
  "context_servers": {
    "context-ledger": {
      "command": "node",
      "args": ["/absolute/path/to/context-ledger/dist/cli.js"],
      "env": {
        "CONTEXT_LEDGER_DATA": "~/.context-ledger"
      }
    }
  }
}
```

> Zed 用 `context_servers` 键（不是 `mcpServers`）。路径必须写绝对路径。

也可通过 UI 添加：**Settings → AI → MCP Servers → Add Server → Add Local Server**，Zed 会把配置写进 settings 文件。

## 远程方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "context_servers": {
    "context-ledger": {
      "url": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

> 注意：remote 服务器若没有配置 `Authorization` 头，Zed 会自动发起 MCP OAuth 流程。本地无鉴权服务器建议直接用 stdio 方式，避免 OAuth 弹窗。

## 工具注册名与权限

Zed 中 MCP 工具的权限键格式为 `mcp:<server>:<tool>`，例如 `mcp:context-ledger:compress`。全部放行可设：

```json
{
  "agent": {
    "tool_permissions": {
      "default": "confirm",
      "mcp:context-ledger:acp_status": { "default": "allow" },
      "mcp:context-ledger:acp_view": { "default": "allow" },
      "mcp:context-ledger:search_context": { "default": "allow" }
    }
  }
}
```

（只读工具免确认，`compress` / `decompress` 保留默认 confirm。）

## 验证与排错

- **Settings → AI → MCP Servers**：`context-ledger` 旁的指示点为绿色即正常（tooltip "Server is active"）。
- 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
- Zed 支持 `notifications/tools/list_changed`——工具列表变更无需重启。
- Zed 还会把配置的 MCP server 通过 ACP 转发给 External Agents（如 Claude Code 接入 Zed 时）。
