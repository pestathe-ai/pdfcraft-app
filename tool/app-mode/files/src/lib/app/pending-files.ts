/**
 * Passaggio di file tra pagine (es. da "Converti" allo strumento giusto).
 * Usa IndexedDB, così funziona anche se la pagina viene ricaricata.
 */
const DB = 'pdfcraft-app';
const STORE = 'pending';

interface PendingRecord {
  slug: string;
  files: { name: string; type: string; lastModified: number; data: Blob }[];
  at: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setPendingFiles(slug: string, files: File[]): Promise<void> {
  const db = await open();
  const rec: PendingRecord = {
    slug,
    at: Date.now(),
    files: files.map((f) => ({ name: f.name, type: f.type, lastModified: f.lastModified, data: f })),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Restituisce (e cancella) i file in attesa per questo strumento, se ce ne sono. */
export async function takePendingFiles(slug: string): Promise<File[] | null> {
  let db: IDBDatabase;
  try {
    db = await open();
  } catch {
    return null;
  }
  const rec = await new Promise<PendingRecord | undefined>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('current');
    req.onsuccess = () => resolve(req.result as PendingRecord | undefined);
    req.onerror = () => resolve(undefined);
  });
  if (!rec || rec.slug !== slug || Date.now() - rec.at > 10 * 60 * 1000) {
    db.close();
    return null;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
  return rec.files.map((f) => new File([f.data], f.name, { type: f.type, lastModified: f.lastModified }));
}
