"""context-ledger — native Hermes context engine plugin.

Implements the Hermes ContextEngine ABC (agent/context_engine.py) on top of a
block ledger: compressed ranges become summary blocks, originals stay
restorable, and the compacted view is returned as a valid OpenAI-format
message list. Falls back to deterministic extractive compaction — no LLM call
is required, so compress() is fast and cache-friendly.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict, List, Optional

try:
    from agent.context_engine import ContextEngine  # type: ignore
except ImportError:  # outside Hermes (tests / standalone use)
    class ContextEngine:  # type: ignore
        last_prompt_tokens: int = 0
        last_completion_tokens: int = 0
        last_total_tokens: int = 0
        threshold_tokens: int = 0
        context_length: int = 0
        compression_count: int = 0

        def update_model(self, model, context_length, **kwargs):
            self.context_length = context_length

try:
    from .kernel import Ledger, LedgerStore, estimate_tokens, extractive_summary
except ImportError:  # flat install (no package context)
    from kernel import Ledger, LedgerStore, estimate_tokens, extractive_summary  # type: ignore


ENGINE_NAME = "context-ledger"
DEFAULT_THRESHOLD_RATIO = 0.7  # compress at 70% of the context window


class ContextLedgerEngine(ContextEngine):
    """Block-ledger context engine for Hermes.

    - Mirrors the transcript into the ledger keyed by session id.
    - should_compress() fires when estimated prompt tokens cross the threshold.
    - compress() replaces the old message list with: one carrier message
      holding the compacted ledger view + the tail-guarded live messages.
    - get_tool_schemas()/handle_tool_call() expose the ledger query surface
      (status / search / decompress) as agent-callable tools.
    """

    def __init__(self, data_dir: Optional[str] = None,
                 context_length: int = 200000,
                 threshold_ratio: float = DEFAULT_THRESHOLD_RATIO,
                 view_tokens: int = 2500):
        self.data_dir = data_dir or os.environ.get(
            "CONTEXT_LEDGER_DATA",
            os.path.join(os.path.expanduser("~"), ".context-ledger"),
        )
        self.store = LedgerStore(self.data_dir)
        self.threshold_ratio = threshold_ratio
        self.view_tokens = view_tokens
        self._ledgers: Dict[str, Ledger] = {}
        self.threshold_tokens = int(context_length * threshold_ratio)
        super().__init__()
        self.context_length = context_length

    # -- lifecycle -----------------------------------------------------------

    def clone_for_agent(self) -> "ContextLedgerEngine":
        """Fresh engine sharing the durable store (deepcopy would copy ledgers)."""
        clone = ContextLedgerEngine(
            data_dir=self.data_dir,
            context_length=self.context_length,
            threshold_ratio=self.threshold_ratio,
            view_tokens=self.view_tokens,
        )
        clone.threshold_tokens = self.threshold_tokens
        return clone

    @property
    def name(self) -> str:
        return ENGINE_NAME

    # -- token accounting ------------------------------------------------------

    def update_from_response(self, usage: dict) -> None:
        self.last_prompt_tokens = usage.get("prompt_tokens", 0)
        self.last_completion_tokens = usage.get("completion_tokens", 0)
        self.last_total_tokens = usage.get("total_tokens", 0)

    def should_compress(self, prompt_tokens: int = None) -> bool:
        if prompt_tokens is None:
            prompt_tokens = self.last_prompt_tokens
        if not prompt_tokens:
            return False
        return prompt_tokens >= self.threshold_tokens

    def should_compress_preflight(self, messages) -> bool:
        """Cheap char-based estimate before the API call."""
        total = sum(estimate_tokens(_content_text(m)) for m in messages)
        return total >= self.threshold_tokens

    # -- ledger mirroring --------------------------------------------------------

    def _ledger_for(self, messages: list) -> Ledger:
        """Mirror messages into a stable ledger.

        Keyed on message identity: Hermes stamps `message_uid` on every
        persisted row; we fall back to position+content hashing when absent.
        The ledger is append-only from the mirror's perspective, so repeated
        calls are idempotent.
        """
        uid = self._conv_key(messages)
        led = self._ledgers.get(uid)
        if led is None:
            led = self.store.load(uid)
            self._ledgers[uid] = led
        seen = {m["id"] for m in led.msgs}
        for i, m in enumerate(messages):
            mid = f"m{i + 1:05d}"
            if mid in seen:
                continue
            led.append(
                m.get("role", "user"),
                _content_text(m),
                msg_id=mid,
                uid=m.get("message_uid"),
            )
        self.store.save(led)
        return led

    @staticmethod
    def _conv_key(messages: list) -> str:
        """Stable conversation key: hash of the first message's uid/content."""
        if not messages:
            return "empty"
        first = messages[0]
        key = first.get("message_uid") or f"{first.get('role')}::{_content_text(first)[:120]}"
        import hashlib
        return "conv-" + hashlib.sha1(key.encode("utf-8", "replace")).hexdigest()[:12]

    # -- compression ---------------------------------------------------------------

    def compress(self, messages: list, current_tokens: int = None,
                 focus_topic: str = None, force: bool = False) -> list:
        led = self._ledger_for(messages)

        # Determine what to compress: oldest contiguous live range up to the
        # tail guard (last 4 messages stay live).
        live = led.live_msgs()
        if len(live) <= 4:
            if not force:
                return messages
            # even forced, keep the guard
        ranges = led.find_compressible()
        if ranges:
            r = ranges[0]  # oldest
            block = led.compress(r["startId"], r["endId"],
                                 extractive_summary(
                                     [m for m in led.msgs
                                      if Ledger.msg_num(r["startId"]) <= Ledger.msg_num(m["id"])
                                      <= Ledger.msg_num(r["endId"])],
                                     focus_topic),
                                 topic=focus_topic or None)
            self.compression_count = getattr(self, "compression_count", 0) + 1
            self.store.save(led)
        elif not force:
            # nothing compressible and not forced — leave untouched
            return messages

        # Build the compacted message list: carrier + live tail.
        view = led.render_view(self.view_tokens)
        compacted = [
            {
                "role": "system",
                "content": (
                    "[context-ledger] Compacted conversation history follows. "
                    "📦 entries are summary blocks (originals restorable via "
                    "decompress); everything after them is verbatim recent "
                    "history. Trust this as authoritative context."
                ),
            },
            {"role": "user", "content": view},
        ]
        # live tail = messages after the last compressed block
        guard = live[-4:] if len(live) >= 4 else live
        for m in guard:
            compacted.append({"role": m["role"], "content": m["content"]})
        return compacted

    # -- engine tools ---------------------------------------------------------------

    def get_tool_schemas(self) -> list:
        return [
            {
                "name": "ledger_status",
                "description": "Show the block ledger: blocks, tokens saved, compressible ranges.",
                "parameters": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "ledger_search",
                "description": "Search compressed block summaries and live messages.",
                "parameters": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
            {
                "name": "ledger_decompress",
                "description": "Restore the original messages of a block (pass full=true for tier>=2).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "block_id": {"type": "string"},
                        "full": {"type": "boolean"},
                    },
                    "required": ["block_id"],
                },
            },
        ]

    def handle_tool_call(self, name: str, args: dict, **kwargs) -> str:
        led = self._current_ledger()
        if led is None:
            return json.dumps({"error": "no active ledger yet"})
        try:
            if name == "ledger_status":
                return json.dumps(led.status(), ensure_ascii=False)
            if name == "ledger_search":
                return json.dumps({"hits": led.search(args["query"])}, ensure_ascii=False)
            if name == "ledger_decompress":
                return json.dumps(
                    {"text": led.decompress(args["block_id"], args.get("full", False))},
                    ensure_ascii=False,
                )
            return json.dumps({"error": f"Unknown tool: {name}"})
        except (KeyError, ValueError) as exc:
            return json.dumps({"error": str(exc)})

    def _current_ledger(self) -> Optional[Ledger]:
        return next(iter(self._ledgers.values()), None)

    # -- status -----------------------------------------------------------------------

    def get_status(self) -> dict:
        led = self._current_ledger()
        base = super().get_status() if hasattr(super(), "get_status") else {}
        if led:
            base.update(led.status())
        return base


def _content_text(message: dict) -> str:
    c = message.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):  # provider content parts
        return "\n".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in c
        )
    if c is None:
        return ""
    return json.dumps(c, ensure_ascii=False)


# ---------------------------------------------------------------------------
# registration (both shapes Hermes accepts)
# ---------------------------------------------------------------------------

def _make_engine(**kwargs) -> ContextLedgerEngine:
    return ContextLedgerEngine(**kwargs)


def register(ctx) -> None:
    """General-plugin registration: ctx.register_context_engine(engine)."""
    ctx.register_context_engine(_make_engine())


# Directory discovery mode: ~/.hermes/plugins/context_engine/context-ledger/
# __init__.py must export a ContextEngine subclass — an instance is created
# by Hermes with no args, so defaults must be env-driven (they are).
__all__ = ["ContextLedgerEngine", "ContextEngine", "register", "_make_engine"]
