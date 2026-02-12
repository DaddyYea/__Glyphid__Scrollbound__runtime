/**
 * JSON Array Splitter — Constant-memory streaming of top-level array elements.
 *
 * Reads a JSON file that is either:
 *   - A top-level array: [ {...}, {...}, ... ]
 *   - A wrapped object:  { "conversations": [ {...}, {...}, ... ] }
 *
 * Uses a simple state machine to track brace/bracket depth and string escapes.
 * Extracts one raw JSON substring per array element, calls JSON.parse() on just
 * that slice, then discards it. Memory usage is proportional to the largest
 * single array element, NOT the file size.
 *
 * This replaces stream-json which builds an expensive internal token
 * representation that can OOM on multi-GB files.
 */

import { createReadStream } from 'fs';

export interface SplitterOptions {
  /** Callback for each parsed array element */
  onItem: (item: any, index: number) => void;
  /** Called on non-fatal parse errors for individual items */
  onError?: (error: Error, index: number) => void;
}

/**
 * Stream a JSON file and emit each top-level array element one at a time.
 * Truly constant memory — only holds raw bytes for the current element.
 */
export function streamJsonArray(
  filePath: string,
  options: SplitterOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 256 * 1024 });

    // State machine
    let depth = 0;           // Brace/bracket nesting depth
    let inString = false;    // Currently inside a JSON string
    let escaped = false;     // Previous char was backslash
    let arrayFound = false;  // We've entered the target array
    let arrayDepth = 0;      // The depth at which the target array starts
    let collecting = false;  // Currently collecting chars for one element
    let chunks: string[] = [];  // Raw chars for current element
    let itemIndex = 0;
    let totalChars = 0;

    // For wrapped objects: skip until we find the first '[' inside the object
    // For plain arrays: the first '[' IS the target array
    let seenFirstToken = false;
    let topLevelIsObject = false;

    stream.on('data', (chunk: string) => {
      // Pause to apply backpressure while processing this chunk
      stream.pause();

      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        totalChars++;

        // Handle string state
        if (inString) {
          if (collecting) chunks.push(ch);
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\') {
            escaped = true;
            continue;
          }
          if (ch === '"') {
            inString = false;
          }
          continue;
        }

        // Skip whitespace outside strings when not collecting
        if (!collecting && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',')) {
          continue;
        }

        // Detect top-level structure
        if (!seenFirstToken && (ch === '[' || ch === '{')) {
          seenFirstToken = true;
          topLevelIsObject = ch === '{';
          depth = 1;
          if (!topLevelIsObject) {
            // Plain array — this IS our target
            arrayFound = true;
            arrayDepth = 1;
          }
          continue;
        }

        // Track structure
        if (ch === '"') {
          inString = true;
          if (collecting) chunks.push(ch);
          else if (arrayFound && depth === arrayDepth) {
            // String element in the array (rare but handle it)
            collecting = true;
            chunks = [ch];
          }
          continue;
        }

        if (ch === '{' || ch === '[') {
          depth++;

          // For wrapped objects, find the first array inside
          if (topLevelIsObject && !arrayFound && ch === '[') {
            arrayFound = true;
            arrayDepth = depth;
            continue;
          }

          // Start collecting a new element
          if (arrayFound && !collecting && depth === arrayDepth + 1) {
            collecting = true;
            chunks = [ch];
            continue;
          }

          if (collecting) chunks.push(ch);
          continue;
        }

        if (ch === '}' || ch === ']') {
          if (collecting) {
            chunks.push(ch);
            depth--;

            // Completed one element
            if (depth === arrayDepth) {
              collecting = false;
              const raw = chunks.join('');
              chunks = []; // Free memory immediately

              try {
                const parsed = JSON.parse(raw);
                options.onItem(parsed, itemIndex);
              } catch (err) {
                options.onError?.(err as Error, itemIndex);
              }
              itemIndex++;
            }
          } else {
            depth--;

            // End of target array
            if (arrayFound && depth < arrayDepth) {
              // Done — we could break here but let the stream finish naturally
              arrayFound = false;
            }
          }
          continue;
        }

        // Any other character while collecting
        if (collecting) {
          chunks.push(ch);
        }
      }

      // Resume reading next chunk
      stream.resume();
    });

    stream.on('end', () => {
      // Handle case where last element wasn't properly closed
      if (collecting && chunks.length > 0) {
        const raw = chunks.join('');
        try {
          const parsed = JSON.parse(raw);
          options.onItem(parsed, itemIndex);
          itemIndex++;
        } catch (err) {
          options.onError?.(err as Error, itemIndex);
        }
      }
      resolve(itemIndex);
    });

    stream.on('error', (err: Error) => {
      reject(new Error(`File read error: ${err.message}`));
    });
  });
}
