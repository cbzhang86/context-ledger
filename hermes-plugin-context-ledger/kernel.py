"""context-ledger ledger kernel — Python port of context-ledger/src/kernel.ts.

Block-ledger conversation compression (billion-context style):
- Compressed ranges are replaced by summary blocks; original messages are kept
  verbatim so they can be restored.
- Tiered folding: compressing already-compressed content produces a higher-tier
  summary. Decompress walks back down.
- Tail guard: the most recent N messages must stay live.
- Zero dependencies; one JSON file per conversation; atomic writes.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from typing import Any, Dict, List, Optional, Tuple

TAIL_GUARD = 4  # the last N messages must stay live
MIN_RANGE_TOKENS = 200  # ranges smaller than this are not worth compressing


# ---------------------------------------------------------------------------
# token estimation (CJK ≈ 1 token/char, everything else ≈ chars/4)
# ---------------------------------------------------------------------------

def estimate_tokens(text: str) -> int:
    cjk = 0
    for ch in text:
        cp = ord(ch)
        if (
            0x4E00 <= cp <= 0x9FFF
            or 0x3400 <= cp <= 0x4DBF
            or 0x3000 <= cp <= 0x303F
            or 0xFF00 <= cp <= 0xFFEF
        ):
            cjk += 1
    other = len(text) - cjk
    return cjk + (other + 3) // 4


# ---------------------------------------------------------------------------
# ledger store
# ---------------------------------------------------------------------------

class Ledger:
    """One conversation's block ledger, persisted as one JSON file."""

    def __init__(self, conv_id: str, data: Optional[Dict[str, Any]] = None):
        self.id = conv_id
        data = data or {}
        self.msgs: List[Dict[str, Any]] = data.get("msgs", [])
        self.blocks: List[Dict[str, Any]] = data.get("blocks", [])
        self.next_block: int = data.get("nextBlock", 1)
        self.updated_at: str = data.get("updatedAt", "")

    # -- ids ---------------------------------------------------------------

    @staticmethod
    def msg_num(msg_id: str) -> int:
        return int(msg_id[1:])

    def next_msg_id(self) -> str:
        return f"m{len(self.msgs) + 1:05d}"

    # -- mutation -----------------------------------------------------------

    def append(self, role: str, content: str, msg_id: Optional[str] = None,
               uid: Optional[str] = None) -> Dict[str, Any]:
        mid = msg_id or self.next_msg_id()
        # idempotent on explicit ids (mirror stability)
        for m in self.msgs:
            if m["id"] == mid:
                return m
        msg = {
            "id": mid,
            "role": role,
            "tokens": estimate_tokens(content),
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "content": content,
        }
        if uid:
            msg["uid"] = uid
        self.msgs.append(msg)
        self.touch()
        return msg

    def touch(self) -> None:
        self.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # -- queries ------------------------------------------------------------

    def in_block(self, msg_id: str) -> bool:
        for b in self.blocks:
            if Ledger.msg_num(b["startId"]) <= Ledger.msg_num(msg_id) <= Ledger.msg_num(b["endId"]):
                return True
        return False

    def live_msgs(self) -> List[Dict[str, Any]]:
        return [m for m in self.msgs if not self.in_block(m["id"])]

    def raw_tokens(self) -> int:
        return sum(m["tokens"] for m in self.msgs)

    def find_compressible(self) -> List[Dict[str, Any]]:
        """Uncompressed ranges worth compressing (tail guard excluded)."""
        live = self.live_msgs()
        if len(live) <= TAIL_GUARD:
            return []
        guard_ids = {m["id"] for m in live[-TAIL_GUARD:]}
        ranges: List[Dict[str, Any]] = []
        run: List[Dict[str, Any]] = []
        for m in live:
            if m["id"] in guard_ids:
                if run:
                    ranges.append(self._range_info(run))
                    run = []
                continue
            run.append(m)
        if run:
            ranges.append(self._range_info(run))
        return [r for r in ranges if r["tokens"] > MIN_RANGE_TOKENS]

    def _range_info(self, msgs: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {
            "startId": msgs[0]["id"],
            "endId": msgs[-1]["id"],
            "tokens": sum(m["tokens"] for m in msgs),
        }

    # -- compress / decompress / render --------------------------------------

    def compress(self, start_id: str, end_id: str, summary: str,
                 topic: Optional[str] = None) -> Dict[str, Any]:
        s, e = Ledger.msg_num(start_id), Ledger.msg_num(end_id)
        if s > e:
            raise ValueError(f"invalid range: {start_id} > {end_id}")
        targets = [m for m in self.msgs if s <= Ledger.msg_num(m["id"]) <= e]
        if not targets:
            raise ValueError(f"unknown message ids: {start_id}..{end_id}")
        live = self.live_msgs()
        guard_ids = {m["id"] for m in live[-TAIL_GUARD:]}
        blocked = [m["id"] for m in targets if m["id"] in guard_ids]
        if blocked:
            raise ValueError(
                f"tail guard: the last {TAIL_GUARD} messages must stay live "
                f"({blocked[0]} is protected)"
            )
        # overlap with tier-1 blocks?
        overlapping = [
            b for b in self.blocks
            if b["tier"] == 1 and not (Ledger.msg_num(b["endId"]) < s or Ledger.msg_num(b["startId"]) > e)
        ]
        covered = all(self.in_block(m["id"]) for m in targets)
        tier = 1
        derived = None
        if overlapping and covered:
            # tier-2 fold: summary of summaries, consume inner blocks
            tier = min(3, max(b["tier"] for b in overlapping) + 1)
            derived = overlapping[0]["blockId"]
        elif overlapping:
            raise ValueError(
                f"range {start_id}..{end_id} overlaps existing block "
                f"{overlapping[0]['blockId']} ({overlapping[0]['startId']}–{overlapping[0]['endId']}); "
                f"compress the BLOCK range instead"
            )
        original_tokens = sum(m["tokens"] for m in targets)
        summary_tokens = estimate_tokens(summary)
        block = {
            "blockId": f"b{self.next_block}",
            "startId": start_id,
            "endId": end_id,
            "topic": topic,
            "summary": summary,
            "tier": tier,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "originalTokens": original_tokens,
            "summaryTokens": summary_tokens,
        }
        if derived:
            block["derivedFrom"] = derived
        self.next_block += 1
        self.blocks.append(block)
        self.touch()
        return block

    def decompress(self, block_id: str, full: bool = False) -> str:
        for b in self.blocks:
            if b["blockId"] == block_id:
                if b["tier"] == 1 or full:
                    parts = [
                        f"[{m['id']}] {m['role']}: {m['content']}"
                        for m in self.msgs
                        if Ledger.msg_num(b["startId"]) <= Ledger.msg_num(m["id"]) <= Ledger.msg_num(b["endId"])
                    ]
                    return "\n\n".join(parts)
                return (
                    f"📦 [{b['blockId']}] {b['startId']}–{b['endId']} (tier {b['tier']}): "
                    f"{b['summary']}\n(pass full=true to restore the original messages)"
                )
        raise ValueError(f"unknown block: {block_id}")

    def render_view(self, limit_tokens: Optional[int] = None) -> str:
        """Blocks + live messages in order; tail-clipped when over budget."""
        events: List[Tuple[str, str, int]] = []
        block_by_start = {b["startId"]: b for b in self.blocks}
        consumed = set()
        for b in self.blocks:
            for n in range(Ledger.msg_num(b["startId"]), Ledger.msg_num(b["endId"]) + 1):
                consumed.add(f"m{n:05d}")
        for m in self.msgs:
            if m["id"] in consumed:
                continue
            events.append((m["id"], f"[{m['id']}] {m['role']}: {m['content']}", m["tokens"]))
        for b in self.blocks:
            topic = f" ({b['topic']})" if b.get("topic") else ""
            head = f"📦 [{b['blockId']}] {b['startId']}–{b['endId']}{topic} (tier {b['tier']})"
            events.append((b["startId"], f"{head}\n{b['summary']}", b["summaryTokens"]))
        events.sort(key=lambda e: Ledger.msg_num(e[0]))
        out = []
        used = 0
        for _, text, tok in events:
            if limit_tokens and used + tok > limit_tokens and out:
                out.append(f"… ({len(events) - len(out)} earlier entries omitted; "
                           f"ledger retains everything, decompress to restore)")
                break
            out.append(text)
            used += tok
        return "\n\n".join(out)

    def status(self) -> Dict[str, Any]:
        raw = self.raw_tokens()
        view = self.render_view()
        view_tokens = estimate_tokens(view)
        return {
            "conversation": self.id,
            "messages": len(self.msgs),
            "blocks": [
                {
                    "blockId": b["blockId"],
                    "range": f"{b['startId']}–{b['endId']}",
                    "topic": b.get("topic"),
                    "tier": b["tier"],
                    "saved": b["originalTokens"] - b["summaryTokens"],
                }
                for b in self.blocks
            ],
            "tokens": {
                "raw": raw,
                "liveView": view_tokens,
                "savedByCompression": raw - view_tokens,
                "ratio": round(raw / view_tokens, 2) if view_tokens else 1.0,
            },
            "compressibleRanges": self.find_compressible(),
        }

    def search(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        q = query.lower()
        hits = []
        for b in self.blocks:
            if q in b["summary"].lower() or q in (b.get("topic") or "").lower():
                hits.append({"type": "block", "id": b["blockId"],
                             "range": f"{b['startId']}–{b['endId']}",
                             "snippet": b["summary"][:200]})
        for m in self.live_msgs():
            if q in m["content"].lower():
                hits.append({"type": "message", "id": m["id"],
                             "role": m["role"], "snippet": m["content"][:200]})
            if len(hits) >= limit:
                break
        return hits[:limit]


class LedgerStore:
    """Persists one Ledger per conversation as a JSON file (atomic writes)."""

    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        os.makedirs(data_dir, exist_ok=True)

    def _path(self, conv_id: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_-]", "_", conv_id)
        return os.path.join(self.data_dir, f"{safe}.json")

    def load(self, conv_id: str) -> Ledger:
        try:
            with open(self._path(conv_id), "r", encoding="utf-8") as f:
                return Ledger(conv_id, json.load(f))
        except (OSError, json.JSONDecodeError):
            return Ledger(conv_id)

    def save(self, ledger: Ledger) -> None:
        ledger.touch()
        path = self._path(ledger.id)
        fd, tmp = tempfile.mkstemp(dir=self.data_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({
                    "id": ledger.id,
                    "msgs": ledger.msgs,
                    "blocks": ledger.blocks,
                    "nextBlock": ledger.next_block,
                    "updatedAt": ledger.updated_at,
                }, f, ensure_ascii=False)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass


# ---------------------------------------------------------------------------
# extractive fallback summarizer (no LLM required)
# ---------------------------------------------------------------------------

def extractive_summary(msgs: List[Dict[str, Any]], focus_topic: Optional[str] = None,
                       per_msg_chars: int = 160) -> str:
    parts = []
    for m in msgs:
        text = " ".join(m["content"].split())
        if len(text) > per_msg_chars:
            text = text[:per_msg_chars] + "…"
        parts.append(f"{m['id']} {m['role']}: {text}")
    head = "Extractive compaction (deterministic; decompress any block for full originals)."
    if focus_topic:
        head += f" Focus: {focus_topic}."
    return head + "\n" + "\n".join(parts)
