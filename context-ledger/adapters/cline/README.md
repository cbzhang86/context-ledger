# Cline 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Cline](https://github.com/cline/cline)（VSCode 插件）。

## 接入方式：stdio（推荐）

编辑 `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
（macOS）或 `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`
（Windows；其他 VSCode fork 的 globalStorage 路径类似）：

```json
{
  "mcpServers": {
    "context-ledger": {
      "command": "node",
      "args": ["/absolute/path/to/context-ledger/dist/cli.js"],
      "env": {
        "CONTEXT_LEDGER_DATA": "~/.context-ledger"
      },
      "disabled": false,
      "autoApprove": ["acp_status", "acp_view", "search_context"]
    }
  }
}
```

> `autoApprove` 把三个只读工具设为免确认，压缩/还原类写操作仍走确认——推荐保持这种划分。

也可通过 UI 添加：Cline 侧边栏 → **MCP Servers** 图标 → **Installed** → **Configure MCP Servers**（会直接打开上述 JSON）。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcpServers": {
    "context-ledger": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8791/mcp",
      "disabled": false
    }
  }
}
```

## 工具注册名

Cline 注册名带前缀 `mcp_context-ledger_`，例如 `mcp_context-ledger_compress`。

## 验证与排错

- MCP Servers 面板展开 `context-ledger`，5 个工具应全部点亮。
- JSON 修改即时生效，无需重启 VSCode。
- 若工具未出现：确认 `command` 是绝对路径下的 node（PATH 环境差异常见坑），并在 Cline 设置里检查 Auto-approve 配置。
