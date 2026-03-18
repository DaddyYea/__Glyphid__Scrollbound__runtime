// communion/docs/parsers/markdown.ts
// Structural parser for Markdown files.
// Produces a tree of StructuralNodes from heading hierarchy, code blocks,
// frontmatter, tables, blockquotes, and paragraph groups.

import { DocumentMap, StructuralNode, NodeType } from '../types';

function generateNodeId(docId: string, counter: { n: number }): string {
  return `${docId}:node:${counter.n++}`;
}

function detectFrontmatter(lines: string[]): { endLine: number } | null {
  if (lines.length < 2 || lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { endLine: i };
  }
  return null;
}

function headingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 0;
}

function isFencedCodeStart(line: string): boolean {
  return /^```/.test(line.trim());
}

function isTableRow(line: string): boolean {
  return /^\|.*\|/.test(line.trim());
}

function isBlockquote(line: string): boolean {
  return /^>\s?/.test(line.trim());
}

export function parseMarkdown(content: string, filename: string): DocumentMap {
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

  let cursor = 0;

  // Frontmatter
  const fm = detectFrontmatter(lines);
  if (fm) {
    root.children.push({
      id: generateNodeId(docId, counter),
      type: 'frontmatter',
      label: 'frontmatter',
      depth: 1,
      startLine: 0,
      endLine: fm.endLine,
      children: [],
    });
    cursor = fm.endLine + 1;
  }

  // Stack-based heading hierarchy
  const stack: StructuralNode[] = [root];

  function currentParent(): StructuralNode {
    return stack[stack.length - 1];
  }

  function flushParagraph(startLine: number, endLine: number): void {
    if (startLine > endLine) return;
    const text = lines.slice(startLine, endLine + 1).join('\n').trim();
    if (!text) return;
    currentParent().children.push({
      id: generateNodeId(docId, counter),
      type: 'paragraph',
      label: text.substring(0, 60) + (text.length > 60 ? '...' : ''),
      depth: stack.length,
      startLine,
      endLine,
      children: [],
    });
  }

  let paragraphStart: number | null = null;

  while (cursor < lines.length) {
    const line = lines[cursor];
    const hl = headingLevel(line);

    if (hl > 0) {
      // Flush pending paragraph
      if (paragraphStart !== null) {
        flushParagraph(paragraphStart, cursor - 1);
        paragraphStart = null;
      }

      // Pop stack to find the right parent for this heading level
      while (stack.length > 1 && (stack[stack.length - 1] as any)._headingLevel >= hl) {
        stack.pop();
      }

      const sectionType: NodeType = hl <= 2 ? 'section' : 'subsection';
      const node: StructuralNode & { _headingLevel?: number } = {
        id: generateNodeId(docId, counter),
        type: sectionType,
        label: line.replace(/^#+\s*/, '').trim(),
        depth: stack.length,
        startLine: cursor,
        endLine: cursor, // updated when next section starts or EOF
        children: [],
        _headingLevel: hl,
      };
      currentParent().children.push(node);
      stack.push(node);
      cursor++;
      continue;
    }

    // Fenced code block
    if (isFencedCodeStart(line)) {
      if (paragraphStart !== null) {
        flushParagraph(paragraphStart, cursor - 1);
        paragraphStart = null;
      }
      const codeStart = cursor;
      cursor++;
      while (cursor < lines.length && !isFencedCodeStart(lines[cursor])) cursor++;
      const codeEnd = cursor < lines.length ? cursor : cursor - 1;
      const langMatch = line.trim().match(/^```(\w+)/);
      currentParent().children.push({
        id: generateNodeId(docId, counter),
        type: 'code_block',
        label: langMatch ? `code (${langMatch[1]})` : 'code',
        depth: stack.length,
        startLine: codeStart,
        endLine: codeEnd,
        children: [],
        metadata: langMatch ? { language: langMatch[1] } : undefined,
      });
      cursor++;
      continue;
    }

    // Table
    if (isTableRow(line)) {
      if (paragraphStart !== null) {
        flushParagraph(paragraphStart, cursor - 1);
        paragraphStart = null;
      }
      const tableStart = cursor;
      while (cursor < lines.length && isTableRow(lines[cursor])) cursor++;
      currentParent().children.push({
        id: generateNodeId(docId, counter),
        type: 'table',
        label: 'table',
        depth: stack.length,
        startLine: tableStart,
        endLine: cursor - 1,
        children: [],
      });
      continue;
    }

    // Blockquote
    if (isBlockquote(line)) {
      if (paragraphStart !== null) {
        flushParagraph(paragraphStart, cursor - 1);
        paragraphStart = null;
      }
      const bqStart = cursor;
      while (cursor < lines.length && isBlockquote(lines[cursor])) cursor++;
      currentParent().children.push({
        id: generateNodeId(docId, counter),
        type: 'blockquote',
        label: 'blockquote',
        depth: stack.length,
        startLine: bqStart,
        endLine: cursor - 1,
        children: [],
      });
      continue;
    }

    // Blank line — flush paragraph
    if (line.trim() === '') {
      if (paragraphStart !== null) {
        flushParagraph(paragraphStart, cursor - 1);
        paragraphStart = null;
      }
      cursor++;
      continue;
    }

    // Regular text — accumulate paragraph
    if (paragraphStart === null) paragraphStart = cursor;
    cursor++;
  }

  // Flush final paragraph
  if (paragraphStart !== null) {
    flushParagraph(paragraphStart, lines.length - 1);
  }

  // Fix endLine for all section nodes (extend to last child or next sibling)
  function fixEndLines(node: StructuralNode): void {
    for (const child of node.children) fixEndLines(child);
    if (node.children.length > 0) {
      node.endLine = Math.max(node.endLine, node.children[node.children.length - 1].endLine);
    }
  }
  fixEndLines(root);

  // Strip internal _headingLevel from nodes
  function stripInternal(node: StructuralNode): void {
    delete (node as any)._headingLevel;
    for (const child of node.children) stripInternal(child);
  }
  stripInternal(root);

  return { docId, root, lineCount: lines.length, parsedAt: new Date().toISOString() };
}
