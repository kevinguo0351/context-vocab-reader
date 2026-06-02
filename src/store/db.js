// IndexedDB store via the `idb` wrapper. Two object stores:
//   library — book metadata (NOT the file bytes; those re-loaded from disk
//             each session at MVP. Phase 1 Tauri shell adds real caching).
//             Keyed by `${name}|${size}` so re-opening the same file finds
//             its prior progress.
//   vocab   — append-only word log mirrored from successful Eudic saves;
//             feeds the future export-to-CSV/Anki feature. v2 adds a nullable
//             `batchId` field + index so a batch-mode session's words group.
//   batches — (v2) one record per batch-mode session holding the ordered blocks
//             + per-block marked words, used to rebuild the two-column review.

import { openDB } from "idb";

const DB_NAME = "context-vocab-reader";
const DB_VERSION = 2;

let _dbPromise;
function db() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d, _oldVersion, _newVersion, tx) {
        if (!d.objectStoreNames.contains("library")) {
          d.createObjectStore("library", { keyPath: "id" });
        }
        let vocabStore;
        if (!d.objectStoreNames.contains("vocab")) {
          vocabStore = d.createObjectStore("vocab", { keyPath: "id", autoIncrement: true });
          vocabStore.createIndex("savedAt", "savedAt");
          vocabStore.createIndex("word", "word");
        } else {
          vocabStore = tx.objectStore("vocab");
        }
        // v2: index batch grouping. Pre-v2 rows have no batchId and are simply
        // omitted from the index — safe, no row migration needed.
        if (!vocabStore.indexNames.contains("batchId")) {
          vocabStore.createIndex("batchId", "batchId");
        }
        if (!d.objectStoreNames.contains("batches")) {
          d.createObjectStore("batches", { keyPath: "batchId" });
        }
      },
    });
  }
  return _dbPromise;
}

// ---------- library ----------

export function bookId({ name, size }) {
  return `${name}|${size}`;
}

export async function upsertBook({ name, size, type }) {
  const id = bookId({ name, size });
  const d = await db();
  const prior = await d.get("library", id);
  const now = new Date().toISOString();
  await d.put("library", {
    id,
    name,
    type,
    size,
    lastOpenedAt: now,
    addedAt: prior?.addedAt || now,
    progress: prior?.progress || null,
  });
  return id;
}

export async function updateProgress(id, progress) {
  const d = await db();
  const rec = await d.get("library", id);
  if (!rec) return;
  rec.progress = progress;
  rec.lastOpenedAt = new Date().toISOString();
  await d.put("library", rec);
}

export async function getProgress(id) {
  const d = await db();
  const rec = await d.get("library", id);
  return rec?.progress || null;
}

export async function listLibrary() {
  const d = await db();
  const all = await d.getAll("library");
  return all.sort((a, b) => (b.lastOpenedAt || "").localeCompare(a.lastOpenedAt || ""));
}

// ---------- vocab log ----------

// Returns the new auto-increment id so callers (e.g. the batch pipeline) can
// link a vocab row back to its mark. Existing callers ignoring the return are
// unaffected.
export async function appendVocab(entry) {
  const d = await db();
  return d.add("vocab", {
    ...entry,
    savedAt: entry.savedAt || new Date().toISOString(),
  });
}

export async function listVocab({ limit = 200 } = {}) {
  const d = await db();
  const tx = d.transaction("vocab", "readonly");
  const idx = tx.store.index("savedAt");
  const out = [];
  let cursor = await idx.openCursor(null, "prev");
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

// ---------- batches (batch-mode sessions) ----------

export async function createBatch(batch) {
  const d = await db();
  await d.put("batches", {
    ...batch,
    createdAt: batch.createdAt || new Date().toISOString(),
    finishedAt: batch.finishedAt || null,
  });
}

export async function getBatch(batchId) {
  const d = await db();
  return d.get("batches", batchId);
}

export async function updateBatch(batchId, patch) {
  const d = await db();
  const rec = await d.get("batches", batchId);
  if (!rec) return;
  await d.put("batches", { ...rec, ...patch });
}
