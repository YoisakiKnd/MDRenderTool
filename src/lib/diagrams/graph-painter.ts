import { sugiyama } from './layouts/sugiyama';
import { measureText } from './text-metrics';
import { Svg, arrow, color, type Arrow } from './svg-builder';
import type { DiagramGraphic, Direction, Rect } from './types';

export interface GraphNode { id: string; label: string; width: number; height: number }
export interface GraphEdge {
  from: string; to: string; label?: string; start?: Arrow; end?: Arrow; dashed?: boolean; thick?: boolean;
  startLabel?: string; endLabel?: string;
}
export interface GraphGroup { id: string; label: string; nodeIds: string[] }

export function paintGraph<N extends GraphNode>({
  nodes, edges, groups, direction, title, drawNode,
}: {
  nodes: N[]; edges: GraphEdge[]; groups?: GraphGroup[]; direction?: Direction; title: string;
  drawNode: (svg: Svg, node: N, box: Rect) => void;
}): DiagramGraphic {
  const edgeData = edges.map((edge) => {
    const metrics = edge.label ? measureText(edge.label, 12, false, 155) : undefined;
    return { ...edge, labelWidth: metrics?.width, labelHeight: metrics?.height };
  });
  const layout = sugiyama({ nodes, edges: edgeData, groups, direction });
  const svg = new Svg();
  for (const group of groups ?? []) {
    const box = layout.groupBoxes.get(group.id);
    if (!box) continue;
    svg.rect(box, { fill: color('group-bg'), stroke: color('group-border'), 'stroke-dasharray': '5 3' });
    svg.label(group.label, box.x + 10, box.y + 13, { align: 'start', size: 12, bold: true, maxWidth: box.width - 16 });
  }
  const stroke = color('edge-color');
  layout.routes.forEach((route, index) => {
    const edge = edgeData[index];
    svg.add('path', { d: route.path, fill: 'none', stroke,
      'stroke-width': edge.thick ? 2.8 : 1.5, 'stroke-dasharray': edge.dashed ? '5 4' : undefined });
  });
  for (const node of nodes) drawNode(svg, node, layout.nodes.get(node.id)!);
  layout.routes.forEach((route, index) => {
    const edge = edgeData[index];
    const points = route.points;
    if (edge.start) arrow(svg, points[0], points[1], edge.start);
    if (edge.end) arrow(svg, points[points.length - 1], points[points.length - 2], edge.end);
    const { x, y } = route.label;
    if (edge.label && edge.labelWidth && edge.labelHeight) {
      svg.rect({ x: x - edge.labelWidth / 2 - 3, y: y - edge.labelHeight / 2 - 2,
        width: edge.labelWidth + 6, height: edge.labelHeight + 4 }, { fill: color('edge-label-bg'), stroke: 'none', rx: 3 });
      svg.label(edge.label, x, y, { size: 12, maxWidth: 155 });
    }
    if (edge.startLabel) svg.label(edge.startLabel, points[0].x + 11, points[0].y + 11, { size: 10, align: 'start' });
    if (edge.endLabel) {
      const last = points[points.length - 1];
      svg.label(edge.endLabel, last.x + 11, last.y - 12, { size: 10, align: 'start' });
    }
  });
  return svg.graphic(layout.width, layout.height, title);
}
