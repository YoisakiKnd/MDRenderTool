import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const workerSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const scope = 'https://mdrt.test/notes/';
const url = (path: string) => new URL(path, scope).href;
const immutable = 'mdrt-immutable-v1';
const core = 'assets/index-core123.js';
const lazy = 'assets/vendor-katex-lazy123.js';

class TestCache {
  readonly entries = new Map<string, Response>();
  async put(key: string, value: Response) { this.entries.set(key, value.clone()); }
  async match(key: string) { return this.entries.get(key)?.clone(); }
  async keys() { return [...this.entries.keys()].map((key) => new Request(key)); }
  async delete(key: Request) { return this.entries.delete(key.url); }
}

function startWorker(version = 'v1', extraAssets = [lazy]) {
  const handlers = new Map<string, (event: unknown) => void>();
  const storage = new Map<string, TestCache>();
  const open = async (name: string) => {
    let cache = storage.get(name);
    if (!cache) storage.set(name, cache = new TestCache());
    return cache;
  };
  const server = new Map([
    [url('index.html'), `<meta name="mdrt-build" content="${version}" />`],
    [url(''), 'online navigation'],
    [url(core), 'app'],
    [url(lazy), 'KaTeX'],
  ]);
  const fetch = vi.fn(async (request: string | Request) => {
    const address = typeof request === 'string' ? request : request.url;
    const body = server.get(address);
    return new Response(body, { status: body === undefined ? 404 : 200 });
  });
  const claim = vi.fn(async () => undefined);
  const skipWaiting = vi.fn(async () => undefined);
  const manifest = { version, shell: ['index.html', core], assets: [core, ...extraAssets] };
  runInNewContext(workerSource.replace('/* __MDRT_MANIFEST__ */ null', JSON.stringify(manifest)), {
    URL, Response, fetch, console,
    self: {
      registration: { scope },
      clients: { claim },
      skipWaiting,
      addEventListener: (type: string, listener: (event: unknown) => void) => handlers.set(type, listener),
    },
    caches: {
      open,
      keys: async () => [...storage.keys()],
      delete: async (name: string) => storage.delete(name),
    },
  });

  function lifecycle(type: string, data?: unknown): Promise<void> | undefined {
    let pending: Promise<void> | undefined;
    handlers.get(type)?.({ data, waitUntil: (promise: Promise<void>) => { pending = promise; } });
    return pending;
  }

  function request(path: string, mode: string, headers = new Headers(), method = 'GET'): Promise<Response> | undefined {
    let pending: Promise<Response> | undefined;
    handlers.get('fetch')?.({
      request: { url: url(path), method, mode, headers },
      respondWith: (promise: Promise<Response>) => { pending = promise; },
    });
    return pending;
  }

  return { lifecycle, request, fetch, open, server, storage, claim, skipWaiting };
}

describe('Service Worker', () => {
  it('precaches only the shell and navigates network-first with offline fallback', async () => {
    const worker = startWorker();
    await worker.lifecycle('install');
    expect(worker.fetch.mock.calls.map(([request]) => request)).toEqual([url('index.html'), url(core)]);
    expect(await (await worker.request('', 'navigate'))?.text()).toBe('online navigation');

    worker.fetch.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await worker.request('?draft=1', 'navigate'))?.text()).toContain('content="v1"');
    expect(await (await worker.request('index.html', 'navigate'))?.text()).toContain('content="v1"');
  });

  it('stores lazy assets once and serves canonical hash paths cache-first', async () => {
    const worker = startWorker();
    await worker.lifecycle('install');
    expect(await (await worker.request(lazy + '?first=1', 'cors'))?.text()).toBe('KaTeX');
    worker.fetch.mockClear();
    expect(await (await worker.request(lazy, 'cors'))?.text()).toBe('KaTeX');
    expect(await (await worker.request(core, 'cors'))?.text()).toBe('app');
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('warms core settings UI on activation without loading diagram or export engines', async () => {
    const panel = 'assets/DraftPane-new12345.js';
    const worker = startWorker('v1', [panel, lazy]);
    worker.server.set(url(panel), 'draft controls');
    await worker.lifecycle('install');
    const storage = await worker.open(immutable);
    expect(await storage.match(url(panel))).toBeUndefined();
    await worker.lifecycle('activate');
    expect(await (await storage.match(url(panel)))?.text()).toBe('draft controls');
    expect(await storage.match(url(lazy))).toBeUndefined();
  });

  it('only handles supported same-origin routes and full GETs', () => {
    const worker = startWorker();
    expect(worker.request('https://external.test/' + lazy, 'cors')).toBeUndefined();
    expect(worker.request('assets/unversioned.js', 'cors')).toBeUndefined();
    expect(worker.request('outside', 'navigate')).toBeUndefined();
    expect(worker.request(core, 'cors', new Headers({ Range: 'bytes=0-5' }))).toBeUndefined();
    expect(worker.request(core, 'cors', new Headers(), 'POST')).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it('removes superseded shell and hashes while preserving live lazy chunks and unrelated caches', async () => {
    const worker = startWorker('v2');
    const oldShell = await worker.open('mdrt-shell-v1');
    const cache = await worker.open(immutable);
    await worker.open('another-app');
    await oldShell.put(url('index.html'), new Response('old shell'));
    await cache.put(url('assets/retired.js'), new Response('old asset'));
    await cache.put(url(lazy), new Response('reused lazy asset'));
    await cache.put(url(core), new Response('reused core asset'));
    await worker.lifecycle('install');
    await worker.lifecycle('activate');

    expect([...worker.storage.keys()]).toEqual([immutable, 'another-app', 'mdrt-shell-v2']);
    expect((await cache.keys()).map((key) => key.url)).toEqual([url(lazy), url(core)]);
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.claim).toHaveBeenCalledOnce();
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    await worker.lifecycle('message', { type: 'SKIP_WAITING' });
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it('rejects mismatched and partial deployments without exposing an incomplete shell', async () => {
    const worker = startWorker();
    worker.server.set(url('index.html'), '<meta name="mdrt-build" content="v2" />');
    await expect(worker.lifecycle('install')).rejects.toThrow('changed during installation');
    worker.server.set(url('index.html'), '<meta name="mdrt-build" content="v1" />');
    worker.server.delete(url(core));
    await expect(worker.lifecycle('install')).rejects.toThrow('404');
    expect(await (await worker.open('mdrt-shell-v1')).match(url('index.html'))).toBeUndefined();
  });
});
