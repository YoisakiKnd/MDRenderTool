import type { Point, Rect } from '../types';

export interface TreeLayoutNode {
  id: string; width: number; height: number; children: TreeLayoutNode[]; side?: -1 | 1;
}
interface Branch {
  nodes: Array<{ node: TreeLayoutNode; depth: number; center: number }>;
  contours: Array<{ min: number; max: number }>;
}

/** Places siblings at the smallest separation allowed by their depth contours. */
function arrange(root: TreeLayoutNode, gap: number): Branch {
  const branch: Branch = {
    nodes: [{ node: root, depth: 0, center: 0 }],
    contours: [{ min: -root.height / 2, max: root.height / 2 }],
  };
  if (!root.children.length) return branch;
  let last = 0;
  const children: Array<{ branch: Branch; shift: number }> = [];
  const contour: Branch['contours'] = [];
  for (const child of root.children) {
    const next = arrange(child, gap);
    let shift = 0;
    for (let depth = 0; depth < Math.min(contour.length, next.contours.length); depth++) {
      shift = Math.max(shift, contour[depth].max + gap - next.contours[depth].min);
    }
    next.contours.forEach((edge, depth) => {
      const min = edge.min + shift;
      const max = edge.max + shift;
      if (contour[depth]) contour[depth] = { min: Math.min(contour[depth].min, min), max: Math.max(contour[depth].max, max) };
      else contour[depth] = { min, max };
    });
    children.push({ branch: next, shift });
    last = shift;
  }
  const center = last / 2;
  for (const { branch: child, shift } of children) {
    for (const item of child.nodes) branch.nodes.push({ node: item.node, depth: item.depth + 1, center: item.center + shift - center });
  }
  branch.contours.push(...contour.map(({ min, max }) => ({ min: min - center, max: max - center })));
  return branch;
}

export function layoutTree(root: TreeLayoutNode, bidirectional = true): {
  boxes: Map<string, Rect>; sides: Map<string, -1 | 1>; width: number; height: number;
} {
  const groups: Record<-1 | 1, TreeLayoutNode[]> = { [-1]: [], 1: [] };
  const weights: Record<-1 | 1, number> = { [-1]: 0, 1: 0 };
  const weight = (node: TreeLayoutNode): number => 1 + node.children.reduce((sum, child) => sum + weight(child), 0);
  for (const child of root.children) {
    const side = bidirectional ? child.side ?? (weights[1] <= weights[-1] ? 1 : -1) : 1;
    groups[side].push(child);
    weights[side] += weight(child);
  }

  const boxes = new Map<string, Rect>([[root.id, { x: -root.width / 2, y: -root.height / 2, width: root.width, height: root.height }]]);
  const sides = new Map<string, -1 | 1>();
  for (const side of [-1, 1] as const) {
    if (!groups[side].length) continue;
    const arrangement = arrange({ ...root, children: groups[side] }, 16);
    const widths: number[] = [];
    const columns = [0];
    for (const { node, depth } of arrangement.nodes) widths[depth] = Math.max(widths[depth] ?? 0, node.width);
    for (let i = 1; i < widths.length; i++) columns[i] = columns[i - 1] + widths[i - 1] / 2 + 44 + widths[i] / 2;
    for (const { node, depth, center } of arrangement.nodes.slice(1)) {
      const point: Point = { x: columns[depth] * side, y: center };
      boxes.set(node.id, { x: point.x - node.width / 2, y: point.y - node.height / 2, width: node.width, height: node.height });
      sides.set(node.id, side);
    }
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const box of boxes.values()) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  for (const box of boxes.values()) { box.x += 24 - left; box.y += 24 - top; }
  return { boxes, sides, width: right - left + 48, height: bottom - top + 48 };
}
