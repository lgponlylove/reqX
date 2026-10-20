/** Lưu body response các lần chạy lịch vào IndexedDB (localStorage không chứa nổi body/file). */
export interface StoredBody {
  key: string;
  body: string;
  bodyKind: 'text' | 'binary';
  contentType: string;
  savedAt: number;
}

const DB_NAME = 'postman-clone-bodies';
const STORE = 'bodies';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const rq = fn(t.objectStore(STORE));
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
        t.oncomplete = () => db.close();
        t.onerror = () => {
          try { db.close(); } catch { /* ignore */ }
        };
      }),
  );
}

/** Key: `${scheduleId}:${runAt}:${stepIndex}` */
export function bodyKey(scheduleId: string, runAt: number, index: number): string {
  return `${scheduleId}:${runAt}:${index}`;
}

export async function saveBodies(
  items: Omit<StoredBody, 'savedAt'>[],
): Promise<void> {
  const at = Date.now();
  for (const item of items) {
    try {
      await tx('readwrite', (s) => s.put({ ...item, savedAt: at }));
    } catch {
      // Quota đầy → bỏ qua body này, thử tiếp body sau (lịch sử tổng hợp vẫn còn)
      continue;
    }
  }
}

export async function getBody(key: string): Promise<StoredBody | undefined> {
  try {
    return await tx('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

/** Xóa body của các lần chạy đã bị đẩy khỏi top-20 của lịch này. */
export async function pruneBodies(scheduleId: string, keepAts: Set<number>): Promise<void> {
  try {
    const keys = await tx<string[]>('readonly', (s) => s.getAllKeys() as IDBRequest<string[]>);
    const prefix = `${scheduleId}:`;
    const stale = keys.filter((k) => {
      if (!k.startsWith(prefix)) return false;
      const at = Number(k.slice(prefix.length).split(':')[0]);
      return !keepAts.has(at);
    });
    for (const k of stale) {
      try {
        await tx('readwrite', (s) => s.delete(k));
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
