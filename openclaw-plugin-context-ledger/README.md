# context-ledger — OpenClaw native plugin

A native [OpenClaw](https://openclaw.ai) context-engine plugin. It mirrors the
session transcript into a block ledger and, once the session grows past a
threshold, compresses the oldest range **server-side** (before the prompt is
built) and injects the compacted ledger view — the model never sees a prompt
about "managing context" unless you want it to.

## How it works

- Every `before_prompt_build`, the plugin mirrors new history entries into the
  per-session ledger (position-based cursor, idempotent).
- When raw tokens exceed `compressThresholdTokens`:
  - **`autoAppend: true`** (recommended) — the plugin compresses the oldest
    compressible range itself (tail guard: the last 4 messages always stay
    live), then injects the compacted view (`📦 = summary block`, recent
    messages verbatim) as `prependContext`. Fully automatic.
  - **`autoAppend: false`** — reminder-only: the model is told the
    compressible ranges and compresses them itself via the
    `mcp_context-ledger_*` tools (the MCP server's summaries are model-written
    by construction).

## Summary quality

In `autoAppend` mode summaries are written by a **model call** to an
OpenAI-compatible endpoint. Configure it via plugin config:

```json
{
  "autoAppend": true,
  "apiBaseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o-mini"
}
```

or via environment variables: `CONTEXT_LEDGER_SUMMARIZER_BASE_URL`,
`CONTEXT_LEDGER_SUMMARIZER_API_KEY`, `CONTEXT_LEDGER_SUMMARIZER_MODEL`
(`CONTEXT_LEDGER_SUMMARIZER_TIMEOUT` seconds, default 20). With no endpoint
configured (or on any failure — timeout, dead endpoint, bad response) the
plugin falls back to a deterministic extractive summary (first 160 characters
per message), so compression never blocks or breaks a session.

## Config reference

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch (also `CONTEXT_LEDGER_DISABLE=1` at runtime) |
| `dataDir` | `<openclaw state>/context-ledger` | Ledger storage (`CONTEXT_LEDGER_DATA` env also honored) |
| `compressThresholdTokens` | `8000` | Raw-token level that triggers compression/injection |
| `viewTokens` | `2000` | Token budget for the injected view (0 = unbounded) |
| `autoAppend` | `false` | `true` = server-side compress + inject view; `false` = reminder-only |
| `apiBaseUrl` | env | OpenAI-compatible base URL for the summarizer |
| `apiKey` | env | Summarizer API key |
| `model` | env | Summarizer model id |

## Install

Copy this directory into OpenClaw's plugin directory (or register via your
`openclaw.json` plugins entry), then start OpenClaw. The ledger persists per
session key, so resumed sessions get their compacted context restored
automatically.

## Relationship to the MCP server

You can run both: the plugin handles automatic compression in `autoAppend`
mode, while the MCP server (`context-ledger/` in the repo root) gives the
model explicit `compress` / `decompress` / `search_context` / `acp_status`
tools. They share the same ledger format (`CONTEXT_LEDGER_DATA`), so blocks
written by one are visible to the other.
