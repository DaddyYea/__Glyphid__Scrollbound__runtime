/**
 * brainSerializeWorker.ts
 *
 * Off-thread brain serialization / deserialization.
 *
 * Message protocol:
 *   save: { seq, op:'save', filePath: string } + transferred ArrayBuffer (v8 binary)
 *   load: { seq, op:'load', filePath: string }
 *
 * Save flow:
 *   Main thread: serialize() → v8.serialize() → transfer ArrayBuffer (zero-copy)
 *   Worker:      v8.deserialize(buf) → JSON.stringify → atomic fs write
 *   This avoids structured-clone of the large object tree and keeps JSON.stringify
 *   off the main event loop.
 *
 * Response:
 *   save: { seq, op:'save', ok: true, neuronCount, axonCount } | { ..., ok:false, error }
 *   load: { seq, op:'load', ok: true, data: object }           | { ..., ok:false, error }
 */

import { parentPort } from 'worker_threads';
import fs from 'node:fs/promises';
import { deserialize as v8Deserialize } from 'node:v8';

if (!parentPort) throw new Error('brainSerializeWorker must run as a worker thread');

parentPort.on('message', async (msg: {
  seq: number;
  op: 'save' | 'load';
  filePath?: string;
  // save: transferred ArrayBuffer containing v8-serialized brain state
  [key: string]: unknown;
}) => {
  const { seq, op } = msg;
  try {
    if (op === 'save') {
      const { filePath } = msg;
      if (!filePath) throw new Error('save requires filePath');

      // Find the transferred ArrayBuffer — it arrives as an ArrayBuffer key
      // (the key name doesn't matter, but our convention is the first ArrayBuffer value)
      let stateBuf: ArrayBuffer | undefined;
      for (const val of Object.values(msg)) {
        if (val instanceof ArrayBuffer) { stateBuf = val; break; }
      }
      if (!stateBuf) throw new Error('save requires transferred ArrayBuffer (v8 binary)');

      // v8.deserialize → JSON.stringify — both happen off the main thread
      const state = v8Deserialize(Buffer.from(stateBuf)) as Record<string, any>;
      const json = JSON.stringify(state);
      const tmpPath = `${filePath}.${Date.now()}.w.tmp`;
      await fs.writeFile(tmpPath, json, 'utf-8');
      await fs.rename(tmpPath, filePath);
      const neuronCount = Object.keys(state?.graph?.neurons ?? {}).length;
      const axonCount   = (state?.graph?.edges ?? []).length;
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
