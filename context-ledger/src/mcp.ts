/**
 * context-ledger MCP server core (zero-dependency, JSON-RPC 2.0 over MCP).
 *
 * Exposes four tools (same shape as billion-context):
 *   compress       - fold a message range into a summary block
 *   decompress     - restore a folded range (one tier, or full raw)
 *   search_context - keyword search over blocks + live messages
 *   acp_status     - context usage overview + compressible ranges
 * plus one helper:
 *   acp_view       - render the current "what the model should see" view
 *
 * Dual transport: stdio (local MCP clients) and streamable HTTP
 * (ChatGPT desktop Developer-Mode connectors, which never launch local
 * stdio servers — they need an HTTPS/network endpoint).
 */

import type { Kernel } from "./kernel.js";
import { estimateTokens } from "./kernel.js";

// ---------------------------------------------------------------------------
// MCP protocol plumbing (JSON-RPC 2.0, minimal but spec-shaped)
// ---------------------------------------------------------------------------

type JsonRpcId = string | number | null;
interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
}

function rpcResult(id: JsonRpcId, result: any) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const PROTOCOL_VERSION = "2025-06-18";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any) => Promise<any> | any;
}

export function buildTools(kernel: Kernel): ToolDef[] {
  return [
    {
      name: "compress",
      description:
        "Replace a consumed conversation range with a self-contained summary you write. " +
        "Locate the range EITHER by message ids (start_id/end_id) OR by content anchors " +
        "(from_contains/to_contains — quote a distinctive snippet of the first and last message " +
        "to compress; ids are usually not visible in ChatGPT, so prefer anchors). " +
        "The summary becomes the ONLY record of the range: capture every user request, decision + rationale, " +
        "exact values/paths/errors, open objectives ('Open objectives: … (mNNNNN)'), and media refs verbatim. " +
        "The last few messages are protected and cannot be compressed. If the range is already covered by " +
        "blocks, this folds them one tier up (recursive).",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string", description: "Conversation this range belongs to." },
          start_id: { type: "string", description: "First message id, e.g. m00005. Omit when using from_contains." },
          end_id: { type: "string", description: "Last message id (inclusive), e.g. m00020. Omit when using to_contains." },
          from_contains: { type: "string", description: "Content anchor for the range start: a distinctive substring of the FIRST message to compress. Resolved case-insensitively against live (uncompressed) messages." },
          to_contains: { type: "string", description: "Content anchor for the range end: a distinctive substring of the LAST message to compress. Omit with from_contains to end at the last protected-boundary message." },
          summary: { type: "string", description: "ONE plain string holding the whole summary for the range." },
          topic: { type: "string", description: "Optional short topic label for the block." },
        },
        required: ["conversation_id", "summary"],
      },
      handler: (a) => {
        let startId = a.start_id;
        let endId = a.end_id;
        if (a.from_contains || a.to_contains) {
          const res = kernel.resolveAnchors(a.conversation_id, a.from_contains, a.to_contains);
          if (res.error)
            return { isError: true, content: [{ type: "text", text: `❌ compress failed: ${res.error}` }] };
          startId = res.startId;
          endId = res.endId;
        }
        const r = kernel.compress(a.conversation_id, startId, endId, a.summary, a.topic);
        if (r.error) return { isError: true, content: [{ type: "text", text: `❌ compress failed: ${r.error}` }] };
        const b = r.block;
        return {
          content: [
            {
              type: "text",
              text:
                `📦 Compressed ${b.startId}–${b.endId} → ${b.blockId} (tier ${b.tier})\n` +
                `saved ≈${b.originalTokens - b.summaryTokens} tokens (${b.originalTokens} → ${b.summaryTokens}).\n` +
                `Restore anytime with decompress(blockId="${b.blockId}").`,
            },
          ],
        };
      },
    },
    {
      name: "decompress",
      description:
        "Restore a previously compressed block. Default: one tier up (shows the block content one level deeper). " +
        "full=true restores the ORIGINAL raw messages all the way down. Use when you need exact details lost in compression.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          block_id: { type: "string", description: "e.g. b5" },
          full: { type: "boolean", description: "restore all the way to original raw messages" },
        },
        required: ["conversation_id", "block_id"],
      },
      handler: (a) => {
        const r = kernel.decompress(a.conversation_id, a.block_id, !!a.full);
        if (r.error) return { isError: true, content: [{ type: "text", text: `❌ ${r.error}` }] };
        return { content: [{ type: "text", text: r.text }] };
      },
    },
    {
      name: "search_context",
      description:
        "Full-text search over compressed block summaries AND live (uncompressed) messages. " +
        "Use BEFORE decompressing to find the right block. Returns block ids and message ids you can act on.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          query: { type: "string", description: "Keyword(s); case-insensitive substring match." },
          limit: { type: "number", description: "Max results (default 5)." },
        },
        required: ["conversation_id", "query"],
      },
      handler: (a) => {
        const hits = kernel.search(a.conversation_id, a.query, a.limit ?? 5);
        if (hits.length === 0)
          return { content: [{ type: "text", text: `No hits for “${a.query}”.` }] };
        const text = hits
          .map((h) =>
            h.kind === "block"
              ? `📦 [${h.blockId}] ${h.range} tier ${h.tier} — …${h.snippet}…`
              : `[${h.msgId}] ${h.role} — …${h.snippet}…`,
          )
          .join("\n");
        return { content: [{ type: "text", text }] };
      },
    },
    {
      name: "acp_status",
      description:
        "Context usage overview for a conversation: message count, block ledger, token totals " +
        "(raw vs live view vs saved), and which ranges are still compressible. No args needed except conversation_id.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
        },
        required: ["conversation_id"],
      },
      handler: (a) => ({
        content: [{ type: "text", text: JSON.stringify(kernel.status(a.conversation_id), null, 2) }],
      }),
    },
    {
      name: "acp_view",
      description:
        "Render the current compressed view of a conversation: live messages plus folded summary blocks, in order. " +
        "Use to re-ingest a conversation into a fresh chat window without paying for the full history.",
      inputSchema: {
        type: "object",
        properties: {
          conversation_id: { type: "string" },
          max_tokens: { type: "number", description: "Optional trim budget." },
        },
        required: ["conversation_id"],
      },
      handler: (a) => ({
        content: [{ type: "text", text: kernel.renderView(a.conversation_id, a.max_tokens) }],
      }),
    },
  ];
}

export function handleRpc(kernel: Kernel, req: JsonRpcReq): any {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "context-ledger", version: "0.1.0" },
        // Injected into the host's system prompt by MCP-aware harnesses
        // (Claude Code, OpenClaw, Zed, ...): makes the model compress
        // proactively instead of waiting for the user to ask.
        instructions:
          "context-ledger is a block-ledger context compressor. As conversation history grows " +
          "(rule of thumb: >30 turns or >20k estimated tokens), proactively compress consumed " +
          "ranges with `compress` (locate ranges by from_contains/to_contains anchors; leave the " +
          "last 4 messages live), preferring self-contained summaries that preserve file paths, " +
          "signatures, errors, decisions and open objectives verbatim. Use `acp_status` to check " +
          "savings and compressible ranges, `search_context`/`decompress` to recall detail, and " +
          "`acp_view` to export a compressed view when starting a fresh conversation (rolling handoff).",
      });
    case "notifications/initialized":
      return undefined; // notification: no response
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: buildTools(kernel).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = req.params?.name;
      const tool = buildTools(kernel).find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
      try {
        const out = tool.handler(req.params?.arguments ?? {});
        const resolved = out instanceof Promise ? null : out;
        if (resolved) return rpcResult(id, resolved);
        // async: handled by caller wrapper
        return { __async: true, promise: out, id };
      } catch (e: any) {
        return rpcResult(id, {
          isError: true,
          content: [{ type: "text", text: `tool error: ${e?.message ?? String(e)}` }],
        });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${req.method}`);
  }
}
