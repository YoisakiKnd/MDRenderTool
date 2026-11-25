import { committed, openDatabase, requestValue } from './idb';

export interface CachedDiagram {
  svg: string;
  width: number;
  height: number;
  lastAccessedAt: number;
  byteSize: number;
}

const diagramLimit = { entries: 200, bytes: 8 * 1024 * 1024 };
const usageKey = 'diagram_cache_usage';

export async function getDiagram(key: string): Promise<CachedDiagram | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction('diagram_cache', 'readwrite');
  const store = transaction.objectStore('diagram_cache');
  const done = committed(transaction);
  try {
    const entry = await requestValue<CachedDiagram | undefined>(store.get(key));
    if (entry) {
      entry.lastAccessedAt = Date.now();
      store.put(entry, key);
    }
    await done;
    return entry;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

export function diagramUsage(previous: { entries: number; bytes: number }, oldBytes: number | undefined, newBytes: number): { entries: number; bytes: number } {
  return {
    entries: previous.entries + (oldBytes === undefined ? 1 : 0),
    bytes: previous.bytes - (oldBytes ?? 0) + newBytes,
  };
}

export async function setDiagram(key: string, graphic: CachedDiagram): Promise<void> {
  if (graphic.byteSize > diagramLimit.bytes) return;
  const db = await openDatabase();
  const transaction = db.transaction(['diagram_cache', 'settings'], 'readwrite');
  const done = committed(transaction);
  const store = transaction.objectStore('diagram_cache');
  const settings = transaction.objectStore('settings');

  try {
    const [old, recorded] = await Promise.all([
      requestValue<CachedDiagram | undefined>(store.get(key)),
      requestValue<{ entries: number; bytes: number } | undefined>(settings.get(usageKey)),
    ]);
    const usage = diagramUsage(recorded ?? { entries: 0, bytes: 0 }, old?.byteSize, graphic.byteSize);
    store.put(graphic, key);
    if (usage.entries > diagramLimit.entries || usage.bytes > diagramLimit.bytes) {
      const evictions = store.index('lastAccessedAt').openCursor();
      await new Promise<void>((resolve, reject) => {
        evictions.onerror = () => reject(evictions.error);
        evictions.onsuccess = () => {
          const cursor = evictions.result;
          if (!cursor || (usage.entries <= diagramLimit.entries && usage.bytes <= diagramLimit.bytes)) {
            resolve();
            return;
          }
          if (cursor.primaryKey !== key) {
            usage.entries--;
            usage.bytes -= (cursor.value as CachedDiagram).byteSize;
            cursor.delete();
          }
          cursor.continue();
        };
      });
    }
    settings.put(usage, usageKey);
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

