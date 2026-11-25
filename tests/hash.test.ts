import { describe, expect, it } from 'vitest';
import { fnv1a32, fnv1a64 } from '../src/lib/core/hash';

describe('FNV-1a', () => {
  it.each([
    ['', '811c9dc5', 'cbf29ce484222325'],
    ['a', 'e40c292c', 'af63dc4c8601ec8c'],
    ['foobar', 'bf9cf968', '85944171f73967e8'],
    ['hello', '4f9f2cab', 'a430d84680aabd0b'],
  ])('matches reference values for %j', (input, hex32, hex64) => {
    expect(fnv1a32(input)).toBe(hex32);
    expect(fnv1a64(input)).toBe(hex64);
  });

  it.each([fnv1a32, fnv1a64])('treats text as UTF-8 and accepts byte subviews', (hash) => {
    const bytes = Uint8Array.of(0xff, 0xe4, 0xb8, 0xad, 0xf0, 0x9f, 0x98, 0x80, 0);
    expect(hash('中😀')).toBe(hash(bytes.subarray(1, -1)));
    expect(hash('中😀')).not.toBe(hash(bytes));
    expect(hash('\ud800')).toBe(hash('\ufffd'));
    expect(hash('\0')).not.toBe(hash(''));
  });
});

it('matches reference 64-bit multiplication on binary input crossing word boundaries', () => {
  const bytes = Uint8Array.from({ length: 10_000 }, (_, index) => (Math.imul(index, 61) ^ (index >>> 5)) & 255);
  let reference = 0xcbf29ce484222325n;
  for (const byte of bytes) reference = BigInt.asUintN(64, (reference ^ BigInt(byte)) * 0x100000001b3n);
  expect(fnv1a64(bytes)).toBe(reference.toString(16).padStart(16, '0'));
});
