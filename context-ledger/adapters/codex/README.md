# Codex CLI 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [Codex CLI](https://developers.openai.com/codex)。

## 接入方式：stdio

编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.context-ledger]
command = "node"
args = ["/absolute/path/to/context-ledger/dist/cli.js"]

[mcp_servers.context-ledger.env]
CONTEXT_LEDGER_DATA = "~/.context-ledger"
```

> 路径必须写绝对路径。Windows 用户写 `C:/path/to/context-ledger/dist/cli.js`（正斜杠，TOML 双引号字符串内反斜杠需转义，正斜杠更省事）。

保存后重启 Codex（或执行 `/mcp` 查看状态）。

## HTTP 方式

```bash
node dist/cli.js --http --port 8791
```

```toml
[mcp_servers.context-ledger]
url = "http://127.0.0.1:8791/mcp"
```

## 工具注册名

Codex 注册名带 `mcp__` 前缀（ 部分 codex 版本为无前缀原名）：

| MCP 工具 | Codex 注册名 |
| --- | --- |
| `compress` | `mcp__context-ledger__compress` 或 `compress` |
| `decompress` | `mcp__context-ledger__decompress` 或 `decompress` |
| `search_context` | `mcp__context-ledger__search_context` 或 `search_context` |
| `acp_status` | `mcp__context-ledger__acp_status` 或 `acp_status` |
| `acp_view` | `mcp__context-ledger__acp_view` 或 `acp_view` |

会话内执行 `/mcp` 确认实际注册名。

## 验证

```bash
codex mcp list        # 应列出 context-ledger
```

> 参考：billion-context 本身就是从 Codex 插件起步的（plugins/codex），context-ledger 的工具契约与之相同，习惯 Codex 版 billion-context 的用户可无缝迁移。
