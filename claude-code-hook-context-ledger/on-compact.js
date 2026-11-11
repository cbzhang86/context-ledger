#!/usr/bin/env node
/**
 * PreCompact / PostCompact observer for Claude Code.
 *
 * - pre:  snapshot the transcript side (Claude Code compaction is about to
 *         rewrite history). We record that a compaction happened so the next
 *         UserPromptSubmit mirror keeps the ledger consistent.
 * - post: nothing to restore (Claude Code replaced history itself); we just
 *         log to stderr for debugging.
 *
 * The ledger itself is never deleted: summaries and originals stay on disk,
 * so anything Claude Code's native compaction drops can be recovered from
 * the ledger via the MCP tools (search_context / decompress).
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const phase = process.argv[2] === "post" ? "post" : "pre";
const DATA_DIR =
  process.env.CONTEXT_LEDGER_DATA || join(homedir(), ".context-ledger");

let evt = {};
try {
  evt = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}

try {
  mkdirSync(join(DATA_DIR, "compaction-log"), { recursive: true });
  appendFileSync(
    join(DATA_DIR, "compaction-log", `${evt.session_id || "default"}.jsonl`),
    JSON.stringify({
      phase,
      trigger: evt.trigger,
      at: new Date().toISOString(),
    }) + "\n",
  );
} catch {
  // best effort only
}
process.exit(0);
