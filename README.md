<div align="center">

# context-ledger

**Give your AI agent a memory that shrinks instead of growing — long conversations stay cheap, and nothing is ever lost.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](#the-core-server)
[![Tests](https://img.shields.io/badge/tests-13%20passing-success.svg)](#the-core-server)
[![Status](https://img.shields.io/badge/status-v0.1.0--working-blue.svg)](#honest-limitations)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Why this exists

Every long AI conversation hits the same wall: the history grows, the context
window fills up, the model gets slower, more expensive, and starts forgetting
things it knew ten minutes ago.

[billion-context](https://github.com/ranxianglei/billion-context) solved this
for Codex by compressing old messages into summary blocks — a "ledger" — while
keeping everything restorable. **context-ledger brings that same idea to every
MCP host**, including ChatGPT Desktop, which billion-context cannot touch
(its proxy approach needs traffic interception; ChatGPT won't allow that).

The trade-off we chose: instead of intercepting traffic, context-ledger is a
**tool** the model calls when a conversation section is "done". On hosts with
native extension channels (OpenClaw, Hermes Agent) it goes further and becomes
**fully automatic** — the model doesn't call anything; compression just happens.

---

## How it works (30 seconds)

You're 40 messages into a planning session. The first 25 messages settled the
architecture — nobody needs their verbatim text anymore. So:

```
┌─────────────────────────────────────────────────────┐
│  BEFORE                    tokens: 12,000           │
│  [m00001..m00015] architecture debate (verbatim)    │
│  [m00016..m00025] API design (verbatim)             │
│  [m00026..m00040] current work                      │
└─────────────────────────────────────────────────────┘
                    │  compress + your summary
                    ▼
┌─────────────────────────────────────────────────────┐
│  AFTER                     tokens: 3,100            │
│  📦 [b1] m00001–m00015 (architecture)               │
│      "Settled: hexagonal core, REST gateway,        │
│       Postgres store. Open: auth strategy."         │
│  📦 [b2] m00016–m00025 (api-design)                 │
│      "v1 endpoints frozen; pagination = cursor."    │
│  [m00026..m00040] current work (verbatim)           │
└─────────────────────────────────────────────────────┘
```

- **Nothing is destroyed.** Summaries live in a block ledger; originals stay
  on disk. `decompress(full: true)` puts every word back.
- **The model writes the summaries** — it knows what mattered. The server is
  pure bookkeeping (zero dependencies, one JSON file per conversation).
- **The newest 4 messages are untouchable** (tail guard), so the work in
  flight is always verbatim.
- Compressing an already-compressed range folds it into a higher-tier summary
  — compress the summaries, again and again.

---

## What's in this repo

| Path | What it is | Best for |
| --- | --- | --- |
| [`context-ledger/`](context-ledger/) | **The core**: MCP server (stdio + HTTP), 13 tests | Any MCP host — ChatGPT Desktop, Claude, Codex, Cursor, Zed, and 8 more |
| [`openclaw-plugin-context-ledger/`](openclaw-plugin-context-ledger/) | Native OpenClaw context-engine plugin | OpenClaw users who want **zero-touch** compression |
| [`hermes-plugin-context-ledger/`](hermes-plugin-context-ledger/) | Native Hermes ContextEngine | Hermes users who want **zero-touch** compression |
| [`claude-code-hook-context-ledger/`](claude-code-hook-context-ledger/) | Claude Code hook | Claude Code: nags the model to compress at the right moment |
| [`cursor-hook-context-ledger/`](cursor-hook-context-ledger/) | Cursor hook | Cursor: same reminder approach |

> **Two levels of automation.** OpenClaw and Hermes can *replace* the context
> the model sees — true invisible compression. Claude Code and Cursor hooks
> can only *inject reminders* (the model still does the compressing via MCP
> tools). ChatGPT Desktop and most other hosts are MCP-only: you ask, the
> model compresses. The full compatibility matrix is in
> [`context-ledger/adapters/README.md`](context-ledger/adapters/README.md).

---

## Quick start

Pick your host:

### ChatGPT Desktop (MCP + tunnel)

ChatGPT never launches local servers, so you need the HTTP server plus an
HTTPS endpoint:

```bash
cd context-ledger
npm install && npm run build
node dist/cli.js --http --port 8791
# in another terminal:
cloudflared tunnel --url http://127.0.0.1:8791
```

Then: **Settings → Security and login → Developer mode → Plugins → +** →
paste the `https://...trycloudflare.com` URL → Auth: **No auth** → Create.
Open a **new** conversation, enable the plugin, and try:

> Compress the part of our conversation where we settled the architecture.

Detailed steps and alternatives (OpenAI Secure MCP Tunnel, own domain) are in
[`context-ledger/README.md`](context-ledger/README.md#connect-to-chatgpt-desktop).

### Claude Code / Codex / Cursor / Zed / … (stdio, one snippet)

Ready-made, verified config snippets for **13 hosts** live in
[`context-ledger/adapters/`](context-ledger/adapters/README.md). Example for
Claude Code:

```bash
claude mcp add context-ledger -- node /absolute/path/to/context-ledger/dist/cli.js
```

### OpenClaw / Hermes (fully automatic)

```bash
# OpenClaw — install the plugin, it activates as a context engine
cp -r openclaw-plugin-context-ledger ~/.openclaw/plugins/context-ledger

# Hermes — install as context engine and select it
cp -r hermes-plugin-context-ledger ~/.hermes/plugins/context_engine/context-ledger
# in ~/.hermes/config.yaml:
#   context:
#     engine: "context-ledger"
```

From then on compression just happens when the session crosses the token
threshold. Each native plugin has its own README with verification steps.

---

## The core server

Five MCP tools (names follow the billion-context contract):

| Tool | What it does |
| --- | --- |
| `compress` | Replace a message range with a summary **you write**. Accepts `start_id`/`end_id` or **content anchors** (`from_contains`/`to_contains`) for hosts where ids aren't visible. |
| `decompress` | Restore a block's content; `full: true` returns the verbatim originals. |
| `search_context` | Keyword search over summaries + live messages. |
| `acp_status` | Token accounting: raw vs. current view vs. saved, plus compressible ranges. |
| `acp_view` | Render "what the model should see now" — paste into a fresh chat to resume cheaply. |

```bash
cd context-ledger
npm install && npm run build && npm test   # 13 tests
node dist/cli.js                            # stdio
node dist/cli.js --http --port 8791         # HTTP (ChatGPT)
curl http://127.0.0.1:8791/healthz          # health check
```

Data lives in `~/.context-ledger/` (override: `CONTEXT_LEDGER_DATA`).
Zero runtime dependencies; TypeScript, ~900 lines total.

---

## Honest limitations

- **MCP-only hosts need a nudge.** The server can't force the model to
  compress; on ChatGPT Desktop, Claude Desktop, etc., you either ask, or the
  server's `instructions` field (surfaced by some hosts) does the nudging.
- **Plain-text storage.** Ledgers are unencrypted JSON on your disk. Don't
  point `CONTEXT_LEDGER_DATA` at a shared folder you don't trust.
- **Summary quality is model quality.** The ledger only stores what the model
  writes. Good summaries name decisions, paths, and open questions — the tool
  descriptions spell out that contract.
- **v0.1.0.** Tested via unit tests + live smoke tests on every host listed,
  but real-world mileage may vary; issues welcome.

---

## Going back

Nothing here is load-bearing for your host. Delete the MCP entry, remove the
plugin folder, or `rm -rf ~/.context-ledger` — your conversations were never
modified, only mirrored.

---

## For developers

```
context-ledger/src/kernel.ts    block ledger: tiers, tail guard, anchors, token estimates
context-ledger/src/mcp.ts       tool definitions + JSON-RPC (MCP 2025-06-18)
context-ledger/src/cli.ts       stdio + streamable-HTTP transports, CORS, /healthz
*/kernel.{js,py}                the same kernel, vendored per native plugin (TS→JS, TS→py port)
```

Design credit: this is an active, tool-based port of
[billion-context](https://github.com/ranxianglei/billion-context)'s
compression kernel. See [CONTRIBUTING.md](CONTRIBUTING.md) to hack on it.

## License

MIT — see [LICENSE](LICENSE).
