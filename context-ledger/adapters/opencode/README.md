# OpenCode 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [OpenCode](https://opencode.ai)。

## 接入方式：stdio（推荐）

编辑项目 `opencode.json`（或 `opencode.jsonc`；全局配置见 `opencode mcp add --global`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "context-ledger": {
        "type": "local",
        "command": ["node", "/absolute/path/to/context-ledger/dist/cli.js"],
        "environment": {
          "CONTEXT_LEDGER_DATA": "~/.context-ledger"
        }
      }
    }
  }
}
```

> OpenCode V2 的关键差异：服务器名放在 `mcp.servers` 下（不是 `mcp` 直接下）；`command` 是**数组**（含可执行文件）；环境变量字段叫 `environment`（不是 `env`）。

CLI 一行命令等价写法：

```bash
opencode mcp add context-ledger -- node /absolute/path/to/context-ledger/dist/cli.js
```

## 远程方式

```bash
node dist/cli.js --http --port 8791
```

```json
{
  "mcp": {
    "servers": {
      "context-ledger": {
        "type": "remote",
        "url": "http://127.0.0.1:8791/mcp",
        "oauth": false
      }
    }
  }
}
```

> 远程服务器默认走 OAuth，本地无鉴权服务必须加 `"oauth": false`。

## 工具注册名与 Code Mode

- OpenCode 工具命名为 `<server>_<tool>`（非字母数字字符归一为 `_`），例如 `context_ledger_compress`（`context-ledger` 归一为 `context_ledger`）。
- 默认 **Code Mode** 开启：工具不直接进模型工具列表，而是通过 `tools.context_ledger.compress(...)` 形式在代码中调用（更省上下文）。想退回原生工具列表，加 `"codemode": false`。
- MCP 服务器返回的 instructions 会注入 `<mcp_instructions>` 系统提示——context-ledger 的压缩哲学因此自动生效。

## 验证

```bash
opencode mcp list     # 应显示 ✓ context-ledger  connected
```

会话内 `/mcps` 可查看、重连。
