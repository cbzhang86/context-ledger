# Cursor 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Cursor](https://cursor.com)。

## 接入方式：stdio（推荐）

编辑 `~/.cursor/mcp.json`（全局）或项目根目录 `.cursor/mcp.json`（仅当前项目）：

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

也可通过 UI 添加：Cursor Settings → **MCP & Integrations** → **New MCP Server**。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcpServers": {
    "context-ledger": {
      "url": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

## 工具注册名

Cursor 加前缀，注册名为 `context-ledger_compress` 等（`<server>_<tool>` 形式）。

## 验证与排错

- Cursor Settings → MCP & Integrations：`context-ledger` 应显示绿色圆点。
- 修改 mcp.json 后需点击 **Reload**（或重启 Cursor）。
- 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
- Agent 模式下对模型说「压缩我们前面的讨论」即可触发 `compress`。
