import type { Direction, Point, Rect } from '../types';

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { from: string; to: string; labelWidth?: number; labelHeight?: number }
export interface LayoutGroup { id: string; nodeIds: string[] }
export interface EdgeRoute { points: Point[]; path: string; label: Point; reversed: boolean }

interface LayerNode extends LayoutNode {
  rank: number; order: number; point: Point; previous: LayerNode[]; next: LayerNode[];
  group?: string;
}

const pointText = ({ x, y }: Point) => `${x.toFixed(2)} ${y.toFixed(2)}`;

export function sugiyama<N extends LayoutNode, E extends LayoutEdge>({
  nodes, edges, groups = [], direction = 'TB', nodeSep = 38, rankSep = 68,
}: { nodes: N[]; edges: E[]; groups?: LayoutGroup[]; direction?: Direction; nodeSep?: number; rankSep?: number }): {
  nodes: Map<string, Rect>; routes: EdgeRoute[]; groupBoxes: Map<string, Rect>; width: number; height: number;
} {
  const sideways = direction === 'LR' || direction === 'RL';
  const membership = new Map<string, string>();
  for (const group of groups) for (const id of group.nodeIds) membership.set(id, group.id);
  const byId = new Map(nodes.map((node) => [node.id, makeNode(node.id, sideways ? node.height : node.width, sideways ? node.width : node.height)]));
  for (const node of byId.values()) node.group = membership.get(node.id);
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error('图表引用了未定义节点。');
    if (edge.from !== edge.to) {
      const targets = outgoing.get(edge.from) ?? [];
      targets.push(edge.to);
      outgoing.set(edge.from, targets);
    }
  }
  const active = new Set<string>();
  const complete = new Set<string>();
  const reversedPairs = new Map<string, Set<string>>();
  function visit(id: string): void {
    if (complete.has(id)) return;
    active.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (active.has(target)) {
        const targets = reversedPairs.get(id) ?? new Set<string>();
        targets.add(target);
        reversedPairs.set(id, targets);
      } else {
        visit(target);
      }
    }
    active.delete(id);
    complete.add(id);
  }
  for (const node of nodes) visit(node.id);

  const directed = edges.map((edge) => {
    const reversed = reversedPairs.get(edge.from)?.has(edge.to) ?? false;
    const from = byId.get(reversed ? edge.to : edge.from)!;
    const to = byId.get(reversed ? edge.from : edge.to)!;
    if (from !== to) { from.next.push(to); to.previous.push(from); }
    return { from, to, reversed, chain: [] as LayerNode[] };
  });
  const indegree = new Map([...byId.values()].map((node) => [node, node.previous.length]));
  const queue = [...byId.values()].filter((node) => indegree.get(node) === 0);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    for (const next of node.next) {
      next.rank = Math.max(next.rank, node.rank + 1);
      const degree = indegree.get(next)! - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  const layers: LayerNode[][] = [];
  function add(node: LayerNode): void {
    const layer = layers[node.rank] ??= [];
    node.order = layer.length;
    layer.push(node);
    node.previous = [];
    node.next = [];
  }
  for (const node of byId.values()) add(node);

  directed.forEach(({ from, to, chain }, index) => {
    chain.push(from);
    if (from === to) return;
    for (let rank = from.rank + 1; rank < to.rank; rank++) {
      const dummy = makeNode(`\0${index}/${rank}`, 0, 0);
      dummy.rank = rank;
      add(dummy);
      chain.push(dummy);
    }
    chain.push(to);
    for (let n = 1; n < chain.length; n++) {
      chain[n - 1].next.push(chain[n]);
      chain[n].previous.push(chain[n - 1]);
    }
  });

  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    for (let row = 1; row < layers.length; row++) {
      const layer = layers[down ? row : layers.length - 1 - row];
      const groupScores = new Map<string, { sum: number; count: number }>();
      const scores = new Map(layer.map((node) => {
        const adjacent = down ? node.previous : node.next;
        const score = adjacent.length ? adjacent.reduce((sum, neighbor) => sum + neighbor.order, 0) / adjacent.length : node.order;
        if (node.group) {
          const group = groupScores.get(node.group) ?? { sum: 0, count: 0 };
          group.sum += score;
          group.count++;
          groupScores.set(node.group, group);
        }
        return [node, score];
      }));
      const order = (node: LayerNode) => {
        const score = scores.get(node)!;
        const group = node.group ? groupScores.get(node.group) : undefined;
        return group ? (score + group.sum / group.count) / 2 : score;
      };
      layer.sort((a, b) => order(a) - order(b) || a.order - b.order);
      layer.forEach((node, index) => { node.order = index; });
    }
  }

  const lengths = layers.map((layer) => layer.reduce((length, node) => length + node.width + nodeSep, -nodeSep));
  const rowHeights = layers.map((layer) => layer.reduce((height, node) => Math.max(height, node.height), 0));
  const crossSize = Math.max(0, ...lengths);
  let axisSize = 0;
  const labelsByRank = new Map<number, number>();
  directed.forEach(({ from }, index) => {
    const labelSize = sideways ? edges[index].labelWidth ?? 0 : edges[index].labelHeight ?? 0;
    labelsByRank.set(from.rank, Math.max(labelsByRank.get(from.rank) ?? 0, labelSize));
  });
  layers.forEach((layer, rank) => {
    let left = (crossSize - lengths[rank]) / 2;
    for (const node of layer) {
      node.point = { x: left + node.width / 2, y: axisSize + rowHeights[rank] / 2 };
      left += node.width + nodeSep;
    }
    axisSize += rowHeights[rank];
    if (rank + 1 < layers.length) axisSize += Math.max(rankSep, (labelsByRank.get(rank) ?? 0) + 34);
  });

  function orient(point: Point): Point {
    if (direction === 'LR') return { x: point.y, y: point.x };
    if (direction === 'RL') return { x: axisSize - point.y, y: point.x };
    if (direction === 'BT') return { x: point.x, y: axisSize - point.y };
    return { ...point };
  }
  const positioned = new Map<string, Rect>();
  for (const node of nodes) {
    const center = orient(byId.get(node.id)!.point);
    positioned.set(node.id, { x: center.x - node.width / 2, y: center.y - node.height / 2, width: node.width, height: node.height });
  }
  const parallel = new Map<string, number>();
  const routes = directed.map(({ from, to, reversed, chain }) => {
    const pairKey = JSON.stringify([from.id, to.id]);
    const number = parallel.get(pairKey) ?? 0;
    parallel.set(pairKey, number + 1);
    if (from === to) {
      const right = from.point.x + from.width / 2;
      const extension = 33 + number * 14;
      const y = from.point.y;
      const p = [
        { x: right, y: y - 7 }, { x: right + extension, y: y - 28 },
        { x: right + extension, y: y + 28 }, { x: right, y: y + 7 },
      ].map(orient);
      return { points: p, path: '', label: orient({ x: right + extension + 7, y }), reversed };
    }
    const shift = number === 0 ? 0 : Math.min(17, Math.ceil(number / 2) * 5) * (number % 2 ? 1 : -1);
    const coordinates = chain.map((node) => ({
      x: node.point.x + Math.max(-node.width / 3, Math.min(node.width / 3, shift)),
      y: node.point.y,
    }));
    coordinates[0].y += from.height / 2;
    coordinates[coordinates.length - 1].y -= to.height / 2;
    for (let i = 1; i < coordinates.length - 1; i++) coordinates[i].x += shift;
    const labelSegment = Math.floor((coordinates.length - 1) / 2);
    const a = coordinates[labelSegment];
    const b = coordinates[labelSegment + 1];
    const label = orient({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const points = coordinates.map(orient);
    if (reversed) points.reverse();
    return { points, path: '', label, reversed };
  });

  const groupBoxes = new Map<string, Rect>();
  for (const group of groups) {
    const members = group.nodeIds.flatMap((id) => positioned.get(id) ?? []);
    if (!members.length) continue;
    const box = bounds(members);
    groupBoxes.set(group.id, { x: box.x - 20, y: box.y - 32, width: box.width + 40, height: box.height + 52 });
  }
  const all = [...positioned.values(), ...groupBoxes.values()];
  routes.forEach((route, index) => {
    all.push(...route.points.map((point) => ({ ...point, width: 0, height: 0 })));
    const w = (edges[index].labelWidth ?? 0) + 8;
    const h = (edges[index].labelHeight ?? 0) + 8;
    all.push({ x: route.label.x - w / 2, y: route.label.y - h / 2, width: w, height: h });
  });
  const frame = bounds(all);
  const dx = 25 - frame.x;
  const dy = 25 - frame.y;
  for (const rect of [...positioned.values(), ...groupBoxes.values()]) { rect.x += dx; rect.y += dy; }
  const isLoop = (index: number) => directed[index].from === directed[index].to;
  routes.forEach((route, index) => {
    const points = route.points;
    for (const point of [...points, route.label]) { point.x += dx; point.y += dy; }
    route.path = 'M ' + pointText(points[0]);
    if (isLoop(index)) {
      route.path += ' C ' + points.slice(1).map(pointText).join(' ');
    } else {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const controls = sideways ? [{ x: midX, y: a.y }, { x: midX, y: b.y }] : [{ x: a.x, y: midY }, { x: b.x, y: midY }];
        route.path += ' C ' + [...controls, b].map(pointText).join(' ');
      }
    }
  });
  return { nodes: positioned, routes, groupBoxes, width: frame.width + 50, height: frame.height + 50 };
}

function makeNode(id: string, width: number, height: number): LayerNode {
  return { id, width, height, rank: 0, order: 0, point: { x: 0, y: 0 }, previous: [], next: [] };
}

function bounds(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    x = Math.min(x, rect.x); y = Math.min(y, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}
