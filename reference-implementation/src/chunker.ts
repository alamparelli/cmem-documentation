import { Chunk, Config } from './types.js';

export class SmartChunker {
  private maxTokens: number;
  private overlap: number;
  private minSize: number;

  constructor(config: Config['chunking']) {
    this.maxTokens = config.maxTokens;
    this.overlap = config.overlapTokens;
    this.minSize = config.minChunkSize;
  }

  private estimateTokens(text: string): number {
    // Approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  chunk(content: string): Chunk[] {
    const trimmed = content.trim();

    // If short enough, no chunking needed
    if (this.estimateTokens(trimmed) <= this.maxTokens) {
      return [{ content: trimmed, index: 0, total: 1 }];
    }

    const chunks: string[] = [];

    // Try to split by paragraphs first
    const paragraphs = trimmed.split(/\n\n+/);

    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      // If single paragraph exceeds limit, split by sentences
      if (this.estimateTokens(trimmedPara) > this.maxTokens) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        chunks.push(...this.chunkBySentences(trimmedPara));
        continue;
      }

      // If adding this paragraph would exceed limit
      const combined = currentChunk + (currentChunk ? '\n\n' : '') + trimmedPara;
      if (this.estimateTokens(combined) > this.maxTokens) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        // Add overlap from previous chunk
        const overlapText = this.getOverlap(currentChunk);
        currentChunk = overlapText + trimmedPara;
      } else {
        currentChunk = combined;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    // Merge small chunks
    const merged = this.mergeSmallChunks(chunks);

    return merged.map((c, i) => ({
      content: c,
      index: i,
      total: merged.length
    }));
  }

  private chunkBySentences(text: string): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const combined = current + (current ? ' ' : '') + sentence;
      if (this.estimateTokens(combined) > this.maxTokens) {
        if (current) {
          chunks.push(current.trim());
        }
        current = sentence;
      } else {
        current = combined;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  private getOverlap(text: string): string {
    if (!text) return '';

    const words = text.split(/\s+/);
    const overlapWords = Math.floor(this.overlap / 2); // ~2 chars per word avg

    if (words.length <= overlapWords) {
      return text + '\n\n';
    }

    return words.slice(-overlapWords).join(' ') + '\n\n';
  }

  private mergeSmallChunks(chunks: string[]): string[] {
    if (chunks.length === 0) return chunks;

    const merged: string[] = [];
    let buffer = '';

    for (const chunk of chunks) {
      if (this.estimateTokens(chunk) < this.minSize) {
        buffer += (buffer ? '\n\n' : '') + chunk;
      } else {
        if (buffer) {
          // Try to merge buffer with previous or current chunk
          if (merged.length > 0 &&
              this.estimateTokens(merged[merged.length - 1] + '\n\n' + buffer) <= this.maxTokens) {
            merged[merged.length - 1] += '\n\n' + buffer;
          } else {
            merged.push(buffer + '\n\n' + chunk);
            buffer = '';
            continue;
          }
          buffer = '';
        }
        merged.push(chunk);
      }
    }

    if (buffer) {
      if (merged.length > 0) {
        merged[merged.length - 1] += '\n\n' + buffer;
      } else {
        merged.push(buffer);
      }
    }

    return merged;
  }
}
