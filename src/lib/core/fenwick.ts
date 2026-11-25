/** A zero-based height index with exclusive prefix sums. */
export class FenwickTree {
  private readonly heights: Float64Array;
  private readonly tree: Float64Array;
  private readonly searchBit: number;

  constructor(input: number | ArrayLike<number>) {
    const size = typeof input === 'number' ? input : input.length;
    // Index arithmetic uses signed 32-bit bitwise operations.
    if (!Number.isInteger(size) || size < 0 || size > 0x7fffffff) {
      throw new RangeError('Invalid Fenwick tree size');
    }

    this.heights = new Float64Array(size);
    this.tree = new Float64Array(size + 1);
    this.searchBit = size === 0 ? 0 : 2 ** Math.floor(Math.log2(size));

    if (typeof input !== 'number') {
      for (let i = 1; i <= size; i++) {
        const height = input[i - 1];
        this.validateHeight(height);
        this.heights[i - 1] = height;
        this.tree[i] += height;
        const parent = i + (i & -i);
        if (parent <= size) this.tree[parent] += this.tree[i];
      }
      this.validateHeight(this.totalHeight());
    }
  }

  get size(): number {
    return this.heights.length;
  }

  update(index: number, delta: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError('Invalid Fenwick update index');
    }
    const height = this.heights[index] + delta;
    this.validateHeight(height);
    if (!Number.isFinite(this.totalHeight() + delta)) {
      throw new RangeError('Total height must remain finite');
    }
    this.heights[index] = height;
    for (let i = index + 1; i <= this.size; i += i & -i) this.tree[i] += delta;
  }

  prefixSum(index: number): number {
    if (!Number.isInteger(index) || index < 0 || index > this.size) {
      throw new RangeError('Invalid Fenwick prefix index');
    }

    let sum = 0;
    for (let i = index; i > 0; i -= i & -i) sum += this.tree[i];
    return sum;
  }

  totalHeight(): number {
    return this.prefixSum(this.size);
  }

  /** Find the block containing the offset. End offsets clamp to the last block. */
  findIndexByOffset(offset: number): number {
    if (Number.isNaN(offset)) throw new RangeError('Offset must be a number');
    if (this.size === 0) return -1;

    let index = 0;
    let remaining = Math.max(0, offset);
    for (let bit = this.searchBit; bit > 0; bit >>= 1) {
      const next = index + bit;
      if (next <= this.size && this.tree[next] <= remaining) {
        index = next;
        remaining -= this.tree[next];
      }
    }
    return Math.min(index, this.size - 1);
  }

  private validateHeight(height: number): void {
    if (!Number.isFinite(height) || height < 0) {
      throw new RangeError('Heights must be finite and non-negative');
    }
  }
}
