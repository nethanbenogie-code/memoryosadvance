/**
 * MemoryOS — services/search-service.js
 *
 * Full-text search with zero dependencies: a tokenized inverted index
 * held in memory, rebuilt from IndexedDB at startup and kept current by
 * listening to the event bus. The role FTS5 plays in a SQLite build,
 * this plays here.
 *
 * Query semantics (v0.1):
 *   - terms are ANDed
 *   - the final term matches by prefix, so search feels live as you type
 *   - optional filters: type, tag, category
 *
 * v0.3 note: semantic search will not replace this — it will sit beside
 * it (keyword recall + embedding similarity, merged). That is why this
 * module owns "lexical search" only and nothing else.
 */

import { bus } from "../core/events.js";

export class SearchIndex {
  constructor() {
    /** token → Set<memoryId> */
    this._postings = new Map();
    /** memoryId → memory (live working set for filtering/ranking) */
    this._docs = new Map();
  }

  /** Build from scratch. @param {Array} memories */
  build(memories) {
    this._postings.clear();
    this._docs.clear();
    for (const memory of memories) this.add(memory);
  }

  /** Index one memory. @param {Object} memory */
  add(memory) {
    this.remove(memory.id);
    this._docs.set(memory.id, memory);
    for (const token of tokensOf(memory)) {
      if (!this._postings.has(token)) this._postings.set(token, new Set());
      this._postings.get(token).add(memory.id);
    }
  }

  /** Re-index after an edit. @param {Object} memory */
  update(memory) {
    if (memory.deletedAt) this.remove(memory.id);
    else this.add(memory);
  }

  /** Drop a memory from the index. @param {string} id */
  remove(id) {
    if (!this._docs.has(id)) return;
    this._docs.delete(id);
    for (const set of this._postings.values()) set.delete(id);
  }

  /**
   * Search.
   * @param {string} query
   * @param {{type?: string, tag?: string, category?: string}} [filters]
   * @returns {Array} matching memories, newest occurredAt first.
   */
  search(query, filters = {}) {
    const terms = tokenize(query);
    let ids;

    if (terms.length === 0) {
      ids = new Set(this._docs.keys());
    } else {
      const sets = terms.map((term, i) =>
        i === terms.length - 1 ? this._prefixSet(term) : this._exactSet(term)
      );
      sets.sort((a, b) => a.size - b.size); // intersect smallest-first
      ids = sets[0];
      for (let i = 1; i < sets.length && ids.size > 0; i++) {
        ids = intersect(ids, sets[i]);
      }
    }

    const results = [];
    for (const id of ids) {
      const memory = this._docs.get(id);
      if (!memory) continue;
      if (filters.type && memory.type !== filters.type) continue;
      if (filters.tag && !memory.tags.includes(filters.tag)) continue;
      if (filters.category && memory.category !== filters.category) continue;
      results.push(memory);
    }
    results.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return results;
  }

  /** Every tag in use, with counts — powers the filter chips. */
  tagCounts() {
    const counts = new Map();
    for (const memory of this._docs.values()) {
      for (const tag of memory.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  /** @param {string} term */
  _exactSet(term) {
    return this._postings.get(term) ?? new Set();
  }

  /** Union of all postings whose token starts with `prefix`. */
  _prefixSet(prefix) {
    const out = new Set();
    for (const [token, set] of this._postings) {
      if (token.startsWith(prefix)) for (const id of set) out.add(id);
    }
    return out;
  }
}

/** The application-wide index, wired to the event bus. */
export const searchIndex = new SearchIndex();

bus.on("memory:created", ({ memory }) => searchIndex.add(memory));
bus.on("memory:updated", ({ memory }) => searchIndex.update(memory));
bus.on("memory:deleted", ({ id }) => searchIndex.remove(id));

/* ------------------------------ tokenizing ------------------------------ */

/**
 * Lowercase unicode word tokens. \p{L}\p{N} keeps this friendly to
 * Filipino and any other language, not just English.
 * @param {string} text
 */
export function tokenize(text) {
  return (String(text ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** All searchable tokens of a memory. @param {Object} memory */
function tokensOf(memory) {
  const tokens = new Set([
    ...tokenize(memory.title),
    ...tokenize(memory.content),
    ...memory.tags,
    memory.type,
  ]);
  // Index Memory Card extras for people, location, reflection search
  if (memory.extra) {
    for (const person of memory.extra.people ?? []) {
      for (const t of tokenize(person)) tokens.add(t);
    }
    for (const t of tokenize(memory.extra.location ?? "")) tokens.add(t);
    for (const t of tokenize(memory.extra.reflection ?? "")) tokens.add(t);
    for (const ref of memory.extra.externalMedia ?? []) {
      for (const t of tokenize(ref.label ?? "")) tokens.add(t);
    }
  }
  return tokens;
}

/** @param {Set} a @param {Set} b */
function intersect(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set();
  for (const item of small) if (large.has(item)) out.add(item);
  return out;
}
