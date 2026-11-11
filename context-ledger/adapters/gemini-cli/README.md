# Gemini CLI 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Gemini CLI](https://github.com/google-gemini/gemini-cli)。

## 接入方式：stdio（推荐）

编辑 `~/.gemini/settings.json`：

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

项目级配置可放在项目根目录 `.gemini/settings.json`。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcpServers": {
    "context-ledger": {
      "httpUrl": "http://127.0.0.1:8791/mcp"
    }
  }
}
```

Gemini CLI 的 HTTP 型条目用 `httpUrl` 字段（不是 `url`）。

## 工具注册名

Gemini CLI 注册名带前缀 `mcp__context-ledger__`，例如 `mcp__context-ledger__compress`。

## 验证与排错

- 启动 gemini 后执行 `/mcp list` 查看注册状态。
- 5 个工具：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
- 工具调用需在 `/tools` 设置或提示中确认允许；stderr 日志可见 `~/.gemini/tmp/`。
