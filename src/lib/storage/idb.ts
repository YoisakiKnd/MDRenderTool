export interface Settings {
  theme: 'system' | 'light' | 'dark';
  prose: 'minimal' | 'github' | 'document';
  mode: 'editor' | 'split' | 'preview';
  sidebar: boolean;
  split: number;
  activeDocumentId: string;
}

let connection: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mdrt-db', 1);
    let blocked = false;

    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('documents', { keyPath: 'id' });
      db.createObjectStore('settings');
      db.createObjectStore('diagram_cache').createIndex('lastAccessedAt', 'lastAccessedAt');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('IndexedDB is blocked by another tab'));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }

      const release = () => {
        db.close();
        if (connection === opening) connection = undefined;
      };
      db.onversionchange = release;
      db.onclose = release;
      resolve(db);
    };
  });

  connection = opening;
  void opening.catch(() => {
    if (connection === opening) connection = undefined;
  });
  return opening;
}

export async function getSettings(): Promise<Partial<Settings>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const theme = store.get('theme');
    const prose = store.get('prose');
    const mode = store.get('mode');
    const sidebar = store.get('sidebar');
    const split = store.get('split');
    const active = store.get('activeDocumentId');

    transaction.onabort = () => reject(transaction.error);
    transaction.oncomplete = () => {
      const settings: Partial<Settings> = {};
      if (theme.result === 'system' || theme.result === 'light' || theme.result === 'dark') {
        settings.theme = theme.result;
      }
      if (prose.result === 'minimal' || prose.result === 'github' || prose.result === 'document') {
        settings.prose = prose.result;
      }
      if (mode.result === 'editor' || mode.result === 'split' || mode.result === 'preview') settings.mode = mode.result;
      if (typeof sidebar.result === 'boolean') settings.sidebar = sidebar.result;
      if (typeof split.result === 'number' && split.result >= 25 && split.result <= 75) settings.split = split.result;
      if (typeof active.result === 'string') settings.activeDocumentId = active.result;
      resolve(settings);
    };
  });
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    transaction.objectStore('settings').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
  });
}

export interface DraftSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface LocalDocument extends DraftSummary {
  content: string;
  cursorLine: number;
  scrollTop: number;
  previewLine?: number;
  fileHandleName?: string;
  fileHandle?: FileSystemFileHandle;
}

const draftIndex = 'documents_index';

export async function getDocument(id: string): Promise<LocalDocument | undefined> {
  const db = await openDatabase();
  return requestValue(db.transaction('documents').objectStore('documents').get(id));
}

export async function listDocuments(): Promise<DraftSummary[]> {
  const db = await openDatabase();
  const transaction = db.transaction(['documents', 'settings']);
  const summaries = await requestValue<DraftSummary[] | undefined>(transaction.objectStore('settings').get(draftIndex));
  if (summaries) return summaries.sort((left, right) => right.updatedAt - left.updatedAt);
  return readDocumentIndex(transaction.objectStore('documents'));
}

function readDocumentIndex(store: IDBObjectStore): Promise<DraftSummary[]> {
  const request = store.openCursor();
  const list: DraftSummary[] = [];
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(list.sort((left, right) => right.updatedAt - left.updatedAt));
        return;
      }
      const { id, title, updatedAt } = cursor.value as LocalDocument;
      list.push({ id, title, updatedAt });
      cursor.continue();
    };
  });
}

async function updateDocuments(id: string, draft?: LocalDocument): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(['documents', 'settings'], 'readwrite');
  const done = committed(transaction);
  const store = transaction.objectStore('documents');
  const settings = transaction.objectStore('settings');
  try {
    const previous = await requestValue<DraftSummary[] | undefined>(settings.get(draftIndex))
      ?? await readDocumentIndex(store);
    const updated = previous.filter((item) => item.id !== id);
    if (draft) {
      const { title, updatedAt } = draft;
      store.put(draft);
      updated.push({ id, title, updatedAt });
    } else {
      store.delete(id);
    }
    settings.put(updated, draftIndex);
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

export function putDocument(draft: LocalDocument): Promise<void> {
  return updateDocuments(draft.id, draft);
}

export function removeDocument(id: string): Promise<void> {
  return updateDocuments(id);
}
