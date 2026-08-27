// Persistent, background upload queue for captured documents.
//
// Capture writes the (already-shrunk) photo into an IndexedDB "outbox" and
// returns instantly — the user never waits on the network. A single background
// worker drains the outbox, uploading each item and deleting it on success.
// Because the outbox lives in IndexedDB, a photo survives an app close, reload,
// or connection drop and is retried automatically — so nothing is ever lost.

import { api } from '@/src/api/client';

export type OutboxItem = {
  id: string;
  blob: Blob;
  filename: string;
  category_key: string;
  note: string;
  thumb: string;      // base64 (no data-url prefix), may be ''
  created_at: number;
  tries: number;
};

const DB_NAME = 'rmj-doc-outbox';
const STORE = 'items';

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll(): Promise<OutboxItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as OutboxItem[]).sort((a, b) => a.created_at - b.created_at));
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(item: OutboxItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- listeners (so the UI can show "N waiting to upload") ----
type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let lastCount = 0;

async function emitCount() {
  try {
    lastCount = hasIDB() ? (await idbAll()).length : 0;
  } catch { /* ignore */ }
  listeners.forEach((l) => { try { l(lastCount); } catch { /* ignore */ } });
}

export function onOutboxChange(cb: Listener): () => void {
  listeners.add(cb);
  cb(lastCount);
  emitCount();
  return () => { listeners.delete(cb); };
}

export async function outboxCount(): Promise<number> {
  return hasIDB() ? (await idbAll()).length : 0;
}

// ---- the worker ----
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function buildForm(item: OutboxItem): FormData {
  const form = new FormData();
  form.append('file', item.blob, item.filename);
  form.append('category_key', item.category_key);
  form.append('note', item.note || '');
  if (item.thumb) form.append('thumb', item.thumb);
  // Idempotency: a retry after a timeout (where the server actually saved the
  // doc) must not create a duplicate — the server dedupes on this key.
  form.append('client_id', item.id);
  return form;
}

async function drain(): Promise<void> {
  if (draining || !hasIDB()) return;
  draining = true;
  try {
    // Process oldest-first, one at a time. On a failure, stop and schedule a
    // retry with backoff — the item stays in the outbox and is tried again.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const items = await idbAll();
      if (items.length === 0) break;
      const item = items[0];
      try {
        await api.upload('/documents', buildForm(item));
        await idbDel(item.id);
        await emitCount();
      } catch {
        item.tries = (item.tries || 0) + 1;
        try { await idbPut(item); } catch { /* ignore */ }
        // Back off (cap ~30s) and try the whole drain again later.
        const delay = Math.min(30000, 2000 * Math.max(1, item.tries));
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => { draining = false; drain(); }, delay);
        return;   // leave `draining` true until the retry fires
      }
    }
  } finally {
    draining = false;
  }
}

export async function enqueueUpload(item: Omit<OutboxItem, 'created_at' | 'tries'>): Promise<void> {
  if (!hasIDB()) {
    // No IndexedDB (shouldn't happen on web) — fall back to a direct upload.
    await api.upload('/documents', buildForm({ ...item, created_at: Date.now(), tries: 0 }));
    return;
  }
  const rec: OutboxItem = { ...item, created_at: Date.now(), tries: 0 };
  await idbPut(rec);
  await emitCount();
  drain();
}

let started = false;
export function startUploadQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => drain());
  // Kick a drain on startup so anything left from a previous session goes out.
  emitCount();
  drain();
}
