# Claude Code 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)。

## 方式一：CLI 命令（推荐）

```bash
claude mcp add context-ledger -- node /absolute/path/to/context-ledger/dist/cli.js
```

带数据目录环境变量：

```bash
claude mcp add context-ledger --env CONTEXT_LEDGER_DATA=~/.context-ledger -- node /absolute/path/to/context-ledger/dist/cli.js
```

作用域：默认 local（仅当前项目）；`-s user` 写入用户级（所有项目可用）；`-s project` 写入项目 `.mcp.json`（可提交到 git）。

## 方式二：直接编辑配置

- 用户级：`~/.claude.json` 的 `mcpServers` 键
- 项目级：项目根目录 `.mcp.json`

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

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```bash
claude mcp add --transport http context-ledger http://127.0.0.1:8791/mcp
```

## 工具注册名

Claude Code 会加前缀 `mcp__<server>__<tool>`：

| MCP 工具 | Claude Code 注册名 |
| --- | --- |
| `compress` | `mcp__context-ledger__compress` |
| `decompress` | `mcp__context-ledger__decompress` |
| `search_context` | `mcp__context-ledger__search_context` |
| `acp_status` | `mcp__context-ledger__acp_status` |
| `acp_view` | `mcp__context-ledger__acp_view` |

## 验证

会话内执行 `/mcp` 查看连接状态与工具列表。

> 提示：由于 Claude Code 自带 auto-compact，context-ledger 是「显式压缩、原文可还原」的补充方案——摘要由模型写、账本持久化在磁盘，不会像 auto-compact 一样一次性丢细节。
