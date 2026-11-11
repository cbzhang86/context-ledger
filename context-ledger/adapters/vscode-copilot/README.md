# VSCode Copilot（GitHub Copilot Agent）适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 VSCode 的 GitHub Copilot Agent 模式。

## 接入方式：stdio（推荐）

**工作区级**：在项目根目录创建 `.vscode/mcp.json`：

```json
{
  "servers": {
    "context-ledger": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/context-ledger/dist/cli.js"],
      "env": {
        "CONTEXT_LEDGER_DATA": "~/.context-ledger"
      }
    }
  }
}
```

**用户级**：命令面板 → `MCP: Open User Configuration`（写入 `mcp.json` 的用户版），格式同上。

> 注意：VSCode 用 `servers` 键（不是 `mcpServers`），且 stdio 条目需要显式 `"type": "stdio"`。路径必须写绝对路径。

保存后在 `.vscode/mcp.json` 中会出现 **Start** 按钮启动服务。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "servers": {
    "context-ledger": {
      "type": "http",
      "url": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

## 工具注册名

Copilot 注册名带前缀 `mcp_<server>_<tool>`，例如 `mcp_context-ledger_compress`。

## 验证与排错

- 命令面板 → `MCP: List Servers` 查看 `context-ledger` 状态（Running）。
- Agent 模式的工具确认列表里可把 `acp_status` / `acp_view` / `search_context` 设为自动批准，`compress` / `decompress` 保持手动确认。
- 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
