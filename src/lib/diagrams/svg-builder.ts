import { escapeMarkup } from '../core/escape';
import { measureText } from './text-metrics';
import type { DiagramGraphic, Point, Rect } from './types';

type Attrs = Record<string, string | number | undefined>;
export const color = (token: string) => `var(--dg-${token})`;
const xml = (text: string) => escapeMarkup(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd'));
const attributes = (attrs: Attrs) => Object.entries(attrs).filter(([, value]) => value !== undefined)
  .map(([key, value]) => ` ${key}="${xml(typeof value === 'number' ? String(Math.round(value * 100) / 100) : String(value))}"`).join('');

export class Svg {
  private readonly parts: string[] = [];

  add(tag: 'path' | 'rect' | 'circle' | 'line' | 'polyline' | 'polygon' | 'ellipse', attrs: Attrs): void {
    this.parts.push(`<${tag}${attributes(attrs)}/>`);
  }

  rect(box: Rect, attrs: Attrs = {}): void {
    this.add('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 6,
      fill: color('node-bg'), stroke: color('node-border'), ...attrs });
  }

  line(from: Point, to: Point, attrs: Attrs = {}): void {
    this.add('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      stroke: color('edge-color'), 'stroke-width': 1.4, ...attrs });
  }

  label(text: string, x: number, y: number, options: { size?: number; bold?: boolean; maxWidth?: number; align?: 'start' | 'middle' | 'end'; fill?: string } = {}): void {
    const { size = 14, bold = false, maxWidth = 240, align = 'middle', fill = color('node-text') } = options;
    const metrics = measureText(text, size, bold, maxWidth);
    this.parts.push(`<text${attributes({ x, y, 'text-anchor': align, 'font-size': size, 'font-weight': bold ? 650 : 400, fill })}>`);
    const step = size * 1.4;
    metrics.lines.forEach((line, index) => {
      const baseline = y + (index - (metrics.lines.length - 1) / 2) * step + size * .34;
      this.parts.push(`<tspan${attributes({ x, y: baseline })}>${xml(line)}</tspan>`);
    });
    this.parts.push('</text>');
  }

  embed(graphic: DiagramGraphic, x: number, y: number): void {
    this.parts.push(graphic.svg.replace('<svg ', `<svg${attributes({ x, y })} `));
  }

  graphic(width: number, height: number, title: string): DiagramGraphic {
    width = Math.max(1, Math.ceil(width));
    height = Math.max(1, Math.ceil(height));
    return {
      width, height,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" class="mdrt-diagram" role="img" aria-label="${xml(title)}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,sans-serif"><title>${xml(title)}</title><rect width="100%" height="100%" fill="${color('bg')}"/>${this.parts.join('')}</svg>`,
    };
  }
}

export type Arrow = 'filled' | 'open' | 'triangle' | 'diamond' | 'hollow-diamond' | 'cross'
  | 'zero-one' | 'one' | 'zero-many' | 'many' | 'circle';

export function arrow(svg: Svg, tip: Point, previous: Point, kind: Arrow, stroke = color('edge-color')): void {
  const direction = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const cosine = Math.cos(direction);
  const sine = Math.sin(direction);
  const at = (back: number, side = 0) => ({
    x: tip.x - back * cosine - side * sine, y: tip.y - back * sine + side * cosine,
  });
  const path = (points: Point[]) => points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const paper = color('edge-label-bg');
  if (kind === 'cross') {
    svg.line(at(0, -4), at(8, 4), { stroke });
    svg.line(at(0, 4), at(8, -4), { stroke });
  } else if (kind === 'circle') {
    const center = at(4);
    svg.add('circle', { cx: center.x, cy: center.y, r: 3.5, fill: paper, stroke });
  } else if (kind === 'one' || kind === 'many' || kind === 'zero-one' || kind === 'zero-many') {
    if (kind.endsWith('many')) {
      svg.add('polyline', { points: path([at(1, -5), at(9), at(1, 5)]), fill: 'none', stroke });
    } else {
      svg.line(at(3, -5), at(3, 5), { stroke });
    }
    if (kind.startsWith('zero')) {
      const center = at(13);
      svg.add('circle', { cx: center.x, cy: center.y, r: 3.5, fill: paper, stroke });
    } else {
      svg.line(at(12, -5), at(12, 5), { stroke });
    }
  } else if (kind === 'diamond' || kind === 'hollow-diamond') {
    svg.add('polygon', { points: path([tip, at(7, -4), at(14), at(7, 4)]), fill: kind === 'diamond' ? stroke : paper, stroke });
  } else {
    svg.add(kind === 'open' ? 'polyline' : 'polygon', {
      points: path([at(9, -4.5), tip, at(9, 4.5)]),
      fill: kind === 'open' ? 'none' : kind === 'triangle' ? paper : stroke, stroke, 'stroke-linejoin': 'round',
    });
  }
}
