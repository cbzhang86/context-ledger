# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Global kill switch** — every component (MCP server, OpenClaw plugin,
  Hermes engine, Cursor hook) honors
  `CONTEXT_LEDGER_DISABLE=1` to turn off reminders/compression without
  uninstalling; set to `0`/`false`/unset to re-enable, no restart needed.
  Hermes manual `/compress` (force) keeps working while disabled; the MCP
  server keeps `tools/list` healthy and returns a gentle per-call error.
- **Positioning** — README now states plainly where billion-context (the
  original traffic-level proxy) is the better choice, and where
  context-ledger fits (hosts with no routing seam, proxy-free setups).

### Changed
- **Pruned components that duplicated billion-context's stronger lanes**: removed
  `claude-code-hook-context-ledger` (billion-context's Claude lane is a full
  compression posture; our reminder-only hook added no real capability).
  Claude Code users keep full ledger access via the MCP server.

### Added
- **Model-written summaries in both native engines.** The Hermes engine
  (`compress()`) and the OpenClaw plugin (`autoAppend`) now call an
  OpenAI-compatible endpoint to write block summaries (credentials come from
  the engine's `update_model` payload / plugin config `apiBaseUrl`+`apiKey`+
  `model`, or `CONTEXT_LEDGER_SUMMARIZER_*` env vars). Any failure — missing
  credentials, timeout, dead endpoint — falls back to the deterministic
  extractive summary, so compression never blocks a session.
- OpenClaw `autoAppend` now performs **real server-side compression** (oldest
  compressible range folded into a summary block) instead of only injecting a
  pre-compression view.

### Fixed
- Tail-guard off-by-one in the TypeScript kernel: `findCompressible` could
  return a range ending at `lastNum-3`, which `compress` then rejected
  (`m00009 vs m00008`); both TS and Python kernels now agree that the last
  **4** messages are never compressible.

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
- `cursor-hook-context-ledger/` — Cursor hooks: beforeSubmitPrompt reminder
  + preCompact observer (same injection-level boundary).
