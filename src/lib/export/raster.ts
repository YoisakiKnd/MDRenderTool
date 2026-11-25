import type { ThemeMode } from '../core/protocol';
import type { Settings } from '../storage/idb';
import { inlineSvgThemeStyles } from './export-utils';

const svgNamespace = 'http://www.w3.org/2000/svg';
const htmlNamespace = 'http://www.w3.org/1999/xhtml';

async function decodeImage(src: string, signal: AbortSignal): Promise<HTMLImageElement> {
  signal.throwIfAborted();
  const image = new Image();
  image.src = src;
  const abort = () => { image.src = ''; };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await image.decode();
    signal.throwIfAborted();
    return image;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function imageToPng(src: string, width: number, height: number, signal: AbortSignal,
  background?: string): Promise<Blob> {
  const image = await decodeImage(src, signal);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  try {
    if (canvas.width > 8_000 || canvas.height > 8_000 || canvas.width * canvas.height > 24_000_000) {
      throw new Error('画布尺寸超过安全上限。');
    }
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法创建画布。');
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    signal.throwIfAborted();
    const result = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('浏览器未能编码 PNG。')), 'image/png');
    });
    signal.throwIfAborted();
    return result;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    image.src = '';
  }
}

export async function svgToPng(
  graphic: { svg: string; width: number; height: number }, theme: ThemeMode, dpi: 2 | 3,
  transparent: boolean, signal: AbortSignal, themedAlready = false,
): Promise<Blob> {
  const { width, height } = graphic;
  const scale = Math.min(dpi, 8_000 / width, 8_000 / height, Math.sqrt(24_000_000 / (width * height)) * .995);
  const markup = themedAlready ? graphic.svg : inlineSvgThemeStyles(graphic.svg, theme);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    return await imageToPng(url, width * scale, height * scale, signal, transparent ? undefined : theme === 'dark' ? '#1d1e20' : '#faf9f6');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function markupPng(options: {
  markup: string; width: number; height: number; contentWidth: number; contentHeight: number;
  css: string; prose: Settings['prose']; scale?: number; padding?: number; dpi: 2 | 3;
  transparent: boolean; signal: AbortSignal;
}): Promise<Blob> {
  const { width, height, contentWidth, contentHeight, css, prose, padding = 0, dpi, transparent, signal, scale = 1 } = options;
  const root = document.createElementNS(svgNamespace, 'svg');
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const foreign = document.createElementNS(svgNamespace, 'foreignObject');
  foreign.setAttribute('x', String((width - (contentWidth + 2 * padding) * scale) / 2));
  foreign.setAttribute('width', String((contentWidth + 2 * padding) * scale));
  foreign.setAttribute('height', String(height));
  const inner = document.createElementNS(htmlNamespace, 'div') as HTMLDivElement;
  inner.style.cssText = 'margin:0; font-family:system-ui,sans-serif; color:var(--foreground); overflow:hidden;';
  const styles = document.createElementNS(htmlNamespace, 'style');
  styles.textContent = css;
  inner.append(styles);
  const article = document.createElementNS(htmlNamespace, 'article') as HTMLElement;
  article.className = 'prose';
  article.dataset.prose = prose;
  article.style.cssText = `width:${contentWidth + 2 * padding}px;height:${contentHeight + padding * 2}px;`
    + `padding:${padding}px;color:var(--foreground);background:${transparent ? 'transparent' : 'var(--background)'};`
    + `transform-origin:top left;transform:scale(${scale});`;
  article.innerHTML = options.markup;
  inner.append(article);
  foreign.append(inner);
  root.append(foreign);
  const resolvedBg = !transparent
    ? ([...css.matchAll(/--background\s*:\s*([^;}\n]+)/g)].pop()?.[1]?.trim() || '#ffffff')
    : undefined;
  if (resolvedBg) {
    const background = document.createElementNS(svgNamespace, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', resolvedBg);
    root.prepend(background);
  }
  const serialized = new XMLSerializer().serializeToString(root);
  const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
  return imageToPng(source, width * dpi, height * dpi, signal, resolvedBg);
}

export function measurementSurface(css: string, prose: Settings['prose'], width: number): {
  host: HTMLElement; article: HTMLElement; close: () => void;
} {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;visibility:hidden;pointer-events:none;`;
  const shadow = host.attachShadow({ mode: 'closed' });
  const article = document.createElement('article');
  article.className = 'prose';
  article.dataset.prose = prose;
  article.style.width = width + 'px';
  const styles = document.createElement('style');
  styles.textContent = css;
  shadow.append(styles, article);
  document.body.append(host);
  return { host, article, close: () => host.remove() };
}

export function yieldFrame(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => { if (signal.aborted) reject(signal.reason); else resolve(); }, 0);
  });
}
