import { paintGraph, type GraphEdge, type GraphGroup } from '../../graph-painter';
import { Svg, color, type Arrow } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, directionOf, sourceLines, unquote, type DiagramEngine, type Direction, type Rect } from '../../types';

interface Member { visibility: '+' | '-' | '#' | '~' | ''; text: string; kind: 'field' | 'method' }
interface ClassNode { id: string; label: string; stereotype?: string; members: Member[] }
interface ClassIR { classes: ClassNode[]; relations: GraphEdge[]; packages: GraphGroup[]; direction: Direction }
const id = '"(?:\\\\.|[^"])*"|[\\p{L}\\p{N}_][\\p{L}\\p{N}_.~]*';
const relation = new RegExp(`^(${id})\\s*(?:"([^"]*)"\\s*)?(<\\|--|--\\|>|<\\|\\.\\.|\\.\\.\\|>|\\*--|--\\*|o--|--o|-->|<--|\\.\\.>|<\\.\\.|--|\\.\\.)\\s*(?:"([^"]*)"\\s*)?(${id})(?:\\s*:\\s*(.+))?$`, 'u');
const arrowHeads: Record<string, Arrow> = { '<|': 'triangle', '|>': 'triangle', '*': 'diamond', o: 'hollow-diamond', '<': 'open', '>': 'open' };

function parse(source: string): ClassIR {
  const classes = new Map<string, ClassNode>();
  const packages: GraphGroup[] = [];
  const stack: GraphGroup[] = [];
  const relations: GraphEdge[] = [];
  let current: ClassNode | undefined;
  let direction: Direction = 'TB';

  function node(name: string): ClassNode {
    const nameId = unquote(name);
    let value = classes.get(nameId);
    if (!value) {
      value = { id: nameId, label: nameId, members: [] };
      classes.set(nameId, value);
      for (const group of stack) group.nodeIds.push(nameId);
    }
    return value;
  }
  function member(raw: string, target: ClassNode): void {
    const text = raw.trim();
    if (!text) return;
    const stereo = /^<<(.+)>>$/.exec(text);
    if (stereo) { target.stereotype = stereo[1]; return; }
    const leading = /^[+#~-]/.test(text) ? text[0] as Member['visibility'] : '';
    target.members.push({ visibility: leading, text: text.slice(leading.length).trimStart(), kind: text.includes('(') ? 'method' : 'field' });
  }

  for (const { text, line } of sourceLines(source)) {
    if (/^classDiagram$/i.test(text)) continue;
    const orient = /^direction\s+(\w+)$/.exec(text);
    if (orient) { direction = directionOf(orient[1]); continue; }
    if (/^left to right direction$/i.test(text)) { direction = 'LR'; continue; }
    if (current) {
      const closing = text.endsWith('}');
      const value = closing ? text.slice(0, -1) : text;
      for (const item of value.split(';')) member(item, current);
      if (closing) current = undefined;
      continue;
    }
    if (text === '}') {
      if (!stack.pop()) throw new DiagramSyntaxError('包的结束括号没有匹配项。', line);
      continue;
    }
    const packageDecl = /^(?:package|namespace)\s+(.+?)\s*\{$/i.exec(text);
    if (packageDecl) {
      const item = { id: 'package-' + line, label: unquote(packageDecl[1]), nodeIds: [] };
      packages.push(item);
      stack.push(item);
      continue;
    }
    const declaration = /^(abstract class|abstract|class|interface|enum)\s+("(?:\\.|[^"])*"|[^\s{]+)(?:\s+as\s+([\w.-]+))?(?:\s*<<([^>]+)>>)?\s*(?:\{(.*))?$/i.exec(text);
    if (declaration) {
      const value = node(declaration[3] ?? declaration[2]);
      if (declaration[3]) value.label = unquote(declaration[2]);
      value.stereotype = declaration[4] ?? (declaration[1] === 'class' ? value.stereotype : declaration[1].split(' ')[0]);
      if (declaration[5] !== undefined) {
        const closing = declaration[5].endsWith('}');
        for (const item of (closing ? declaration[5].slice(0, -1) : declaration[5]).split(';')) member(item, value);
        if (!closing) current = value;
      }
      continue;
    }
    const edge = relation.exec(text);
    if (edge) {
      const symbol = edge[3];
      const start = /^(<\||[<*o])/.exec(symbol)?.[0];
      const end = /(\|>|[>*o])$/.exec(symbol)?.[0];
      relations.push({ from: node(edge[1]).id, to: node(edge[5]).id, label: edge[6], dashed: symbol.includes('.'),
        start: start ? arrowHeads[start] : undefined, end: end ? arrowHeads[end] : undefined,
        startLabel: edge[2], endLabel: edge[4] });
      continue;
    }
    const stereotype = /^<<([^>]+)>>\s+(.+)$/.exec(text);
    if (stereotype) { node(stereotype[2]).stereotype = stereotype[1]; continue; }
    const inline = /^([^:\s]+)\s*:\s*(.+)$/.exec(text);
    if (inline) { member(inline[2], node(inline[1])); continue; }
    throw new DiagramSyntaxError('无法识别类、成员或关系。', line);
  }
  if (current || stack.length) throw new DiagramSyntaxError('类或包缺少结束括号。');
  if (!classes.size) throw new DiagramSyntaxError('类图至少需要一个类。');
  return { direction, packages, relations, classes: [...classes.values()] };
}

const memberLabel = (member: Member): string => (member.visibility ? member.visibility + ' ' : '') + member.text;
const widthLimit = 256;

interface MeasuredClass extends ClassNode {
  width: number; height: number; nameHeight: number; stereoHeight: number; fieldsHeight: number;
}
function drawClass(svg: Svg, node: MeasuredClass, box: Rect): void {
  const { x, y, width, height } = box;
  svg.rect(box, { rx: 5 });
  svg.rect({ x, y, width, height: node.nameHeight }, { fill: color('accent-soft'), rx: 5 });
  if (node.stereotype) svg.label('«' + node.stereotype + '»', x + width / 2, y + 6 + node.stereoHeight / 2, { size: 11, maxWidth: widthLimit });
  svg.label(node.label, x + width / 2, y + (node.nameHeight + node.stereoHeight) / 2, { bold: true, maxWidth: widthLimit });
  const first = y + node.nameHeight;
  let row = first;
  const topOfMethods = first + node.fieldsHeight;
  for (const boundary of [first, topOfMethods]) {
    svg.line({ x, y: boundary }, { x: x + width, y: boundary }, { stroke: color('node-border'), 'stroke-width': 1 });
  }
  for (const kind of ['field', 'method'] as const) {
    if (kind === 'method') row = topOfMethods;
    row += 5;
    for (const member of node.members) {
      if (member.kind !== kind) continue;
      const text = memberLabel(member);
      const size = measureText(text, 12, false, widthLimit);
      svg.label(text, x + 11, row + size.height / 2, { size: 12, align: 'start', maxWidth: widthLimit });
      row += size.height + 3;
    }
  }
  if (row > y + height) throw new Error('类图的成员超出布局高度。');
}
const engine: DiagramEngine<ClassIR> = {
  type: 'class', version: '1', parse,
  render({ classes, relations, packages, direction }) {
    const nodes = classes.map((node) => {
      const name = measureText(node.label, 14, true, widthLimit);
      const stereo = node.stereotype ? measureText('«' + node.stereotype + '»', 11, false, widthLimit) : { width: 0, height: 0 };
      const rows = node.members.map((item) => ({ ...measureText(memberLabel(item), 12, false, widthLimit), kind: item.kind }));
      const width = Math.max(108, name.width + 24, stereo.width + 24, ...rows.map((row) => row.width + 24));
      const stereoHeight = stereo.height + (node.stereotype ? 4 : 0);
      const nameHeight = name.height + stereoHeight + 15;
      const fieldsHeight = 12 + rows.filter((row) => row.kind === 'field').reduce((height, row) => height + row.height + 3, 0);
      const methodsHeight = 12 + rows.filter((row) => row.kind === 'method').reduce((height, row) => height + row.height + 3, 0);
      return { ...node, width, height: nameHeight + fieldsHeight + methodsHeight, nameHeight, stereoHeight, fieldsHeight };
    });
    return paintGraph({ nodes, edges: relations, groups: packages, direction, title: '类图', drawNode: drawClass });
  },
};
export default engine;
