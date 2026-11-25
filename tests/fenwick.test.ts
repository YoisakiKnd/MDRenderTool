import { describe, expect, it } from 'vitest';
import { FenwickTree } from '../src/lib/core/fenwick';

describe('FenwickTree', () => {
  it('uses exclusive prefix sums and supports fractional deltas', () => {
    const tree = new FenwickTree([10.5, 20.25, 30, 40.75]);
    expect([0, 1, 2, 3, 4].map((index) => tree.prefixSum(index))).toEqual([0, 10.5, 30.75, 60.75, 101.5]);
    tree.update(1, -2.5);
    tree.update(3, 4);
    expect(tree.prefixSum(2)).toBe(28.25);
    expect(tree.totalHeight()).toBe(103);
  });

  it('selects the next nonempty block at exact boundaries', () => {
    const tree = new FenwickTree([0, 15, 0, 20, 0]);
    const offsets = [-1, 0, 14.999, 15, 34.99, 35, Infinity];
    expect(offsets.map((offset) => tree.findIndexByOffset(offset))).toEqual([1, 1, 1, 3, 3, 4, 4]);
  });

  it('supports empty trees and initialization with an item count', () => {
    const empty = new FenwickTree(0);
    expect(empty.totalHeight()).toBe(0);
    expect(empty.findIndexByOffset(30)).toBe(-1);

    const tree = new FenwickTree(6);
    tree.update(4, 42);
    expect(tree.findIndexByOffset(0)).toBe(4);
    expect(tree.findIndexByOffset(41)).toBe(4);
    expect(tree.prefixSum(5)).toBe(42);
  });

  it('rejects invalid indices, updates and heights without changing data', () => {
    const tree = new FenwickTree([5]);
    expect(() => new FenwickTree(-1)).toThrow(RangeError);
    expect(() => new FenwickTree([Infinity])).toThrow(RangeError);
    expect(() => new FenwickTree([Number.MAX_VALUE, Number.MAX_VALUE])).toThrow(RangeError);
    expect(() => tree.update(1, 2)).toThrow(RangeError);
    expect(() => tree.update(0, -6)).toThrow(RangeError);
    expect(() => tree.update(0, NaN)).toThrow(RangeError);
    expect(() => tree.prefixSum(0.5)).toThrow(RangeError);
    expect(() => tree.findIndexByOffset(NaN)).toThrow(RangeError);
    expect(tree.totalHeight()).toBe(5);
  });

  it('finds boundaries throughout 50,000 blocks after measurements change', () => {
    const heights = Float64Array.from({ length: 50_000 }, (_, index) => (index % 19) + 1);
    const tree = new FenwickTree(heights);
    for (let i = 0; i < heights.length; i += 32) {
      heights[i] += 3.5;
      tree.update(i, 3.5);
    }

    let prefix = 0;
    for (let i = 0; i < heights.length; i++) {
      if (i % 47 === 0) {
        expect(tree.prefixSum(i)).toBe(prefix);
        expect(tree.findIndexByOffset(prefix)).toBe(i);
        expect(tree.findIndexByOffset(prefix + heights[i] / 2)).toBe(i);
      }
      prefix += heights[i];
    }
    expect(tree.totalHeight()).toBe(prefix);
    expect(tree.findIndexByOffset(prefix - 0.25)).toBe(heights.length - 1);
  });
});
