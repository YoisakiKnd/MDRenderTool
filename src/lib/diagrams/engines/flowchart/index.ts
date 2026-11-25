import { paintGraph, type GraphEdge, type GraphGroup } from '../../graph-painter';
import { Svg, color } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, directionOf, sourceLines, unquote, type DiagramEngine, type Direction, type Rect } from '../../types';

type Shape = 'rect' | 'round' | 'stadium' | 'diamond' | 'circle' | 'cylinder' | 'hexagon' | 'subroutine';
interface Node { id: string; label: string; shape: Shape; style?: Record<string, string> }
interface GraphIR { direction: Direction; nodes: Node[]; edges: GraphEdge[]; groups: GraphGroup[] }

const nodeName = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*?(?=(?:--|==|-\.|<)|[^\p{L}\p{N}_.-]|$)/u;
const shapes: Array<[string, string, Shape]> = [
  ['([', '])', 'stadium'], ['((', '))', 'circle'], ['[(', ')]', 'cylinder'], ['{{', '}}', 'hexagon'],
  ['[[', ']]', 'subroutine'], ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'diamond'],
];
const simpleEdge = /^(<-->|-->|---|-\.->|==>|<--|\.\.>|--)/;
const paintColors = { fill: 'fill', stroke: 'stroke', color: 'color' } as const;

function splitStatements(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i - 1] !== '\\') quoted = !quoted;
    else if (ch === ';' && !quoted) {
      const piece = text.slice(start, i).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseStyle(text: string): Record<string, string> {
  const style: Record<string, string> = {};
  for (const property of text.split(',')) {
    const [key, value] = property.trim().split(/\s*:\s*/, 2);
    if (Object.hasOwn(paintColors, key) && /^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(value ?? '')) style[key] = value;
  }
  return style;
}

function parse(source: string, dialect: 'generic' | 'mermaid' | 'plantuml'): GraphIR {
  let direction: Direction = 'TB';
  const nodes = new Map<string, Node>();
  const edges: GraphEdge[] = [];
  const groups: GraphGroup[] = [];
  const open: GraphGroup[] = [];
  const classes = new Map<string, Record<string, string>>();
  const classNames = new Map<string, string>();
  const styles = new Map<string, Record<string, string>>();
  const activity: Array<{ id: string; ends: string[]; no?: string; while: boolean }> = [];
  let previous: string | undefined;
  let branchLabel: string | undefined;

  function add(id: string, label = id, shape?: Shape): string {
    if (shape || !nodes.has(id)) nodes.set(id, { id, label, shape: shape ?? 'rect' });
    for (const group of open) if (!group.nodeIds.includes(id)) group.nodeIds.push(id);
    return id;
  }

  function link(from: string, to: string, symbol = '-->', label?: string): void {
    edges.push({ from, to, label, start: symbol.startsWith('<') ? 'filled' : undefined,
      end: symbol.endsWith('>') ? 'filled' : undefined, dashed: symbol.includes('.'), thick: symbol.startsWith('=') });
  }

  function consumeNode(text: string, line: number): { id: string; rest: string } {
    const parts = nodeName.exec(text);
    if (!parts) throw new DiagramSyntaxError('此处需要一个流程节点。', line);
    const id = parts[0];
    let rest = text.slice(id.length).trimStart();
    for (const [start, end, shape] of shapes) {
      if (!rest.startsWith(start)) continue;
      let index = -1;
      let quote = false;
      for (let i = start.length; i < rest.length; i++) {
        if (rest[i] === '"' && rest[i - 1] !== '\\') quote = !quote;
        if (!quote && rest.startsWith(end, i)) { index = i; break; }
      }
      if (index < 0) throw new DiagramSyntaxError('节点缺少结束括号。', line);
      add(id, unquote(rest.slice(start.length, index)), shape);
      rest = rest.slice(index + end.length).trimStart();
      break;
    }
    add(id);
    const named = /^:::([\w-]+)/.exec(rest);
    if (named) { classNames.set(id, named[1]); rest = rest.slice(named[0].length).trimStart(); }
    return { id, rest };
  }

  function statement(text: string, line: number): void {
    let tail = text;
    function multiple(): string[] {
      const ids: string[] = [];
      do {
        const node = consumeNode(tail, line);
        ids.push(node.id);
        tail = node.rest;
        if (!tail.startsWith('&')) break;
        tail = tail.slice(1).trimStart();
      } while (tail);
      return ids;
    }
    let from = multiple();
    while (tail) {
      const withLabel = /^--\s+(.+?)\s+-->\s*/.exec(tail);
      const symbol = withLabel ? '-->' : simpleEdge.exec(tail)?.[0];
      if (!symbol) throw new DiagramSyntaxError('无法识别流程连线。', line);
      tail = tail.slice(withLabel?.[0].length ?? symbol.length).trimStart();
      let label = withLabel?.[1];
      if (tail.startsWith('|')) {
        const end = tail.indexOf('|', 1);
        if (end < 0) throw new DiagramSyntaxError('连线标签缺少结束竖线。', line);
        label = tail.slice(1, end);
        tail = tail.slice(end + 1).trimStart();
      }
      const to = multiple();
      for (const left of from) for (const right of to) link(left, right, symbol, label);
      from = to;
    }
  }

  for (const { text, line } of sourceLines(source)) {
    const heading = /^(?:(?:flowchart|graph)(?:\s+([A-Z]{2}))?|direction\s+([A-Z]{2}))\s*;?$/i.exec(text);
    if (heading) { direction = directionOf(heading[1] ?? heading[2] ?? 'TB'); continue; }
    if (dialect === 'plantuml' && /^left to right direction$/i.test(text)) { direction = 'LR'; continue; }
    const subgraph = /^subgraph\s+(\S+?)(?:\s*\[(.*)\]|\s+(.*))?$/.exec(text);
    if (subgraph) {
      const group = { id: 'group-' + groups.length, label: unquote(subgraph[2] ?? subgraph[3] ?? subgraph[1]), nodeIds: [] };
      groups.push(group); open.push(group); continue;
    }
    if (text === 'end' && open.length) { open.pop(); continue; }
    const style = /^(style|classDef|class)\s+(\S+)\s+(.+)$/.exec(text);
    if (style) {
      if (style[1] === 'classDef') classes.set(style[2], parseStyle(style[3]));
      else if (style[1] === 'style') styles.set(style[2], parseStyle(style[3]));
      else for (const id of style[2].split(',')) classNames.set(id, style[3].trim());
      continue;
    }
    if (dialect === 'plantuml' || dialect === 'generic') {
      const activityNode = /^(start|stop|end)$|^:(.*);$/i.exec(text);
      const startBranch = /^(if|while)\s*\((.+)\)\s*(?:then\s*\(([^)]*)\)|is\s*\(([^)]*)\))?$/i.exec(text);
      const transition = /^(else)(?:\s*\((.*)\))?$|^(endif|endwhile)(?:\s*\((.*)\))?$/i.exec(text);
      if (activityNode || startBranch) {
        const id = 'activity-' + line;
        if (startBranch) add(id, unquote(startBranch[2]), 'diamond');
        else add(id, activityNode?.[2] ?? activityNode![1], activityNode?.[2] ? 'round' : 'stadium');
        if (previous) link(previous, id, '-->', branchLabel);
        previous = id;
        branchLabel = undefined;
        if (startBranch) {
          activity.push({ id, ends: [], while: startBranch[1].toLowerCase() === 'while' });
          branchLabel = startBranch[3] ?? startBranch[4] ?? '是';
        }
        continue;
      }
      if (transition) {
        const frame = activity.at(-1);
        if (!frame) throw new DiagramSyntaxError('分支结束符没有对应的开始。', line);
        if (transition[1]) {
          if (previous) frame.ends.push(previous);
          previous = frame.id;
          branchLabel = transition[2] ?? '否';
          frame.no = branchLabel;
        } else {
          activity.pop();
          const merge = add('merge-' + line, frame.while ? '继续' : '汇合', 'round');
          if (frame.while && previous) link(previous, frame.id);
          else if (previous) link(previous, merge, '-->', branchLabel);
          if (frame.while || !frame.no) link(frame.id, merge, '-->', transition[4] ?? '否');
          for (const end of frame.ends) link(end, merge);
          previous = merge;
          branchLabel = undefined;
        }
        continue;
      }
      const declaration = /^(rectangle|component|database|cloud|node)\s+("(?:\\.|[^"])*"|[\w.-]+)(?:\s+as\s+([\w.-]+))?$/i.exec(text);
      if (declaration) {
        add(declaration[3] ?? unquote(declaration[2]), unquote(declaration[2]), declaration[1].toLowerCase() === 'database' ? 'cylinder' : 'round');
        continue;
      }
      const relation = /^("(?:\\.|[^"])*"|[\w.-]+)\s*(-->|\.\.>|<--|-->)\s*("(?:\\.|[^"])*"|[\w.-]+)\s*:\s*(.+)$/.exec(text);
      if (relation) { link(add(unquote(relation[1])), add(unquote(relation[3])), relation[2], relation[4]); continue; }
    }
    if (nodes.size > 400 || edges.length > 600) throw new DiagramSyntaxError('流程图节点或连线过多。', line);
    for (const part of splitStatements(text)) statement(part, line);
  }
  if (open.length || activity.length) throw new DiagramSyntaxError('子图或活动分支未结束。');
  if (!nodes.size) throw new DiagramSyntaxError('流程图至少需要一个节点。');
  return { direction, nodes: [...nodes.values()].map((node) => ({
    ...node, style: { ...classes.get(classNames.get(node.id) ?? ''), ...styles.get(node.id) },
  })), edges, groups };
}

function drawNode(svg: Svg, node: Node, box: Rect): void {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const attrs = { fill: node.style?.fill ?? color('node-bg'), stroke: node.style?.stroke ?? color('node-border') };
  if (node.shape === 'diamond' || node.shape === 'hexagon') {
    const points = node.shape === 'diamond'
      ? `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`
      : `${x + 13},${y} ${x + width - 13},${y} ${x + width},${cy} ${x + width - 13},${y + height} ${x + 13},${y + height} ${x},${cy}`;
    svg.add('polygon', { points, ...attrs });
  } else if (node.shape === 'circle') {
    svg.add('circle', { cx, cy, r: width / 2, ...attrs });
  } else if (node.shape === 'cylinder') {
    svg.add('path', { d: `M${x} ${y + 9} a${width / 2} 9 0 0 1 ${width} 0 v${height - 18} a${width / 2} 9 0 0 1 -${width} 0 Z`, ...attrs });
    svg.add('ellipse', { cx, cy: y + 9, rx: width / 2, ry: 9, ...attrs });
  } else {
    svg.rect(box, { ...attrs, rx: node.shape === 'stadium' ? height / 2 : node.shape === 'round' ? 8 : 2 });
    if (node.shape === 'subroutine') {
      svg.line({ x: x + 9, y }, { x: x + 9, y: y + height }, attrs);
      svg.line({ x: x + width - 9, y }, { x: x + width - 9, y: y + height }, attrs);
    }
  }
  svg.label(node.label, cx, cy + (node.shape === 'cylinder' ? 4 : 0), { bold: true, fill: node.style?.color });
}

const engine: DiagramEngine<GraphIR> = {
  type: 'flowchart', version: '1',
  parse,
  render(ir) {
    const nodes = ir.nodes.map((node) => {
      const text = measureText(node.label, 14, true);
      const wide = node.shape === 'diamond' ? text.width + 76 : text.width + 36;
      const high = text.height + (node.shape === 'diamond' || node.shape === 'cylinder' ? 36 : 23);
      const diameter = Math.max(wide, high);
      return { ...node, width: node.shape === 'circle' ? diameter : Math.max(64, wide), height: node.shape === 'circle' ? diameter : high };
    });
    return paintGraph({ nodes, edges: ir.edges, groups: ir.groups, direction: ir.direction, title: '流程图', drawNode });
  },
};
export default engine;
