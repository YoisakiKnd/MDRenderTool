import { paintGraph, type GraphEdge } from '../../graph-painter';
import { Svg, color, type Arrow } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, directionOf, sourceLines, unquote, type DiagramEngine, type Direction, type Rect } from '../../types';

interface Attribute { name: string; type: string; keys: string; comment?: string }
interface Entity { id: string; label: string; attributes: Attribute[] }
interface ErIR { entities: Entity[]; relationships: GraphEdge[]; direction: Direction }
const identifier = '"(?:\\\\.|[^"])*"|[\\p{L}\\p{N}_.-]+';
const relationship = new RegExp(`^(${identifier})\\s*([|o{}]{2})(--|\\.\\.)([|o{}]{2})\\s*(${identifier})(?:\\s*:\\s*(.+))?$`, 'u');
const cardinality = (symbol: string): Arrow => symbol.includes('{') || symbol.includes('}')
  ? (symbol.includes('o') ? 'zero-many' : 'many') : (symbol.includes('o') ? 'zero-one' : 'one');
const keysIn = (value: string): string => (value.match(/\b(?:PK|FK|UK)\b/gi) ?? []).map((key) => key.toUpperCase()).join(' / ');

function parse(source: string, dialect: string): ErIR {
  const entities = new Map<string, Entity>();
  const relationships: GraphEdge[] = [];
  let current: Entity | undefined;
  let direction: Direction = 'TB';

  function entity(raw: string, label?: string): Entity {
    const id = unquote(raw);
    const item = entities.get(id) ?? { id, label: label ?? id, attributes: [] };
    if (label) item.label = label;
    entities.set(id, item);
    return item;
  }

  for (const { text, line } of sourceLines(source)) {
    if (/^erDiagram$/i.test(text)) continue;
    const orientation = /^direction\s+(\w+)$/i.exec(text);
    if (orientation) { direction = directionOf(orientation[1]); continue; }
    if (/^left to right direction$/i.test(text)) { direction = 'LR'; continue; }
    if (current) {
      if (text === '}') { current = undefined; continue; }
      if (/^(?:--|\.\.)+$/.test(text)) continue;
      const plant = /^\*?\s*([^:\s]+)\s*:\s*(.+?)(?:\s*<<(.+)>>)?$/.exec(text);
      const mermaid = /^(\S+)\s+(\S+)(?:\s+([\w, ]+?))?(?:\s+("(?:\\.|[^"])*"))?$/.exec(text);
      if (plant && dialect !== 'mermaid') {
        current.attributes.push({ name: plant[1], type: plant[2], keys: keysIn(plant[3] ?? '') });
      } else if (mermaid) {
        current.attributes.push({ type: mermaid[1], name: mermaid[2], keys: keysIn(mermaid[3] ?? ''), comment: mermaid[4] ? unquote(mermaid[4]) : undefined });
      } else throw new DiagramSyntaxError('无法识别实体属性。', line);
      continue;
    }
    const rel = relationship.exec(text);
    if (rel) {
      relationships.push({ from: entity(rel[1]).id, to: entity(rel[5]).id, start: cardinality(rel[2]), end: cardinality(rel[4]),
        dashed: rel[3] === '..', label: rel[6] ? unquote(rel[6]) : undefined });
      continue;
    }
    const name = /^(?:entity\s+)?("(?:\\.|[^"])*"|[^\s{]+)(?:\s+as\s+(\S+?))?\s*(\{)?\s*(\})?$/iu.exec(text);
    if (name) {
      const item = entity(name[2] ?? name[1], unquote(name[1]));
      if (name[3] && !name[4]) current = item;
      continue;
    }
    throw new DiagramSyntaxError('无法识别实体或鸦爪连线。', line);
  }
  if (current) throw new DiagramSyntaxError('实体缺少结束括号。');
  if (!entities.size) throw new DiagramSyntaxError('ER 图至少需要一个实体。');
  return { entities: [...entities.values()], relationships, direction };
}

const rowWidth = 124;
const attributeLabel = (item: Attribute): string => item.comment ? item.name + '\n' + item.comment : item.name;
interface Measured extends Entity { width: number; height: number; top: number; left: number; right: number; badge: number; rows: number[] }
function drawEntity(svg: Svg, node: Measured, box: Rect): void {
  const { x, y, width } = box;
  svg.rect(box);
  svg.rect({ x, y, width, height: node.top }, { fill: color('accent-soft') });
  svg.label(node.label, x + width / 2, y + node.top / 2, { bold: true });
  let cursor = y + node.top;
  for (const [index, item] of node.attributes.entries()) {
    const height = node.rows[index];
    svg.line({ x, y: cursor }, { x: x + width, y: cursor }, { stroke: color('node-border'), 'stroke-width': .7 });
    svg.label(attributeLabel(item), x + 10, cursor + height / 2, { size: 12, align: 'start', maxWidth: rowWidth });
    svg.label(item.type, x + 23 + node.left, cursor + height / 2, { size: 12, align: 'start', maxWidth: rowWidth });
    if (item.keys) {
      const badgeX = x + width - node.badge - 9;
      svg.rect({ x: badgeX, y: cursor + (height - 17) / 2, width: node.badge, height: 17 }, { fill: color('accent-soft'), stroke: 'none', rx: 3 });
      svg.label(item.keys, badgeX + node.badge / 2, cursor + height / 2, { size: 10, bold: true });
    }
    cursor += height;
  }
}
const engine: DiagramEngine<ErIR> = {
  type: 'er', version: '1', parse,
  render({ entities, relationships, direction }) {
    const nodes = entities.map((item) => {
      const title = measureText(item.label, 14, true);
      const names = item.attributes.map((attribute) => measureText(attributeLabel(attribute), 12, false, rowWidth));
      const types = item.attributes.map((attribute) => measureText(attribute.type, 12, false, rowWidth));
      const left = Math.max(30, ...names.map((entry) => entry.width));
      const right = Math.max(25, ...types.map((entry) => entry.width));
      const badge = item.attributes.some((attribute) => attribute.keys)
        ? 10 + Math.max(...item.attributes.map((attribute) => measureText(attribute.keys, 10, true).width)) : 0;
      const top = title.height + 16;
      const rows = names.map((name, index) => 12 + Math.max(name.height, types[index].height));
      return { ...item, width: Math.max(title.width + 30, left + right + badge + 43), height: top + rows.reduce((sum, row) => sum + row, 0), left, right, badge, rows, top };
    });
    return paintGraph({ nodes, edges: relationships, direction, title: '实体关系图', drawNode: drawEntity });
  },
};
export default engine;
