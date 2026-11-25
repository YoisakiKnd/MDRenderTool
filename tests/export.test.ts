import { describe, expect, it } from 'vitest';
import { paginate } from '../src/lib/export/export-png';
import { exportStyles, inlineSvgThemeStyles, prepareAllBlocksForExport, removeExternalReferences } from '../src/lib/export/export-utils';
import type { ParsedBlock } from '../src/lib/core/protocol';

describe('export preparation', () => {
  it('fixes the chosen SVG palette and removes external resource attributes', () => {
    const svg = '<svg class="mdrt-diagram"><text>文档</text></svg>';
    const light = inlineSvgThemeStyles(svg, 'light');
    const dark = inlineSvgThemeStyles(svg, 'dark');
    expect(dark).toMatch(/--dg-node-bg:\s*#26262a/);
    expect(light).not.toContain('#26262a');
    expect(exportStyles('dark', ':host')).toMatch(/--hl-keyword:\s*#e3a1f0/);
    expect(exportStyles('light')).not.toContain('#e3a1f0');
    expect(removeExternalReferences('<a href="https://example.test">label</a><a href="#one">one</a><img src="data:image/png;base64,ABCD">'))
      .toBe('<a>label</a><a href="#one">one</a><img src="data:image/png;base64,ABCD">');
  });

  it('uses no more than four concurrent render jobs and preserves document order', async () => {
    const blocks: ParsedBlock[] = Array.from({ length: 9 }, (_, index) => ({
      index, hash: 'hash-' + index, kind: 'diagram', startLine: index + 1, endLine: index + 1,
      estimatedHeight: 42, diagram: { fenceLang: 'pie', detectedType: 'pie', source: `pie\n"total": ${index}`, sourceHash: String(index) },
    }));
    let active = 0;
    let concurrent = 0;
    const updates: number[] = [];
    const result = await prepareAllBlocksForExport(blocks, {
      render: async (source) => {
        concurrent = Math.max(concurrent, ++active);
        await Promise.resolve();
        active--;
        if (source.sourceHash === '0') return { status: 'unsupported', renderMs: 1 };
        return { status: 'ok', renderMs: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 42, height: 42 };
      },
    }, 'light', new AbortController().signal, (_message, done) => updates.push(done));
    expect(concurrent).toBe(4);
    expect(updates).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(result[0].html).toContain('<pre><code>pie');
    expect(result[8].graphic).toMatchObject({ width: 42, height: 42 });
  });

  it('stops assigning additional jobs when the caller cancels', async () => {
    const controller = new AbortController();
    const block: ParsedBlock = {
      index: 0, hash: 'hash', kind: 'diagram', startLine: 1, endLine: 1, estimatedHeight: 10,
      diagram: { fenceLang: 'pie', detectedType: 'pie', source: 'pie', sourceHash: 'test' },
    };
    let attempted = 0;
    await expect(prepareAllBlocksForExport(Array(8).fill(block), {
      render: async () => {
        attempted++;
        controller.abort();
        return { status: 'ok', renderMs: 0 };
      },
    }, 'light', controller.signal, () => undefined)).rejects.toThrow();
    expect(attempted).toBe(1);
  });

  it('paginates whole blocks and scales an oversized block into its own page', () => {
    expect(paginate([400, 500, 1_700, 600, 400], 1_000)).toEqual([
      { start: 0, end: 2, contentHeight: 900, scale: 1 },
      { start: 2, end: 3, contentHeight: 1_700, scale: 1_000 / 1_700 },
      { start: 3, end: 5, contentHeight: 1_000, scale: 1 },
    ]);
    expect(paginate([], 1_000)).toEqual([]);
  });
});
