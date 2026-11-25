import type { MarkdownIt } from 'markdown-it';
import { escapeMarkup } from '../core/escape';

export function installMathRules(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'mdrt_math', (state, silent) => {
    const start = state.pos;
    const src = state.src;
    if (src[start] !== '$' || !src[start + 1] || /[\s$]/.test(src[start + 1])) return false;
    let end = src.indexOf('$', start + 1);
    while (end > start && end < state.posMax) {
      let slash = end;
      while (slash > start && src[slash - 1] === '\\') slash--;
      if ((end - slash) % 2 === 0) break;
      end = src.indexOf('$', end + 1);
    }
    if (end < start + 2 || end >= state.posMax || /\s/.test(src[end - 1]) ||
        /[\d$]/.test(src[end + 1] ?? '') || src.slice(start + 1, end).includes('\n')) return false;
    if (!silent) state.push('math_inline', '', 0).content = src.slice(start + 1, end);
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before('fence', 'mdrt_math_block', (state, start, end, silent) => {
    const opening = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
    if (!opening.startsWith('$$') || state.sCount[start] - state.blkIndent >= 4) return false;
    const sameLine = opening.length > 4 && opening.endsWith('$$');
    let closing = start;
    if (!sameLine) {
      if (opening !== '$$') return false;
      for (closing = start + 1; closing < end; closing++) {
        if (state.src.slice(state.bMarks[closing] + state.tShift[closing], state.eMarks[closing]).trim() === '$$') break;
      }
      if (closing === end) return false;
    }
    if (silent) return true;
    const token = state.push('math_block', 'div', 0);
    token.block = true;
    token.map = [start, closing + 1];
    token.content = sameLine ? opening.slice(2, -2).trim() : state.getLines(start + 1, closing, state.blkIndent, false);
    state.line = closing + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  md.renderer.rules.math_inline = (tokens, index) => String(tokens[index].meta?.mathHtml ?? escapeMarkup(tokens[index].content));
  md.renderer.rules.math_block = (tokens, index) => String(tokens[index].meta?.mathHtml ?? escapeMarkup(tokens[index].content));
}

export async function loadMathRenderer(): Promise<(source: string, displayMode: boolean) => string> {
  const { default: katex } = await import('katex');
  return (source, displayMode) => {
    if (source.length > 16_384) return `<code>${escapeMarkup(source)}</code>`;
    try {
      return katex.renderToString(source, {
        displayMode,
        maxExpand: 250,
        maxSize: 32,
        strict: 'ignore',
        throwOnError: false,
        trust: false,
      });
    } catch {
      return `<code>${escapeMarkup(source)}</code>`;
    }
  };
}
