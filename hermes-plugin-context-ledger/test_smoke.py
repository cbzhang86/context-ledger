"""Smoke tests for the context-ledger Hermes engine (no Hermes install needed)."""

import json
import shutil
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kernel import Ledger, LedgerStore, estimate_tokens, extractive_summary  # noqa: E402
from __init__ import ContextLedgerEngine  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".test-data")


def make_msgs(n: int) -> list:
    return [
        {
            "role": "user" if i % 2 == 0 else "assistant",
            "content": f"Turn {i}: discussing deployment plan with rollback strategy details {i}",
            "message_uid": f"uid{i:032x}",
        }
        for i in range(n)
    ]


def main() -> None:
    shutil.rmtree(DATA, ignore_errors=True)
    eng = ContextLedgerEngine(data_dir=DATA, context_length=1000, threshold_ratio=0.5, view_tokens=500)
    assert eng.name == "context-ledger"

    msgs = make_msgs(30)

    # preflight estimate
    est = sum(estimate_tokens(m["content"]) for m in msgs)
    assert eng.should_compress_preflight(msgs), f"preflight should fire at {est} tok"

    # mirror
    led = eng._ledger_for(msgs)
    assert len(led.msgs) == 30, f"mirrored {len(led.msgs)}"
    # idempotent
    eng._ledger_for(msgs)
    assert len(led.msgs) == 30, "mirror not idempotent"

    # compress
    out = eng.compress(msgs)
    assert isinstance(out, list) and all("role" in m for m in out), "invalid message list"
    assert any("context-ledger" in (m.get("content") or "") for m in out), "no carrier"
    assert out[-1]["content"].endswith("details 29"), "tail guard lost the live tail"
    led2 = eng.store.load(eng._conv_key(msgs))
    assert led2.blocks, "no block created"
    assert led2.blocks[0]["blockId"] == "b1"
    print("compress ok:", json.dumps(led2.status()["tokens"]))

    # engine tools
    r = json.loads(eng.handle_tool_call("ledger_status", {}))
    assert r["blocks"][0]["blockId"] == "b1"
    r = json.loads(eng.handle_tool_call("ledger_search", {"query": "deployment"}))
    assert r["hits"], "search found nothing"
    r = json.loads(eng.handle_tool_call("ledger_decompress", {"block_id": "b1", "full": True}))
    assert "Turn 0" in r["text"], "decompress lost originals"

    # clone semantics
    clone = eng.clone_for_agent()
    assert clone.name == "context-ledger"
    assert clone.store.data_dir == eng.store.data_dir

    # forced compress with nothing compressible → still valid list
    out2 = eng.compress(make_msgs(3), force=True)
    assert isinstance(out2, list)

    shutil.rmtree(DATA, ignore_errors=True)
    print("ALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    main()
