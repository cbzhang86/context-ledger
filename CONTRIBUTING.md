# Contributing to context-ledger

Thanks for your interest! This project is small and focused: a block-ledger
context compressor for MCP hosts, plus native plugins for the two hosts that
allow full context replacement. Keep that focus in mind when proposing
changes.

## Development setup

```bash
# core server (TypeScript)
cd context-ledger
npm install
npm run build
npm test          # 13 tests — all must pass

# OpenClaw plugin (TypeScript)
cd ../openclaw-plugin-context-ledger
npm install && npm run build

# Hermes plugin (Python, stdlib only)
cd ../hermes-plugin-context-ledger
python test_smoke.py

# Cursor hook (Python, stdlib only)
echo '{"conversation_id":"t1","prompt":"hello"}' | python ../cursor-hook-context-ledger/hook.py
```

## Project rules

1. **Zero runtime dependencies** for the core server and the hooks. Dev
   dependencies (`typescript`, `@types/node`) are fine. The Hermes/Cursor
   Python plugins use the standard library only.
2. **The kernel is the contract.** `context-ledger/src/kernel.ts` is the
   source of truth; the vendored copies (`kernel.js`, `kernel.py`) must stay
   behavior-identical. If you change kernel semantics, port the change to
   every vendored copy and add a test.
3. **Never break the tail guard.** The last 4 messages must stay live in
   every code path, including force compress.
4. **Summaries are model-written.** The server never generates summaries
   itself (deterministic extractive fallbacks in the native plugins are the
   only exception, and they must be documented as such).
5. **Fail open.** Hooks and plugins must never break the host when they
   error — catch, log, return empty.

## Pull requests

- One logical change per PR; include tests or a smoke reproduction.
- Update the relevant README(s) if behavior or setup changes.
- For new host adapters: verify against the real host, follow the format of
  `context-ledger/adapters/zed/README.md` (config file, transport, tool
  prefixes, verification step, pitfalls).

## Reporting bugs

Open an issue with: host + version, transport (stdio/HTTP), the tool call or
hook event, expected vs actual behavior, and (if relevant) the ledger JSON
from `~/.context-ledger/` with any private content redacted.

## License

By contributing you agree that your contributions are licensed under the MIT
License.
