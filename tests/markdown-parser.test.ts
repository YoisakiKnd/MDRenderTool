import { describe, expect, it } from 'vitest';
import { MarkdownParser } from '../src/lib/worker/markdown-parser';
import { highlightCode } from '../src/lib/worker/highlighter';
import { FenwickTree } from '../src/lib/core/fenwick';
import { lineAtOffset, offsetAtLine, ScrollSync, visibleWindow } from '../src/lib/core/scroll-sync';

describe('worker Markdown pipeline', () => {
  it('extracts mapped blocks, stable slugs, GFM tasks, and document statistics', async () => {
    const result = await new MarkdownParser().parse('# 你好\n\n- [x] Done\n\n# 你好\n\n|A|B|\n|-|-|\n|1|2|', 1);
    expect(result.blocks.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
      ['heading', 1, 1], ['list', 3, 4], ['heading', 5, 5], ['table', 7, 9],
    ]);
    expect(result.toc.map((item) => item.slug)).toEqual(['你好', '你好-1']);
    expect(result.blocks[1].html).toContain('disabled checked');
    expect(result.stats.lineCount).toBe(9);
  });

  it('produces safe markup and never fetches source images or math resources', async () => {
    const source = [
      '<script>alert(1)</script>',
      '[blocked](javascript:alert(1)) ![logo](https://example.test/logo.png)',
      'See [Example](https://example.test) and $E=mc^2$.',
      '$$\\frac{a}{b}$$',
      '$\\includegraphics{https://example.test/bad.png}$',
      '$100 is less than $200.',
    ].join('\n\n');
    const result = await new MarkdownParser().parse(source, 2);
    const html = result.blocks.map((b) => b.html).join('');
    expect(result.hasMath).toBe(true);
    expect(result.blocks.map((b) => b.kind)).toContain('math');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="mdrt-image-alt">logo');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<script|href="javascript:|<img/);
    expect(html).toContain('$100 is less than $200.');
  });

  it('diffs against the displayed base and accounts for reference changes', async () => {
    const parser = new MarkdownParser();
    await parser.parse('# heading\n\n[first][link]\n\nText[^n].\n\n[^n]: **note**\n\n[link]: https://old.test', 1);
    const result = await parser.parse('# heading\n\n[first][link]\n\nText[^n].\n\n[^n]: **note**\n\n[link]: https://new.test', 2, 1);
    expect(result.blocks[0].unchanged).toBe(true);
    expect(result.blocks[1].html).toContain('https://new.test');
    expect(result.blocks[2].unchanged).toBe(true);
    expect(result.footnotes['1']).toMatchObject({ line: 7, html: '<p><strong>note</strong></p>\n' });
    const fresh = await parser.parse('# heading', 3, 1);
    expect(fresh.blocks[0].html).toContain('<h1');
  });

  it('returns source-only metadata for a diagram and stages footnote references', async () => {
    const result = await new MarkdownParser().parse('Note[^a].\n\n```mermaid\npie\n```\n\n[^a]: Definition.', 1);
    expect(result.blocks[0].html).toContain('data-footnote-id="1"');
    expect(result.blocks[1]).toMatchObject({ kind: 'diagram', html: '', diagram: { fenceLang: 'mermaid', source: 'pie\n' } });
  });
});

describe('lightweight code lexer', () => {
  it('escapes untrusted text and tokenizes keywords, identifiers, strings and comments', () => {
    expect(highlightCode('const call = fn("<img>"); // hello', 'ts')).toEqual({
      html: '<span class="hl-keyword">const</span> call <span class="hl-operator">=</span> <span class="hl-function">fn</span><span class="hl-punctuation">(</span><span class="hl-string">&quot;&lt;img&gt;&quot;</span><span class="hl-punctuation">);</span> <span class="hl-comment">// hello</span>'.replace('>);</span>', '>)</span><span class="hl-punctuation">;</span>'),
      skipped: false,
    });
  });

  it('bypasses oversized UTF-8 or multiline blocks and escapes unknown languages', () => {
    expect(highlightCode('中'.repeat(34_000), 'js').skipped).toBe(true);
    expect(highlightCode('x\n'.repeat(2_001), 'sh').skipped).toBe(true);
    expect(highlightCode('<svg>', 'unknown').html).toBe('&lt;svg&gt;');
  });

  it('highlights SQL keywords regardless of fence language casing', () => {
    const result = highlightCode('SELECT id FROM users WHERE id = 1', 'SQL');
    expect(result.skipped).toBe(false);
    expect(result.html).toContain('<span class="hl-keyword">SELECT</span>');
    expect(result.html).toContain('<span class="hl-keyword">FROM</span>');
    expect(result.html).toContain('<span class="hl-keyword">WHERE</span>');
  });
});

describe('scroll synchronization', () => {
  it('maps source ranges to fractional offsets and vice versa', () => {
    const blocks = [{ startLine: 1, endLine: 3 }, { startLine: 5, endLine: 7 }];
    const tree = new FenwickTree([21, 30]);
    expect(offsetAtLine(blocks, tree, 6.5)).toBe(36);
    expect(lineAtOffset(blocks, tree, 36)).toBe(6.5);
  });

  it('caps the mount window even when hundreds of blocks fit on screen', () => {
    const tree = new FenwickTree(Array(30_000).fill(1));
    const [first, end] = visibleWindow(tree, 10_000, 500);
    expect(first).toBe(10_000);
    expect(end - first).toBe(60);
  });

  it('ignores feedback during a scroll lock', () => {
    const sync = new ScrollSync();
    expect(sync.accept('editor', 100)).toBe(true);
    expect(sync.accept('preview', 200)).toBe(false);
    expect(sync.accept('preview', 250)).toBe(true);
  });
});
