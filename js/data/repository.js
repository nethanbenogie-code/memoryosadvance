/**
 * MemoryOS — data/repository.js
 *
 * The ONLY module allowed to touch IndexedDB. Services and UI speak in
 * Memory Objects, never in database mechanics. When sync arrives (or if
 * the storage engine ever changes to SQLite-WASM), this file is the
 * blast radius — nothing else.
 *
 * Layering rule, enforced by convention and code review:
 *   UI → services → repository → IndexedDB
 */

import { openDatabase, promisify, txDone } from "./db.js";

/* ------------------------------ memories ------------------------------ */

/**
 * Insert a new memory.
 * @param {import("./models.js").MemoryObject} memory
 */
export async function insertMemory(memory) {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readwrite");
  tx.objectStore("memories").add(memory);
  await txDone(tx);
  return memory;
}

/**
 * Persist changes to an existing memory. Bumps `modifiedAt` — that
 * timestamp is the last-write-wins key for future sync, so it is set
 * here, in exactly one place.
 * @param {import("./models.js").MemoryObject} memory
 */
export async function updateMemory(memory) {
  memory.modifiedAt = new Date().toISOString();
  const db = await openDatabase();
  const tx = db.transaction("memories", "readwrite");
  tx.objectStore("memories").put(memory);
  await txDone(tx);
  return memory;
}

/**
 * Soft-delete: set the tombstone, keep the record. MemoryOS never
 * destroys a memory — and tombstones are what let deletions propagate
 * through sync later.
 * @param {string} id
 * @returns {Promise<boolean>} false if the id was not found.
 */
export async function softDeleteMemory(id) {
  const memory = await getMemory(id, { includeDeleted: true });
  if (!memory) return false;
  memory.deletedAt = new Date().toISOString();
  await updateMemory(memory);
  return true;
}

/**
 * Fetch one memory by id.
 * @param {string} id
 * @param {{includeDeleted?: boolean}} [opts]
 */
export async function getMemory(id, opts = {}) {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readonly");
  const memory = await promisify(tx.objectStore("memories").get(id));
  if (!memory) return null;
  if (memory.deletedAt && !opts.includeDeleted) return null;
  return memory;
}

/**
 * All live memories, newest occurredAt first.
 * v0.1 datasets are small enough that views and the search index load
 * everything; the by_occurredAt index keeps this a single ordered scan.
 */
export async function listMemories() {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readonly");
  const index = tx.objectStore("memories").index("by_occurredAt");
  const all = await promisify(index.getAll());
  return all.filter((m) => !m.deletedAt).reverse();
}

/**
 * Live memories whose occurredAt falls in [startIso, endIso), oldest
 * first — the journal's "what happened today" query.
 * @param {string} startIso @param {string} endIso
 */
export async function listMemoriesInRange(startIso, endIso) {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readonly");
  const index = tx.objectStore("memories").index("by_occurredAt");
  const range = IDBKeyRange.bound(startIso, endIso, false, true);
  const rows = await promisify(index.getAll(range));
  return rows.filter((m) => !m.deletedAt);
}

/**
 * Live memories of one type.
 * @param {string} type
 */
export async function listMemoriesByType(type) {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readonly");
  const index = tx.objectStore("memories").index("by_type");
  const rows = await promisify(index.getAll(type));
  return rows.filter((m) => !m.deletedAt);
}

/* -------------------------------- links -------------------------------- */

/**
 * Insert a link record.
 * @param {{id:string, sourceId:string, targetId:string}} link
 */
export async function insertLink(link) {
  const db = await openDatabase();
  const tx = db.transaction("links", "readwrite");
  tx.objectStore("links").add(link);
  await txDone(tx);
  return link;
}

/**
 * All links touching a memory, in either direction.
 * @param {string} memoryId
 */
export async function listLinksFor(memoryId) {
  const db = await openDatabase();
  const tx = db.transaction("links", "readonly");
  const store = tx.objectStore("links");
  const [out, into] = await Promise.all([
    promisify(store.index("by_sourceId").getAll(memoryId)),
    promisify(store.index("by_targetId").getAll(memoryId)),
  ]);
  return [...out, ...into];
}

/* --------------------------------- meta --------------------------------- */

/** @param {string} key */
export async function getMeta(key) {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readonly");
  const row = await promisify(tx.objectStore("meta").get(key));
  return row ? row.value : null;
}

/** @param {string} key @param {any} value */
export async function setMeta(key, value) {
  const db = await openDatabase();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put({ key, value });
  await txDone(tx);
}

/* ----------------------- backup / restore access ----------------------- */

/**
 * EVERY memory including soft-deleted tombstones — backups must carry
 * deletions, or a restore would resurrect things the user removed.
 */
export async function listMemoriesRaw() {
  const db = await openDatabase();
  const tx = db.transaction("memories", "readonly");
  return promisify(tx.objectStore("memories").getAll());
}

/** Every link record. */
export async function listAllLinks() {
  const db = await openDatabase();
  const tx = db.transaction("links", "readonly");
  return promisify(tx.objectStore("links").getAll());
}

/**
 * Write a restore's worth of records in ONE transaction — either the
 * whole restore lands or none of it does.
 * @param {Array} memories @param {Array} links
 */
export async function bulkUpsert(memories, links) {
  const db = await openDatabase();
  const tx = db.transaction(["memories", "links"], "readwrite");
  const memStore = tx.objectStore("memories");
  const linkStore = tx.objectStore("links");
  for (const memory of memories) memStore.put(memory);
  for (const link of links) linkStore.put(link);
  await txDone(tx);
}

/* ------------------------------ embeddings ----------------------------- *
 * The embeddings store (keyPath ["memoryId","model"]) was reserved in the
 * v1 schema for semantic search. These accessors are its only gateway.
 * Keyed per model so re-embedding with a better model later is additive.
 * ---------------------------------------------------------------------- */

/**
 * Store (or replace) a memory's embedding for a given model.
 * @param {{memoryId:string, model:string, vector:number[], dim:number, indexedAt?:string}} record
 */
export async function putEmbedding(record) {
  const db = await openDatabase();
  const tx = db.transaction("embeddings", "readwrite");
  tx.objectStore("embeddings").put({
    indexedAt: new Date().toISOString(),
    ...record,
  });
  await txDone(tx);
  return record;
}

/**
 * All embeddings for one model, as an array of records.
 * @param {string} model
 */
export async function listEmbeddings(model) {
  const db = await openDatabase();
  const tx = db.transaction("embeddings", "readonly");
  const all = await promisify(tx.objectStore("embeddings").getAll());
  return all.filter((e) => e.model === model);
}

/**
 * Remove every embedding (all models) for a memory — called on delete.
 * @param {string} memoryId
 */
export async function deleteEmbeddingsFor(memoryId) {
  const db = await openDatabase();
  const tx = db.transaction("embeddings", "readwrite");
  const store = tx.objectStore("embeddings");
  const keys = await promisify(store.getAllKeys());
  for (const key of keys) {
    if (Array.isArray(key) && key[0] === memoryId) store.delete(key);
  }
  await txDone(tx);
}
