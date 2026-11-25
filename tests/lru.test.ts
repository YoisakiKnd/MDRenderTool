import { describe, expect, it, vi } from 'vitest';
import { LRUCache } from '../src/lib/core/lru';

describe('LRUCache', () => {
  it('refreshes hits and evicts the least recently used entry by count', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, string>({ maxEntries: 2, maxBytes: 20, onEvict });
    cache.set('a', 'A', 2);
    cache.set('b', 'B', 3);
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C', 4);

    expect(cache.size).toBe(2);
    expect(cache.byteSize).toBe(6);
    expect(cache.get('b')).toBeUndefined();
    expect(onEvict.mock.calls).toEqual([['b', 'B']]);
  });

  it('evicts as many entries as needed to fit the byte budget', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache({ maxEntries: 5, maxBytes: 8, onEvict });
    cache.set(1, 'A', 2);
    cache.set(2, 'B', 2);
    cache.set(3, 'C', 2);
    cache.set(4, 'D', 6);

    expect(cache.byteSize).toBe(8);
    expect(cache.size).toBe(2);
    expect(onEvict.mock.calls).toEqual([[1, 'A'], [2, 'B']]);
  });

  it('accounts for overwrites, explicit removals and clear', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, string>({ maxEntries: 2, maxBytes: 5, onEvict });
    cache.set('a', 'A', 3);
    cache.set('b', 'B', 2);
    cache.set('a', 'A', 2);
    expect(cache.byteSize).toBe(4);
    expect(onEvict).not.toHaveBeenCalled();

    cache.set('a', 'C', 2);
    expect(cache.delete('b')).toBe(true);
    expect(cache.delete('b')).toBe(false);
    cache.clear();
    expect(cache.byteSize).toBe(0);
    expect(cache.size).toBe(0);
    expect(onEvict.mock.calls).toEqual([['a', 'A'], ['b', 'B'], ['a', 'C']]);
  });

  it('rejects oversized entries while leaving existing entries and recency intact', () => {
    const cache = new LRUCache({ maxEntries: 2, maxBytes: 2 });
    cache.set('a', 'A', 1);
    cache.set('b', 'B', 1);
    expect(cache.set('a', 'oversized', 3)).toBe(false);
    cache.set('c', 'C', 1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('B');
  });

  it('honors zero capacities and validates limits and entry sizes', () => {
    expect(new LRUCache({ maxEntries: 0, maxBytes: 10 }).set('a', null, 0)).toBe(false);
    const cache = new LRUCache({ maxEntries: 1, maxBytes: 0 });
    expect(cache.set('a', null, 1)).toBe(false);
    expect(cache.set('a', null, 0)).toBe(true);
    expect(() => cache.set('b', null, NaN)).toThrow(RangeError);
    expect(() => new LRUCache({ maxEntries: 1.2, maxBytes: 10 })).toThrow(RangeError);
    expect(() => new LRUCache({ maxEntries: 1, maxBytes: Infinity })).toThrow(RangeError);
  });

  it('keeps bounds and runs all cleanup callbacks when one callback throws', () => {
    const onEvict = vi.fn((key: number) => {
      if (key === 1) throw new Error('cleanup failed');
    });
    const cache = new LRUCache({ maxEntries: 3, maxBytes: 2, onEvict });
    cache.set(1, 'A', 1);
    cache.set(2, 'B', 1);

    expect(() => cache.set(3, 'C', 2)).toThrow(AggregateError);
    expect(onEvict.mock.calls).toEqual([[1, 'A'], [2, 'B']]);
    expect(cache.get(3)).toBe('C');
    expect(cache.byteSize).toBe(2);
  });
});
