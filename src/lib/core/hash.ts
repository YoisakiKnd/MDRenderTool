const encoder = new TextEncoder();

/** FNV-1a over UTF-8 bytes, as eight lowercase hexadecimal digits. */
export function fnv1a32(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** FNV-1a over UTF-8 bytes, as sixteen lowercase hexadecimal digits. */
export function fnv1a64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let low = 0x84222325;
  let high = 0xcbf29ce4;
  for (let i = 0; i < bytes.length; i++) {
    // The 64-bit prime is 0x100_000001b3. The low product fits exactly in a double.
    const mixedLow = (low ^ bytes[i]) >>> 0;
    const product = mixedLow * 0x1b3;
    const carry = Math.floor(product / 0x1_0000_0000);
    high = (Math.imul(high, 0x1b3) + Math.imul(mixedLow, 0x100) + carry) >>> 0;
    low = product >>> 0;
  }
  return high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
}
