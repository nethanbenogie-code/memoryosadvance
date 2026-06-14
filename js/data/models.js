/**
 * MemoryOS — data/models.js
 *
 * The Memory Object: the single data shape behind everything in
 * MemoryOS. One shape, many types — adding a future type (Conversation,
 * Goal, ...) is an enum entry, not a schema migration. Type-specific
 * fields live in `extra` so the core schema stays stable for years.
 *
 * Time is first-class and precise:
 *   createdAt  — when the memory was captured.
 *   occurredAt — when the thing it describes happened (defaults to
 *                createdAt). The timeline sorts on THIS, which is what
 *                makes "what was I doing last Tuesday?" answerable.
 *   modifiedAt — last write; also the last-write-wins key for future sync.
 *   dueAt      — optional deadline (tasks, events).
 *   deletedAt  — soft-delete tombstone. MemoryOS never hard-deletes;
 *                tombstones also let deletions propagate through sync.
 *
 * All timestamps are ISO-8601 UTC strings. Local time is a UI concern.
 */

import { uuidv7 } from "../core/ids.js";

/** Every kind of memory the system understands. */
export const MemoryType = Object.freeze({
  NOTE: "note",
  IDEA: "idea",
  TASK: "task",
  REMINDER: "reminder",
  JOURNAL: "journal",
  EVENT: "event",
  MEETING: "meeting",
  PERSON: "person",
  PROJECT: "project",
  FILE: "file",
  WEBSITE: "website",
  CONVERSATION: "conversation",
  GOAL: "goal",
  MEMORY_CARD: "memory_card",
  LEARNING: "learning",
  ARTICLE: "article",
});

export const TaskStatus = Object.freeze({
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
});

export const Priority = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
});

export const ImportanceLevel = Object.freeze({
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  MILESTONE: 4,
});

export const MediaType = Object.freeze({
  FACEBOOK_ALBUM: "facebook_album",
  GOOGLE_PHOTOS: "google_photos",
  ICLOUD: "icloud",
  LOCAL_FOLDER: "local_folder",
  EXTERNAL_DRIVE: "external_drive",
  URL: "url",
  OTHER: "other",
});

export const LinkType = Object.freeze({
  RELATES_TO: "relates_to",
  PART_OF: "part_of",
  MENTIONS: "mentions",
});

const VALID_TYPES = new Set(Object.values(MemoryType)); // auto-includes new types
const VALID_STATUSES = new Set(Object.values(TaskStatus));

/**
 * @typedef {Object} MemoryObject
 * @property {string}      id          UUIDv7.
 * @property {string}      type        One of MemoryType.
 * @property {string}      title
 * @property {string}      content
 * @property {string[]}    tags        Lowercase, unique.
 * @property {string|null} category
 * @property {string}      createdAt   ISO UTC.
 * @property {string}      modifiedAt  ISO UTC.
 * @property {string}      occurredAt  ISO UTC — timeline position.
 * @property {string|null} dueAt       ISO UTC.
 * @property {number|null} priority    One of Priority.
 * @property {string|null} status      One of TaskStatus (tasks only).
 * @property {string|null} summary     Reserved for AI summaries (v0.3).
 * @property {string|null} deletedAt   ISO UTC tombstone.
 * @property {Object}      extra       Type-specific fields.
 */

/**
 * Create a new Memory Object with defaults applied and input validated.
 * @param {Partial<MemoryObject> & { title?: string }} fields
 * @returns {MemoryObject}
 */
export function createMemory(fields = {}) {
  const now = new Date().toISOString();
  const type = fields.type ?? MemoryType.NOTE;
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Unknown memory type: ${type}`);
  }

  const memory = {
    id: fields.id ?? uuidv7(),
    type,
    title: (fields.title ?? "").trim(),
    content: fields.content ?? "",
    tags: normalizeTags(fields.tags),
    category: fields.category ?? null,
    createdAt: fields.createdAt ?? now,
    modifiedAt: fields.modifiedAt ?? now,
    occurredAt: fields.occurredAt ?? fields.createdAt ?? now,
    dueAt: fields.dueAt ?? null,
    priority: fields.priority ?? null,
    status: null,
    summary: fields.summary ?? null,
    deletedAt: null,
    extra: fields.extra ?? {},
  };

  if (type === MemoryType.TASK) {
    memory.status = validStatus(fields.status) ?? TaskStatus.PENDING;
  }

  if (!memory.title && !memory.content) {
    throw new Error("A memory needs a title or content.");
  }
  if (!memory.title) {
    memory.title = deriveTitle(memory.content);
  }
  return memory;
}

/**
 * Create a link record between two memories.
 * Links live in their own store: this IS the v0.4 memory graph,
 * accumulating from the very first release.
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string} [linkType]
 */
export function createLink(sourceId, targetId, linkType = LinkType.RELATES_TO) {
  if (!sourceId || !targetId) throw new Error("A link needs two memory IDs.");
  if (sourceId === targetId) throw new Error("A memory cannot link to itself.");
  return {
    id: uuidv7(),
    sourceId,
    targetId,
    linkType,
    createdAt: new Date().toISOString(),
  };
}

/** Normalize a tag list: trim, lowercase, strip '#', dedupe, drop empties. */
/**
 * Create a Memory Card — the cognitive anchor for a life event.
 * The card stores meaning and a pointer; actual photos live elsewhere.
 * @param {Partial<MemoryObject> & {title: string}} fields
 */
export function createMemoryCard(fields = {}) {
  return createMemory({
    ...fields,
    type: MemoryType.MEMORY_CARD,
    extra: {
      people: fields.people ?? [],
      location: fields.location ?? "",
      externalMedia: fields.externalMedia ?? [],
      importanceLevel: fields.importanceLevel ?? ImportanceLevel.MEDIUM,
      reflection: fields.reflection ?? "",
      category: fields.category ?? "personal",
      ...fields.extra,
    },
  });
}

/**
 * Create an external media reference — the "cognitive link" that wires
 * a Memory Card to wherever the actual photos live.
 * @param {{label: string, type?: string, path?: string}} opts
 */
export function createMediaRef(opts = {}) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    label: opts.label ?? "",
    type: opts.type ?? MediaType.OTHER,
    path: opts.path ?? "",
    addedAt: new Date().toISOString(),
  };
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = String(raw).trim().toLowerCase().replace(/^#/, "");
    if (tag) seen.add(tag);
  }
  return [...seen];
}

/** First non-empty line of content, capped, as a fallback title. */
export function deriveTitle(content, max = 80) {
  const line = String(content).split("\n").find((l) => l.trim()) ?? "";
  const trimmed = line.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

/** @param {string|undefined|null} status */
function validStatus(status) {
  return status && VALID_STATUSES.has(status) ? status : null;
}

/** Human-readable singular label for a type. */
export function typeLabel(type) {
  const labels = {
    [MemoryType.NOTE]: "Note",
    [MemoryType.IDEA]: "Idea",
    [MemoryType.TASK]: "Task",
    [MemoryType.REMINDER]: "Reminder",
    [MemoryType.JOURNAL]: "Journal",
    [MemoryType.EVENT]: "Event",
    [MemoryType.MEETING]: "Meeting",
    [MemoryType.PERSON]: "Person",
    [MemoryType.PROJECT]: "Project",
    [MemoryType.FILE]: "File",
    [MemoryType.WEBSITE]: "Website",
    [MemoryType.CONVERSATION]: "Conversation",
    [MemoryType.GOAL]: "Goal",
    [MemoryType.MEMORY_CARD]: "Memory Card",
    [MemoryType.LEARNING]: "Learning",
    [MemoryType.ARTICLE]: "Article",
    [MemoryType.REMINDER]: "Reminder",
    [MemoryType.MEETING]: "Meeting",
    [MemoryType.PERSON]: "Person",
    [MemoryType.PROJECT]: "Project",
    [MemoryType.FILE]: "File",
    [MemoryType.WEBSITE]: "Website",
    [MemoryType.CONVERSATION]: "Conversation",
  };
  return labels[type] ?? type;
}
