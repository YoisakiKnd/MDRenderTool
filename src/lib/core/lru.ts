export interface LRUOptions<K, V> {
  maxEntries: number;
  maxBytes: number;
  onEvict?: (key: K, value: V) => void;
}

interface Entry<V> {
  value: V;
  bytes: number;
}

export class LRUCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly onEvict: LRUOptions<K, V>['onEvict'];
  private bytes = 0;

  constructor({ maxEntries, maxBytes, onEvict }: LRUOptions<K, V>) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError('Cache limits must be non-negative safe integers');
    }

    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** A rejected entry remains the caller's responsibility. */
  set(key: K, value: V, bytes: number): boolean {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new RangeError('Entry size must be a non-negative safe integer');
    }
    if (this.maxEntries === 0 || bytes > this.maxBytes) return false;

    const released: Array<[K, Entry<V>]> = [];
    const previous = this.remove(key);
    if (previous && !Object.is(previous.value, value)) released.push([key, previous]);

    for (const [oldKey, entry] of this.entries) {
      if (this.entries.size < this.maxEntries && this.bytes <= this.maxBytes - bytes) break;
      this.remove(oldKey);
      released.push([oldKey, entry]);
    }

    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    this.release(released);
    return true;
  }

  delete(key: K): boolean {
    const entry = this.remove(key);
    if (!entry) return false;
    this.onEvict?.(key, entry.value);
    return true;
  }

  clear(): void {
    const released = [...this.entries];
    this.entries.clear();
    this.bytes = 0;
    this.release(released);
  }

  private remove(key: K): Entry<V> | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
    return entry;
  }

  private release(entries: Array<[K, Entry<V>]>): void {
    if (!this.onEvict) return;

    const errors: unknown[] = [];
    for (const [key, entry] of entries) {
      try {
        this.onEvict(key, entry.value);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Cache cleanup failed');
  }
}
