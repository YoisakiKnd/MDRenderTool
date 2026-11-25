/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '../core/protocol';
import { MarkdownParser } from './markdown-parser';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const parser = new MarkdownParser();
const send = (message: WorkerResponse) => worker.postMessage(message);
type ParseRequest = Extract<WorkerRequest, { type: 'PARSE_DOC' }>;
let nextParse: ParseRequest | undefined;
let parsing = false;
type DiagramRequest = Extract<WorkerRequest, { type: 'RENDER_DIAGRAM' }>;
const graphics = new Map<string, DiagramRequest>();
let diagramTimer: ReturnType<typeof setTimeout> | undefined;
let drawing: { id: string; cancelled: boolean } | undefined;

function scheduleDiagram(): void {
  if (diagramTimer !== undefined || drawing || parsing || !graphics.size) return;
  diagramTimer = setTimeout(() => {
    diagramTimer = undefined;
    void drawNext();
  }, 0);
}

async function drawNext(): Promise<void> {
  if (parsing) return;
  const request = graphics.values().next().value;
  if (!request) return;

  const { requestId, sourceHash } = request;
  graphics.delete(requestId);
  const job = { id: requestId, cancelled: false };
  drawing = job;
  const started = performance.now();
  try {
    const { renderDiagram } = await import('../diagrams/registry');
    if (job.cancelled) return;
    const result = await renderDiagram(request.fenceLang, request.source, request.themeMode);
    if (!job.cancelled) send({ ...result, type: 'DIAGRAM_RESULT', requestId, sourceHash, renderMs: performance.now() - started });
  } catch {
    if (!job.cancelled) send({ type: 'DIAGRAM_RESULT', status: 'error', reason: '图表引擎无法加载。', requestId, sourceHash, renderMs: performance.now() - started });
  } finally {
    drawing = undefined;
    scheduleDiagram();
  }
}

async function drainParses(): Promise<void> {
  if (parsing) return;
  parsing = true;
  try {
    while (nextParse) {
      const request = nextParse;
      nextParse = undefined;
      try {
        send(await parser.parse(request.text, request.docVersion, request.baseVersion));
      } catch (error) {
        send({ type: 'PARSE_ERROR', docVersion: request.docVersion, reason: error instanceof Error ? error.message : '文档解析失败' });
      }
    }
  } finally {
    parsing = false;
    scheduleDiagram();
  }
}

worker.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'PARSE_DOC') {
    nextParse = data;
    void drainParses();
  } else if (data.type === 'RENDER_DIAGRAM') {
    graphics.set(data.requestId, data);
    scheduleDiagram();
  } else if (data.type === 'CANCEL_DIAGRAMS') {
    for (const id of data.requestIds) {
      graphics.delete(id);
      if (drawing?.id === id) drawing.cancelled = true;
    }
  }
};
