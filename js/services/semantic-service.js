/**
 * MemoryOS — services/semantic-service.js
 *
 * The semantic brain. Lexical search (search-service.js) recalls by
 * shared words; this recalls by MEANING. "What did I do when I felt
 * burned out?" finds a journal entry that never used the word
 * "burnout" — because the embedding sits near it in vector space.
 *
 * How it fits the existing architecture (nothing upstream changes):
 *   - Embeddings live in the `embeddings` store reserved in db.js (v1),
 *     keyed per model, reached only through the repository.
 *   - It subscribes to the same bus events as search-service, so new and
 *     edited memories get embedded automatically.
 *   - It runs fully in the browser via transformers.js (WebAssembly /
 *     WebGPU). No server, no key. The model downloads once (~25MB) and
 *     is cached by the browser thereafter — and it works offline after.
 *
 * Search-service owns lexical recall; this owns vector recall. The AI
 * service merges them. Per the v0.3 plan, semantic SITS BESIDE lexical,
 * it does not replace it.
 */

import { bus } from "../core/events.js";
import * as repo from "../data/repository.js";
import { listAll } from "./memory-service.js";

/** The embedding model. Stored in each embedding's key so a future
 *  upgrade to a stronger model re-indexes incrementally, not destructively. */
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Status the UI can poll/render. */
export const state = {
  ready: false,        // model loaded
  indexing: false,     // backfill in progress
  indexed: 0,          // memories embedded so far this pass
  total: 0,            // memories to embed this pass
  error: null,         // last fatal error message, if any
};

/* ───────────────────────────── embedder ──────────────────────────────── */

let _extractor = null;
let _loading = null;

/** Lazily load the transformers.js feature-extraction pipeline. */
async function ensureModel() {
  if (_extractor) return _extractor;
  if (_loading) return _loading;
  _loading = (async () => {
    const { pipeline, env } = await import(
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2"
    );
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    _extractor = await pipeline("feature-extraction", EMBED_MODEL);
    state.ready = true;
    return _extractor;
  })();
  return _loading;
}

/**
 * Embed a string into a unit-length vector (so cosine = dot product).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embedText(text) {
  const extractor = await ensureModel();
  const out = await extractor(text || " ", { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

/** The text of a memory worth embedding — mirrors what search indexes. */
function memoryText(m) {
  const parts = [m.title, m.content];
  if (m.extra) {
    if (m.extra.people?.length) parts.push(m.extra.people.join(", "));
    if (m.extra.location) parts.push(m.extra.location);
    if (m.extra.reflection) parts.push(m.extra.reflection);
  }
  if (m.tags?.length) parts.push(m.tags.join(" "));
  return parts.filter(Boolean).join(". ");
}

/* ─────────────────────────── indexing ────────────────────────────────── */

/**
 * Embed one memory and persist it. Safe to call repeatedly.
 * @param {import("../data/models.js").MemoryObject} memory
 */
export async function indexMemory(memory) {
  if (!memory || memory.deletedAt) return;
  const vector = await embedText(memoryText(memory));
  await repo.putEmbedding({
    memoryId: memory.id,
    model: EMBED_MODEL,
    vector,
    dim: vector.length,
  });
}

/**
 * Backfill: embed every live memory that doesn't yet have an embedding
 * for the current model. Incremental — re-running only does new work.
 * @param {(s: typeof state) => void} [onProgress]
 */
export async function indexAll(onProgress) {
  if (state.indexing) return;
  state.indexing = true;
  state.error = null;
  try {
    await ensureModel();
    const [memories, existing] = await Promise.all([
      listAll(),
      repo.listEmbeddings(EMBED_MODEL),
    ]);
    const have = new Set(existing.map((e) => e.memoryId));
    const todo = memories.filter((m) => !have.has(m.id));

    state.indexed = 0;
    state.total = todo.length;
    onProgress?.(state);

    for (const memory of todo) {
      await indexMemory(memory);
      state.indexed++;
      onProgress?.(state);
    }
  } catch (err) {
    state.error = err?.message || String(err);
    console.error("[semantic] indexAll failed:", err);
  } finally {
    state.indexing = false;
    onProgress?.(state);
  }
}

/* ─────────────────────────── retrieval ───────────────────────────────── */

/** Cosine similarity of two unit vectors (stored normalized → dot product). */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/**
 * Find the memories most semantically similar to a query.
 * @param {string} query
 * @param {{limit?: number, threshold?: number}} [opts]
 * @returns {Promise<Array<{memory: Object, score: number}>>}
 */
export async function semanticSearch(query, opts = {}) {
  const { limit = 8, threshold = 0 } = opts;
  const q = (query || "").trim();
  if (!q) return [];

  const [qvec, embeddings] = await Promise.all([
    embedText(q),
    repo.listEmbeddings(EMBED_MODEL),
  ]);
  if (!embeddings.length) return [];

  // Resolve memory bodies once, skipping any that were deleted.
  const byId = new Map((await listAll()).map((m) => [m.id, m]));

  const scored = [];
  for (const e of embeddings) {
    const memory = byId.get(e.memoryId);
    if (!memory) continue;
    const score = cosine(qvec, e.vector);
    if (score >= threshold) scored.push({ memory, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ─────────────────── auto-indexing via the event bus ─────────────────── */
/* Same seam search-service uses. New/edited memories get embedded in the
 * background; deletions drop their vectors. Failures are isolated so a
 * model that isn't loaded yet never breaks a save. */

bus.on("memory:created", ({ memory }) => {
  indexMemory(memory).catch((e) => console.warn("[semantic] index on create:", e));
});
bus.on("memory:updated", ({ memory }) => {
  if (memory.deletedAt) repo.deleteEmbeddingsFor(memory.id).catch(() => {});
  else indexMemory(memory).catch((e) => console.warn("[semantic] index on update:", e));
});
bus.on("memory:deleted", ({ id }) => {
  repo.deleteEmbeddingsFor(id).catch((e) => console.warn("[semantic] drop on delete:", e));
});
