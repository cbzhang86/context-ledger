#!/usr/bin/env python3
"""context-ledger hook for Cursor — reminder mode.

Cursor hooks (hooks.json) can inject context but cannot replace the
transcript, so like the Claude Code variant this keeps the ledger in sync
and past the threshold injects a compression reminder. The actual
compression happens through the context-ledger MCP server
(see adapters/cursor/README.md).

Wire it in ~/.cursor/hooks.json (user) or .cursor/hooks.json (project):

    { "version": 1, "hooks": {
        "sessionStart":      [ { "command": "python3 /ABS/PATH/cursor-hook-context-ledger/hook.py" } ],
        "beforeSubmitPrompt":[ { "command": "python3 /ABS/PATH/cursor-hook-context-ledger/hook.py" } ],
        "preCompact":        [ { "command": "python3 /ABS/PATH/cursor-hook-context-ledger/hook.py --observe" } ]
    } }

Env: CONTEXT_LEDGER_DATA (default ~/.context-ledger),
     CONTEXT_LEDGER_THRESHOLD (default 30000 tokens).
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from kernel import Ledger as Kernel, LedgerStore as Store  # noqa: E402  (vendored kernel port)

DATA_DIR = os.environ.get("CONTEXT_LEDGER_DATA") or os.path.join(
    os.path.expanduser("~"), ".context-ledger"
)
THRESHOLD = int(os.environ.get("CONTEXT_LEDGER_THRESHOLD", "30000"))


def main() -> int:
    observe = "--observe" in sys.argv
    try:
        raw = sys.stdin.read() or "{}"
        evt = json.loads(raw)
    except Exception:
        return 0

    session_key = "cursor-" + str(
        evt.get("conversation_id") or evt.get("session_id") or "default"
    )

    if observe:
        # preCompact: native compaction is about to rewrite history; the
        # ledger keeps everything restorable. Nothing to output.
        return 0

    prompt = evt.get("prompt") or evt.get("user_prompt") or ""
    if not isinstance(prompt, str) or not prompt:
        return 0

    try:
        store = Store(DATA_DIR)
        kernel = store.load(session_key)
        kernel.append("user", prompt)
        store.save(kernel)
        st = kernel.status()
    except Exception:
        return 0  # fail-open: never block the host

    if st["tokens"]["raw"] < THRESHOLD:
        return 0

    ranges = ", ".join(
        f"{r['startId']}–{r['endId']} (~{r['tokens']} tok)"
        for r in st.get("compressibleRanges", [])
    ) or "(none — tail guard protects the last 4)"

    print(
        json.dumps(
            {
                "user_message": (
                    f"[context-ledger] This session is ~{st['tokens']['raw']} tokens (raw). "
                    f"Compressible ranges: {ranges}. Use the context-ledger MCP tools "
                    f"(compress) with a self-contained summary — keep paths, signatures, "
                    f"errors, decisions and open objectives verbatim. The last 4 messages "
                    f"must stay live."
                )
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
