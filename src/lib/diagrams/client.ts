import { LRUCache } from '../core/lru';
import type { DiagramReply, DiagramSource, ThemeMode, WorkerRequest } from '../core/protocol';
import { getDiagram, setDiagram } from '../storage/diagram-idb';

const encoder = new TextEncoder();
type Answer = Omit<DiagramReply, 'type' | 'requestId' | 'sourceHash'>;
type Send = (message: WorkerRequest) => void;
type Job = { resolve: (reply: DiagramReply) => void; reject: (error: unknown) => void };

export class DiagramClient {
  private readonly jobs = new Map<string, Job>();
  private readonly memory = new LRUCache<string, Answer>({ maxEntries: 80, maxBytes: 4 * 1024 * 1024 });
  private readonly inflight = new Map<string, { promise: Promise<Answer>; controller: AbortController; clients: number }>();
  private nextId = 0;

  constructor(private readonly send: Send) {}

  receive(reply: DiagramReply): void {
    this.jobs.get(reply.requestId)?.resolve(reply);
  }

  close(): void {
    for (const flight of this.inflight.values()) flight.controller.abort();
    this.inflight.clear();
    this.memory.clear();
  }

  render(source: DiagramSource, theme: ThemeMode, signal: AbortSignal): Promise<Answer> {
    signal.throwIfAborted();
    const version = source.detectedType === 'gantt' ? '1-' + new Date().toISOString().slice(0, 10) : '1';
    const key = `${version}:${source.detectedType}:${theme}:${source.sourceHash}`;
    const memory = this.memory.get(key);
    if (memory) return Promise.resolve(memory);
    let existing = this.inflight.get(key);
    if (!existing) {
      const controller = new AbortController();
      const pending = this.renderViaStorage(source, theme, key, controller.signal);
      const created = { promise: pending, controller, clients: 0 };
      this.inflight.set(key, created);
      const release = () => { if (this.inflight.get(key) === created) this.inflight.delete(key); };
      void pending.then(release, release);
      existing = created;
    }
    const flight = existing;
    flight.clients++;
    return new Promise<Answer>((resolve, reject) => {
      let settled = false;
      const detach = (): boolean => {
        if (settled) return false;
        settled = true;
        flight.clients--;
        signal.removeEventListener('abort', abort);
        return true;
      };
      const abort = () => {
        if (!detach()) return;
        if (flight.clients === 0) {
          if (this.inflight.get(key) === flight) this.inflight.delete(key);
          flight.controller.abort();
        }
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      void flight.promise.then(
        (answer) => { if (detach()) resolve(answer); },
        (error: unknown) => { if (detach()) reject(error); },
      );
    });
  }

  private async renderViaStorage(source: DiagramSource, theme: ThemeMode, key: string, signal: AbortSignal): Promise<Answer> {
    const started = performance.now();
    const cached = await getDiagram(key).catch(() => undefined);
    signal.throwIfAborted();
    if (cached) {
      const { svg, width, height, byteSize } = cached;
      const reply: Answer = { status: 'ok', diagramType: source.detectedType, svg, width, height, renderMs: performance.now() - started };
      this.memory.set(key, reply, byteSize);
      return reply;
    }

    const requestId = String(++this.nextId);
    const reply = await new Promise<DiagramReply>((resolve, reject) => {
      const done = () => {
        this.jobs.delete(requestId);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        done();
        this.send({ type: 'CANCEL_DIAGRAMS', requestIds: [requestId] });
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.jobs.set(requestId, {
        resolve(value) { done(); resolve(value); },
        reject(error) { done(); reject(error); },
      });
      try { this.send({ type: 'RENDER_DIAGRAM', requestId, ...source, themeMode: theme }); }
      catch (error) { this.jobs.get(requestId)?.reject(error); }
    });

    if (reply.status === 'ok' && reply.svg && reply.width && reply.height) {
      const graphic = { svg: reply.svg, width: reply.width, height: reply.height, byteSize: encoder.encode(reply.svg).byteLength, lastAccessedAt: Date.now() };
      this.memory.set(key, reply, graphic.byteSize);
      void setDiagram(key, graphic).catch(() => undefined);
    }
    return reply;
  }
}
