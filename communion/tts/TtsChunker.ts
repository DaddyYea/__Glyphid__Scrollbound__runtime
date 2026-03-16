import { TtsChunkPolicy } from './TtsTypes';

export const DEFAULT_TTS_CHUNK_POLICY: TtsChunkPolicy = {
  firstMinChars: 55,
  minChars: 80,
  preferredChars: 180,
  maxChars: 360,
  boundaryWaitMs: 90,
  boundaryWaitMsNormal: 120,
};

interface ChunkBoundaryResult {
  chunk: string | null;
  remainder: string;
}

export class IncrementalTtsChunker {
  private buffer = '';
  private closed = false;
  private firstChunkEmitted = false;
  private readonly policy: TtsChunkPolicy;

  constructor(policy?: Partial<TtsChunkPolicy>) {
    this.policy = { ...DEFAULT_TTS_CHUNK_POLICY, ...(policy || {}) };
  }

  append(text: string): void {
    if (!text) return;
    this.buffer += text;
  }

  replaceTail(text: string): void {
    this.buffer = text || '';
  }

  close(): void {
    this.closed = true;
  }

  getState(): { bufferLength: number; closed: boolean; firstChunkEmitted: boolean } {
    return {
      bufferLength: this.buffer.length,
      closed: this.closed,
      firstChunkEmitted: this.firstChunkEmitted,
    };
  }

  drainReady(forceSpeculative = false): string[] {
    const ready: string[] = [];
    while (true) {
      const next = this.takeNext(forceSpeculative);
      if (!next) break;
      ready.push(next);
    }
    return ready;
  }

  private takeNext(forceSpeculative: boolean): string | null {
    const source = this.buffer.replace(/\r/g, '');
    if (!source.trim()) {
      this.buffer = '';
      return null;
    }

    const minChars = this.firstChunkEmitted ? this.policy.minChars : this.policy.firstMinChars;
    const preferredChars = this.policy.preferredChars;
    const maxChars = this.policy.maxChars;

    if (!this.closed && !forceSpeculative && source.trim().length < minChars) return null;

    const { chunk, remainder } = this.extractChunk(source, minChars, preferredChars, maxChars, forceSpeculative || this.closed);
    if (!chunk) return null;

    this.buffer = remainder;
    this.firstChunkEmitted = true;
    return chunk;
  }

  private extractChunk(
    source: string,
    minChars: number,
    preferredChars: number,
    maxChars: number,
    allowSpeculative: boolean,
  ): ChunkBoundaryResult {
    const trimmed = source.trimStart();
    const leadingWs = source.slice(0, source.length - trimmed.length);
    const effective = trimmed;
    if (!effective) return { chunk: null, remainder: '' };

    const boundary = this.findBoundaryIndex(effective, minChars, preferredChars, maxChars, allowSpeculative);
    if (boundary <= 0) {
      if (this.closed || allowSpeculative || effective.length >= maxChars) {
        const fallbackBoundary = Math.min(effective.length, maxChars);
        const finalBoundary = this.backtrackWhitespace(effective, fallbackBoundary, minChars);
        const chunk = effective.slice(0, finalBoundary).trim();
        const remainder = effective.slice(finalBoundary).replace(/^\s+/, '');
        return { chunk: chunk || null, remainder };
      }
      return { chunk: null, remainder: source };
    }

    const chunk = effective.slice(0, boundary).trim();
    const remainder = effective.slice(boundary).replace(/^\s+/, '');
    return { chunk: chunk || null, remainder: leadingWs ? `${leadingWs}${remainder}` : remainder };
  }

  private findBoundaryIndex(
    source: string,
    minChars: number,
    preferredChars: number,
    maxChars: number,
    allowSpeculative: boolean,
  ): number {
    const sentence = this.findLastMatchWithin(source, /[.!?]["')\]]?(?:\s+|$)/g, minChars, preferredChars);
    if (sentence > 0) return sentence;

    const paragraph = this.findLastMatchWithin(source, /\n{2,}/g, minChars, preferredChars);
    if (paragraph > 0) return paragraph;

    const clause = this.findLastMatchWithin(source, /[,;:—–-](?:\s+|$)/g, minChars, preferredChars);
    if (clause > 0 && (allowSpeculative || source.length >= preferredChars)) return clause;

    if (source.length <= maxChars && !allowSpeculative) return 0;

    return this.backtrackWhitespace(source, Math.min(source.length, maxChars), minChars);
  }

  private findLastMatchWithin(source: string, pattern: RegExp, minChars: number, maxChars: number): number {
    const clone = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = clone.exec(source)) !== null) {
      const boundary = match.index + match[0].length;
      if (boundary < minChars) continue;
      if (boundary > maxChars) break;
      last = boundary;
    }
    return last;
  }

  private backtrackWhitespace(source: string, boundary: number, minChars: number): number {
    let idx = boundary;
    while (idx > minChars && !/\s/.test(source.charAt(idx))) idx -= 1;
    return idx > minChars ? idx : Math.min(boundary, source.length);
  }
}
