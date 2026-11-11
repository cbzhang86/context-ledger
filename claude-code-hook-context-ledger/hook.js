#!/usr/bin/env node
/**
 * context-ledger hook for Claude Code — UserPromptSubmit reminder mode.
 *
 * Claude Code hooks can inject context (additionalContext) but cannot replace
 * the transcript, so this hook keeps the ledger in sync with the transcript
 * (mirroring from hook input when available) and, once the session crosses
 * the token threshold, injects a compression reminder listing compressible
 * ranges. The model then calls the MCP tools (compress/decompress/…) itself.
 *
 * Install (user scope, applies to every project):
 *   ~/.claude/settings.json
 *   {
 *     "hooks": {
 *       "UserPromptSubmit": [
 *         { "hooks": [ { "type": "command",
 *             "command": "node /ABS/PATH/claude-code-hook-context-ledger/hook.js" } ] }
 *       ],
 *       "PreCompact":   [ { "hooks": [ { "type": "command",
 *           "command": "node /ABS/PATH/claude-code-hook-context-ledger/on-compact.js pre" } ] } ],
 *       "PostCompact":  [ { "hooks": [ { "type": "command",
 *           "command": "node /ABS/PATH/claude-code-hook-context-ledger/on-compact.js post" } ] } ]
 *     }
 *   }
 *
 * Env:
 *   CONTEXT_LEDGER_DATA   ledger dir (default ~/.context-ledger)
 *   CONTEXT_LEDGER_THRESHOLD  reminder threshold in tokens (default 30000)
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
// kernel.js is expected next to this file (copied from context-ledger/dist).
const { Kernel, Store, estimateTokens } = require(join(__dirname, "kernel.js"));

const DATA_DIR =
  process.env.CONTEXT_LEDGER_DATA || join(homedir(), ".context-ledger");
const THRESHOLD = Number(process.env.CONTEXT_LEDGER_THRESHOLD || 30000);
// Kill switch: set CONTEXT_LEDGER_DISABLE=1 to turn the hook into a silent
// no-op (exit 0, no injection) without removing it from settings.json.
const v = (process.env.CONTEXT_LEDGER_DISABLE || "").trim().toLowerCase();
if (v !== "" && v !== "0" && v !== "false") process.exit(0);

function main() {
  let input = "";
  try {
    input = readFileSync(0, "utf8");
  } catch {
    process.exit(0);
  }
  let evt;
  try {
    evt = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const sessionKey = `claude-${evt.session_id || evt.conversation_id || "default"}`;
  const prompt =
    typeof evt.prompt === "string"
      ? evt.prompt
      : Array.isArray(evt.prompt)
        ? evt.prompt.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("\n")
        : "";

  if (!prompt) process.exit(0);

  const store = new Store(DATA_DIR);
  const kernel = new Kernel(store);

  // Append the user turn to the ledger. The assistant side of the transcript
  // is not visible to this hook; ledger stays user-turn anchored, which is
  // enough to compute compressible ranges and maintain blocks.
  try {
    kernel.append(sessionKey, "user", prompt);
  } catch {
    process.exit(0); // never break the host on hook failure
  }

  const st = kernel.status(sessionKey);
  if (st.tokens.raw < THRESHOLD) process.exit(0);

  const ranges = (st.compressibleRanges || [])
    .map((r) => `${r.startId}–${r.endId} (~${r.tokens} tok)`)
    .join(", ");

  const msg =
    `[context-ledger] This session is ~${st.tokens.raw} tokens (raw). ` +
    `Compressible ranges: ${ranges || "(none — tail guard protects the last 4)"}.\n` +
    `Use the context-ledger MCP tools to compress the oldest range now ` +
    `(compress with a self-contained summary: keep paths, signatures, errors, ` +
    `decisions and open objectives verbatim). The last 4 messages must stay live.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: msg,
      },
    }),
  );
}

main();
