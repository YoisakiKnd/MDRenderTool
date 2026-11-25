import type { ILevelsOptions, IParagraphOptions, IRunStylePropertiesOptions, Paragraph, ParagraphChild, Table } from 'docx';
import { downloadBlob, safeFilename } from '../storage/file-io';
import { exportStyles, loadMathStyles, type ExportJob } from './export-utils';
import { imageToPng, markupPng, measurementSurface, svgToPng, yieldFrame } from './raster';

type WordBlock = Paragraph | Table;
type InlineStyle = IRunStylePropertiesOptions & { preserve?: boolean };
type DocxApi = typeof import('docx');
const maxImageWidth = 595;

function nodesFrom(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  const wrapper = document.createElement('div');
  wrapper.append(template.content);
  return wrapper;
}

class WordWriter {
  private listId = 0;
  readonly numbering: Array<{ reference: string; levels: ILevelsOptions[] }> = [];
  private readonly colors: Record<string, string>;

  constructor(private readonly word: DocxApi, private readonly job: ExportJob, private readonly css: string) {
    this.colors = Object.fromEntries([...css.matchAll(/--hl-([\w-]+):\s*#([\da-f]{6})/gi)].map((entry) => [entry[1], entry[2].toUpperCase()]));
  }

  async blocks(nodes: NodeListOf<ChildNode> | ChildNode[], depth = 0, quote = false): Promise<WordBlock[]> {
    const { Paragraph, Table, TableCell, TableRow, BorderStyle, HeadingLevel, WidthType, AlignmentType, Bookmark, TextRun } = this.word;
    const output: WordBlock[] = [];
    const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
    const common: IParagraphOptions = quote ? {
      indent: { left: 330 }, border: { left: { style: BorderStyle.SINGLE, size: 16, color: '4F72A5', space: 10 } },
      shading: { fill: 'F3F5F8' }, spacing: { before: 65, after: 65 },
    } : { spacing: { after: 110 } };

    for (const node of nodes) {
      this.job.signal.throwIfAborted();
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
      if (!(node instanceof Element)) {
        output.push(new Paragraph({ ...common, children: await this.inline([node]) }));
        continue;
      }
      const tag = node.localName;
      if (/^h[1-6]$/.test(tag)) {
        let children = await this.inline(node.childNodes);
        const id = node.getAttribute('id');
        if (id) children = [new Bookmark({ id: this.anchor(id), children })];
        output.push(new Paragraph({ ...common, heading: levels[Number(tag[1]) - 1], keepNext: true, children }));
      } else if (tag === 'pre') {
        output.push(new Paragraph({
          spacing: { before: 80, after: 105 }, shading: { fill: 'F1F3F6' },
          border: { left: { style: BorderStyle.SINGLE, size: 10, color: 'D4D9E1', space: 6 } },
          children: await this.inline(node.childNodes, { preserve: true, font: 'Consolas', size: 18 }),
        }));
      } else if (tag === 'blockquote') {
        output.push(...await this.blocks(node.childNodes, depth, true));
      } else if (tag === 'ol' || tag === 'ul') {
        output.push(...await this.list(node, depth));
      } else if (tag === 'table') {
        const rows: InstanceType<typeof TableRow>[] = [];
        for (const row of node.querySelectorAll('tr')) {
          const header = row.parentElement?.localName === 'thead';
          const cells: InstanceType<typeof TableCell>[] = [];
          for (const cell of row.children) {
            const align = (cell as HTMLElement).style.textAlign;
            cells.push(new TableCell({
              margins: { top: 85, bottom: 85, left: 105, right: 105 },
              shading: header ? { fill: 'ECEFF3' } : undefined,
              children: [new Paragraph({
                alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
                children: await this.inline(cell.childNodes, { bold: header }),
              })],
            }));
          }
          rows.push(new TableRow({ children: cells, tableHeader: header, cantSplit: true }));
        }
        if (rows.length) {
          const border = { color: 'CED4DF', size: 5, style: BorderStyle.SINGLE };
          output.push(new Table({
            rows, width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
          }));
        }
      } else if (tag === 'hr') {
        output.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: 'CCD2DD' } }, spacing: { after: 95 } }));
      } else if (!node.classList.contains('footnotes')) {
        const displayMath = node.classList.contains('katex-display');
        output.push(new Paragraph({
          ...common,
          alignment: displayMath ? AlignmentType.CENTER : undefined,
          children: tag === 'p' ? await this.inline(node.childNodes) : await this.inline([node]),
        }));
      }
    }
    return output.length ? output : [new Paragraph({ children: [new TextRun('')] })];
  }

  private anchor(value: string): string {
    let index = this.job.toc.findIndex((item) => item.slug === value);
    if (index === -1) index = this.job.toc.findIndex((item) => encodeURIComponent(item.slug) === value);
    return index < 0 ? '' : 'mdrt_heading_' + index;
  }

  private async list(element: Element, depth: number): Promise<WordBlock[]> {
    const { Paragraph, LevelFormat, TextRun } = this.word;
    const reference = 'list_' + this.listId++;
    const ordered = element.localName === 'ol';
    const level = Math.min(8, depth);
    const start = Number(element.getAttribute('start') ?? '1');
    this.numbering.push({
      reference,
      levels: Array.from({ length: 9 }, (_, index) => ({
        level: index, format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
        text: ordered ? `%${index + 1}.` : index % 2 ? '◦' : '•',
        start: index === level && Number.isInteger(start) ? start : 1,
        style: { paragraph: { indent: { left: 360 + 315 * index, hanging: 250 } } },
      })),
    });
    const output: WordBlock[] = [];
    for (const item of element.children) {
      if (item.localName !== 'li') continue;
      let line: ParagraphChild[] = [];
      let first = true;
      const row = () => {
        if (!line.length && !first) return;
        output.push(new Paragraph({
          numbering: first ? { reference, level } : undefined,
          indent: first ? undefined : { left: 360 + 315 * level },
          children: line.length ? line : [new TextRun('')],
          spacing: { after: 55 },
        }));
        line = [];
        first = false;
      };
      for (const node of item.childNodes) {
        if (node instanceof Element && (node.localName === 'ul' || node.localName === 'ol')) {
          if (first || line.length) row();
          output.push(...await this.list(node, depth + 1));
        } else if (node instanceof Element && node.localName === 'p') {
          if (line.length) row();
          line.push(...await this.inline(node.childNodes));
          row();
        } else {
          line.push(...await this.inline([node]));
        }
      }
      if (first || line.length) row();
    }
    return output;
  }

  private async inline(nodes: NodeListOf<ChildNode> | ChildNode[], style: InlineStyle = {}): Promise<ParagraphChild[]> {
    const { TextRun, ExternalHyperlink, InternalHyperlink, FootnoteReferenceRun, Math: WordMath, MathRun, Tab } = this.word;
    const children: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const { preserve, ...properties } = style;
        const text = node.textContent ?? '';
        if (!text || (!preserve && !text.trim() && text.includes('\n'))) continue;
        if (!preserve) {
          children.push(new TextRun({ ...properties, text: text.replace(/\s+/g, ' ') }));
        } else {
          text.split('\n').forEach((line, index) => {
            const segments = line.split('\t');
            const content = segments.flatMap((segment, index) => index ? [new Tab(), segment] : [segment]);
            children.push(new TextRun({ ...properties, break: index > 0 ? 1 : undefined, children: content }));
          });
        }
        continue;
      }
      if (!(node instanceof Element)) continue;
      if (node.classList.contains('katex-display') || node.classList.contains('katex')) {
        const source = node.querySelector('annotation')?.textContent ?? node.textContent ?? '';
        try {
          children.push(await this.mathImage(node));
        } catch {
          this.job.signal.throwIfAborted();
          children.push(new WordMath({ children: [new MathRun(source)] }));
        }
        continue;
      }
      const tag = node.localName;
      if (tag === 'a') {
        const footnote = node.getAttribute('data-footnote-id');
        if (footnote && this.job.footnotes[footnote]) {
          children.push(new FootnoteReferenceRun(Number(footnote)));
          continue;
        }
        const href = node.getAttribute('href') ?? '';
        const contents = await this.inline(node.childNodes, { ...style, color: '244E8F', underline: {} });
        const anchor = href.startsWith('#') ? this.anchor(href.slice(1)) : '';
        if (anchor) children.push(new InternalHyperlink({ anchor, children: contents }));
        else if (/^(?:https?:\/\/|mailto:)/i.test(href)) children.push(new ExternalHyperlink({ link: href, children: contents }));
        else children.push(...contents);
        continue;
      }
      if (tag === 'br') {
        children.push(new TextRun({ break: 1 }));
        continue;
      }
      if (tag === 'input') {
        children.push(new TextRun(node.hasAttribute('checked') ? '☑ ' : '☐ '));
        continue;
      }
      if (tag === 'img') {
        const src = node.getAttribute('src') ?? '';
        if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src)) {
          try {
            const image = new Image();
            image.src = src;
            await image.decode();
            const factor = Math.min(1, maxImageWidth / image.naturalWidth, 585 / image.naturalHeight);
            const width = Math.max(1, Math.round(image.naturalWidth * factor));
            const height = Math.max(1, Math.round(image.naturalHeight * factor));
            const blob = await imageToPng(src, 2 * width, 2 * height, this.job.signal);
            children.push(await this.image(blob, width, height, node.getAttribute('alt') ?? '图片'));
          } catch {
            this.job.signal.throwIfAborted();
            children.push(new TextRun(node.getAttribute('alt') ?? '图片'));
          }
        }
        continue;
      }
      const next = { ...style };
      if (tag === 'strong' || tag === 'b') next.bold = true;
      if (tag === 'em' || tag === 'i') next.italics = true;
      if (tag === 's' || tag === 'del' || tag === 'strike') next.strike = true;
      if (tag === 'code') {
        next.font = 'Consolas';
        if (!style.preserve) next.shading = { fill: 'EEF1F5' };
      }
      const highlight = [...node.classList].find((name) => name.startsWith('hl-'));
      if (highlight && this.colors[highlight.slice(3)]) next.color = this.colors[highlight.slice(3)];
      children.push(...await this.inline(node.childNodes, next));
    }
    return children;
  }

  private async image(blob: Blob, width: number, height: number, alt: string): Promise<ParagraphChild> {
    this.job.signal.throwIfAborted();
    return new this.word.ImageRun({
      data: new Uint8Array(await blob.arrayBuffer()), type: 'png',
      transformation: { width, height }, altText: { description: alt, title: alt, name: alt },
    });
  }

  private async mathImage(node: Element): Promise<ParagraphChild> {
    const { prose, signal } = this.job;
    const surface = measurementSurface(this.css.replaceAll(':root', ':host'), prose, 610);
    let height: number;
    let width: number;
    try {
      surface.article.style.width = 'max-content';
      surface.article.style.maxWidth = '590px';
      surface.article.style.lineHeight = '1.4';
      surface.article.innerHTML = node.outerHTML;
      await document.fonts.ready;
      const box = surface.article.getBoundingClientRect();
      width = Math.max(12, Math.min(610, Math.ceil(box.width) + 12));
      height = Math.max(24, Math.ceil(box.height) + 8);
    } finally { surface.close(); }
    const png = await markupPng({
      markup: node.outerHTML, width, height, contentWidth: width, contentHeight: height,
      css: this.css + 'article{line-height:1.4;overflow:visible}article>.katex-display{margin:.2em 0}',
      prose, dpi: 2, transparent: true, signal,
    });
    return this.image(png, width, height, node.querySelector('annotation')?.textContent ?? '数学公式');
  }

  async diagram(graphic: NonNullable<ExportJob['blocks'][number]['graphic']>): Promise<Paragraph> {
    const factor = Math.min(1, maxImageWidth / graphic.width, 760 / graphic.height);
    const width = Math.max(1, Math.floor(graphic.width * factor));
    const height = Math.max(1, Math.floor(graphic.height * factor));
    const svg = graphic.svg;
    const data = await svgToPng({ svg, width, height }, 'light', 2, false, this.job.signal, true);
    return new this.word.Paragraph({
      alignment: this.word.AlignmentType.CENTER, spacing: { before: 120, after: 130 },
      children: [await this.image(data, width, height, '图表')],
    });
  }
}

export async function exportDocument(job: ExportJob): Promise<void> {
  job.signal.throwIfAborted();
  const word = await import('docx');
  const math = job.hasMath ? await loadMathStyles(job.signal) : '';
  const writer = new WordWriter(word, job, exportStyles('light') + math);
  const content: WordBlock[] = [];
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  for (const note of Object.values(job.footnotes)) {
    const noteBlocks = await writer.blocks(nodesFrom(note.html).childNodes);
    footnotes[note.id] = { children: noteBlocks.filter((block): block is Paragraph => block instanceof word.Paragraph) };
    if (!footnotes[note.id].children.length) footnotes[note.id].children.push(new word.Paragraph(nodesFrom(note.html).textContent ?? ''));
  }
  for (const [index, block] of job.blocks.entries()) {
    if (index % 24 === 0) {
      job.progress('正在排版 Word', index, job.blocks.length);
      await yieldFrame(job.signal);
    }
    if (block.graphic) content.push(await writer.diagram(block.graphic));
    else if (block.kind !== 'footnote_section') content.push(...await writer.blocks(nodesFrom(block.html).childNodes));
  }
  job.signal.throwIfAborted();
  const documentFile = new word.Document({
    title: job.title, creator: 'MDRenderTool', footnotes, numbering: { config: writer.numbering },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 850, right: 850 } } },
      children: content.length ? content : [new word.Paragraph('')],
    }],
  });
  job.progress('正在打包 DOCX', job.blocks.length, job.blocks.length);
  const blob = await word.Packer.toBlob(documentFile);
  job.signal.throwIfAborted();
  downloadBlob(blob, safeFilename(job.title.replace(/\.(?:md|markdown|txt)$/i, ''), '.docx'));
}
