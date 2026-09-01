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
  // We store the file bytes as an ArrayBuffer (not a Blob). iOS Safari/PWA has
  // a long-standing bug where a Blob written to IndexedDB comes back empty or
  // unreadable, which produced a corrupted/empty multipart body on upload
  // (server saw no file → 422). ArrayBuffers round-trip reliably; we rebuild
  // the Blob from `data` + `mime` at upload time.
  data: ArrayBuffer;
  mime: string;
  blob?: Blob;         // legacy items enqueued before the ArrayBuffer switch
  filename: string;
  thumb: string;      // base64 (no data-url prefix), may be ''
  created_at: number;
  tries: number;
  // A permanent (4xx) failure — the file itself is the problem (too big, bad
  // type, no permission). We stop retrying these and surface the reason so the
  // user can cancel; only transient (network / 5xx) errors keep retrying.
  permanent?: boolean;
  error?: string;
  endpoint?: string;  // default '/documents'
  // Documents:
  category_key?: string;
  note?: string;
  // Record photos (repair/sample/employee):
  ref_type?: string;
  ref_id?: string;
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

async function idbGet(id: string): Promise<OutboxItem | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as OutboxItem | undefined);
    req.onerror = () => reject(req.error);
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

// Lightweight metadata for the queue UI (no blob needed to render the list).
export type OutboxMeta = {
  id: string; filename: string; thumb: string; tries: number; created_at: number;
  category_key?: string; ref_type?: string; endpoint?: string;
  permanent?: boolean; error?: string;
};

export async function outboxItems(): Promise<OutboxMeta[]> {
  if (!hasIDB()) return [];
  const items = await idbAll();
  return items.map((i) => ({
    id: i.id, filename: i.filename, thumb: i.thumb, tries: i.tries || 0, created_at: i.created_at,
    category_key: i.category_key, ref_type: i.ref_type, endpoint: i.endpoint,
    permanent: i.permanent, error: i.error,
  }));
}

// Cancel one queued/stuck item. Safe even if it's the one currently uploading —
// the worker checks for its removal before any retry, so it won't come back.
export async function cancelUpload(id: string): Promise<void> {
  if (!hasIDB()) return;
  await idbDel(id);
  await emitCount();
}

// Set/replace the note (remark) on a queued item — used by quick capture's
// optional "add remark" after a photo is already queued. No-op if it already
// uploaded and left the outbox.
export async function updateOutboxNote(id: string, note: string): Promise<void> {
  if (!hasIDB()) return;
  const item = await idbGet(id).catch(() => undefined);
  if (!item) return;
  item.note = note;
  try { await idbPut(item); } catch { /* ignore */ }
}

export async function clearOutbox(): Promise<void> {
  if (!hasIDB()) return;
  const items = await idbAll();
  for (const it of items) { try { await idbDel(it.id); } catch { /* ignore */ } }
  await emitCount();
}

// Force an immediate retry pass (e.g. after the connection is back). Also
// clears any "permanent failure" flags so those items get one more attempt —
// the user asked to retry, so honor it.
export async function retryUploads(): Promise<void> {
  if (hasIDB()) {
    try {
      const items = await idbAll();
      for (const it of items) {
        if (it.permanent) { it.permanent = false; it.error = undefined; it.tries = 0; await idbPut(it); }
      }
      await emitCount();
    } catch { /* ignore */ }
  }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  draining = false;
  drain();
}

// ---- the worker ----
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function buildForm(item: OutboxItem): FormData {
  const form = new FormData();
  // Rebuild the Blob from the stored ArrayBuffer (falling back to a legacy
  // stored Blob for items enqueued before the switch).
  const fileBlob = item.data
    ? new Blob([item.data], { type: item.mime || 'application/octet-stream' })
    : item.blob;
  form.append('file', fileBlob as Blob, item.filename);
  if (item.thumb) form.append('thumb', item.thumb);
  if (item.category_key) form.append('category_key', item.category_key);
  if (item.note !== undefined) form.append('note', item.note || '');
  if (item.ref_type) form.append('ref_type', item.ref_type);
  if (item.ref_id) form.append('ref_id', item.ref_id);
  // Idempotency: a retry after a timeout (where the server actually saved it)
  // must not create a duplicate — the server dedupes on this key.
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
      // Skip items already marked as a permanent failure — they stay in the
      // outbox (shown as "failed" in the badge) until the user cancels them,
      // but must not block the rest of the queue or be retried.
      const item = items.find((i) => !i.permanent);
      if (!item) break;
      try {
        await api.upload(item.endpoint || '/documents', buildForm(item));
        await idbDel(item.id);
        await emitCount();
      } catch (e: any) {
        // If the user cancelled this item while it was in flight, it's no
        // longer in the outbox — don't resurrect it by writing it back.
        const still = await idbGet(item.id).catch(() => undefined);
        if (!still) { await emitCount(); continue; }
        const status = Number(e?.status) || 0;
        // 4xx = the file/request itself is wrong (too large, bad type, no
        // permission) — retrying can never succeed, so mark it failed and move
        // on. Everything else (network drop, 5xx) is transient → back off/retry.
        if (status >= 400 && status < 500) {
          item.permanent = true;
          item.error = e?.detail || 'Upload rejected';
          try { await idbPut(item); } catch { /* ignore */ }
          await emitCount();
          continue;   // try the next item; don't schedule a retry for this one
        }
        item.tries = (item.tries || 0) + 1;
        try { await idbPut(item); } catch { /* ignore */ }
        await emitCount();
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

// Public input: callers hand us a Blob; we convert it to an ArrayBuffer for
// safe IndexedDB storage (see the note on OutboxItem.data).
export type EnqueueInput = {
  id: string; blob: Blob; filename: string; thumb: string;
  endpoint?: string; category_key?: string; note?: string; ref_type?: string; ref_id?: string;
};

export async function enqueueUpload(input: EnqueueInput): Promise<void> {
  const { blob, ...rest } = input;
  const data = await blob.arrayBuffer();
  const rec: OutboxItem = { ...rest, data, mime: blob.type || 'application/octet-stream', created_at: Date.now(), tries: 0 };
  if (!hasIDB()) {
    // No IndexedDB (shouldn't happen on web) — fall back to a direct upload.
    await api.upload(rec.endpoint || '/documents', buildForm(rec));
    return;
  }
  await idbPut(rec);
  await emitCount();
  drain();
}

// Convenience for a high-res record photo (repair/sample/employee) → uploads to
// Drive in the background via /record-photos, keeping only a thumbnail.
export async function enqueueRecordPhoto(args: {
  id: string; blob: Blob; filename: string; thumb: string; ref_type: string; ref_id: string;
}): Promise<void> {
  await enqueueUpload({ ...args, endpoint: '/record-photos' });
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
