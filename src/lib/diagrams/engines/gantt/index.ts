import { Svg, color } from '../../svg-builder';
import { measureText } from '../../text-metrics';
import { DiagramSyntaxError, sourceLines, unquote, type DiagramEngine } from '../../types';

type Status = 'done' | 'active' | 'crit' | 'milestone';
interface Task { id: string; label: string; startDate: number; endDate: number; status?: Status }
interface Section<T> { name: string; tasks: T[] }
interface GanttIR { title?: string; dateFormat: string; sections: Section<Task>[] }
interface TaskInput {
  id: string; label: string; line: number; start?: string; end?: string;
  dependency?: { ids: string[]; target: 'startDate' | 'endDate' };
  status?: Status;
}
const day = 86_400_000;
const hour = day / 24;
const status = new Set(['done', 'active', 'crit', 'milestone']);
const lengths: Record<string, number> = { d: day, day, days: day, w: day * 7, week: day * 7, weeks: day * 7, h: hour, hour, hours: hour };
const duration = (value: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?|h|hours?)$/i.exec(value);
  return match ? Number(match[1]) * lengths[match[2].toLowerCase()] : undefined;
};

function parseDate(value: string, format: string, line: number): number {
  const date = value.trim();
  const canonical = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const order: string[] = format.match(/YYYY|MM|DD/g) ?? [];
  const parts = date.match(/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/) ? date.split(/[-/.]/).map(Number) : [];
  const values = canonical ? canonical.slice(1).map(Number) : ['YYYY', 'MM', 'DD'].map((key) => parts[order.indexOf(key)]);
  const [year, month, dateNumber] = values;
  const time = Date.UTC(year, month - 1, dateNumber);
  const resolved = new Date(time);
  if (year < 1000 || year > 9999 || resolved.getUTCFullYear() !== year ||
      resolved.getUTCMonth() !== month - 1 || resolved.getUTCDate() !== dateNumber) {
    throw new DiagramSyntaxError(`无效日期 ${value}。`, line);
  }
  return time;
}

function parse(source: string, dialect: string): GanttIR {
  let title: string | undefined;
  let dateFormat = 'YYYY-MM-DD';
  let origin: string | undefined;
  let current: Section<TaskInput> = { name: '', tasks: [] };
  const groups = [current];
  const tasks = new Map<string, TaskInput>();
  let previous: string | undefined;

  function add(id: string, label: string, line: number): TaskInput {
    const known = tasks.get(id);
    if (known) return known;
    const task = { id, label, line };
    tasks.set(id, task);
    current.tasks.push(task);
    return task;
  }

  for (const { text, line } of sourceLines(source)) {
    if (/^gantt$/i.test(text)) continue;
    const option = /^(title|dateFormat|section)\s*:?[ \t]*(.+)$/i.exec(text);
    if (option) {
      const name = option[1].toLowerCase();
      if (name === 'title') title = unquote(option[2]);
      if (name === 'dateformat') dateFormat = option[2];
      if (name === 'section') {
        current = { name: unquote(option[2]), tasks: [] };
        groups.push(current);
      }
      continue;
    }
    if (/^(?:axisFormat|tickInterval|todayMarker)\b/i.test(text)) continue;
    const project = /^Project starts\s+(.+)$/i.exec(text);
    if (project) { origin = project[1]; continue; }
    const heading = /^--\s+(.*?)\s+--$/.exec(text);
    if (heading) { current = { name: heading[1], tasks: [] }; groups.push(current); continue; }
    const plant = /^\[([^\]]+)\](?:\s+as\s+\[([^\]]+)\])?\s+(lasts|starts?|ends?|is)\s+(.*)$/i.exec(text);
    if (plant && dialect !== 'mermaid') {
      const task = add(plant[2] ?? plant[1], plant[1], line);
      const operation = plant[3].toLowerCase();
      const dependency = /^(?:at\s+)?\[([^\]]+)\]'s\s+(start|end)$/i.exec(plant[4]);
      if (operation === 'lasts') task.end = plant[4];
      else if (operation.startsWith('end')) task.end = plant[4].replace(/^(?:at|on)\s+/i, '');
      else if (dependency) task.dependency = { ids: [dependency[1]], target: dependency[2] === 'start' ? 'startDate' : 'endDate' };
      else if (operation === 'is') {
        const mark = plant[4].replace(/^a\s+/i, '').toLowerCase();
        if (!status.has(mark)) throw new DiagramSyntaxError('无法识别甘特图任务状态。', line);
        task.status = mark as Status;
      } else {
        const [start, lasts] = plant[4].split(/\s+and\s+lasts\s+/i);
        task.start = start.replace(/^(?:at|on)\s+/i, '');
        if (lasts) task.end = lasts;
      }
      continue;
    }
    const entry = /^([^:]+):\s*(.+)$/.exec(text);
    if (!entry) throw new DiagramSyntaxError('无法识别甘特图任务。', line);
    const fields = entry[2].split(',').map((part) => part.trim()).filter(Boolean);
    let tag: Status | undefined;
    while (status.has(fields[0])) {
      const mark = fields.shift() as Status;
      if (tag !== 'milestone') tag = mark;
    }
    const explicitId = fields.length > 1 && /^[\w.-]+$/.test(fields[0]) &&
      !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(fields[0]) && duration(fields[0]) === undefined ? fields.shift() : undefined;
    const id = explicitId ?? 'task-' + line;
    if (tasks.has(id)) throw new DiagramSyntaxError(`任务标识 ${id} 重复。`, line);
    const task = add(id, unquote(entry[1]), line);
    task.status = tag;
    if (fields[0]?.startsWith('after ')) {
      task.dependency = { ids: fields.shift()!.slice(6).trim().split(/\s+/), target: 'endDate' };
    } else if (fields.length > 1 || (fields.length === 1 && duration(fields[0]) === undefined)) {
      task.start = fields.shift();
    } else if (previous) {
      task.dependency = { ids: [previous], target: 'endDate' };
    }
    task.end = fields.shift();
    if (fields.length) throw new DiagramSyntaxError('甘特图任务的日期字段过多。', line);
    previous = id;
  }

  if (!tasks.size) throw new DiagramSyntaxError('甘特图至少需要一个任务。');
  const defaultStart = origin ? parseDate(origin, dateFormat, 1) : undefined;
  const fallback = defaultStart ?? [...tasks.values()].flatMap((task) => task.start ? [parseDate(task.start, dateFormat, task.line)] : [])
    .reduce((earliest, date) => Math.min(earliest, date), Infinity);
  const ready = new Map<string, Task>();
  const active = new Set<string>();

  function resolve(task: TaskInput): Task {
    const cached = ready.get(task.id);
    if (cached) return cached;
    if (active.has(task.id)) throw new DiagramSyntaxError('甘特图任务之间有循环依赖。', task.line);
    active.add(task.id);
    let startDate = fallback;
    if (task.start) startDate = parseDate(task.start, dateFormat, task.line);
    if (task.dependency) {
      const target = task.dependency.target;
      startDate = Math.max(...task.dependency.ids.map((id) => {
        const other = tasks.get(id) ?? [...tasks.values()].find((candidate) => candidate.label === id);
        if (!other) throw new DiagramSyntaxError(`找不到依赖任务 ${id}。`, task.line);
        return resolve(other)[target];
      }));
    }
    if (!Number.isFinite(startDate)) throw new DiagramSyntaxError('请指定任务日期或项目起始日期。', task.line);
    const elapsed = task.end ? duration(task.end) : undefined;
    const endDate = task.status === 'milestone' ? startDate : !task.end ? startDate + day
      : elapsed === undefined ? parseDate(task.end, dateFormat, task.line) : startDate + elapsed;
    if (!Number.isFinite(endDate) || endDate < startDate || endDate - startDate > day * 36_600) {
      throw new DiagramSyntaxError('甘特图任务的结束日期或时长无效。', task.line);
    }
    const resolved = { id: task.id, label: task.label, startDate, endDate, status: task.status };
    ready.set(task.id, resolved);
    active.delete(task.id);
    return resolved;
  }

  return { title, dateFormat, sections: groups.filter((group) => group.tasks.length).map((group) => ({
    name: group.name, tasks: group.tasks.map(resolve),
  })) };
}

const engine: DiagramEngine<GanttIR> = {
  type: 'gantt', version: '1', parse,
  render({ title, sections }) {
    const all = sections.flatMap((group) => group.tasks);
    const start = Math.min(...all.map((task) => task.startDate));
    const end = Math.max(start + hour, ...all.map((task) => task.endDate));
    const steps = [hour, hour * 2, hour * 6, hour * 12, day, day * 2, day * 7, day * 14, day * 30, day * 90, day * 365];
    const step = steps.find((candidate) => (end - start) / candidate <= 10) ?? Math.ceil((end - start) / (day * 3650)) * day * 365;
    const first = Math.floor(start / step) * step;
    const last = Math.max(first + step, Math.ceil(end / step) * step);
    const timeWidth = Math.max(440, Math.min(920, (last - first) / step * 88));
    const offset = (time: number) => (time - first) / (last - first) * timeWidth;
    const labelWidth = 24 + Math.max(112, ...all.map((task) => measureText(task.label, 13, false, 190).width));
    const left = labelWidth + 14;
    const width = left + timeWidth + 24;
    const svg = new Svg();
    const titleHeight = title ? measureText(title, 18, true, width - 40).height + 20 : 12;
    if (title) svg.label(title, 16, titleHeight / 2, { align: 'start', bold: true, size: 18, maxWidth: width - 40 });
    let row = titleHeight + 30;
    const rows: Array<{ task: Task; y: number; height: number; color: string }> = [];
    for (const [index, group] of sections.entries()) {
      const palette = color('palette-' + (index % 8 + 1));
      if (group.name) {
        const height = measureText(group.name, 12, true, labelWidth - 12).height + 12;
        svg.rect({ x: 11, y: row, width: width - 27, height }, { fill: color('group-bg'), stroke: 'none', rx: 2 });
        svg.label(group.name, 18, row + height / 2, { size: 12, bold: true, align: 'start', maxWidth: labelWidth - 12 });
        row += height;
      }
      for (const task of group.tasks) {
        const height = Math.max(34, measureText(task.label, 13, false, 190).height + 13);
        if (rows.length % 2 === 0) svg.rect({ x: 11, y: row, width: width - 27, height }, { fill: color('bg'), stroke: color('group-border'), 'stroke-opacity': .25, rx: 2 });
        rows.push({ task, color: palette, y: row, height });
        row += height;
      }
    }
    for (let time = first; time <= last + 1; time += step) {
      const x = left + offset(time);
      const date = new Date(time).toISOString();
      const label = step < day ? date.slice(11, 16) : date.slice(0, 10);
      svg.line({ x, y: titleHeight + 23 }, { x, y: row }, { 'stroke-opacity': .28 });
      svg.label(label, x, titleHeight + 13, { size: 10 });
    }
    const today = Math.floor(Date.now() / day) * day;
    if (today >= first && today <= last) {
      const x = left + offset(today);
      svg.line({ x, y: titleHeight + 22 }, { x, y: row }, { stroke: color('accent'), 'stroke-dasharray': '4 3' });
      svg.label('今日', x, row + 12, { size: 10, fill: color('accent') });
    }
    for (const entry of rows) {
      const { task, y, height } = entry;
      const cy = y + height / 2;
      svg.label(task.label, 19, cy, { size: 13, align: 'start', maxWidth: 190 });
      const x = left + offset(task.startDate);
      if (task.status === 'milestone') {
        svg.add('polygon', { points: `${x},${cy - 8} ${x + 8},${cy} ${x},${cy + 8} ${x - 8},${cy}`, fill: entry.color });
      } else {
        const fill = task.status === 'crit' ? color('palette-3') : task.status === 'active' ? color('accent') : entry.color;
        svg.rect({ x, y: cy - 8, width: Math.max(3, offset(task.endDate) - offset(task.startDate)), height: 16 },
          { fill, stroke: 'none', opacity: task.status === 'done' ? .62 : 1, rx: 6 });
      }
    }
    return svg.graphic(width, row + 28, title ?? '甘特图');
  },
};
export default engine;
