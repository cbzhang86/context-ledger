# OpenClaw 适配指南

[context-ledger](../README.md) 可以作为 MCP server 接入 [OpenClaw](https://openclaw.ai)（开源个人 AI 助手，2026）。

> 以下配置依据官方文档 docs.openclaw.ai/tools/mcp（2026-11 现行版）核对。

## 方式一：CLI 一行添加（推荐）

```bash
# stdio（本地推荐）
openclaw mcp add context-ledger \
  --command node \
  --arg /absolute/path/to/context-ledger/dist/cli.js

# 或 HTTP（先启动：node dist/cli.js --http --port 8791）
openclaw mcp add context-ledger \
  --url http://127.0.0.1:8791/mcp \
  --transport streamable-http
```

立即验证可达性（保存定义 ≠ 可达，必须 probe）：

```bash
openclaw mcp doctor context-ledger --probe
```

## 方式二：直接写配置

OpenClaw 的服务器定义在 `~/.openclaw/openclaw.json` 的 **`mcp.servers`** 键下（嵌套两级，不是顶层 `mcpServers`）：

```json5
{
  mcp: {
    servers: {
      "context-ledger": {
        // stdio 方式：command 与 url 二选一，混写会被配置校验拒绝
        command: "node",
        args: ["/absolute/path/to/context-ledger/dist/cli.js"],
        transport: "stdio",
        enabled: true
      }
      // HTTP 方式（替换上面的 command/args/transport）：
      // url: "http://127.0.0.1:8791/mcp",
      // transport: "streamable-http",
      // enabled: true,
      // connectionTimeoutMs: 5000,
      // requestTimeoutMs: 20000
    }
  }
}
```

也可在 **Control UI → Settings → MCP → Add server** 里可视化添加（选 Stdio 或 Streamable HTTP 传输）。

## 工具过滤（可选）

OpenClaw 的 MCP 工具走统一的 tool-profile / tool-policy 治理。若想只暴露部分工具：

```json5
{
  mcp: {
    servers: {
      "context-ledger": {
        // ...
        toolFilter: { include: ["compress", "decompress", "search_context", "acp_status", "acp_view"] }
      }
    }
  }
}
```

只读工具免确认可设：`openclaw mcp configure context-ledger --approval auto`（默认跟随会话权限姿态）。

## 验证与排错

```bash
openclaw mcp status --verbose          # 配置摘要
openclaw mcp doctor context-ledger --probe   # 实连 + 列出工具
openclaw mcp reload                    # 改配置后热重载（Gateway 开 hot reload 时改文件即生效）
```

- 5 个工具应出现在 probe 结果里：`compress` / `decompress` / `search_context` / `acp_status` / `acp_view`。
- stdio 启动失败最常见原因：`command` 在 Gateway 进程的 PATH 里解析不到——用 node 的绝对路径。
- HTTP 401 报 `authentication refused (401)`：context-ledger 默认无鉴权，检查是否连错端口/路径。
- 服务器启动失败后 OpenClaw 以 30s 起指数退避重试（上限 10 分钟），修复后无需重启，下个轮次自动恢复。
- 服务器初始化时返回的 instructions 会注入系统提示（截断到 2000 字符）——context-ledger 的压缩哲学因此对 agent 自动可见。
