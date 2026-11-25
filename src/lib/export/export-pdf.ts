import printCss from '../../styles/print.css?inline';
import { exportBlockMarkup, exportStyles, loadMathStyles, type ExportJob } from './export-utils';

export async function exportDocument(job: ExportJob): Promise<void> {
  const { title, blocks, prose, signal, options, progress } = job;
  const math = job.hasMath ? await loadMathStyles(signal) : '';
  signal.throwIfAborted();
  progress('正在准备打印页面', 0, 1);
  const root = document.createElement('article');
  root.id = 'mdrt-print-root';
  root.className = 'prose';
  root.dataset.prose = prose;
  root.innerHTML = blocks.map((block) => exportBlockMarkup(block.html)).join('');
  const css = document.createElement('style');
  css.textContent = exportStyles(options.theme, '#mdrt-print-root') + math + printCss
    + (options.theme === 'light' ? '@media print{#mdrt-print-root{background:white}}' : '');
  document.head.append(css);
  document.body.append(root);
  const previousTitle = document.title;
  document.title = title;
  progress('等待打印完成', 1, 1);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('afterprint', finished);
      signal.removeEventListener('abort', cancelled);
      root.remove();
      css.remove();
      document.title = previousTitle;
    };
    const finished = () => { cleanup(); resolve(); };
    const cancelled = () => { cleanup(); reject(signal.reason); };
    window.addEventListener('afterprint', finished, { once: true });
    signal.addEventListener('abort', cancelled, { once: true });
    try { window.print(); }
    catch (error) { cleanup(); reject(error); }
  });
}
