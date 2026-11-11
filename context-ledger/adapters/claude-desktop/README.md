# Claude Desktop 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Claude Desktop](https://claude.ai/download)。

## 接入方式：stdio（推荐）

编辑配置文件（Claude Desktop → Settings → Developer → Edit Config，或直接打开）：

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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

> 路径必须写绝对路径（`~` 不会被展开）。Windows 用户写 `C:/path/to/context-ledger/dist/cli.js`（正斜杠）。

保存后**完全退出并重启** Claude Desktop（托盘图标 → Quit，不是只关窗口）。

## 接入方式：HTTP（远程/共享）

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcpServers": {
    "context-ledger": {
      "type": "http",
      "url": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

Claude Desktop 0.10+ 支持 `http` / `sse` 类型；较老版本仅支持 stdio，此时用 stdio 方式即可。

## 工具注册名

Claude Desktop 不加前缀，直接注册 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。

## 验证

重启后，在对话框左下角（锤子/工具图标）应能看到 5 个 context-ledger 工具。

排错：`claude_desktop_config.json` 必须是合法 JSON（无注释、无尾逗号）；查看 MCP 日志：`~/Library/Logs/Claude/mcp*.log`（macOS）或 `%APPDATA%\Claude\logs\`（Windows）。
