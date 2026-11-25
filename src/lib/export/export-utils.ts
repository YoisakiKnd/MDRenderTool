import { escapeMarkup } from '../core/escape';
import type { FootnoteEntry, ParsedBlock, ThemeMode, TocItem } from '../core/protocol';
import type { DiagramClient } from '../diagrams/client';
import type { Settings } from '../storage/idb';
import themeCss from '../../styles/theme.css?inline';
import proseCss from '../../styles/prose.css?inline';
import highlightCss from '../../styles/highlight.css?inline';

export type ExportFormat = 'html' | 'pdf' | 'png' | 'docx';
export interface ExportOptions {
  format: ExportFormat;
  theme: ThemeMode;
  dpi: 2 | 3;
  toc: boolean;
  transparent: boolean;
}
export interface ExportDocument {
  title: string;
  blocks: ParsedBlock[];
  toc: TocItem[];
  footnotes: Record<string, FootnoteEntry>;
  prose: Settings['prose'];
  hasMath: boolean;
}
export interface PreparedBlock extends ParsedBlock {
  html: string;
  graphic?: { svg: string; width: number; height: number };
}
export interface ExportJob extends Omit<ExportDocument, 'blocks'> {
  blocks: PreparedBlock[];
  options: ExportOptions;
  signal: AbortSignal;
  progress: (message: string, done: number, total: number) => void;
}

const getDeclarations = (theme: ThemeMode): string => {
  const light = /:root\s*\{([^}]+)\}/.exec(themeCss)?.[1] ?? '';
  return light + (theme === 'dark' ? /:root\.dark\s*\{([^}]+)\}/.exec(themeCss)?.[1] ?? '' : '');
};

export function inlineSvgThemeStyles(svg: string, theme: ThemeMode): string {
  const variables = getDeclarations(theme).match(/--dg-[\w-]+\s*:[^;]+;/g)?.join('') ?? '';
  return svg.replace(/^(<svg\b[^>]*>)/, '$1<style>svg{' + variables + '}</style>');
}

export async function prepareAllBlocksForExport(
  blocks: ParsedBlock[], diagrams: Pick<DiagramClient, 'render'>, theme: ThemeMode, signal: AbortSignal,
  progress: ExportJob['progress'], concurrency = 4,
): Promise<PreparedBlock[]> {
  signal.throwIfAborted();
  const prepared = blocks.map((block): PreparedBlock => ({ ...block, html: block.html ?? '' }));
  const targets = prepared.filter((block) => block.diagram);
  let next = 0;
  let done = 0;
  if (targets.length) progress('正在渲染图表', 0, targets.length);
  async function render(): Promise<void> {
    while (next < targets.length) {
      signal.throwIfAborted();
      const block = targets[next++];
      const source = block.diagram!;
      const diagram = await diagrams.render(source, theme, signal);
      signal.throwIfAborted();
      if (diagram.status === 'ok' && diagram.svg && diagram.width && diagram.height) {
        const svg = inlineSvgThemeStyles(diagram.svg, theme);
        block.graphic = { svg, width: diagram.width, height: diagram.height };
        block.html = svg;
      } else {
        block.html = `<p>${escapeMarkup(diagram.reason ?? '图表无法渲染')}</p><pre><code>${escapeMarkup(source.source)}</code></pre>`;
      }
      progress('正在渲染图表', ++done, targets.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, render));
  return prepared;
}

export function removeExternalReferences(html: string): string {
  return html.replace(/\s(href|src)="([^"]*)"/gi, (attribute, key: string, value: string) =>
    value.startsWith('#') || (key.toLowerCase() === 'src' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) ? attribute : '');
}

const localStyles = `
.prose {box-sizing:border-box; font-size:16px; margin:0;}
.prose .mdrt-diagram {display:block; margin-inline:auto;}
.prose :where(img, .mdrt-diagram) {max-width:100%; height:auto;}
.prose pre {white-space:pre-wrap; overflow-wrap:anywhere;}
.prose table {width:auto; max-width:100%;}
.prose .task-list-item {list-style:none;}
.prose .code-notice,.prose .mdrt-image-alt {color:var(--muted-foreground);}
.prose .katex-display {max-width:100%; overflow:hidden;}
.export-block {display:flow-root; margin:0; padding:.25em 0; box-sizing:border-box;}
.export-block:has(> :first-child:last-child) > :only-child:not(hr) {margin-block:0;}
`;

export function exportStyles(theme: ThemeMode, scope = ':root'): string {
  const unwanted = theme === 'dark' ? /:root\s*\{[^}]+\}/ : /:root\.dark\s*\{[^}]+\}/;
  const palette = highlightCss.replace(unwanted, '').replace(/:root(?:\.dark)?/g, scope);
  return `${scope}{${getDeclarations(theme)}}\n${proseCss}\n${palette}\n${localStyles}`;
}

export function exportBlockMarkup(html: string): string {
  return '<div class="export-block">' + removeExternalReferences(html) + '</div>';
}

const fontsAsData = new Map<string, Promise<string>>();

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

export async function loadMathStyles(signal: AbortSignal): Promise<string> {
  await import('katex/dist/katex.min.css');
  signal.throwIfAborted();
  const sheet = [...document.styleSheets].find((candidate) =>
    /(?:vendor-katex|katex\.min\.css)/i.test(candidate.href ?? '') ||
    (candidate.ownerNode instanceof HTMLElement && /katex.*\.css/.test(candidate.ownerNode.dataset.viteDevId ?? '')));
  if (!sheet) return '.katex-html{display:none} .katex-mathml{display:initial}';
  const css = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  const source = sheet.href ?? document.baseURI;
  const urls = [...new Set([...css.matchAll(/url\(["']?([^)"']+)["']?\)/g)].map((match) => match[1]))];
  let resolved = css;
  for (const url of urls) {
    signal.throwIfAborted();
    const address = new URL(url, source);
    if (address.origin !== location.origin) {
      resolved = resolved.replaceAll(url, '');
      continue;
    }
    let pending = fontsAsData.get(address.href);
    if (!pending) {
      if (fontsAsData.size >= 24) fontsAsData.delete(fontsAsData.keys().next().value!);
      pending = fetch(address).then((response) => {
        if (!response.ok) throw new Error('Formula font did not load');
        return response.blob();
      }).then(dataUrl).catch((error: unknown) => {
        fontsAsData.delete(address.href);
        throw error;
      });
      fontsAsData.set(address.href, pending);
    }
    try {
      const data = await pending;
      resolved = resolved.replaceAll(url, data);
    } catch {
      // Each locally available face remains embedded. The browser can draw MathML when files are unavailable offline.
      return '.katex-html{display:none} .katex-mathml{display:initial}';
    }
  }
  return resolved;
}
