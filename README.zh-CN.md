<div align="center">

# context-ledger

**让 AI 的对话记忆会“瘦身”而不是无限膨胀 —— 长对话保持便宜，且什么都不会丢。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](#核心服务器)
[![Tests](https://img.shields.io/badge/tests-13%20passing-success.svg)](#核心服务器)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## 为什么做这个

每个长 AI 对话都会撞上同一堵墙：历史越来越长，上下文窗口被填满，模型变慢、变贵，还开始忘记十分钟前说过的话。

[billion-context](https://github.com/ranxianglei/billion-context) 通过把旧消息压缩成摘要块（一个“账本”）为 Codex 解决了这个问题，同时保证一切可还原。**context-ledger 把同样的机制带给所有 MCP 宿主**——包括 billion-context 碰不到的 ChatGPT Desktop（它靠流量代理实现，ChatGPT 不允许这么做）。

我们选择的取舍：不是拦截流量，而是做成模型**按需调用的工具**。在有原生扩展通道的宿主上（OpenClaw、Hermes Agent），它更进一步——**完全自动**，模型什么都不用调，压缩自动发生。

---

## 工作原理（30 秒版）

对话进行到第 40 条消息，前 25 条已经把架构定下来了——它们的原文不再被需要。于是：

```
┌─────────────────────────────────────────────────────┐
│  压缩前                    tokens: 12,000           │
│  [m00001..m00015] 架构讨论（原文）                    │
│  [m00016..m00025] API 设计（原文）                   │
│  [m00026..m00040] 当前工作                           │
└─────────────────────────────────────────────────────┘
                    │  compress + 你写的摘要
                    ▼
┌─────────────────────────────────────────────────────┐
│  压缩后                    tokens: 3,100            │
│  📦 [b1] m00001–m00015 (architecture)               │
│      "已定：六边形核心、REST 网关、Postgres。         │
│       待定：鉴权方案。"                              │
│  📦 [b2] m00016–m00025 (api-design)                 │
│      "v1 端点冻结；分页用 cursor。"                   │
│  [m00026..m00040] 当前工作（原文保留）                │
└─────────────────────────────────────────────────────┘
```

- **什么都不会丢。** 摘要存在块账本里，原文留在磁盘上，`decompress(full: true)` 随时还原每个字。
- **摘要由模型来写**——它最清楚哪些内容重要。服务器只做记账（零依赖，每会话一个 JSON 文件）。
- **最近 4 条消息不可压缩**（尾保护），进行中的工作永远是原文。
- 压缩已压缩的区间会折叠成更高级摘要——摘要的摘要，层层递进。

---

## 仓库里有什么

| 路径 | 是什么 | 适合谁 |
| --- | --- | --- |
| [`context-ledger/`](context-ledger/) | **核心**：MCP server（stdio + HTTP），13 个测试 | 任何 MCP 宿主——ChatGPT Desktop、Claude、Codex、Cursor、Zed 等 13 个 |
| [`openclaw-plugin-context-ledger/`](openclaw-plugin-context-ledger/) | OpenClaw 原生 context-engine 插件 | OpenClaw 用户，想要**零操作**压缩 |
| [`hermes-plugin-context-ledger/`](hermes-plugin-context-ledger/) | Hermes 原生 ContextEngine | Hermes 用户，想要**零操作**压缩 |
| [`claude-code-hook-context-ledger/`](claude-code-hook-context-ledger/) | Claude Code hook | Claude Code：在合适的时机提醒模型压缩 |
| [`cursor-hook-context-ledger/`](cursor-hook-context-ledger/) | Cursor hook | Cursor：同样的提醒方式 |

> **两级自动化。** OpenClaw 和 Hermes 可以*替换*模型看到的上下文——真正的无感知压缩。Claude Code 和 Cursor 的 hook 只能*注入提醒*（模型仍通过 MCP 工具执行压缩）。ChatGPT Desktop 和其他大多数宿主仅支持 MCP：你开口，模型压缩。完整兼容矩阵见 [`context-ledger/adapters/README.md`](context-ledger/adapters/README.md)。

---

## 快速开始

选你的宿主：

### ChatGPT Desktop（MCP + 隧道）

ChatGPT 永远不会启动本地服务器，所以需要 HTTP 服务 + HTTPS 端点：

```bash
cd context-ledger
npm install && npm run build
node dist/cli.js --http --port 8791
# 另开一个终端：
cloudflared tunnel --url http://127.0.0.1:8791
```

然后：**设置 → Security and login → 开启 Developer mode → Plugins → +** →
粘贴 `https://...trycloudflare.com` 地址 → Auth 选 **No auth** → Create。
开一个**新**对话，启用插件，试试：

> 把我们前面讨论架构的部分压缩一下。

详细步骤和其他方式（OpenAI Secure MCP Tunnel、自有域名）见
[`context-ledger/README.md`](context-ledger/README.md#connect-to-chatgpt-desktop)。

### Claude Code / Codex / Cursor / Zed /…（stdio，一段配置）

**13 个宿主**的现成配置片段在 [`context-ledger/adapters/`](context-ledger/adapters/README.md)。以 Claude Code 为例：

```bash
claude mcp add context-ledger -- node /绝对路径/context-ledger/dist/cli.js
```

### OpenClaw / Hermes（全自动）

```bash
# OpenClaw —— 装插件即生效（context engine）
cp -r openclaw-plugin-context-ledger ~/.openclaw/plugins/context-ledger

# Hermes —— 装为 context engine 并启用
cp -r hermes-plugin-context-ledger ~/.hermes/plugins/context_engine/context-ledger
# 在 ~/.hermes/config.yaml 里加：
#   context:
#     engine: "context-ledger"
```

之后会话超过 token 阈值时压缩自动发生。每个原生插件有自己的 README 和验证步骤。

---

## billion-context 还是 context-ledger？

诚实回答：[billion-context](https://github.com/ranxianglei/billion-context)
（启发本项目的原作）是一个坐在宿主和模型 API 之间的**流量级代理**——更成熟、
经过 18.7B token 生产验证，**凡是能插代理的宿主**（Claude Code、Codex、pi、
opencode、dsh 等 20+ 个）它都是更好的选择。

以下情况用 **context-ledger**：

- **宿主没有路由缝隙。** ChatGPT Desktop、Claude Desktop 的 Code 标签页等
  封闭应用的模型流量没有任何代理能碰到（原项目自己也把这些标记为无解，
  如 issue #2290）。一个纯 MCP server + 原生插件在这里能工作。
- **你不想跑常驻代理。** 没有守护进程、没有 CA 证书、没有端口管理、没有
  SQLite 维护——一条 `node dist/cli.js`，零运行时依赖。
- **你想要不经流量拦截的宿主原生压缩**——这里的 OpenClaw context-engine
  和 Hermes ContextEngine 集成走官方扩展 API 替换上下文，不是中间人。

在 billion-context 已有原生插件的宿主上，请用它——本项目的 MCP 面在那里的
重叠是有意为之（同一工具契约），且这里的一切都是可选、可开关的。

## 核心服务器

五个 MCP 工具（命名遵循 billion-context 契约）：

| 工具 | 作用 |
| --- | --- |
| `compress` | 用**你写的摘要**替换一段消息。支持 `start_id`/`end_id`，也支持**内容锚点**（`from_contains`/`to_contains`，给看不到消息 id 的宿主用）。 |
| `decompress` | 还原块内容；`full: true` 返回逐字原文。 |
| `search_context` | 在摘要 + 未压缩消息里做关键词搜索。 |
| `acp_status` | token 记账：原始 vs 当前视图 vs 已省，以及还有哪些可压区间。 |
| `acp_view` | 渲染“模型现在应该看到什么”——粘到新对话开头即可便宜续接。 |

```bash
cd context-ledger
npm install && npm run build && npm test   # 13 个测试
node dist/cli.js                            # stdio
node dist/cli.js --http --port 8791         # HTTP（ChatGPT 用）
curl http://127.0.0.1:8791/healthz          # 健康检查
```

数据在 `~/.context-ledger/`（可用 `CONTEXT_LEDGER_DATA` 覆盖）。
零运行时依赖；TypeScript，共约 900 行。

---

## 诚实的局限

- **仅 MCP 的宿主需要推一把。** 服务器无法强迫模型压缩；在 ChatGPT Desktop、Claude Desktop 等宿主上，要么你开口，要么靠服务器的 `instructions` 字段（部分宿主会注入）来提示。
- **明文存储。** 账本是磁盘上的未加密 JSON。别把 `CONTEXT_LEDGER_DATA` 指到你不信任的共享目录。
- **摘要质量 = 模型质量。** 账本只存模型写的东西。好的摘要会点名决策、路径和未决问题——工具描述里写明了这个契约。
- **v0.1.0。** 已通过单测 + 每个列出宿主的真机冒烟验证，但实际效果因人而已；欢迎提 issue。

---

## 想撤掉？

这里没有任何东西是宿主的必需依赖。删掉 MCP 配置、删掉插件目录、或 `rm -rf ~/.context-ledger` 即可——你的对话从未被修改过，只是被镜像了。

---

## 给开发者

```
context-ledger/src/kernel.ts    块账本：分层折叠、尾保护、内容锚点、token 估算
context-ledger/src/mcp.ts       工具定义 + JSON-RPC（MCP 2025-06-18）
context-ledger/src/cli.ts       stdio + streamable-HTTP 传输、CORS、/healthz
*/kernel.{js,py}                同一个内核，按原生插件各自 vendored（TS→JS、TS→py 移植）
```

设计致谢：这是 [billion-context](https://github.com/ranxianglei/billion-context)
压缩内核的主动式、工具化移植。想参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT — 见 [LICENSE](LICENSE)。
