# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Global kill switch** — every component (MCP server, OpenClaw plugin,
  Hermes engine, Claude Code hook, Cursor hook) honors
  `CONTEXT_LEDGER_DISABLE=1` to turn off reminders/compression without
  uninstalling; set to `0`/`false`/unset to re-enable, no restart needed.
  Hermes manual `/compress` (force) keeps working while disabled; the MCP
  server keeps `tools/list` healthy and returns a gentle per-call error.
- **Positioning** — README now states plainly where billion-context (the
  original traffic-level proxy) is the better choice, and where
  context-ledger fits (hosts with no routing seam, proxy-free setups).

## [0.1.0] - 2026-11-12

First public release. A block-ledger context compressor for MCP hosts, with
native integrations where hosts allow deeper automation.

### Added

**Core — `context-ledger/` (MCP server, TypeScript, zero runtime deps)**

- Block ledger kernel: per-conversation message ledger with compression
  blocks, tier folding (1→2→3), tail guard (last 4 messages untouchable),
  overlap refusal, and restorable originals on disk.
- Five MCP tools on the billion-context naming contract: `compress`,
  `decompress`, `search_context`, `acp_status`, `acp_view`.
- Content-anchor compression: `from_contains` / `to_contains` resolve ranges
  without visible message ids (for ChatGPT and similar hosts).
- Dual transport: stdio and streamable HTTP (MCP 2025-06-18), session ids,
  CORS, `/healthz`; server `instructions` field for MCP-aware hosts.
- 13 unit tests; verified config snippets for 13 hosts in
  `context-ledger/adapters/`.

**Native integrations (beyond MCP)**

- `openclaw-plugin-context-ledger/` — OpenClaw context-engine plugin
  (`kind: "context-engine"`): mirrors every turn into the ledger, injects
  the compacted view before each prompt build; reminder and full-auto modes.
- `hermes-plugin-context-ledger/` — Hermes Agent ContextEngine
  (`context.engine: "context-ledger"`): automatic compression at the token
  threshold, ledger status/search/decompress exposed as agent tools,
  per-agent clones sharing the durable store.
- `claude-code-hook-context-ledger/` — Claude Code hooks: UserPromptSubmit
  `additionalContext` compression reminder + PreCompact/PostCompact
  observers (injection-level automation; Claude Code hooks cannot replace
  the transcript).
- `cursor-hook-context-ledger/` — Cursor hooks: beforeSubmitPrompt reminder
  + preCompact observer (same injection-level boundary).
