# context-ledger hooks for Cursor

Cursor hooks can inject context (`user_message` in hook output) but cannot
replace the transcript, so this runs in **reminder mode** (same design as the
Claude Code variant): mirror user turns into the ledger, and past the token
threshold remind the model to compress via the context-ledger **MCP server**
(see `adapters/cursor/README.md`). `preCompact` is observed so native Cursor
compaction and the ledger stay consistent.

## Install

1. Copy this folder somewhere permanent, e.g. `~/.cursor/context-ledger-hook/`.
2. Add to `~/.cursor/hooks.json` (user) or `<project>/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      { "command": "python3 ~/.cursor/context-ledger-hook/hook.py", "timeout": 10 }
    ],
    "preCompact": [
      { "command": "python3 ~/.cursor/context-ledger-hook/hook.py --observe", "timeout": 10 }
    ]
  }
}
```

3. Optional env: `CONTEXT_LEDGER_DATA` (default `~/.context-ledger`),
   `CONTEXT_LEDGER_THRESHOLD` (default 30000).
4. Configure the MCP server per `adapters/cursor/README.md` — the hook
   reminds, the MCP tools do the compression.

## Notes

- Exit 0 with no output = no injection (fail-open; Cursor proceeds normally).
- `sessionStart` could inject a ledger recap for resumed sessions; kept
  minimal by default — add it to `hooks.json` if you want that.
- Fully automatic transcript replacement is not possible via Cursor hooks;
  this is a Cursor platform boundary, same as Claude Code.
