// communion/docs/registry.ts
// Parser registry — maps file extensions to structural parsers.

import { DocumentParser, DocumentMap } from './types';
import { parseMarkdown } from './parsers/markdown';
import { parsePlaintext } from './parsers/plaintext';

const parsers: DocumentParser[] = [];

export function registerParser(parser: DocumentParser): void {
  parsers.push(parser);
}

export function getParser(ext: string): DocumentParser | null {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return parsers.find(p => p.extensions.includes(normalized)) || null;
}

export function listParsers(): Array<{ id: string; extensions: string[] }> {
  return parsers.map(p => ({ id: p.id, extensions: p.extensions }));
}

// Register built-in parsers

registerParser({
  id: 'markdown',
  extensions: ['.md', '.markdown', '.mdx'],
  parse(content: string, filename: string): DocumentMap {
    return parseMarkdown(content, filename);
  },
});

registerParser({
  id: 'plaintext',
  extensions: ['.txt', '.text', '.log', '.csv'],
  parse(content: string, filename: string): DocumentMap {
    return parsePlaintext(content, filename);
  },
});

// Fallback: treat unknown extensions as plain text
registerParser({
  id: 'plaintext-fallback',
  extensions: ['.json', '.jsonl', '.jsonld', '.yaml', '.yml', '.toml', '.cfg', '.ini', '.env', '.sh', '.bash', '.ts', '.js', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.html', '.css', '.scss', '.xml', '.sql'],
  parse(content: string, filename: string): DocumentMap {
    return parsePlaintext(content, filename);
  },
});
