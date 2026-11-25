import type { FenwickTree } from './fenwick';

export interface SourceRange {
  startLine: number;
  endLine: number;
}

export function indexAtLine<T extends SourceRange>(blocks: readonly T[], line: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (blocks[middle].startLine <= line) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function offsetAtLine(blocks: readonly SourceRange[], heights: FenwickTree, line: number): number {
  if (!blocks.length) return 0;
  const index = indexAtLine(blocks, line);
  const block = blocks[index];
  const top = heights.prefixSum(index);
  const height = heights.prefixSum(index + 1) - top;
  const progress = (line - block.startLine) / Math.max(1, block.endLine - block.startLine + 1);
  return top + height * Math.max(0, Math.min(progress, 1));
}

export function lineAtOffset(blocks: readonly SourceRange[], heights: FenwickTree, offset: number): number {
  const index = heights.findIndexByOffset(offset);
  if (index < 0) return 1;
  const block = blocks[index];
  const top = heights.prefixSum(index);
  const height = heights.prefixSum(index + 1) - top;
  const progress = Math.max(0, Math.min((offset - top) / Math.max(height, 1), 1));
  return block.startLine + progress * (block.endLine - block.startLine + 1);
}

export function visibleWindow(heights: FenwickTree, scrollTop: number, viewportHeight: number): [number, number] {
  if (!heights.size) return [0, 0];
  const first = heights.findIndexByOffset(scrollTop);
  const last = heights.findIndexByOffset(scrollTop + viewportHeight);
  const start = Math.max(0, first - Math.min(10, Math.floor((59 - Math.min(59, last - first)) / 2)));
  return [start, Math.min(heights.size, start + 60, last + 11)];
}

export class ScrollSync {
  private source: 'editor' | 'preview' | undefined;
  private until = 0;

  accept(source: 'editor' | 'preview', now = performance.now()): boolean {
    if (this.source !== source && now < this.until) return false;
    this.source = source;
    this.until = now + 150;
    return true;
  }

  reset(): void {
    this.until = 0;
  }
}
