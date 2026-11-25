import MarkdownIt, { type Env, type MarkdownIt as MarkdownItInstance, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { escapeMarkup } from '../core/escape';
import { fnv1a64 } from '../core/hash';
import { LRUCache } from '../core/lru';
import type { BlockKind, FootnoteEntry, HeadingLevel, ParsedBlock, ParseResult, TocItem } from '../core/protocol';
import type { detectDiagram } from '../diagrams/detector';
import type { highlightCode } from './highlighter';
import { installMathRules, loadMathRenderer } from './math-renderer';

const diagramLanguages = new Set(['mermaid', 'plantuml', 'puml', 'uml', 'sequence', 'flowchart', 'mindmap', 'gantt', 'pie', 'er', 'class', 'state']);
const mathLanguages = new Set(['math', 'latex', 'tex']);
const fenceLanguage = (token: Token) => token.info.trim().split(/\s/, 1)[0].toLowerCase();
const encoder = new TextEncoder();

const kindByToken: Record<string, BlockKind> = {
  heading_open: 'heading',
  paragraph_open: 'paragraph',
  bullet_list_open: 'list',
  ordered_list_open: 'list',
  blockquote_open: 'blockquote',
  table_open: 'table',
  fence: 'code',
  code_block: 'code',
  math_block: 'math',
  hr: 'hr',
  footnote_block_open: 'footnote_section',
};

function createMarkdown(lex: typeof highlightCode): MarkdownItInstance {
  const md = new MarkdownIt({ html: false, linkify: true }).use(footnote as unknown as (md: MarkdownItInstance) => void);
  installMathRules(md);
  md.validateLink = (url) => /^(?:https?:\/\/|mailto:|#|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(url);
  md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    const url = String(token.attrGet('href') ?? '');
    if (!url.startsWith('#')) {
      if (/^(?:https?:\/\/|mailto:)/i.test(url)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      } else {
        token.attrSet('href', '#');
      }
    }
    return self.renderToken(tokens, index, options);
  };
  const image = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const src = String(token.attrGet('src') ?? '');
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)) {
      token.attrSet('loading', 'lazy');
      return image?.(tokens, index, options, env, self) ?? '';
    }
    return `<span class="mdrt-image-alt">${escapeMarkup(self.renderInlineAsText(token.children ?? [], options, env) || '图片')}</span>`;
  };
  const footnoteRef = md.renderer.rules.footnote_ref;
  md.renderer.rules.footnote_ref = (tokens, index, options, env, self) => {
    const id = Number(tokens[index].meta?.id) + 1;
    return (footnoteRef?.(tokens, index, options, env, self) ?? '')
      .replace('<a ', `<a data-footnote-id="${id}" `);
  };
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    if (token.meta?.mathHtml) return token.meta.mathHtml as string;
    const lang = fenceLanguage(token);
    const result = lex(token.content, lang);
    const label = result.skipped ? '<p class="code-notice">超大代码块已跳过语法高亮</p>' : '';
    return `${label}<pre><code class="language-${escapeMarkup(lang)}">${result.html}</code></pre>\n`;
  };
  md.core.ruler.after('inline', 'mdrt_tasks', (state) => {
    for (let i = 2; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== 'inline' || state.tokens[i - 1].type !== 'paragraph_open' ||
          state.tokens[i - 2].type !== 'list_item_open') continue;
      const text = token.children?.[0];
      if (text?.type !== 'text') continue;
      const task = /^\[([ xX])\]\s+/.exec(text.content);
      if (!task) continue;
      const marker = new state.Token('mdrt_task_checkbox', 'input', 0);
      marker.meta = { checked: task[1] !== ' ' };
      text.content = text.content.slice(task[0].length);
      token.children?.unshift(marker);
      state.tokens[i - 2].attrJoin('class', 'task-list-item');
    }
  });
  md.renderer.rules.mdrt_task_checkbox = (tokens, i) =>
    `<input type="checkbox" aria-label="任务状态" disabled${tokens[i].meta?.checked ? ' checked' : ''}> `;
  return md;
}

function visitTokens(tokens: Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    if (token.children) visitTokens(token.children, visit);
  }
}

function tokenizeBlocks(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  for (let start = 0; start < tokens.length;) {
    let end = start + 1;
    if (tokens[start].nesting === 1) {
      let depth: number = 1;
      while (end < tokens.length && depth > 0) depth += tokens[end++].nesting;
    }
    groups.push(tokens.slice(start, end));
    start = end;
  }
  return groups;
}

function estimatedHeight(kind: BlockKind, lineCount: number): number {
  switch (kind) {
    case 'heading': return 44;
    case 'math': return 72;
    case 'diagram': return 250;
    case 'hr': return 22;
    case 'code': return Math.min(660, 30 + 21 * lineCount);
    default: return Math.min(500, 16 + 24 * lineCount);
  }
}

export class MarkdownParser {
  private lex: typeof highlightCode | undefined;
  private detect: typeof detectDiagram | undefined;
  private readonly md = createMarkdown((source, lang) => this.lex?.(source, lang) ?? { html: escapeMarkup(source), skipped: false });
  private readonly html = new LRUCache<string, string>({ maxEntries: 2_000, maxBytes: 12 * 1024 * 1024 });
  private previousVersion: number | undefined;
  private previousHashes = new Set<string>();
  private mathRenderer: ReturnType<typeof loadMathRenderer> | undefined;

  async parse(text: string, docVersion: number, baseVersion?: number): Promise<ParseResult> {
    const started = performance.now();
    const env: Env = {};
    const normalized = text.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    const tokens = this.md.parse(normalized, env);
    const groups = tokenizeBlocks(tokens);
    const blocks: ParsedBlock[] = [];
    const hashes = new Set<string>();
    const toc: TocItem[] = [];
    const footnotes: Record<string, FootnoteEntry> = {};
    const slugs = new Set<string>();
    const slugCounts = new Map<string, number>();
    const canDiff = baseVersion !== undefined && baseVersion === this.previousVersion;
    let hasMath = false;
    const fences = tokens.filter((token) => token.type === 'fence').map(fenceLanguage);
    await Promise.all([
      !this.lex && fences.some((language) => !diagramLanguages.has(language) && !mathLanguages.has(language))
        ? import('./highlighter').then((module) => { this.lex = module.highlightCode; }).catch(() => undefined) : undefined,
      !this.detect && fences.some((language) => diagramLanguages.has(language))
        ? import('../diagrams/detector').then((module) => { this.detect = module.detectDiagram; }).catch(() => undefined) : undefined,
    ]);

    for (const group of groups) {
      const first = group[0];
      const kind = first.type === 'fence' && diagramLanguages.has(fenceLanguage(first)) ? 'diagram'
        : first.type === 'fence' && mathLanguages.has(fenceLanguage(first)) ? 'math'
          : kindByToken[first.type] ?? 'html';
      const startLine = first.map ? first.map[0] + 1 : lines.length;
      const endLine = first.map?.[1] ?? startLine;
      const index = blocks.length;
      const block: ParsedBlock = {
        index, kind, hash: '', startLine, endLine,
        estimatedHeight: estimatedHeight(kind, endLine - startLine + 1),
      };

      if (kind === 'heading') {
        const label = this.md.renderer.renderInlineAsText(group[1]?.children ?? [], this.md.options, env)
          .trim().replace(/\s+/g, ' ');
        const baseSlug = label.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '')
          .trim().replace(/\s+/g, '-') || 'section';
        let count = slugCounts.get(baseSlug) ?? 0;
        let slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
        while (slugs.has(slug)) slug = `${baseSlug}-${++count}`;
        slugs.add(slug);
        slugCounts.set(baseSlug, count + 1);
        first.attrSet('id', slug);
        block.heading = { level: Number(first.tag.slice(1)) as HeadingLevel, text: label, slug };
        toc.push({ ...block.heading, line: startLine, blockIndex: index });
      }

      const metadata: string[] = [block.heading?.slug ?? ''];
      const mathTokens: Token[] = [];
      visitTokens(group, (token) => {
        if (token.type === 'footnote_ref') metadata.push(`fn:${token.meta?.id}:${token.meta?.subId}`);
        if (token.type === 'link_open' || token.type === 'image') metadata.push(JSON.stringify(token.attrs));
        if (token.type === 'math_inline' || token.type === 'math_block' ||
            (token.type === 'fence' && mathLanguages.has(fenceLanguage(token)))) {
          mathTokens.push(token);
          hasMath = true;
        }
      });

      let raw = lines.slice(startLine - 1, endLine).join('\n');
      if (kind === 'footnote_section') {
        await this.renderMath(mathTokens);
        raw = this.md.renderer.render(group, this.md.options, env);
        this.extractFootnotes(group, footnotes, env);
      }
      const blockHash = fnv1a64(`${kind}\u0000${raw}\u0000${JSON.stringify(metadata)}`);
      block.hash = blockHash;
      hashes.add(blockHash);

      if (canDiff && this.previousHashes.has(blockHash)) {
        block.unchanged = true;
      } else if (kind === 'diagram') {
        const fenceLang = fenceLanguage(first);
        block.diagram = {
          fenceLang, detectedType: this.detect?.(fenceLang, first.content).type ?? fenceLang, source: first.content, sourceHash: fnv1a64(first.content),
        };
        block.html = '';
      } else if (kind === 'footnote_section') {
        block.html = raw;
      } else {
        const cached = this.html.get(blockHash);
        if (cached !== undefined) {
          block.html = cached;
        } else {
          if (mathTokens.length) await this.renderMath(mathTokens);
          const html = this.md.renderer.render(group, this.md.options, env);
          this.html.set(blockHash, html, encoder.encode(html).byteLength);
          block.html = html;
        }
      }
      blocks.push(block);
    }

    this.previousVersion = docVersion;
    this.previousHashes = hashes;
    let wordCount = 0;
    const words = /\p{Script=Han}|[^\s\p{Script=Han}]+/gu;
    while (words.exec(normalized)) wordCount++;
    return {
      type: 'PARSE_RESULT', docVersion, blocks, toc, footnotes, hasMath,
      stats: { wordCount, charCount: normalized.length, lineCount: lines.length, blockCount: blocks.length, parseMs: performance.now() - started },
    };
  }

  private async renderMath(tokens: Token[]): Promise<void> {
    if (!tokens.length) return;
    const render = await (this.mathRenderer ??= loadMathRenderer()).catch(() => {
      this.mathRenderer = undefined;
      return (source: string) => `<code>${escapeMarkup(source)}</code>`;
    });
    for (const token of tokens) {
      token.meta = { ...token.meta, mathHtml: render(token.content, token.type !== 'math_inline') };
    }
  }

  private extractFootnotes(tokens: Token[], entries: Record<string, FootnoteEntry>, env: Env): void {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type !== 'footnote_open') continue;
      const parts: Token[] = [];
      let line = 0;
      while (++i < tokens.length && tokens[i].type !== 'footnote_close') {
        if (tokens[i].type === 'footnote_anchor') continue;
        if (!line && tokens[i].map) line = tokens[i].map![0] + 1;
        parts.push(tokens[i]);
      }
      const id = String(Number(token.meta?.id) + 1);
      entries[id] = { id, label: id, line, html: this.md.renderer.render(parts, this.md.options, env) };
    }
  }
}
