// Keeps the planner's last Dispatch Planning preview, with its workbook, in
// this browser (IndexedDB) so a menu change or a reload does not lose it while
// today's planning is open. Nothing here is trusted by the server: confirming
// still needs a valid preview token.

const DATABASE = "stockpro-dispatch";
const STORE = "preview";
const KEY = "current";

export type StoredDispatchPreview<T> = {
  planId: string;
  userId: string;
  savedAt: number;
  fileName: string;
  file: Blob;
  preview: T;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<R>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<R>
): Promise<R> {
  const database = await openDatabase();
  try {
    return await new Promise<R>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function loadStoredDispatchPreview<T>(): Promise<StoredDispatchPreview<T> | null> {
  try {
    const value = await withStore("readonly", (store) => store.get(KEY));
    return (value as StoredDispatchPreview<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveStoredDispatchPreview<T>(value: StoredDispatchPreview<T>) {
  try {
    await withStore("readwrite", (store) => store.put(value, KEY));
  } catch {
    // Private windows or a full disk: the preview simply is not kept.
  }
}

export async function clearStoredDispatchPreview() {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // Nothing stored or storage unavailable.
  }
}

/** When the signed preview token stops being accepted by the confirmation. */
export function dispatchPreviewExpiresAt(token: string | undefined) {
  if (!token) return null;
  try {
    const encoded = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    const match = /"expiresAt":(\d+)/.exec(atob(padded));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
