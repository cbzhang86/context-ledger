# Windsurf 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Windsurf](https://windsurf.com)（原 Codeium）。

## 接入方式：stdio（推荐）

编辑 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
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

> 路径必须写绝对路径。Windows 用户写 `C:/path/to/context-ledger/dist/cli.js`（正斜杠）。

也可通过 UI 添加：Windsurf Settings → **Windsurf Settings** → **MCP Servers** → **Manage** → **Add MCP Server**。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcpServers": {
    "context-ledger": {
      "serverUrl": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

Windsurf 的 HTTP 型条目用 `serverUrl` 字段（不是 `url`）。

## 工具注册名

Windsurf 加前缀 `mcp-<server>-<tool>`（连字符形式），例如 `mcp-context-ledger-compress`。

## 验证与排错

- MCP Servers 面板中 `context-ledger` 应显示绿色状态点；修改配置后点 **Refresh**。
- 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
- Cascade 模式下说「压缩当前对话历史」即可触发。
