import { Svg, color } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, sourceLines, unquote, type DiagramEngine } from '../../types';

interface Slice { label: string; value: number }
interface PieIR { title?: string; showData: boolean; slices: Slice[] }

const engine: DiagramEngine<PieIR> = {
  type: 'pie', version: '1',
  parse(source) {
    const slices: Slice[] = [];
    let title: string | undefined;
    let showData = false;
    for (const { text, line } of sourceLines(source)) {
      const header = /^pie(?:\s+(showData))?(?:\s+title\s+(.+))?$/i.exec(text);
      if (header) { showData ||= Boolean(header[1]); if (header[2]) title = unquote(header[2]); continue; }
      const heading = /^title\s*:?[ \t]*(.+)$/i.exec(text);
      if (heading) { title = unquote(heading[1]); continue; }
      const slice = /^("(?:\\.|[^"])*"|[^:]+)\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(text);
      if (!slice) throw new DiagramSyntaxError('饼图分类需要标签和数值。', line);
      const value = Number(slice[2]);
      if (!Number.isFinite(value) || value < 0) throw new DiagramSyntaxError('饼图数值必须为非负有限数。', line);
      slices.push({ label: unquote(slice[1]), value });
    }
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    if (!Number.isFinite(total) || total <= 0 || slices.length > 80) {
      throw new DiagramSyntaxError('饼图需要有效的正数总和，分类数最多为 80。');
    }
    return { slices, title, showData };
  },
  render({ slices, title, showData }) {
    const svg = new Svg();
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    const legend = slices.map(({ label, value }) => {
      const percentage = value / total;
      return { label: label + (showData ? '  ' + String(value) : '') + `  ${(percentage * 100).toFixed(1)}%`, percentage };
    });
    const metrics = legend.map(({ label }) => measureText(label, 13, false, 213));
    const legendHeight = metrics.reduce((sum, metric) => sum + Math.max(25, metric.height + 7), 0);
    const titleHeight = title ? measureText(title, 19, true, 430).height + 19 : 6;
    const height = Math.max(245, legendHeight + 24) + titleHeight;
    const width = Math.max(title ? measureText(title, 19, true, 430).width + 36 : 390,
      284 + Math.max(...metrics.map(({ width }) => width)));
    const center = { x: 122, y: titleHeight + (height - titleHeight) / 2 };
    const radius = 81;
    if (title) svg.label(title, width / 2, titleHeight / 2, { size: 19, bold: true, maxWidth: 430 });
    svg.add('circle', { cx: center.x, cy: center.y, r: radius, fill: 'none', stroke: color('group-bg'), 'stroke-width': 35 });
    const point = (angle: number, distance = radius) => `${(center.x + Math.cos(angle) * distance).toFixed(3)} ${(center.y + Math.sin(angle) * distance).toFixed(3)}`;
    let angle = -Math.PI / 2;
    let y = titleHeight + (height - titleHeight - legendHeight) / 2;
    for (const [index, item] of legend.entries()) {
      const next = angle + item.percentage * Math.PI * 2;
      const palette = color('palette-' + (index % 8 + 1));
      if (item.percentage > .9999) {
        svg.add('circle', { cx: center.x, cy: center.y, r: radius, fill: 'none', stroke: palette, 'stroke-width': 35 });
      } else if (item.percentage > 0.0001) {
        const gap = Math.min(.021, (next - angle) / 6);
        svg.add('path', { d: `M ${point(angle + gap)} A ${radius} ${radius} 0 ${next - angle > Math.PI ? 1 : 0} 1 ${point(next - gap)}`,
          fill: 'none', stroke: palette, 'stroke-width': 35 });
      }
      if (item.percentage >= .08) {
        const middle = (angle + next) / 2;
        const cx = center.x + Math.cos(middle) * radius;
        const cy = center.y + Math.sin(middle) * radius;
        svg.rect({ x: cx - 17, y: cy - 7, width: 34, height: 14 }, { fill: color('edge-label-bg'), stroke: 'none', rx: 4 });
        svg.label(`${Math.round(item.percentage * 100)}%`, cx, cy, { size: 10, bold: true });
      }
      const row = Math.max(25, metrics[index].height + 7);
      svg.rect({ x: 235, y: y + row / 2 - 6, width: 12, height: 12 }, { fill: palette, stroke: 'none', rx: 3 });
      svg.label(item.label, 254, y + row / 2, { align: 'start', size: 13, maxWidth: 213 });
      y += row;
      angle = next;
    }
    svg.label(String(slices.length), center.x, center.y - 6, { size: 24, bold: true });
    svg.label('个分类', center.x, center.y + 15, { size: 11 });
    return svg.graphic(width, height, title ?? '饼图');
  },
};
export default engine;
