/**
 * MemoryOS — data/db.js
 *
 * IndexedDB connection + versioned migration machinery.
 *
 * Migrations are an ordered list; IndexedDB hands us `oldVersion` in
 * `onupgradeneeded` and we replay every migration above it. Adding
 * schema in v0.2 means appending ONE entry to MIGRATIONS — existing
 * users upgrade in place, exactly like numbered SQL migration files.
 *
 * Stores (schema v1):
 *   memories — keyPath "id"
 *     by_occurredAt  → timeline range queries
 *     by_type        → tasks view, journal lookups
 *     by_modifiedAt  → future sync change detection
 *   links — keyPath "id"
 *     by_sourceId, by_targetId → the memory graph (v0.4 reads this)
 *   embeddings — keyPath [memoryId, model]
 *     Empty in v0.1. Exists so semantic search (v0.3) is an additive
 *     feature, not a migration. Keyed per model so re-embedding with a
 *     better model later is incremental.
 *   meta — keyPath "key" (settings, future sync cursors)
 */

const DB_NAME = "memoryos";

/** Each entry upgrades the schema by one version. Never reorder. */
const MIGRATIONS = [
  /** v1 — initial schema. */
  (db) => {
    const memories = db.createObjectStore("memories", { keyPath: "id" });
    memories.createIndex("by_occurredAt", "occurredAt");
    memories.createIndex("by_type", "type");
    memories.createIndex("by_modifiedAt", "modifiedAt");

    const links = db.createObjectStore("links", { keyPath: "id" });
    links.createIndex("by_sourceId", "sourceId");
    links.createIndex("by_targetId", "targetId");

    db.createObjectStore("embeddings", { keyPath: ["memoryId", "model"] });
    db.createObjectStore("meta", { keyPath: "key" });
  },
];

export const DB_VERSION = MIGRATIONS.length;

/** @type {Promise<IDBDatabase>|null} */
let _dbPromise = null;

/**
 * Open (and migrate, if needed) the database. Idempotent.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (let v = event.oldVersion; v < DB_VERSION; v++) {
        MIGRATIONS[v](db, request.transaction);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the schema, close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      console.warn("[db] open blocked — another tab holds an old version.");
  });

  return _dbPromise;
}

/* ----------------------------------------------------------------- *
 * Promise helpers — IndexedDB is callback-based; everything above the
 * repository speaks async/await.
 * ----------------------------------------------------------------- */

/**
 * Wrap an IDBRequest in a Promise.
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolve when a transaction commits, reject if it aborts.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}
