import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('IndexedDB settings', () => {
  it('lets callers fall back and retries when IndexedDB is unavailable', async () => {
    const error = new Error('Storage denied');
    const open = vi.fn(() => { throw error; });
    vi.stubGlobal('indexedDB', { open });
    const { getSettings } = await import('../src/lib/storage/idb');

    await expect(getSettings()).rejects.toBe(error);
    await expect(getSettings()).rejects.toBe(error);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('validates settings on read and resolves writes only after commit', async () => {
    const values = new Map<string, unknown>([['theme', 'dark'], ['prose', 'old-format']]);
    const put = vi.fn();
    const createObjectStore = vi.fn((..._args: Parameters<IDBDatabase['createObjectStore']>) => ({ createIndex: vi.fn() }));
    const transactions: IDBTransaction[] = [];
    const db = {
      createObjectStore,
      transaction: vi.fn(() => {
        const transaction = {
          objectStore: () => ({ get: (key: string) => ({ result: values.get(key) }), put }),
        } as unknown as IDBTransaction;
        transactions.push(transaction);
        return transaction;
      }),
    } as unknown as IDBDatabase;
    const request = { result: db } as IDBOpenDBRequest;
    const open = vi.fn(() => {
      queueMicrotask(() => {
        request.onupgradeneeded?.call(request, new Event('upgradeneeded') as IDBVersionChangeEvent);
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    });
    vi.stubGlobal('indexedDB', { open });

    const { getSettings, setSetting } = await import('../src/lib/storage/idb');
    const reading = getSettings();
    await vi.waitFor(() => expect(transactions).toHaveLength(1));
    transactions[0].oncomplete?.call(transactions[0], new Event('complete'));
    await expect(reading).resolves.toEqual({ theme: 'dark' });
    expect(createObjectStore.mock.calls.map((call) => call[0])).toEqual(['documents', 'settings', 'diagram_cache']);

    const committed = vi.fn();
    const writing = setSetting('prose', 'document').then(committed);
    await vi.waitFor(() => expect(put).toHaveBeenCalledWith('document', 'prose'));
    expect(committed).not.toHaveBeenCalled();
    transactions[1].oncomplete?.call(transactions[1], new Event('complete'));
    await writing;
    expect(committed).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledExactlyOnceWith('mdrt-db', 1);
  });
});
