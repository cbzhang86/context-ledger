import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Kernel, Store, estimateTokens, cmpIds } from "../kernel.js";

function tmpKernel(): Kernel {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-ledger-"));
  return new Kernel(new Store(dir));
}

test("estimateTokens counts CJK as ~1 token each and other text as chars/4", () => {
  assert.equal(estimateTokens("一二三四五"), 5);
  assert.equal(estimateTokens("abcdefgh"), 2); // 8 chars / 4
});

test("cmpIds orders message refs", () => {
  assert.ok(cmpIds("m00002", "m00010") < 0);
  assert.equal(cmpIds("m00005", "m00005"), 0);
});

test("append assigns sequential ids", () => {
  const k = tmpKernel();
  const a = k.append("c1", "user", "hello world this is a message");
  const b = k.append("c1", "assistant", "reply");
  assert.equal(a, "m00001");
  assert.equal(b, "m00002");
});

test("compress + renderView replaces the range with the summary", () => {
  const k = tmpKernel();
  for (let i = 0; i < 8; i++) k.append("c1", i % 2 ? "assistant" : "user", `msg ${i} `.repeat(20));
  const r = k.compress("c1", "m00001", "m00003", "Early discussion about msg setup.", "setup");
  assert.equal(r.error, undefined);
  assert.equal(r.block.tier, 1);
  const view = k.renderView("c1");
  assert.ok(view.includes("Early discussion"));
  assert.ok(!view.includes("msg 0 "));
  assert.ok(view.includes("m00004"));
});

test("tail guard: cannot compress the newest 4 messages", () => {
  const k = tmpKernel();
  for (let i = 0; i < 8; i++) k.append("c1", "user", `msg ${i}`);
  const r = k.compress("c1", "m00005", "m00008", "x");
  assert.match(r.error ?? "", /last 4 messages/);
});

test("resolveAnchors: from/to hits, defaults and ordering", () => {
  const k = tmpKernel();
  for (let i = 0; i < 8; i++) k.append("c1", "user", `unique marker ${i} filler text here`);
  // both anchors -> exact hits (to takes the LAST match)
  const both = k.resolveAnchors("c1", "unique marker 1", "unique marker 4");
  assert.equal(both.error, undefined);
  assert.equal(both.startId, "m00002");
  assert.equal(both.endId, "m00005");
  // only from -> start at hit, end at last live
  const onlyFrom = k.resolveAnchors("c1", "unique marker 2");
  assert.equal(onlyFrom.error, undefined);
  assert.equal(onlyFrom.startId, "m00003");
  assert.equal(onlyFrom.endId, "m00008");
  // reversed anchors -> explicit error
  const reversed = k.resolveAnchors("c1", "unique marker 4", "unique marker 1");
  assert.match(reversed.error ?? "", /out of order/);
  // miss -> error mentioning the anchor
  const miss = k.resolveAnchors("c1", "no such anchor anywhere");
  assert.match(miss.error ?? "", /from_contains not found/);
});

test("resolveAnchors ignores content inside compressed blocks", () => {
  const k = tmpKernel();
  for (let i = 0; i < 10; i++) k.append("c1", "user", `marker ${i} `.repeat(15));
  k.compress("c1", "m00001", "m00004", "Early markers folded away.");
  // marker 0 now lives only inside block b1 — must not resolve
  const r = k.resolveAnchors("c1", "marker 0 ");
  assert.match(r.error ?? "", /from_contains not found/);
});

test("compress via content anchors end-to-end", () => {
  const k = tmpKernel();
  for (let i = 0; i < 10; i++) k.append("c1", i % 2 ? "assistant" : "user", `topic alpha ${i} `.repeat(20));
  const a = k.resolveAnchors("c1", "topic alpha 0", "topic alpha 5");
  assert.equal(a.error, undefined);
  const r = k.compress("c1", a.startId, a.endId, "Alpha-topic discussion summarized.", "alpha");
  assert.equal(r.error, undefined);
  assert.equal(r.block.tier, 1);
  const view = k.renderView("c1");
  assert.ok(view.includes("Alpha-topic discussion"));
  assert.ok(!view.includes("topic alpha 0 "));
});

test("overlapping tier-1 compress is refused", () => {
  const k = tmpKernel();
  for (let i = 0; i < 10; i++) k.append("c1", "user", `msg ${i}`);
  k.compress("c1", "m00001", "m00003", "first block");
  const r = k.compress("c1", "m00002", "m00004", "overlap attempt");
  assert.match(r.error ?? "", /overlaps existing block/);
});

test("tier-2 fold: compress a range of blocks consumes them", () => {
  const k = tmpKernel();
  for (let i = 0; i < 10; i++) k.append("c1", "user", `msg ${i}`);
  k.compress("c1", "m00001", "m00002", "block A", "A");
  k.compress("c1", "m00003", "m00004", "block B", "B");
  const r = k.compress("c1", "m00001", "m00004", "A and B folded", "AB");
  assert.equal(r.error, undefined);
  assert.equal(r.block.tier, 2);
  const st = k.status("c1");
  assert.equal(st.blocks.length, 1);
  assert.equal(st.blocks[0].tier, 2);
});

test("decompress restores raw messages (tier-1 default and full)", () => {
  const k = tmpKernel();
  for (let i = 0; i < 8; i++) k.append("c1", "user", `precise detail ${i}`);
  k.compress("c1", "m00001", "m00003", "summary only text");
  // tier-1 block: default already resolves to the raw messages (no lower tier)
  const one = k.decompress("c1", "b1", false);
  assert.ok(one.text.includes("precise detail 0"));
  const full = k.decompress("c1", "b1", true);
  assert.ok(full.text.includes("precise detail 2"));
});

test("search finds blocks and live messages, not folded raw", () => {
  const k = tmpKernel();
  k.append("c1", "user", "the secret password is hunter2");
  for (let i = 0; i < 8; i++) k.append("c1", "user", `filler ${i}`);
  k.compress("c1", "m00001", "m00001", "user revealed secret password hunter2");
  const hits = k.search("c1", "hunter2");
  assert.equal(hits.length, 1); // folded raw should NOT match; only the summary block
  assert.equal(hits[0].kind, "block");
});

test("status reports savings and compressible ranges", () => {
  const k = tmpKernel();
  for (let i = 0; i < 9; i++) k.append("c1", "user", `msg ${i} `.repeat(30)); // >200 tokens total
  k.compress("c1", "m00001", "m00003", "compressed early talk");
  const st = k.status("c1");
  assert.ok(st.tokens.savedByCompression > 0);
  assert.ok(Array.isArray(st.compressibleRanges));
});
