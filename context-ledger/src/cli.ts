#!/usr/bin/env node
/**
 * context-ledger launcher.
 *
 *   context-ledger                 -> stdio MCP server (Claude Desktop, Codex, local debugging)
 *   context-ledger --http          -> streamable HTTP on 127.0.0.1:8791  (ChatGPT desktop connector;
 *                               expose via HTTPS reverse proxy or OpenAI Secure MCP Tunnel)
 *   context-ledger --http --port N --host 0.0.0.0
 *
 * Zero dependencies. Node >= 20.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { Store, Kernel } from "./kernel.js";
import { handleRpc } from "./mcp.js";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const dataDir =
  process.env.CONTEXT_LEDGER_DATA ??
  path.join(os.homedir(), ".context-ledger");

const kernel = new Kernel(new Store(dataDir));

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

function runStdio() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      dispatch(line);
    }
  });
  process.stdin.on("end", () => process.exit(0));

  function dispatch(line: string) {
    let req: any;
    try {
      req = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const out = handleRpc(kernel, req);
    if (out && (out as any).__async) {
      (out as any).promise.then(
        (r: any) => send({ jsonrpc: "2.0", id: (out as any).id, result: r }),
        (e: any) =>
          send({
            jsonrpc: "2.0",
            id: (out as any).id,
            result: { isError: true, content: [{ type: "text", text: `tool error: ${e?.message}` }] },
          }),
      );
      return;
    }
    if (out !== undefined) send(out);
  }

  function send(obj: any) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }
  process.stderr.write(`[context-ledger] stdio MCP server ready (data: ${dataDir})\n`);
}

// ---------------------------------------------------------------------------
// streamable HTTP transport (MCP "Streamable HTTP", POST endpoint returning
// JSON or SSE; GET stream not required for tool-only servers)
// ---------------------------------------------------------------------------

/** Pending SSE responses for server->client requests (we don't initiate any; kept for spec shape). */
function runHttp(port: number, host: string) {
  // session ids per Mcp-Session-Id header
  const sessions = new Set<string>();

  const server = createServer((req, res) => {
    // CORS for browser-based clients / local tooling
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, authorization, mcp-protocol-version");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, server: "context-ledger", data: dataDir }));
      return;
    }

    if (req.method === "DELETE") {
      // client closing a session
      const sid = req.headers["mcp-session-id"];
      if (typeof sid === "string") sessions.delete(sid);
      res.writeHead(204).end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let msgs: any[];
      try {
        const parsed = JSON.parse(body);
        msgs = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
        return;
      }

      // session management: first request (initialize) creates one
      const sid = req.headers["mcp-session-id"] as string | undefined;
      const isInit = msgs.some((m) => m.method === "initialize");
      const knownSid = sid && sessions.has(sid);
      if (isInit) {
        const newSid = randomUUID();
        sessions.add(newSid);
        res.setHeader("Mcp-Session-Id", newSid);
      } else if (!knownSid) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32001, message: "session not found; re-initialize" },
          }),
        );
        return;
      }

      const wantsSse = (req.headers.accept ?? "").includes("text/event-stream");
      const responses: any[] = [];
      const promises: Promise<void>[] = [];

      for (const m of msgs) {
        const out = handleRpc(kernel, m) as any;
        if (out === undefined) continue; // notification
        if (out && out.__async) {
          promises.push(
            out.promise
              .then((r: any) => responses.push({ jsonrpc: "2.0", id: out.id, result: r }))
              .catch((e: any) =>
                responses.push({
                  jsonrpc: "2.0",
                  id: out.id,
                  result: { isError: true, content: [{ type: "text", text: `tool error: ${e?.message}` }] },
                }),
              ),
          );
        } else {
          responses.push(out);
        }
      }

      Promise.all(promises).then(() => {
        const respondJson = () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(responses.length === 1 ? responses[0] : responses));
        };
        const respondSse = () => {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          for (const r of responses) res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
          res.end();
        };
        if (wantsSse && responses.length > 0) respondSse();
        else if (responses.length === 0) {
          res.writeHead(202).end(); // notification-only batch
        } else respondJson();
      });
    });
  });

  server.listen(port, host, () => {
    process.stderr.write(
      `[context-ledger] streamable HTTP MCP server on http://${host}:${port}/  (data: ${dataDir})\n` +
        `[context-ledger] ChatGPT desktop: Developer Mode -> Plugins -> Add -> Create MCP App -> URL\n` +
        `[context-ledger] Local network exposure requires HTTPS (reverse proxy) or OpenAI Secure MCP Tunnel.\n`,
    );
  });
}

// ---------------------------------------------------------------------------

if (has("--http")) {
  runHttp(parseInt(opt("--port", "8791"), 10), opt("--host", "127.0.0.1"));
} else {
  runStdio();
}
