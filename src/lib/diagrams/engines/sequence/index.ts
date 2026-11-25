import { Svg, arrow, color, type Arrow } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, sourceLines, unquote, type DiagramEngine, type Rect } from '../../types';

interface Participant { id: string; label: string; kind: 'participant' | 'actor' | 'database' }
type Item =
  | { kind: 'message'; from: string; to: string; label: string; dashed: boolean; arrow: Arrow; activation?: '+' | '-' }
  | { kind: 'note'; participants: string[]; side: 'left' | 'right' | 'over'; text: string }
  | { kind: 'activation'; id: string; open: boolean }
  | { kind: 'divider'; label: string }
  | { kind: 'fragment'; name: string; label: string; sections: Array<{ label: string; items: Item[] }> };
interface SequenceIR { title?: string; participants: Participant[]; items: Item[]; auto: boolean }
type Fragment = Extract<Item, { kind: 'fragment' }>;

const identity = '"(?:\\\\.|[^"])*"|[\\p{L}\\p{N}_][\\p{L}\\p{N}_.-]*?';
const messagePattern = new RegExp(`^(${identity})\\s*(<--?|--?(?:>>?|[xo]))\\s*([+-]?)\\s*(${identity})(?:\\s*:\\s*(.*))?$`, 'u');

function participantId(raw: string): string { return unquote(raw); }

function parse(source: string, dialect: 'mermaid' | 'plantuml' | 'generic'): SequenceIR {
  const participants = new Map<string, Participant>();
  const items: Item[] = [];
  const stack: Fragment[] = [];
  const lines = sourceLines(source);
  let title: string | undefined;
  let auto = false;

  function current(): Item[] { return stack.at(-1)?.sections.at(-1)?.items ?? items; }
  function add(id: string, label = id, kind: Participant['kind'] = 'participant'): void {
    if (label !== id || kind !== 'participant' || !participants.has(id)) participants.set(id, { id, label, kind });
  }

  for (let index = 0; index < lines.length; index++) {
    const { text, line } = lines[index];
    if (/^sequenceDiagram$/i.test(text)) continue;
    if (/^autonumber\b/i.test(text)) { auto = true; continue; }
    const caption = /^title\s*:?[ \t]*(.+)$/i.exec(text);
    if (caption) { title = unquote(caption[1]); continue; }
    const declaration = /^(participant|actor|database)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(text);
    if (declaration) {
      const first = participantId(declaration[2]);
      const other = declaration[3] ? participantId(declaration[3]) : undefined;
      const plantAlias = dialect === 'plantuml' || declaration[2].startsWith('"');
      add(other && plantAlias ? other : first, other && !plantAlias ? other : first, declaration[1].toLowerCase() as Participant['kind']);
      continue;
    }
    const begin = /^(loop|alt|opt|par|group|critical|break)(?:\s+(.*))?$/i.exec(text);
    if (begin) {
      if (stack.length >= 24) throw new DiagramSyntaxError('时序图分组嵌套过深。', line);
      const fragment: Fragment = { kind: 'fragment', name: begin[1], label: begin[2] ?? '', sections: [{ label: '', items: [] }] };
      current().push(fragment);
      stack.push(fragment);
      continue;
    }
    const more = /^(else|and|option)(?:\s+(.+))?$/i.exec(text);
    if (more) {
      const frame = stack.at(-1);
      if (!frame) throw new DiagramSyntaxError('时序分支没有对应的分组。', line);
      frame.sections.push({ label: more[2] ?? more[1], items: [] });
      continue;
    }
    if (/^end$/i.test(text)) {
      if (!stack.pop()) throw new DiagramSyntaxError('找不到与 end 匹配的分组。', line);
      continue;
    }
    const activity = /^(activate|deactivate)\s+(.+)$/i.exec(text);
    if (activity) {
      const id = participantId(activity[2]);
      add(id);
      current().push({ kind: 'activation', id, open: activity[1].toLowerCase() === 'activate' });
      continue;
    }
    const note = /^note\s+(left|right|over)(?:\s+of)?\s+([^:]+?)(?:\s*:\s*(.*))?$/i.exec(text);
    if (note) {
      const ids = note[2].split(',').map(participantId);
      ids.forEach((id) => add(id));
      let value = note[3];
      if (value === undefined) {
        const body: string[] = [];
        while (++index < lines.length && !/^end\s+note$/i.test(lines[index].text)) body.push(lines[index].text);
        if (index === lines.length) throw new DiagramSyntaxError('注释缺少 end note。', line);
        value = body.join('\n');
      }
      current().push({ kind: 'note', side: note[1].toLowerCase() as 'left' | 'right' | 'over', participants: ids, text: unquote(value) });
      continue;
    }
    const divider = /^==\s*(.*?)\s*==$/.exec(text);
    if (divider) { current().push({ kind: 'divider', label: divider[1] }); continue; }
    const message = messagePattern.exec(text);
    if (!message) throw new DiagramSyntaxError('无法识别时序图语句。', line);
    let from = participantId(message[1]);
    let to = participantId(message[4]);
    add(from);
    add(to);
    if (message[2].startsWith('<')) [from, to] = [to, from];
    const symbol = message[2];
    current().push({
      kind: 'message', from, to, label: unquote(message[5] ?? ''), dashed: symbol.includes('--'),
      arrow: symbol.endsWith('x') ? 'cross' : symbol.endsWith('o') ? 'circle' : symbol.endsWith('>>') ? 'filled' : 'open',
      activation: message[3] === '+' || message[3] === '-' ? message[3] : undefined,
    });
  }
  if (stack.length) throw new DiagramSyntaxError('时序片段缺少 end。');
  if (!participants.size || participants.size > 60) throw new DiagramSyntaxError('时序图需要 1 至 60 个参与者。');
  return { title, participants: [...participants.values()], items, auto };
}

interface Placed { item: Item; y: number; height: number; depth: number; divider?: string }

const engine: DiagramEngine<SequenceIR> = {
  type: 'sequence', version: '1', parse,
  render({ title, participants, items, auto }) {
    const svg = new Svg();
    const locate = new Map<string, Rect>();
    let margin = 40;
    let interval = 146;
    function inspect(input: Item[]): void {
      for (const item of input) {
        if (item.kind === 'note' && item.side !== 'over') margin = Math.max(margin, measureText(item.text, 13, false, 185).width + 22);
        if (item.kind === 'message') interval = Math.max(interval, measureText(item.label, 13, false, 200).width + 36);
        if (item.kind === 'fragment') item.sections.forEach((section) => inspect(section.items));
      }
    }
    inspect(items);
    const labelHeight = Math.max(...participants.map((participant) => measureText(participant.label, 14, true, 144).height));
    const top = title ? 57 + measureText(title, 18, true, 450).height / 2 : 24;
    const cardHeight = labelHeight + 38;
    let previousRight = margin;
    for (const participant of participants) {
      const width = Math.max(84, measureText(participant.label, 14, true, 144).width + 24);
      locate.set(participant.id, { x: previousRight, y: top, width, height: cardHeight });
      previousRight += width + interval / 2;
    }
    const width = Math.max(title ? measureText(title, 18, true, 450).width + 55 : 300, previousRight - interval / 2 + margin + 34);
    const x = (id: string): number => { const box = locate.get(id)!; return box.x + box.width / 2; };
    const positions: Placed[] = [];
    let cursor = top + cardHeight + 16;
    function arrange(input: Item[], depth: number): void {
      for (const item of input) {
        const y = cursor;
        if (item.kind === 'fragment') {
          const start: Placed = { item, y, height: 0, depth };
          positions.push(start);
          cursor += 35;
          for (const [index, section] of item.sections.entries()) {
            if (index) {
              positions.push({ item, depth, y: cursor, height: 24, divider: section.label });
              cursor += 24;
            }
            arrange(section.items, depth + 1);
          }
          cursor += 15;
          start.height = cursor - y;
          cursor += 10;
          continue;
        }
        const height = item.kind === 'message' ? measureText(item.label, 13, false, 200).height + (item.from === item.to ? 39 : 23)
          : item.kind === 'note' ? measureText(item.text, 13, false, 185).height + 27 : item.kind === 'activation' ? 3 : 36;
        positions.push({ item, y, height, depth });
        cursor += height;
      }
    }
    arrange(items, 0);
    const bottom = cursor + 15;
    if (title) svg.label(title, width / 2, 25, { bold: true, size: 18, maxWidth: 450 });
    const indent = (depth: number) => 13 + depth * 7;
    for (const { item, y, height, depth, divider } of positions) {
      if (item.kind !== 'fragment' || divider !== undefined) continue;
      const left = indent(depth);
      svg.rect({ x: left, y, width: width - 2 * left, height }, { fill: color('group-bg'), stroke: color('group-border'), rx: 4 });
      const tag = measureText(item.name, 12, true).width + 21;
      svg.add('polygon', { points: `${left},${y} ${left + tag},${y} ${left + tag},${y + 12} ${left + tag - 8},${y + 23} ${left},${y + 23}`, fill: color('accent-soft'), stroke: color('group-border') });
      svg.label(item.name, left + 8, y + 11, { bold: true, size: 12, align: 'start' });
      if (item.label) svg.label(item.label, left + tag + 9, y + 12, { size: 12, align: 'start', maxWidth: width - left * 2 - tag - 18 });
    }
    for (const participant of participants) {
      const px = x(participant.id);
      svg.line({ x: px, y: top + cardHeight }, { x: px, y: bottom }, { 'stroke-dasharray': '5 5', opacity: .65 });
    }
    const bars = new Map<string, number[]>();
    const opened: Array<{ id: string; depth: number; from: number; to: number }> = [];
    function activate(id: string, open: boolean, y: number): void {
      const positions = bars.get(id) ?? [];
      if (open) positions.push(y);
      else {
        const start = positions.pop();
        if (start !== undefined) opened.push({ id, depth: positions.length, from: start, to: y });
      }
      bars.set(id, positions);
    }
    for (const { item, y, height } of positions) {
      if (item.kind === 'activation') activate(item.id, item.open, y);
      if (item.kind === 'message' && item.activation) activate(item.activation === '+' ? item.to : item.from, item.activation === '+', y + height - 14);
    }
    for (const [id, remaining] of bars) remaining.forEach((from, depth) => opened.push({ id, depth, from, to: bottom }));
    opened.sort((a, b) => a.depth - b.depth);
    for (const bar of opened) {
      svg.rect({ x: x(bar.id) - 5 + 4 * bar.depth, y: bar.from, width: 10, height: Math.max(2, bar.to - bar.from) },
        { fill: color('accent-soft'), stroke: color('accent'), rx: 1 });
    }

    let sequence = 0;
    for (const { item, y, height, depth, divider } of positions) {
      if (item.kind === 'message') {
        const left = x(item.from);
        const right = x(item.to);
        const mid = y + measureText(item.label, 13, false, 200).height / 2 + 4;
        const row = mid + measureText(item.label, 13, false, 200).height / 2 + 5;
        const dash = { 'stroke-dasharray': item.dashed ? '5 4' : undefined };
        if (item.from === item.to) {
          svg.add('path', { d: `M${left} ${row} h44 v19 h-44`, fill: 'none', stroke: color('edge-color'), ...dash });
          arrow(svg, { x: left, y: row + 19 }, { x: left + 44, y: row + 19 }, item.arrow);
        } else {
          svg.line({ x: left, y: row }, { x: right, y: row }, dash);
          arrow(svg, { x: right, y: row }, { x: left, y: row }, item.arrow);
        }
        const number = auto ? `${++sequence}. ` : '';
        svg.label(number + item.label, left === right ? left + 20 : (left + right) / 2, mid, { size: 13, maxWidth: 200 });
      } else if (item.kind === 'note') {
        const coordinates = item.participants.map(x);
        const metrics = measureText(item.text, 13, false, 185);
        const noteWidth = Math.max(metrics.width + 16, 66);
        const left = item.side === 'left' ? Math.min(...coordinates) - noteWidth - 10
          : item.side === 'right' ? Math.max(...coordinates) + 10
            : (Math.min(...coordinates) + Math.max(...coordinates) - noteWidth) / 2;
        const bounded = Math.max(8, Math.min(left, width - noteWidth - 8));
        svg.rect({ x: bounded, y: y + 4, width: noteWidth, height: height - 10 }, { fill: color('note-bg'), stroke: color('note-border'), rx: 3 });
        svg.label(item.text, bounded + noteWidth / 2, y + (height - 2) / 2, { size: 13, maxWidth: 185 });
      } else if (item.kind === 'divider' || divider !== undefined) {
        const row = y + height / 2;
        const left = indent(depth) + 8;
        const label = divider ?? (item.kind === 'divider' ? item.label : '');
        const size = measureText(label, 12, true).width + 12;
        svg.line({ x: left, y: row }, { x: width - left, y: row }, { 'stroke-dasharray': '5 3' });
        svg.rect({ x: width / 2 - size / 2, y: row - 9, width: size, height: 18 }, { fill: color('edge-label-bg'), stroke: 'none', rx: 3 });
        svg.label(label, width / 2, row, { size: 12, bold: true });
      }
    }

    for (const participant of participants) {
      const box = locate.get(participant.id)!;
      const cx = x(participant.id);
      for (const y of [top, bottom]) {
        svg.rect({ ...box, y });
        const icon = y + 14;
        if (participant.kind === 'actor') {
          svg.add('circle', { cx, cy: icon - 2, r: 4, fill: color('accent') });
          svg.add('path', { d: `M${cx - 7} ${icon + 9} q7 -7 14 0`, fill: 'none', stroke: color('accent'), 'stroke-width': 2 });
        } else if (participant.kind === 'database') {
          svg.add('path', { d: `M${cx - 8} ${icon} v9 a8 3 0 0 0 16 0 v-9`, fill: color('accent-soft'), stroke: color('accent') });
          svg.add('ellipse', { cx, cy: icon, rx: 8, ry: 3, fill: color('accent-soft'), stroke: color('accent') });
        } else {
          svg.rect({ x: cx - 7, y: icon - 4, width: 14, height: 12 }, { fill: color('accent-soft'), stroke: color('accent'), rx: 3 });
        }
        svg.label(participant.label, cx, y + 28 + labelHeight / 2, { bold: true, maxWidth: 144 });
      }
    }
    return svg.graphic(width, bottom + cardHeight + 24, title ?? '时序图');
  },
};
export default engine;
