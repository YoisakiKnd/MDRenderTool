import { diagramTypes, type DiagramDialect, type DiagramType } from './types';

export type Detection = { dialect: DiagramDialect; type: DiagramType | 'unsupported'; reason?: string };

const mermaid: Array<[RegExp, DiagramType]> = [
  [/^sequenceDiagram\b/i, 'sequence'], [/^(?:flowchart|graph)\b/i, 'flowchart'],
  [/^classDiagram\b/i, 'class'], [/^stateDiagram(?:-v2)?\b/i, 'state'], [/^erDiagram\b/i, 'er'],
  [/^mindmap\b/i, 'mindmap'], [/^gantt\b/i, 'gantt'], [/^pie\b/i, 'pie'],
];

export function detectDiagram(language: string, source: string): Detection {
  const fence = language.toLowerCase();
  const dialect: DiagramDialect = /^(?:plantuml|puml|uml)$/.test(fence) || /^\s*@start/i.test(source) ? 'plantuml' : 'mermaid';
  if (/^\s*!(?:include\w*|import)\b/im.test(source)) {
    return { dialect, type: 'unsupported', reason: 'PlantUML 外部包含指令不可用。' };
  }
  if ((diagramTypes as readonly string[]).includes(fence)) return { dialect: 'generic', type: fence as DiagramType };

  const rawLines = source.split(/\r?\n/, 160).map((line) => line.trim())
    .filter((line) => line && !/^(?:%%|')/.test(line));
  const first = rawLines[0] ?? '';
  if (dialect === 'plantuml') {
    if (/^@start(?:mindmap|wbs)\b/i.test(first)) return { dialect, type: 'mindmap' };
    if (/^@startgantt\b/i.test(first)) return { dialect, type: 'gantt' };
    if (/^@startpie\b/i.test(first)) return { dialect, type: 'pie' };
    const semantic: string[] = [];
    let skinDepth = 0;
    for (const line of rawLines) {
      if (skinDepth > 0) {
        if (line.includes('{')) skinDepth++;
        if (line.includes('}')) skinDepth--;
        continue;
      }
      if (/^skinparam\b/i.test(line)) {
        if (line.includes('{') && !line.includes('}')) skinDepth = 1;
        continue;
      }
      if (/^(?:title|header|footer|hide|show|scale|left to right direction|top to bottom direction)\b/i.test(line)) continue;
      semantic.push(line);
      if (semantic.length >= 40) break;
    }
    const body = semantic.join('\n');
    const candidates: Array<[RegExp, DiagramType]> = [
      [/^\s*(?:class|interface|abstract|enum)\s+/im, 'class'],
      [/^\s*entity\s+|\|\|--|\}o--/im, 'er'],
      [/\[\*\]\s*-->|^\s*state\s+/im, 'state'],
      [/^\s*(?:start\b|stop\b|if\s*\(|:[^\n]*;|rectangle\b|node\b|component\b|cloud\b)/im, 'flowchart'],
      [/^\s*(?:participant|actor|database)\s+|\S+[ \t]*-+>>?[ \t]*\S+[ \t]*:/im, 'sequence'],
    ];
    if (!/^\s*(?:salt|nwdiag|archimate)\b/im.test(body)) {
      for (const [pattern, type] of candidates) if (pattern.test(body)) return { dialect, type };
    }
  } else {
    for (const [pattern, type] of mermaid) if (pattern.test(first)) return { dialect, type };
  }
  return { dialect, type: 'unsupported', reason: `未收录图表语法 ${first.slice(0, 80) || '（空源码）'}。` };
}
