# Hermes Agent 适配指南

[context-ledger](../README.md) 可以作为 MCP server 直接接入 [Hermes Agent](https://github.com/NousResearch/hermes-agent)（Nous Research）。

## 接入方式

### 方式一：stdio（推荐，本地使用）

编辑 `~/.hermes/config.yaml`，添加：

```yaml
mcp_servers:
  context-ledger:
    command: "node"
    args: ["/absolute/path/to/context-ledger/dist/cli.js"]
    env:
      CONTEXT_LEDGER_DATA: "~/.context-ledger"
```

> 路径必须是绝对路径（`~` 在 args 中不会被展开）。Windows 用户写 `C:/...` 正斜杠路径。

保存后重启 Hermes，或在会话中执行 `/reload-mcp`。

### 方式二：HTTP（远程/共享）

```bash
node dist/cli.js --http --port 8791
```

```yaml
mcp_servers:
  context-ledger:
    url: "http://127.0.0.1:8791/mcp"
```

URL 以 `/mcp` 结尾（Hermes HTTP MCP 约定）。

## 工具注册名

Hermes 会给 MCP 工具加前缀，注册名变为：

| MCP 工具 | Hermes 注册名 |
| --- | --- |
| `compress` | `mcp_context-ledger_compress` |
| `decompress` | `mcp_context-ledger_decompress` |
| `search_context` | `mcp_context-ledger_search_context` |
| `acp_status` | `mcp_context-ledger_acp_status` |
| `acp_view` | `mcp_context-ledger_acp_view` |

模型在推理时会自动选择，无需手动调用。若想精简工具列表，可加过滤：

```yaml
mcp_servers:
  context-ledger:
    command: "node"
    args: [".../dist/cli.js"]
    tools:
      include: [compress, decompress, search_context, acp_status, acp_view]
```

## 安装配套 Skill（可选但推荐）

把 `skills/context-ledger/` 目录复制到 `~/.hermes/skills/`：

```bash
cp -r skills/context-ledger ~/.hermes/skills/
```

Skill 教会 Hermes **何时主动压缩**（MCP 工具模型不会自动注入压缩哲学——模型需要被引导）。Skill 内容涵盖：

- 自包含摘要契约（Open objectives、verbatim 保护、路径/签名/错误原文保留）
- 尾部保护（最近 4 条消息禁压）
- 内容锚点用法（`from_contains`/`to_contains`，无需消息 id）
- 滚动接力工作流（`acp_view` 导出 → 新会话接力，最省 token 的用法）

Skill 兼容 agentskills.io 开放标准，也可通过 GitHub tap 分发（`hermes skills install owner/repo/skills/context-ledger`）。

## 验证

启动 Hermes 后：

```
hermes chat
> 压缩我们前面的讨论，保留所有待办事项
```

模型应调用 `mcp_context-ledger_compress` 并返回 `📦 Compressed ...` 确认。

排错：

- 工具未出现 → 检查 `node --version`（需 ≥20）、路径是否绝对路径、`/reload-mcp`
- 数据目录未创建 → 检查 `CONTEXT_LEDGER_DATA` 是否可写
