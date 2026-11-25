import type { DiagramReply, ThemeMode } from '../core/protocol';
import { detectDiagram } from './detector';
import { DiagramSyntaxError, type DiagramEngine, type DiagramType } from './types';

const loaders: Record<DiagramType, () => Promise<{ default: DiagramEngine }>> = {
  sequence: () => import('./engines/sequence'),
  flowchart: () => import('./engines/flowchart'),
  mindmap: () => import('./engines/mindmap'),
  class: () => import('./engines/class'),
  state: () => import('./engines/state'),
  er: () => import('./engines/er'),
  gantt: () => import('./engines/gantt'),
  pie: () => import('./engines/pie'),
};

type RenderResult = Omit<DiagramReply, 'type' | 'requestId' | 'sourceHash' | 'renderMs'>;

export async function renderDiagram(fenceLang: string, source: string, themeMode: ThemeMode): Promise<RenderResult> {
  const { type, dialect, reason } = detectDiagram(fenceLang, source);
  if (type === 'unsupported') return { status: 'unsupported', diagramType: type, reason };
  const load = loaders[type];
  if (source.length > 120_000 || source.split('\n', 1_201).length > 1_200) {
    return { status: 'error', diagramType: type, reason: '图表超过 1,200 行或 120,000 字符。' };
  }
  try {
    const { default: engine } = await load();
    const graphic = engine.render(engine.parse(source, dialect), { themeMode });
    return { status: 'ok', diagramType: type, ...graphic };
  } catch (error) {
    return {
      status: 'error', diagramType: type,
      reason: error instanceof Error ? error.message : '图表渲染失败。',
      errorLine: error instanceof DiagramSyntaxError ? error.line : undefined,
    };
  }
}
