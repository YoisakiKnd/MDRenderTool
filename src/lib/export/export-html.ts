import { escapeMarkup } from '../core/escape';
import { downloadBlob, safeFilename } from '../storage/file-io';
import { exportBlockMarkup, exportStyles, loadMathStyles, type ExportJob } from './export-utils';

export async function exportDocument(job: ExportJob): Promise<void> {
  const { title, blocks, toc, prose, options, hasMath, signal, progress } = job;
  const math = hasMath ? await loadMathStyles(signal) : '';
  signal.throwIfAborted();
  progress('正在生成 HTML', 0, 1);
  const parts = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;">`,
    '<title>', escapeMarkup(title), '</title><style>', exportStyles(options.theme), math,
    `body{margin:0 auto;padding:2rem 1rem 4rem;max-width:60rem;background:var(--background);color:var(--foreground);font-family:system-ui,sans-serif}
    .export-toc{background:var(--muted);border:1px solid var(--border);border-radius:.55rem;padding:.75rem 1rem;margin-bottom:1.4rem}
    .export-toc a{display:block;color:var(--primary);margin-block:.35em;text-decoration:none}
    summary{cursor:pointer} [id]{scroll-margin-top:1rem}
    </style></head><body>`,
  ];
  if (options.toc && toc.length) {
    parts.push('<details class="export-toc" open><summary>文档大纲</summary><nav>');
    for (const item of toc) parts.push(`<a style="padding-inline-start:${item.level - 1}rem" href="#${escapeMarkup(item.slug)}">${escapeMarkup(item.text)}</a>`);
    parts.push('</nav></details>');
  }
  parts.push(`<article class="prose" data-prose="${prose}">`);
  for (const block of blocks) parts.push(exportBlockMarkup(block.html));
  parts.push('</article></body></html>');
  signal.throwIfAborted();
  downloadBlob(new Blob(parts, { type: 'text/html;charset=utf-8' }), safeFilename(title.replace(/\.(?:md|markdown|txt)$/i, ''), '.html'));
  progress('已生成 HTML', 1, 1);
}
