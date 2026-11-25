import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../src/lib/storage/sw-register';

function browser() {
  const waiting = Object.assign(new EventTarget(), { postMessage: vi.fn(), state: 'installed' });
  const registration = Object.assign(new EventTarget(), {
    waiting: null as typeof waiting | null,
    installing: null as typeof waiting | null,
  });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: null as typeof waiting | null,
    register: vi.fn(async () => registration),
  });
  const reload = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker });
  vi.stubGlobal('window', { location: { reload } });
  return { serviceWorker, registration, waiting, reload };
}

function callbacks() {
  return { onReady: vi.fn(), onUpdate: vi.fn<(applyUpdate: () => void) => void>(), onError: vi.fn() };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('service worker registration', () => {
  it('stays disabled during development', () => {
    vi.stubEnv('DEV', true);
    const { serviceWorker } = browser();
    const stop = registerServiceWorker(callbacks());
    expect(serviceWorker.register).not.toHaveBeenCalled();
    stop();
  });

  it('registers a same-origin script and announces when the first worker claims the page', async () => {
    vi.stubEnv('DEV', false);
    const { serviceWorker, waiting, reload } = browser();
    const events = callbacks();
    const stop = registerServiceWorker(events);
    await Promise.resolve();
    expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    expect(events.onReady).not.toHaveBeenCalled();

    serviceWorker.controller = waiting;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(events.onReady).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    stop();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(events.onReady).toHaveBeenCalledOnce();
  });

  it('announces an installed update once and reloads only after it takes control', async () => {
    vi.stubEnv('DEV', false);
    const { serviceWorker, registration, waiting, reload } = browser();
    serviceWorker.controller = Object.assign(new EventTarget(), { postMessage: vi.fn(), state: 'activated' });
    const events = callbacks();
    const stop = registerServiceWorker(events);
    await Promise.resolve();

    registration.installing = waiting;
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = waiting;
    waiting.dispatchEvent(new Event('statechange'));
    waiting.dispatchEvent(new Event('statechange'));
    expect(events.onUpdate).toHaveBeenCalledOnce();

    events.onUpdate.mock.calls[0][0]();
    events.onUpdate.mock.calls[0][0]();
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();

    serviceWorker.controller = waiting;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
    stop();
  });
});
