import type { ThemeMode } from '../core/protocol';

export const diagramTypes = ['sequence', 'flowchart', 'class', 'state', 'er', 'mindmap', 'gantt', 'pie'] as const;
export type DiagramType = typeof diagramTypes[number];
export type DiagramDialect = 'mermaid' | 'plantuml' | 'generic';
export type Direction = 'TB' | 'BT' | 'LR' | 'RL';
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface DiagramGraphic { svg: string; width: number; height: number }

export interface DiagramEngine<IR = unknown> {
  readonly type: DiagramType;
  readonly version: string;
  parse(source: string, dialect: DiagramDialect): IR;
  render(ir: IR, options: { themeMode: ThemeMode }): DiagramGraphic;
}

export class DiagramSyntaxError extends Error {
  constructor(message: string, readonly line?: number) { super(message); }
}

export function sourceLines(source: string): { text: string; line: number }[] {
  return source.split(/\r?\n/).flatMap((line, index) => {
    const text = line.trim();
    return !text || /^(?:%%|'|@(?:start|end)\w+)/i.test(text) ? [] : [{ text, line: index + 1 }];
  });
}

export function unquote(value: string): string {
  return value.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

export function directionOf(input: string): Direction {
  const direction = input.toUpperCase();
  return direction === 'LR' || direction === 'RL' || direction === 'BT' ? direction : 'TB';
}
