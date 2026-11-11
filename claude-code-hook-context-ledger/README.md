# context-ledger hooks for Claude Code

Claude Code hooks can **inject context** but cannot replace the transcript, so
this integration runs in *reminder mode*: the hook mirrors each user turn into
the ledger and, past a token threshold, injects a compression reminder via
`additionalContext`. The model compresses through the context-ledger **MCP
server** (see `adapters/claude-code/README.md`); PreCompact/PostCompact are
observed so ledger and native compaction stay consistent.

## Install

1. Copy this folder somewhere permanent, e.g. `~/.claude/context-ledger-hook/`.
2. Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
          "command": "node ~/.claude/context-ledger-hook/hook.js" } ] }
    ],
    "PreCompact": [
      { "hooks": [ { "type": "command",
          "command": "node ~/.claude/context-ledger-hook/on-compact.js pre" } ] }
    ],
    "PostCompact": [
      { "hooks": [ { "type": "command",
          "command": "node ~/.claude/context-ledger-hook/on-compact.js post" } ] }
    ]
  }
}
```

3. Optional env: `CONTEXT_LEDGER_DATA` (default `~/.context-ledger`),
   `CONTEXT_LEDGER_THRESHOLD` (default 30000 tokens).
4. Also configure the MCP server (tools) per `adapters/claude-code/README.md`
   — the hook reminds, the MCP tools do the compression.

## What you get

| Depth | Mechanism |
| --- | --- |
| Automatic mirroring | every `UserPromptSubmit` appends the user turn to the ledger |
| Automatic reminder | past threshold, `additionalContext` lists compressible ranges |
| Compression | model calls `mcp__context-ledger__compress` with content anchors |
| Native compaction safety | PreCompact/PostCompact logged; ledger originals restorable via `decompress` even after Claude Code compacts |

Fully transcript-replacing automation is not possible through Claude Code
hooks (injection-only by design); a plugin **mod** (JS function hooks) could
go deeper — tracked as a future upgrade.
