import { layoutTree } from '../../layouts/tree';
import { Svg, color } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, unquote, type DiagramEngine } from '../../types';

interface Node {
  id: string; label: string; shape: 'default' | 'round' | 'pill' | 'cloud' | 'bang';
  children: Node[]; width: number; height: number; side?: -1 | 1;
}

function nodeFor(raw: string, line: number): Node {
  const shapes: [RegExp, Node['shape']][] = [
    [/^(?:[\w.-]+)?\(\((.*)\)\)$/, 'pill'], [/^(?:[\w.-]+)?\((.*)\)$/, 'round'],
    [/^(?:[\w.-]+)?\[(.*)\]$/, 'default'], [/^(?:[\w.-]+)?\)\)(.*)\(\($/, 'cloud'],
    [/^(?:[\w.-]+)?\)\!(.*)\!\($/, 'bang'],
  ];
  for (const [pattern, shape] of shapes) {
    const match = pattern.exec(raw);
    if (match) return build(unquote(match[1]), shape);
  }
  return build(unquote(raw), 'default');

  function build(label: string, shape: Node['shape']): Node {
    const metrics = measureText(label, 14, true, 188);
    return { id: String(line), label, shape, children: [], width: Math.max(58, metrics.width + 30), height: metrics.height + 20 };
  }
}

const engine: DiagramEngine<{ root: Node }> = {
  type: 'mindmap', version: '1',
  parse(source, dialect) {
    const stack: Array<{ level: number; node: Node }> = [];
    let root: Node | undefined;
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index];
      const text = raw.trim();
      if (!text || /^(?:mindmap\b|%%|'|@(?:start|end))/i.test(text)) continue;
      const marker = /^([*+-]+)\s+(.+)/.exec(text);
      const numbered = dialect === 'plantuml' || (dialect === 'generic' && Boolean(marker));
      if (numbered && !marker) throw new DiagramSyntaxError('PlantUML 思维导图节点需要 *、+ 或 - 层级标记。', index + 1);
      const level = marker && numbered ? marker[1].length : raw.match(/^\s*/)?.[0].replace(/\t/g, '    ').length ?? 0;
      const node = nodeFor(marker && numbered ? marker[2] : text, index + 1);
      if (marker?.[1].startsWith('+')) node.side = 1;
      if (marker?.[1].startsWith('-')) node.side = -1;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length > 100) throw new DiagramSyntaxError('思维导图层级过深。', index + 1);
      const parent = stack.at(-1)?.node;
      if (parent) parent.children.push(node);
      else if (root) throw new DiagramSyntaxError('思维导图只能包含一个根节点。', index + 1);
      else root = node;
      stack.push({ node, level });
    }
    if (!root) throw new DiagramSyntaxError('思维导图缺少根节点。');
    return { root };
  },
  render({ root }) {
    const { boxes, sides, width, height } = layoutTree(root);
    const svg = new Svg();
    function draw(node: Node, palette: number, depth: number): void {
      const box = boxes.get(node.id)!;
      const stroke = depth ? color('palette-' + palette) : color('accent');
      for (const [index, child] of node.children.entries()) {
        const next = boxes.get(child.id)!;
        const side = sides.get(child.id) ?? 1;
        const start = { x: box.x + (side > 0 ? box.width : 0), y: box.y + box.height / 2 };
        const end = { x: next.x + (side > 0 ? 0 : next.width), y: next.y + next.height / 2 };
        const mid = (start.x + end.x) / 2;
        const childPalette = depth ? palette : index % 8 + 1;
        svg.add('path', {
          d: `M${start.x} ${start.y} C${mid} ${start.y},${mid} ${end.y},${end.x} ${end.y}`,
          fill: 'none', stroke: color('palette-' + childPalette), 'stroke-width': 2,
        });
        draw(child, childPalette, depth + 1);
      }
      svg.rect(box, { fill: depth ? color('node-bg') : color('accent-soft'), stroke,
        rx: node.shape === 'pill' || node.shape === 'cloud' ? box.height / 2 : node.shape === 'round' ? 10 : 4,
        'stroke-width': node.shape === 'bang' ? 2.7 : 1.4,
        'stroke-dasharray': node.shape === 'cloud' ? '4 2' : undefined,
      });
      svg.label(node.label, box.x + box.width / 2, box.y + box.height / 2, { bold: true, maxWidth: 188 });
    }
    draw(root, 1, 0);
    return svg.graphic(width, height, '思维导图');
  },
};
export default engine;
