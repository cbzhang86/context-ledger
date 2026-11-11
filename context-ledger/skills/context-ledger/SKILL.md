---
name: context-ledger
description: Compress old conversation turns into a persistent block ledger to save tokens — decide when to compress, how to write self-contained summaries, and when to roll over to a fresh session via acp_view.
version: 0.1.0
metadata:
  hermes:
    tags: [context, tokens, memory, compression]
    category: productivity
    requires_tools: [mcp_context-ledger_compress]
---

# Context Ledger — conversation compression

## When to Use

- The conversation has grown long (>~30 turns or >20k tokens of history) and older turns are no longer needed verbatim.
- The user asks to "compress / save context / free up tokens / 总结一下节省上下文".
- You notice you keep re-reading old tool outputs or earlier discussion that is already settled.
- Before a long new phase of work (e.g. "now let's start implementing") — compress the discussion phase first.

## Procedure

1. Check the ledger: call `mcp_context-ledger_acp_status` with `{"conversation_id": "<this conversation's stable id>"}`. Note `compressibleRanges` and `savedByCompression`.
2. Choose ranges to compress — **never touch the last 4 messages** (the kernel enforces a tail guard and will reject).
3. Write the summary. This is the critical part — the summary REPLACES the original in your working view:
   - Self-contained: a reader must be able to continue the task from the summary alone.
   - Keep verbatim: full file paths with line numbers, function/type signatures, exact error messages, exact values (versions, thresholds, config keys), decisions AND their rationale, constraints discovered.
   - Record open objectives explicitly (`Open objectives: ...`), with message refs.
   - Drop: verbose logs once the error line is captured, dead-end exploration (keep one lesson line), duplicate reads.
4. Compress by content anchors (message ids are rarely visible; anchors are preferred):

```json
{
  "conversation_id": "<id>",
  "from_contains": "first distinctive phrase of the range",
  "to_contains": "last distinctive phrase of the range",
  "summary": "<your self-contained summary>"
}
```

   Omitting `to_contains` compresses through the end of the live tail guard. `start_id`/`end_id` also work if you know them.
5. Verify: call `mcp_context-ledger_acp_status` again — confirm `savedByCompression` increased and the view is coherent via `mcp_context-ledger_acp_view`.
6. To recover exact details later: `mcp_context-ledger_decompress` (block level, or `full: true` for original messages); `mcp_context-ledger_search_context` searches summaries without inflating context.

## Rolling handoff (cheapest of all)

When a conversation is finished as a unit but the work continues:

1. Call `mcp_context-ledger_acp_view` — it renders the compressed view (📦 block summaries + live tail).
2. Give that view to the user to paste at the top of a **fresh session**, reusing the same `conversation_id` to keep the ledger.

## Pitfalls

- Compressing with a summary that drops file paths or error text — later work then needs a decompress round-trip. Always keep them verbatim.
- Trying to anchor on content that is already inside a block → error `from_contains not found in live messages`. Anchors only search live (uncompressed) messages.
- Range overlaps an existing block → compress the BLOCK range instead (the error tells you the block id).
- Out-of-order anchors → check quoting of `from_contains`/`to_contains`.
- The last 4 messages must stay live — do not try to compress them.
- Never let the summary change the task: preserve user intent, constraints, and priorities exactly.

## Verification

- `acp_status` shows increased `savedByCompression` and a lower ratio.
- `acp_view` renders 📦 block summaries inline with the live tail.
- A follow-up question about compressed content is answerable via `search_context` without decompressing.
