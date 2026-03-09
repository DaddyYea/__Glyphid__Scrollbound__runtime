/**
 * bloomWorker.ts
 *
 * Off-thread semantic bloom + cluster extraction.
 * Receives packed Float64Arrays of neuron mean embeddings and importance scores,
 * computes cosine similarity, returns bloom pairs and cluster groups.
 *
 * All ArrayBuffer arguments are transferred (zero-copy) — they become detached
 * on the sending side after postMessage.
 *
 * Message protocol:
 *   { seq, op:'bloom', ids, packedMeans, importanceScores,
 *     sampleSize, bloomThreshold, clusterThreshold, clusterSampleSize }
 *
 * Response:
 *   { seq, op:'bloom', bloomPairs, clusterGroups, blooms }
 *
 * bloomPairs: Array<{ aIdx, bIdx, aMean: number[], bMean: number[] }>
 *   — indices into `ids`; means returned so main thread can call tick()
 * clusterGroups: Array<{ neuronIds: string[], weight: number }>
 *   — main thread computes centroids from live neuron state
 */

import { parentPort } from 'worker_threads';

if (!parentPort) throw new Error('bloomWorker must run as a worker thread');

const DIM = 768;

function mag(buf: Float64Array, offset: number): number {
  let s = 0;
  const end = offset + DIM;
  for (let i = offset; i < end; i++) { const v = buf[i]; s += v * v; }
  return Math.sqrt(s);
}

function dot(buf: Float64Array, oA: number, oB: number): number {
  let d = 0;
  const end = oA + DIM;
  for (let i = oA, j = oB; i < end; i++, j++) d += buf[i] * buf[j];
  return d;
}

function cosineSim(buf: Float64Array, oA: number, oB: number): number {
  const mA = mag(buf, oA);
  const mB = mag(buf, oB);
  if (mA < 1e-6 || mB < 1e-6) return 0;
  return dot(buf, oA, oB) / (mA * mB);
}

parentPort.on('message', (msg: {
  seq: number;
  op: string;
  ids: string[];
  packedMeans: Float64Array;
  importanceScores: Float64Array;
  sampleSize: number;
  bloomThreshold: number;
  clusterThreshold: number;
  clusterSampleSize: number;
}) => {
  const { seq, op, ids, packedMeans, importanceScores,
    sampleSize, bloomThreshold, clusterThreshold, clusterSampleSize } = msg;
  if (op !== 'bloom') return;

  const n = ids.length;

  // ── Semantic bloom: random pair sampling ──────────────────────────────────
  const bloomPairs: Array<{ aIdx: number; bIdx: number; aMean: number[]; bMean: number[] }> = [];
  for (let i = 0; i < sampleSize; i++) {
    let aIdx = Math.floor(Math.random() * n);
    let bIdx = Math.floor(Math.random() * (n - 1));
    if (bIdx >= aIdx) bIdx++;

    const sim = cosineSim(packedMeans, aIdx * DIM, bIdx * DIM);
    if (sim >= bloomThreshold) {
      bloomPairs.push({
        aIdx,
        bIdx,
        aMean: Array.from(packedMeans.subarray(aIdx * DIM, (aIdx + 1) * DIM)),
        bMean: Array.from(packedMeans.subarray(bIdx * DIM, (bIdx + 1) * DIM)),
      });
    }
  }

  // ── Extract clusters: top-N by importance, union-find ────────────────────
  interface ScoredNode { idx: number; score: number }
  const scored: ScoredNode[] = [];
  for (let i = 0; i < n; i++) {
    if (importanceScores[i] > 0) scored.push({ idx: i, score: importanceScores[i] });
  }
  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, clusterSampleSize);

  const clusterGroups: Array<{ neuronIds: string[]; weight: number }> = [];

  if (topN.length >= 2) {
    // Union-Find over topN indices (not neuron indices)
    const parent: number[] = Array.from({ length: topN.length }, (_, i) => i);
    const find = (x: number): number => {
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    };
    const union = (x: number, y: number) => { parent[find(x)] = find(y); };

    for (let i = 0; i < topN.length; i++) {
      const oI = topN[i].idx * DIM;
      const mI = mag(packedMeans, oI);
      if (mI < 1e-6) continue;
      for (let j = i + 1; j < topN.length; j++) {
        const oJ = topN[j].idx * DIM;
        const mJ = mag(packedMeans, oJ);
        if (mJ < 1e-6) continue;
        const d = dot(packedMeans, oI, oJ);
        if (d / (mI * mJ) >= clusterThreshold) union(i, j);
      }
    }

    // Group by root
    const groups = new Map<number, number[]>();
    for (let i = 0; i < topN.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(i);
    }

    for (const [, members] of groups) {
      if (members.length < 2) continue;
      let totalScore = 0;
      const neuronIds: string[] = [];
      for (const mi of members) {
        neuronIds.push(ids[topN[mi].idx]);
        totalScore += topN[mi].score;
      }
      clusterGroups.push({
        neuronIds,
        weight: totalScore / members.length,
      });
    }
    clusterGroups.sort((a, b) => b.weight - a.weight);
  }

  parentPort!.postMessage({ seq, op, bloomPairs, clusterGroups, blooms: bloomPairs.length });
});
