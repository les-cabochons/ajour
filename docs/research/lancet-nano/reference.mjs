// Research only. Commands are inert strings. Model files live outside this repo.
// Runtime algorithm adapted from Tanner Middleton's MIT-licensed classify.py.
// Copyright (c) 2026 Tanner Middleton. Preserve bundle/licenses/pi-jev-guard-MIT.txt.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const [scratch, fixturePath, outputPath] = process.argv.slice(2);
const require = createRequire(path.join(scratch, "package.json"));
const ort = require("onnxruntime-web");
ort.env.wasm.numThreads = 1;
const dir = path.join(scratch, "bundle/model");
const json = (name) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const meta = json("model.json"),
  vocab = json("vocab.json"),
  descriptor = json("head.json");
const bin = fs.readFileSync(path.join(dir, "head.bin"));
const head = Object.fromEntries(
  descriptor.tensors.map((t) => [
    t.name,
    Array.from({ length: t.bytes / 4 }, (_, i) =>
      bin.readFloatLE(t.offset + i * 4),
    ),
  ]),
);
const ranks = new Map(
  fs
    .readFileSync(path.join(dir, "merges.txt"), "utf8")
    .split(/\r?\n/)
    .filter((x) => x && !x.startsWith("#"))
    .map((x, i) => [x, i]),
);
const bytes = [...Array(94)]
  .map((_, i) => i + 33)
  .concat(
    [...Array(12)].map((_, i) => i + 161),
    [...Array(82)].map((_, i) => i + 174),
  );
const chars = [...bytes];
let extra = 0;
for (let b = 0; b < 256; b++)
  if (!bytes.includes(b)) {
    bytes.push(b);
    chars.push(256 + extra++);
  }
const byteMap = new Map(
  bytes.map((b, i) => [b, String.fromCharCode(chars[i])]),
);
const cache = new Map();
function bpe(word) {
  if (cache.has(word)) return cache.get(word);
  let parts = [...word];
  while (parts.length > 1) {
    let best = Infinity,
      pair;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i] + " " + parts[i + 1],
        rank = ranks.get(p);
      if (rank < best) {
        best = rank;
        pair = p;
      }
    }
    if (pair === undefined) break;
    const next = [];
    for (let i = 0; i < parts.length; i++) {
      if (i + 1 < parts.length && parts[i] + " " + parts[i + 1] === pair) {
        next.push(parts[i] + parts[++i]);
      } else next.push(parts[i]);
    }
    parts = next;
  }
  const ids = parts.map((p) => {
    if (vocab[p] === undefined) throw Error("unknown BPE");
    return vocab[p];
  });
  cache.set(word, ids);
  return ids;
}
function tokenize(command) {
  const chunks =
    command.match(
      /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu,
    ) || [];
  return chunks.flatMap((c) =>
    bpe(Array.from(Buffer.from(c, "utf8"), (b) => byteMap.get(b)).join("")),
  );
}
function linear(weight, x, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    let s = 0;
    for (let c = 0; c < x.length; c++) s += weight[r * x.length + c] * x[c];
    out.push(s);
  }
  return out;
}
const initialMemory = process.memoryUsage();
const start = performance.now();
const session = await ort.InferenceSession.create(
  new Uint8Array(fs.readFileSync(path.join(dir, "encoder-int8.onnx"))),
  { executionProviders: ["wasm"], graphOptimizationLevel: "all" },
);
const loadMs = performance.now() - start;
async function score(command, shell) {
  const reason = !meta.supportedShells.includes(shell)
    ? "unsupported-shell"
    : typeof command !== "string"
      ? "command-not-string"
      : !command.trim()
        ? "empty-command"
        : command.includes("\0")
          ? "nul-byte"
          : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
                command,
              )
            ? "invalid-unicode"
            : Buffer.byteLength(command) > 8192
              ? "raw-input-too-long"
              : null;
  if (reason) return { classification: "review", score: null, reason };
  const ids = tokenize(command),
    total = new Float64Array(768),
    maximum = new Float64Array(768).fill(-Infinity);
  let from = 0,
    previousEnd = 0,
    windows = 0;
  while (from < ids.length) {
    const end = Math.min(ids.length, from + 510),
      framed = [1, ...ids.slice(from, end), 2];
    const outputs = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(framed, BigInt), [
        1,
        framed.length,
      ]),
      attention_mask: new ort.Tensor(
        "int64",
        new BigInt64Array(framed.length).fill(1n),
        [1, framed.length],
      ),
    });
    const hidden = outputs[session.outputNames[0]].data;
    for (let t = Math.max(from, previousEnd); t < end; t++)
      for (let h = 0; h < 768; h++) {
        const v = hidden[(t - from + 1) * 768 + h];
        total[h] += v;
        maximum[h] = Math.max(maximum[h], v);
      }
    windows++;
    if (end === ids.length) break;
    previousEnd = end;
    from = end - 64;
  }
  const pooled = [...total].map((v) => v / ids.length).concat([...maximum]);
  let z = linear(head.projection, pooled, 768);
  const mean = z.reduce((a, b) => a + b, 0) / 768,
    variance = z.reduce((a, b) => a + (b - mean) ** 2, 0) / 768;
  z = z.map(
    (v, i) =>
      ((v - mean) / Math.sqrt(variance + descriptor.normEps)) *
        head.norm_weight[i] +
      head.norm_bias[i],
  );
  const logits = linear(head.head_weight, z, 2).map(
    (v, i) => v + head.head_bias[i],
  );
  if (!logits.every(Number.isFinite)) throw Error("nonfinite-model-output");
  const risk = logits[0],
    score =
      1 /
      (1 + Math.exp(-(meta.calibration.scale * risk + meta.calibration.bias)));
  return {
    score,
    riskLogit: risk,
    classification:
      risk >= meta.riskyLogitThreshold
        ? "risky"
        : risk >= meta.reviewLogitThreshold
          ? "review"
          : "not_flagged",
    tokens: ids.length,
    windows,
    ids,
    ...(command === "git status" || windows > 1 ? { pooled } : {}),
  };
}
const rows = JSON.parse(fs.readFileSync(fixturePath, "utf8")),
  results = [];
for (const row of rows) {
  const t = performance.now();
  const result = await score(row.command, row.shell);
  results.push({ ...row, ...result, ms: performance.now() - t });
}
const warm = [];
for (let i = 0; i < 40; i++) {
  const row = rows[i % rows.length],
    t = performance.now();
  await score(row.command, row.shell);
  warm.push(performance.now() - t);
}
fs.writeFileSync(
  outputPath,
  JSON.stringify(
    {
      loadMs,
      initialMemory,
      finalMemory: process.memoryUsage(),
      resourceUsage: process.resourceUsage(),
      warm,
      versions: process.versions,
      results,
    },
    null,
    2,
  ),
);
await session.release();
