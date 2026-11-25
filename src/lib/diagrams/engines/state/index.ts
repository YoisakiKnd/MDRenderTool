import { paintGraph, type GraphEdge } from '../../graph-painter';
import { Svg, color } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, directionOf, sourceLines, unquote, type DiagramEngine, type DiagramGraphic, type Direction, type Rect } from '../../types';

interface State {
  id: string; label: string; kind: 'normal' | 'start' | 'end' | 'fork' | 'choice' | 'note';
  description?: string; children?: StateIR;
}
interface StateIR { direction: Direction; states: Map<string, State>; transitions: GraphEdge[] }
const makeGraph = (): StateIR => ({ direction: 'TB', states: new Map(), transitions: [] });

function parse(source: string): StateIR {
  const root = makeGraph();
  const stack = [root];
  const lines = sourceLines(source);
  function state(graph: StateIR, name: string): State {
    const id = unquote(name);
    const existing = graph.states.get(id);
    if (existing) return existing;
    const item: State = { id, label: id, kind: 'normal' };
    graph.states.set(id, item);
    return item;
  }
  for (let i = 0; i < lines.length; i++) {
    const { text, line } = lines[i];
    const current = stack[stack.length - 1];
    if (/^stateDiagram(?:-v2)?$/i.test(text)) continue;
    const orientation = /^direction\s+(\w+)$/i.exec(text);
    if (orientation) { current.direction = directionOf(orientation[1]); continue; }
    if (text === '}') {
      if (stack.length === 1) throw new DiagramSyntaxError('复合状态结束括号没有对应的开始。', line);
      stack.pop();
      continue;
    }
    const definition = /^state\s+("(?:\\.|[^"])*"|[^\s{]+)(?:\s+as\s+([^\s<{]+))?(?:\s*<<(fork|join|choice)>>)?\s*(\{)?$/i.exec(text);
    if (definition) {
      const item = state(current, definition[2] ?? definition[1]);
      if (definition[2]) item.label = unquote(definition[1]);
      if (definition[3]) item.kind = definition[3] === 'choice' ? 'choice' : 'fork';
      if (definition[4]) {
        if (stack.length > 24) throw new DiagramSyntaxError('复合状态的嵌套层级过深。', line);
        item.children = makeGraph();
        stack.push(item.children);
      }
      continue;
    }
    const note = /^note\s+(?:left|right)\s+of\s+(\S+?)(?:\s*:\s*(.*))?$/i.exec(text);
    if (note) {
      const target = state(current, note[1]);
      let label = note[2];
      if (label === undefined) {
        const body: string[] = [];
        while (++i < lines.length && !/^end\s+note$/i.test(lines[i].text)) body.push(lines[i].text);
        if (i === lines.length) throw new DiagramSyntaxError('状态注释缺少 end note。', line);
        label = body.join('\n');
      }
      const sticky = state(current, '\0note:' + line);
      sticky.kind = 'note';
      sticky.label = unquote(label);
      current.transitions.push({ from: target.id, to: sticky.id, dashed: true });
      continue;
    }
    const transition = /^(\[\*\]|[^\s:]+?)\s*(-->|->)\s*(\[\*\]|[^\s:]+)(?:\s*:\s*(.*))?$/.exec(text);
    if (transition) {
      let from = state(current, transition[1] === '[*]' ? '\0start' : transition[1]);
      let to = state(current, transition[3] === '[*]' ? '\0end' : transition[3]);
      if (transition[1] === '[*]') { from.kind = 'start'; from.label = '开始'; }
      if (transition[3] === '[*]') { to.kind = 'end'; to.label = '结束'; }
      current.transitions.push({ from: from.id, to: to.id, end: 'filled', label: transition[4] });
      continue;
    }
    const description = /^([^\s:]+)\s*:\s*(.+)$/.exec(text);
    if (description) { state(current, description[1]).description = unquote(description[2]); continue; }
    throw new DiagramSyntaxError('无法识别状态或状态转换。', line);
  }
  if (stack.length > 1) throw new DiagramSyntaxError('复合状态缺少结束括号。');
  if (!root.states.size) throw new DiagramSyntaxError('状态图至少需要一个状态。');
  return root;
}

interface MeasuredState extends State { width: number; height: number; embedded?: DiagramGraphic; titleHeight: number }
function drawState(svg: Svg, node: MeasuredState, box: Rect): void {
  const { x, y, width, height } = box;
  const cx = x + width / 2;
  const cy = y + height / 2;
  if (node.kind === 'start' || node.kind === 'end') {
    if (node.kind === 'end') svg.add('circle', { cx, cy, r: width / 2 - 1, fill: color('node-bg'), stroke: color('edge-color') });
    svg.add('circle', { cx, cy, r: node.kind === 'end' ? width / 2 - 5 : width / 2 - 1, fill: color('edge-color') });
    return;
  }
  if (node.kind === 'fork') {
    svg.rect(box, { fill: color('edge-color'), rx: 1 });
    return;
  }
  if (node.kind === 'choice') {
    svg.add('polygon', { points: `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`,
      fill: color('accent-soft'), stroke: color('node-border') });
    return;
  }
  svg.rect(box, { fill: color(node.kind === 'note' ? 'note-bg' : 'node-bg'), stroke: color(node.kind === 'note' ? 'note-border' : 'node-border') });
  if (node.embedded) {
    const barHeight = node.titleHeight + 15;
    svg.rect({ x, y, width, height: barHeight }, { fill: color('accent-soft') });
    svg.label(node.label, cx, y + barHeight / 2, { bold: true });
    svg.embed(node.embedded, cx - node.embedded.width / 2, y + barHeight + 4);
    return;
  }
  if (node.description) {
    svg.label(node.label, cx, y + 7 + node.titleHeight / 2, { bold: true });
    svg.label(node.description, cx, y + node.titleHeight + (height - node.titleHeight) / 2, { size: 12 });
  } else svg.label(node.label, cx, cy, { bold: node.kind !== 'note' });
}

function render(graph: StateIR): DiagramGraphic {
  const nodes = [...graph.states.values()].map((node): MeasuredState => {
    const label = measureText(node.label, 14, node.kind !== 'note');
    const description = node.description ? measureText(node.description, 12) : undefined;
    const embedded = node.children?.states.size ? render(node.children) : undefined;
    const common = { ...node, titleHeight: label.height };
    if (node.kind === 'start' || node.kind === 'end') return { ...common, width: 24, height: 24 };
    if (node.kind === 'fork') return { ...common, width: 68, height: 10 };
    if (node.kind === 'choice') return { ...common, width: 28, height: 28 };
    return { ...common, embedded, width: Math.max(64, label.width + 26, (description?.width ?? 0) + 26, (embedded?.width ?? 0) + 20),
      height: label.height + (embedded ? embedded.height + 28 : (description?.height ?? 0) + 23) };
  });
  return paintGraph({ nodes, edges: graph.transitions, direction: graph.direction, title: '状态图', drawNode: drawState });
}

const engine: DiagramEngine<StateIR> = { type: 'state', version: '1', parse, render };
export default engine;
