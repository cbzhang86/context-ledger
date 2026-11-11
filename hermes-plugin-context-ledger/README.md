# context-ledger for Hermes Agent

**Native Hermes context engine** — fully automatic, model-transparent conversation
compression (方案 2). Once installed and selected, Hermes hands this engine the
transcript every turn; the engine mirrors it into a block ledger and compacts it
when the token threshold is crossed. The model does not need to call any tool
for compression to happen.

## Install

```bash
# user plugin dir
mkdir -p ~/.hermes/plugins/context_engine/
cp -r hermes-plugin-context-ledger ~/.hermes/plugins/context_engine/context-ledger
```

Activate (context engines are never auto-activated by design):

```yaml
# ~/.hermes/config.yaml
context:
  engine: "context-ledger"   # must match the engine's name property
```

Or interactively: `hermes plugins` → Provider Plugins → Context Engine → `context-ledger`.

## What you get

| Behavior | Mechanism |
| --- | --- |
| Automatic compaction | `should_compress()` fires at `context_length × 0.7` (per-model overrides via `compression.model_thresholds` are honored through the ABC contract) |
| Compacted context | One carrier message with the 📦 ledger view + the last 4 live messages (tail guard) |
| Block ledger | Summary blocks, tier-2 folding on re-compress, originals restorable |
| Agent tools | `ledger_status` / `ledger_search` / `ledger_decompress` injected automatically via `get_tool_schemas()` |
| Persistence | One JSON file per conversation under `~/.context-ledger/` (override with `CONTEXT_LEDGER_DATA`), survives restarts and compaction |
| Subagent safety | `clone_for_agent()` gives each agent its own budget while sharing the durable store |
| Manual `/compress` | Routes to this engine with `force=True` on every surface (CLI/TUI/Desktop/messaging) |

## Configuration

The engine reads env vars at init (directory-discovery mode instantiates it with
no args):

| Env var | Default | Meaning |
| --- | --- | --- |
| `CONTEXT_LEDGER_DATA` | `~/.context-ledger` | Ledger JSON storage dir |
| `CONTEXT_LEDGER_VIEW_TOKENS` | 2500 | Token budget for the compacted view |

Threshold is derived from the model context length (`0.7 × context_length`),
updated on model switches via the ABC's `update_model()`.

## General-plugin registration (alternative)

If you prefer the general plugin system:

```python
# ~/.hermes/plugins/context-ledger/__init__.py
from .engine import ContextLedgerEngine

def register(ctx):
    ctx.register_context_engine(ContextLedgerEngine())
```

Only one engine can be registered; the second registration is rejected with a
warning. Select it with `context.engine: "context-ledger"` as before.

## Caveats

- **Extractive fallback summaries**: `compress()` summarizes deterministically
  (first 160 chars per message) — no LLM call, fast and free, but for *short*
  messages the carrier + view can temporarily exceed raw size (savings appear
  once summaries shorter than originals dominate). Replace `extractive_summary`
  with an LLM-backed summarizer (e.g. `ctx.llm.complete`) for maximum ratio.
- **Thread safety**: Hermes runs compression on a pooled thread; the engine
  keeps per-conversation ledgers in `self._ledgers` keyed by conversation
  hash — concurrent sessions get distinct ledgers.
- **`message_uid`**: the mirror uses Hermes' stable `message_uid` when present
  and falls back to position+content keys; mirror appends are idempotent either
  way.

## Files

```
hermes-plugin-context-ledger/
├── plugin.yaml      # manifest (provides_tools: ledger_status/search/decompress)
├── __init__.py      # ContextLedgerEngine (ContextEngine ABC) + register(ctx)
├── kernel.py        # ledger kernel — Python port of context-ledger/src/kernel.ts
└── test_smoke.py    # standalone smoke tests (python test_smoke.py)
```

## Verification

```bash
python test_smoke.py          # standalone: mirror, compress, tools, clone
# inside Hermes:
/compress                     # manual compaction routes to this engine
ledger_status                 # agent tool: blocks + tokens saved + ranges
```
