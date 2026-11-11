/**
 * context-ledger compression kernel.
 *
 * Design borrowed from billion-context (github.com/ranxianglei/billion-context):
 *  - A per-conversation LEDGER of blocks. Compressed ranges are replaced by a
 *    summary block; the original messages are kept so they can be restored.
 *  - Summaries are ONE TIER UP: compressing already-compressed content produces
 *    a T2 summary of the T1 summary, recursively. Decompress walks back down.
 *  - The model decides WHAT to compress and writes the summary itself; the
 *    kernel only does the bookkeeping (ranges, tiers, ids, token estimates).
 *
 * Everything is zero-dependency and persisted as one JSON file per conversation.
 */
import fs from "node:fs";
import path from "node:path";
// ---------------------------------------------------------------------------
// token estimation (cheap, deterministic; no tokenizer dependency)
// ---------------------------------------------------------------------------
export function estimateTokens(text) {
    // CJK chars ≈ 1 token each; everything else ≈ chars/4 (OpenAI heuristic).
    let cjk = 0;
    for (const ch of text) {
        const c = ch.codePointAt(0);
        if ((c >= 0x4e00 && c <= 0x9fff) ||
            (c >= 0x3400 && c <= 0x4dbf) ||
            (c >= 0x3000 && c <= 0x303f) ||
            (c >= 0xff00 && c <= 0xffef)) {
            cjk++;
        }
    }
    const other = text.length - cjk;
    return cjk + Math.ceil(other / 4);
}
// ---------------------------------------------------------------------------
// id helpers
// ---------------------------------------------------------------------------
export function msgNum(id) {
    return parseInt(id.slice(1), 10);
}
export function cmpIds(a, b) {
    return msgNum(a) - msgNum(b);
}
// ---------------------------------------------------------------------------
// store (one JSON file per conversation under a data dir)
// ---------------------------------------------------------------------------
export class Store {
    dir;
    constructor(dir) {
        this.dir = dir;
        fs.mkdirSync(dir, { recursive: true });
    }
    file(id) {
        // sanitize: conversation id is used as a filename
        const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
        return path.join(this.dir, `${safe}.json`);
    }
    load(convId) {
        try {
            const raw = fs.readFileSync(this.file(convId), "utf8");
            return JSON.parse(raw);
        }
        catch {
            return {
                id: convId,
                msgs: [],
                blocks: [],
                nextBlock: 1,
                updatedAt: new Date().toISOString(),
            };
        }
    }
    save(conv) {
        conv.updatedAt = new Date().toISOString();
        const tmp = this.file(conv.id) + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(conv, null, 2), "utf8");
        fs.renameSync(tmp, this.file(conv.id));
    }
}
// ---------------------------------------------------------------------------
// kernel
// ---------------------------------------------------------------------------
export class Kernel {
    store;
    constructor(store) {
        this.store = store;
    }
    /**
     * Resolve content anchors to message ids. ChatGPT conversations don't expose
     * mNNNNN ids to the model, so it locates ranges by quoting content instead:
     *   from_contains -> first live message whose content includes the anchor
     *   to_contains   -> last  live message whose content includes the anchor
     * Only searches content that is still live (not inside any block); folded
     * raw text is gone by design. Returns null with a reason when not found.
     */
    resolveAnchors(convId, fromContains, toContains) {
        const conv = this.store.load(convId);
        if (!fromContains && !toContains)
            return { startId: "", endId: "", error: "provide start_id/end_id or from_contains/to_contains" };
        const inBlock = (m) => conv.blocks.some((b) => cmpIds(m.id, b.startId) >= 0 && cmpIds(m.id, b.endId) <= 0);
        const live = conv.msgs.filter((m) => !inBlock(m));
        let startId;
        let endId;
        if (fromContains) {
            const q = fromContains.toLowerCase();
            const hit = live.find((m) => m.content.toLowerCase().includes(q));
            if (!hit)
                return { startId: "", endId: "", error: `from_contains not found in live messages: "${fromContains.slice(0, 60)}" (it may already be inside a compressed block)` };
            startId = hit.id;
        }
        if (toContains) {
            const q = toContains.toLowerCase();
            const hit = [...live].reverse().find((m) => m.content.toLowerCase().includes(q));
            if (!hit)
                return { startId: "", endId: "", error: `to_contains not found in live messages: "${toContains.slice(0, 60)}" (it may already be inside a compressed block)` };
            endId = hit.id;
        }
        if (!startId)
            startId = live[0]?.id;
        if (!endId)
            endId = live[live.length - 1]?.id;
        if (!startId || !endId)
            return { startId: "", endId: "", error: "no live messages to anchor against" };
        if (cmpIds(startId, endId) > 0)
            return { startId: "", endId: "", error: `anchors resolved out of order: ${startId} > ${endId}; check from/to quoting` };
        return { startId, endId };
    }
    /** Append a message; returns its id. */
    append(convId, role, content) {
        const conv = this.store.load(convId);
        const id = `m${String(conv.msgs.length + 1).padStart(5, "0")}`;
        conv.msgs.push({
            id,
            role,
            tokens: estimateTokens(content),
            time: new Date().toISOString(),
            content,
        });
        this.store.save(conv);
        return id;
    }
    /**
     * Compress a range into a summary block.
     * If the range is already fully covered by tier-1 blocks, this creates a
     * tier-2 block summarizing those blocks (recursive folding).
     */
    compress(convId, startId, endId, summary, topic) {
        const conv = this.store.load(convId);
        const s = conv.msgs.find((m) => m.id === startId);
        const e = conv.msgs.find((m) => m.id === endId);
        if (!s || !e) {
            return {
                block: null,
                error: `unknown message ids: ${!s ? startId : ""} ${!e ? endId : ""}`.trim(),
            };
        }
        if (cmpIds(startId, endId) > 0) {
            return { block: null, error: "startId must be <= endId" };
        }
        // Guard: never compress away the last few live messages — the model needs
        // recent context verbatim to keep working (billion-context does the same).
        const lastNum = msgNum(conv.msgs[conv.msgs.length - 1].id);
        const tailGuard = 4;
        if (msgNum(endId) > lastNum - tailGuard) {
            return {
                block: null,
                error: `cannot compress up to ${endId}: the last ${tailGuard} messages must stay live (end at m${String(lastNum - tailGuard).padStart(5, "0")} or earlier)`,
            };
        }
        // How much of the range is already inside compressed blocks?
        const covered = conv.blocks.filter((b) => cmpIds(b.endId, startId) >= 0 && cmpIds(b.startId, endId) <= 0);
        const fullyCovered = covered.length > 0 &&
            covered.every((b) => cmpIds(b.startId, startId) >= 0) &&
            covered.some((b) => cmpIds(b.endId, endId) >= 0) &&
            covered.reduce((acc, b) => acc && cmpIds(b.startId, startId) >= 0 && cmpIds(b.endId, endId) <= 0, true);
        let tier = 1;
        let derivedFrom;
        let originalTokens = 0;
        if (fullyCovered) {
            // Tier-2 fold: summarize the summaries.
            const inner = covered.filter((b) => cmpIds(b.startId, startId) >= 0 && cmpIds(b.endId, endId) <= 0);
            tier = Math.min(3, Math.max(...inner.map((b) => b.tier)) + 1);
            derivedFrom = inner.map((b) => b.blockId).join("+");
            originalTokens = inner.reduce((a, b) => a + b.summaryTokens, 0);
            // consume the inner blocks: they are replaced by this new block
            conv.blocks = conv.blocks.filter((b) => !inner.includes(b));
        }
        else {
            // Tier-1 over raw messages. Refuse to double-compress raw content that
            // is already inside a live block (that range's raw text is gone).
            for (const b of conv.blocks) {
                const overlapsRaw = cmpIds(b.startId, endId) <= 0 && cmpIds(b.endId, startId) >= 0;
                if (overlapsRaw && b.tier === 1) {
                    return {
                        block: null,
                        error: `range overlaps existing block ${b.blockId} (${b.startId}–${b.endId}). Compress the BLOCK range instead to fold a tier up.`,
                    };
                }
            }
            originalTokens = conv.msgs
                .filter((m) => cmpIds(m.id, startId) >= 0 && cmpIds(m.id, endId) <= 0)
                .reduce((a, m) => a + m.tokens, 0);
        }
        const block = {
            blockId: `b${conv.nextBlock++}`,
            startId,
            endId,
            topic,
            summary,
            tier,
            createdAt: new Date().toISOString(),
            originalTokens,
            summaryTokens: estimateTokens(summary),
            derivedFrom,
        };
        conv.blocks.push(block);
        conv.blocks.sort((a, b) => cmpIds(a.startId, b.startId));
        this.store.save(conv);
        return { block };
    }
    /**
     * Decompress: by default expand one tier up (T2 -> its T1 children if any,
     * else raw messages). full=true restores the original raw messages.
     */
    decompress(convId, blockId, full) {
        const conv = this.store.load(convId);
        const block = conv.blocks.find((b) => b.blockId === blockId);
        if (!block)
            return { text: "", error: `unknown block ${blockId}` };
        if (full || block.tier === 1) {
            const raw = conv.msgs
                .filter((m) => cmpIds(m.id, block.startId) >= 0 && cmpIds(m.id, block.endId) <= 0)
                .map((m) => `[${m.id}] ${m.role}: ${m.content}`)
                .join("\n\n");
            return { text: raw || "(raw messages not retained)" };
        }
        // tier>=2 and not full: there are no children (they were consumed at fold
        // time), so "one tier up" means showing the block's own stored summary.
        // For tier>=2 we keep the derived-from listing so the model can decide.
        const header = `[block ${block.blockId}] ${block.startId}–${block.endId} (tier ${block.tier}${block.derivedFrom ? `, folded from ${block.derivedFrom}` : ""})`;
        return {
            text: `${header}\n\n${block.summary}\n\n(use full=true to restore the ORIGINAL raw messages of this range)`,
        };
    }
    /**
     * What the model should see as its context: raw messages outside blocks +
     * summary blocks in order. This is the "current view".
     */
    renderView(convId, limitTokens) {
        const conv = this.store.load(convId);
        const parts = [];
        let i = 0;
        const msgs = conv.msgs;
        const blocks = [...conv.blocks].sort((a, b) => cmpIds(a.startId, b.startId));
        const takeMsg = (m) => parts.push(`[${m.id}] ${m.role}: ${m.content}`);
        while (i < msgs.length) {
            const covering = blocks.find((b) => b.startId === msgs[i].id);
            if (covering) {
                parts.push(`📦 [${covering.blockId}] ${covering.startId}–${covering.endId} (${covering.topic ?? "topic"}${covering.derivedFrom ? `, folded ×${covering.tier - 1}` : ""})\n${covering.summary}`);
                // skip everything inside the block
                while (i < msgs.length && cmpIds(msgs[i].id, covering.endId) <= 0)
                    i++;
            }
            else {
                takeMsg(msgs[i]);
                i++;
            }
        }
        let view = parts.join("\n\n");
        if (limitTokens && estimateTokens(view) > limitTokens) {
            // coarse tail-trim: keep cutting parts until it fits
            while (parts.length > 1 && estimateTokens(parts.join("\n\n")) > limitTokens) {
                parts.splice(parts.length - 2, 1); // drop second-to-last (keep newest)
            }
            view = parts.join("\n\n") + "\n\n… (earlier parts trimmed; compress to persist)";
        }
        return view;
    }
    /** Case-insensitive keyword search over block summaries and live messages. */
    search(convId, query, limit = 5) {
        const conv = this.store.load(convId);
        const q = query.toLowerCase();
        const hits = [];
        for (const b of conv.blocks) {
            const idx = b.summary.toLowerCase().indexOf(q);
            if (idx >= 0) {
                hits.push({
                    kind: "block",
                    blockId: b.blockId,
                    range: `${b.startId}–${b.endId}`,
                    tier: b.tier,
                    snippet: b.summary.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, " "),
                });
            }
        }
        const inBlock = (m) => conv.blocks.some((b) => cmpIds(m.id, b.startId) >= 0 && cmpIds(m.id, b.endId) <= 0);
        for (const m of conv.msgs) {
            if (inBlock(m))
                continue; // folded content lives in its block summary
            const idx = m.content.toLowerCase().indexOf(q);
            if (idx >= 0) {
                hits.push({
                    kind: "msg",
                    msgId: m.id,
                    role: m.role,
                    snippet: m.content.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, " "),
                });
            }
        }
        return hits.slice(0, limit);
    }
    status(convId) {
        const conv = this.store.load(convId);
        const totalRaw = conv.msgs.reduce((a, m) => a + m.tokens, 0);
        const blocks = [...conv.blocks].sort((a, b) => cmpIds(a.startId, b.startId));
        const inBlocksRaw = blocks
            .filter((b) => b.tier === 1)
            .reduce((a, b) => a + b.originalTokens, 0);
        const summaryCost = blocks.reduce((a, b) => a + b.summaryTokens, 0);
        // live view = raw outside tier1 blocks + all block summaries
        const liveTokens = totalRaw - inBlocksRaw + summaryCost;
        return {
            conversation: convId,
            messages: conv.msgs.length,
            blocks: blocks.map((b) => ({
                blockId: b.blockId,
                range: `${b.startId}–${b.endId}`,
                topic: b.topic,
                tier: b.tier,
                saved: b.originalTokens - b.summaryTokens,
            })),
            tokens: {
                raw: totalRaw,
                liveView: liveTokens,
                savedByCompression: totalRaw - liveTokens,
                ratio: liveTokens > 0 ? +(totalRaw / liveTokens).toFixed(2) : 1,
            },
            compressibleRanges: findCompressible(conv),
        };
    }
}
/** Find contiguous uncompressed ranges that are old enough to compress. */
function findCompressible(conv) {
    const blocks = [...conv.blocks].sort((a, b) => cmpIds(a.startId, b.startId));
    const ranges = [];
    let cursor = 1;
    const lastNum = msgNum(conv.msgs[conv.msgs.length - 1]?.id ?? "m00000");
    const protectedFrom = lastNum - 4 + 1; // tail guard = 4
    for (const b of blocks) {
        const bStart = msgNum(b.startId);
        if (bStart > cursor) {
            const end = Math.min(bStart - 1, protectedFrom);
            if (end >= cursor) {
                const seg = conv.msgs.filter((m) => msgNum(m.id) >= cursor && msgNum(m.id) <= end);
                ranges.push({
                    startId: `m${String(cursor).padStart(5, "0")}`,
                    endId: `m${String(end).padStart(5, "0")}`,
                    tokens: seg.reduce((a, m) => a + m.tokens, 0),
                });
            }
        }
        cursor = Math.max(cursor, msgNum(b.endId) + 1);
    }
    if (cursor <= protectedFrom) {
        const seg = conv.msgs.filter((m) => msgNum(m.id) >= cursor && msgNum(m.id) <= protectedFrom);
        ranges.push({
            startId: `m${String(cursor).padStart(5, "0")}`,
            endId: `m${String(protectedFrom).padStart(5, "0")}`,
            tokens: seg.reduce((a, m) => a + m.tokens, 0),
        });
    }
    return ranges.filter((r) => r.tokens > 200);
}
