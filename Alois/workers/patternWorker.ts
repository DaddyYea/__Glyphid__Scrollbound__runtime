/**
 * patternWorker.ts
 *
 * Off-thread scroll pattern recognition.
 * Receives a ScrollEcho[] array, runs all 7 detection pipelines,
 * returns the detected patterns.
 *
 * ScrollPatternRecognizer is stateless per call — each analyzeScrolls()
 * call is a pure transform on the input scrolls. We keep a single instance
 * alive in the worker to avoid re-initialization overhead.
 *
 * Message protocol:
 *   { seq, op:'analyze', scrolls: ScrollEcho[] }
 *
 * Response:
 *   { seq, op:'analyze', patterns: DetectedPattern[], error?: string }
 */

import { parentPort } from 'worker_threads';
import { ScrollPatternRecognizer } from '../../src/memory/scrollPatternRecognition';

if (!parentPort) throw new Error('patternWorker must run as a worker thread');

const recognizer = new ScrollPatternRecognizer();

parentPort.on('message', (msg: {
  seq: number;
  op: string;
  scrolls?: unknown[];
}) => {
  const { seq, op } = msg;
  if (op !== 'analyze') return;
  try {
    const scrolls = (msg.scrolls ?? []) as Parameters<typeof recognizer.analyzeScrolls>[0];
    const patterns = recognizer.analyzeScrolls(scrolls);
    parentPort!.postMessage({ seq, op, patterns });
  } catch (err) {
    parentPort!.postMessage({ seq, op, patterns: [], error: String(err) });
  }
});
