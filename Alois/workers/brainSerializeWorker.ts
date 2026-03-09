/**
 * brainSerializeWorker.ts
 *
 * Off-thread brain serialization / deserialization.
 * Handles JSON.stringify (save) and JSON.parse (load) off the main event loop.
 *
 * Message protocol:
 *   save: { seq, op:'save', state: object, filePath: string }
 *   load: { seq, op:'load', filePath: string }
 *
 * Response:
 *   save: { seq, op:'save', ok: true, neuronCount, axonCount } | { seq, op:'save', ok:false, error }
 *   load: { seq, op:'load', ok: true, data: object } | { seq, op:'load', ok:false, error }
 */

import { parentPort } from 'worker_threads';
import fs from 'node:fs/promises';

if (!parentPort) throw new Error('brainSerializeWorker must run as a worker thread');

parentPort.on('message', async (msg: {
  seq: number;
  op: 'save' | 'load';
  state?: Record<string, unknown>;
  filePath?: string;
}) => {
  const { seq, op } = msg;
  try {
    if (op === 'save') {
      const { state, filePath } = msg;
      if (!state || !filePath) throw new Error('save requires state and filePath');
      const json = JSON.stringify(state);
      const tmpPath = `${filePath}.${Date.now()}.w.tmp`;
      await fs.writeFile(tmpPath, json, 'utf-8');
      await fs.rename(tmpPath, filePath);
      const neuronCount = Object.keys((state as any)?.graph?.neurons ?? {}).length;
      const axonCount = ((state as any)?.graph?.edges ?? []).length;
      parentPort!.postMessage({ seq, op, ok: true, neuronCount, axonCount });

    } else if (op === 'load') {
      const { filePath } = msg;
      if (!filePath) throw new Error('load requires filePath');
      const raw = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(raw);
      parentPort!.postMessage({ seq, op, ok: true, data });

    } else {
      parentPort!.postMessage({ seq, op, ok: false, error: `Unknown op: ${op}` });
    }
  } catch (err) {
    parentPort!.postMessage({ seq, op, ok: false, error: String(err) });
  }
});
