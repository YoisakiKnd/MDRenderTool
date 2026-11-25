import type { ThemeMode } from '../core/protocol';
import { downloadBlob, safeFilename } from '../storage/file-io';
import { exportBlockMarkup, exportStyles, loadMathStyles, type ExportJob } from './export-utils';
import { markupPng, measurementSurface, svgToPng, yieldFrame } from './raster';

interface Page {
  start: number; end: number; contentHeight: number; scale: number;
}

export function paginate(heights: readonly number[], maxContentHeight: number): Page[] {
  const pages: Page[] = [];
  let start = 0;
  let accumulated = 0;
  for (const [index, height] of heights.entries()) {
    if (accumulated > 0 && height + accumulated > maxContentHeight) {
      pages.push({ start, end: index, contentHeight: accumulated, scale: 1 });
      start = index;
      accumulated = 0;
    }
    if (height > maxContentHeight) {
      pages.push({ start: index, end: index + 1, contentHeight: height, scale: maxContentHeight / height });
      start = index + 1;
    } else {
      accumulated += height;
    }
  }
  if (start < heights.length) pages.push({ start, end: heights.length, contentHeight: accumulated, scale: 1 });
  return pages;
}

export async function exportDiagramPng(graphic: { svg: string; width: number; height: number },
  title: string, theme: ThemeMode, dpi: 2 | 3, transparent: boolean, signal: AbortSignal): Promise<void> {
  const image = await svgToPng(graphic, theme, dpi, transparent, signal);
  downloadBlob(image, safeFilename(title, '.png'));
}

export async function exportDocument(job: ExportJob): Promise<void> {
  const { blocks, options, title, prose, signal, progress } = job;
  const width = 960;
  const padding = 34;
  const contentWidth = width - padding * 2;
  const maxContentHeight = Math.min(4_000, Math.floor(8_000 / options.dpi)) - padding * 2;
  const math = job.hasMath ? await loadMathStyles(signal) : '';
  signal.throwIfAborted();
  const surface = measurementSurface(exportStyles(options.theme, ':host') + math, prose, contentWidth);
  const markup = blocks.map((block) => exportBlockMarkup(block.html));
  const heights: number[] = [];

  try {
    for (let index = 0; index < markup.length; index++) {
      if (index % 32 === 0) {
        progress('正在测量文档', index, markup.length);
        await yieldFrame(signal);
      }
      surface.article.innerHTML = markup[index];
      if (index === 0) await document.fonts.ready;
      heights.push(Math.max(1, Math.ceil(surface.article.getBoundingClientRect().height)));
    }
  } finally { surface.close(); }

  const pages = paginate(heights, maxContentHeight);
  const css = exportStyles(options.theme, ':root') + math;
  const render = async (page: Page, index: number): Promise<Blob> => {
    progress('正在生成 PNG', index, pages.length);
    await yieldFrame(signal);
    const height = Math.max(padding * 2, Math.ceil((page.contentHeight + padding * 2) * page.scale));
    return markupPng({
      markup: markup.slice(page.start, page.end).join(''), width, height, contentWidth, contentHeight: page.contentHeight,
      scale: page.scale, css, prose, padding, dpi: options.dpi, transparent: options.transparent, signal,
    });
  };
  const basename = title.replace(/\.(?:md|markdown|txt)$/i, '');
  if (pages.length <= 1) {
    const blob = await render(pages[0] ?? { start: 0, end: 0, contentHeight: 1, scale: 1 }, 0);
    downloadBlob(blob, safeFilename(basename, '.png'));
  } else {
    const { Zip, ZipPassThrough } = await import('fflate');
    const output: BlobPart[] = [];
    let zipError: Error | undefined;
    const archive = new Zip((error, data) => {
      if (error) zipError = error;
      else output.push(new Uint8Array(data));
    });
    const digits = String(pages.length).length;
    try {
      for (const [index, page] of pages.entries()) {
        signal.throwIfAborted();
        const blob = await render(page, index);
        const entry = new ZipPassThrough('page-' + String(index + 1).padStart(Math.max(2, digits), '0') + '.png');
        archive.add(entry);
        entry.push(new Uint8Array(await blob.arrayBuffer()), true);
        if (zipError) throw zipError;
      }
      archive.end();
      if (zipError) throw zipError;
      signal.throwIfAborted();
      downloadBlob(new Blob(output, { type: 'application/zip' }), safeFilename(basename, '.zip'));
    } finally {
      archive.terminate();
    }
  }
  progress('已生成 PNG', pages.length || 1, pages.length || 1);
}
