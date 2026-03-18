// communion/docs/parsers/plaintext.ts
// Structural parser for plain text files.
// Splits on double-newlines as section breaks. Minimal structure.

import { DocumentMap, StructuralNode } from '../types';

function generateNodeId(docId: string, counter: { n: number }): string {
  return `${docId}:node:${counter.n++}`;
}

export function parsePlaintext(content: string, filename: string): DocumentMap {
  const docId = `doc:${filename}`;
  const lines = content.split('\n');
  const counter = { n: 0 };

  const root: StructuralNode = {
    id: generateNodeId(docId, counter),
    type: 'root',
    label: filename,
    depth: 0,
    startLine: 0,
    endLine: lines.length - 1,
    children: [],
  };

  // Split into paragraphs on double-newline boundaries
  let blockStart: number | null = null;

  for (let i = 0; i <= lines.length; i++) {
    const isBlank = i === lines.length || lines[i].trim() === '';

    if (isBlank) {
      if (blockStart !== null) {
        const text = lines.slice(blockStart, i).join('\n').trim();
        if (text) {
          root.children.push({
            id: generateNodeId(docId, counter),
            type: 'paragraph',
            label: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
            depth: 1,
            startLine: blockStart,
            endLine: i - 1,
            children: [],
          });
        }
        blockStart = null;
      }
    } else if (blockStart === null) {
      blockStart = i;
    }
  }

  return { docId, root, lineCount: lines.length, parsedAt: new Date().toISOString() };
}
