# context-ledger

A token-saving context compressor for **ChatGPT Desktop**, modeled on
[billion-context](https://github.com/ranxianglei/billion-context)'s block-ledger
compression. Zero runtime dependencies, Node >= 20, single TypeScript codebase.

## What it does

Long conversations burn tokens on history the model no longer needs. context-ledger
keeps a **ledger of compression blocks** per conversation:

- `compress` — replace a consumed message range `[m00005..m00020]` with a
  summary **you write** (the model decides what to compress and how; the server
  only does bookkeeping).
- The original messages are kept verbatim on disk, so nothing is ever lost.
- `decompress` — walk back down one tier, or `full: true` to restore raw.
- `search_context` — keyword search over block summaries + live messages.
- `acp_status` — token totals (raw vs. live view vs. saved) and which ranges
  are still compressible.
- `acp_view` — render "what the model should see now": live messages + folded
  block summaries in order. Paste this into a fresh chat window to resume a
  long conversation without paying for the full history.

Safety rails borrowed from billion-context:

- **Tail guard** — the newest 4 messages can never be compressed.
- **Tier folding** — compressing a range already covered by blocks produces a
  tier-2 (then tier-3) summary *of the summaries*; inner blocks are consumed.
- **Overlap refusal** — raw content inside a live block can't be re-compressed
  as tier 1; the error tells you to compress the block range instead.
- Summaries must be self-contained (Open objectives, verbatim details, media
  refs) — this contract lives in the tool descriptions so any MCP client sees it.

## Install & build

```bash
cd context-ledger
npm install        # dev-only: typescript + @types/node
npm run build
npm test           # 13 tests: kernel, anchors, tiers, tail guard, search, status
```

## Run

**stdio** (for local MCP clients — Claude Desktop, Codex, debugging):

```bash
node dist/cli.js
```

**Streamable HTTP** (for ChatGPT Desktop — see below):

```bash
node dist/cli.js --http --port 8791
# health check: curl http://127.0.0.1:8791/healthz
```

Data directory defaults to `~/.context-ledger` (override: `CONTEXT_LEDGER_DATA`).

## Connect to other hosts (adapters)

context-ledger works with any MCP host. Ready-made, verified config snippets
live in [adapters/](adapters/README.md):

Claude Desktop · Claude Code · Codex CLI · Cursor · Windsurf · Cline ·
Gemini CLI · VSCode Copilot · Zed · OpenCode · OpenClaw · Hermes Agent

### Native integrations (beyond MCP)

Two hosts have **native extension channels** that go beyond the MCP tool
surface — fully automatic, model-transparent compression:

- **OpenClaw** — [openclaw-plugin-context-ledger](../openclaw-plugin-context-ledger/):
  a `context-engine` plugin that mirrors every turn into the ledger and injects
  the compacted view before each prompt build (reminder or full-auto mode).
- **Hermes Agent** — [hermes-plugin-context-ledger](../hermes-plugin-context-ledger/):
  a ContextEngine implementation (`context.engine: "context-ledger"`) that
  compresses automatically at the token threshold, with ledger status/search/
  decompress exposed as agent tools.

Two more hosts support **hook-based reminders** (the model still compresses via
MCP tools, but the host nags it at the right moment):

- **Claude Code** — [claude-code-hook-context-ledger](../claude-code-hook-context-ledger/):
  UserPromptSubmit `additionalContext` reminder + PreCompact/PostCompact observers.
- **Cursor** — [cursor-hook-context-ledger](../cursor-hook-context-ledger/):
  beforeSubmitPrompt reminder + preCompact observer.

Platform boundary: Claude Code and Cursor hooks can inject context but cannot
replace the transcript — only OpenClaw and Hermes offer true replacement-level
automation. See the depth table in [adapters/README.md](adapters/README.md).

## Connect to ChatGPT Desktop

ChatGPT **never launches local stdio MCP servers**, so the HTTP transport plus
an HTTPS endpoint is required:

1. You need a paid plan with **Developer Mode**
   (Plus / Pro / Business / Enterprise / Edu; Free doesn't have it).
2. Settings → Security and login → enable **Developer mode**.
3. Expose the server over HTTPS, pick one:
   - **Tunnel**: `cloudflared tunnel --url http://127.0.0.1:8791` or
     `ngrok http 8791` → copy the `https://...` URL.
   - **OpenAI Secure MCP Tunnel**: run OpenAI's `tunnel-client` against the
     local HTTP server; in ChatGPT pick Connection = **Tunnel** (no public URL).
   - **Own domain**: reverse proxy (nginx/caddy) with TLS to `127.0.0.1:8791`.
4. Plugins → **Add** → **Create MCP App** → paste the HTTPS URL →
   Auth: **No auth** (add auth yourself in front of the proxy if exposed) →
   **Create**.
5. In a chat, enable the connector, then ask the model to compress consumed
   ranges. Suggested workflow prompt:

   > You have context tools (compress/decompress/search_context/acp_status).
   > When older parts of our conversation are no longer needed verbatim, call
   > `compress` with a self-contained summary of that range, then keep working
   > from the summary. Use `search_context`/`decompress` when you need details
   > back. Use `acp_view` to show me the compressed view.

## Compressing by content anchors (no message ids)

Inside ChatGPT the model can't see `mNNNNN` ids, so `compress` also accepts
**content anchors**: quote a distinctive snippet of the first and last message
of the range and the kernel resolves them against live messages
(case-insensitive; content already inside a block is not searchable):

```json
{
  "conversation_id": "c1",
  "from_contains": "let us discuss the deployment plan",
  "to_contains": "what about rollback",
  "summary": "Alpha deployment decided: blue-green, auto-rollback 30s.",
  "topic": "alpha-deploy"
}
```

- `to_contains` omitted → range ends at the last compressible message.
- Miss → error tells you the anchor wasn't found in *live* messages (usually
  means it's already compressed — search the block summary instead).
- `start_id`/`end_id` still work when you have them (stdio hosts, tests).

## Rolling handoff: the cheapest context of all

The biggest token savings come from **starting a fresh conversation** with a
compressed view instead of dragging a huge thread along:

1. When the current thread gets long, ask: *"export the compressed view"* —
   the model calls `acp_view` and you copy the output.
2. Paste it at the top of a **new** conversation (same `conversation_id` keeps
   the same ledger; a new id starts a fresh one).
3. Continue working there. Optionally put this in Custom Instructions so the
   model reminds you when it's time:

   > When our conversation grows long and early parts are settled, suggest
   > exporting a compressed view (acp_view) so we can continue in a fresh
   > conversation, and compress consumed ranges with self-contained summaries
   > before doing so.

Every new session then only pays for the summary — the raw history stays on
disk, restorable via `decompress(full=true)` at any time.

### Caveats (be honest about these)

- The server declares compression guidance via the MCP `instructions` field
  (initialize response). Hosts that surface it — Claude Code, OpenClaw, Zed,
  Hermes — inject it into the system prompt, so the model compresses
  proactively. ChatGPT Desktop ignores server instructions for custom
  connectors, so there the model only compresses when prompted.
- MCP connectors are request/response — the server can't proactively remind
  the model to compress. billion-context gets that for free via its traffic
  proxy; that's impossible for ChatGPT Desktop traffic, which is why this is
  an *active* tool-based port instead.
- Conversation data lives in plain JSON under the data dir on this machine.

## Layout

```
src/kernel.ts   block ledger, tiers, tail guard, token estimates, status
src/mcp.ts      tool definitions + JSON-RPC handling (MCP 2025-06-18)
src/cli.ts      stdio + streamable-HTTP transports, session ids, CORS, /healthz
src/__tests__/kernel.test.ts   13 node:test cases
```
