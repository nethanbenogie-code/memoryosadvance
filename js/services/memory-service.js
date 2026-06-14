/**
 * MemoryOS — services/memory-service.js
 *
 * Business logic for the life of a Memory Object. The UI calls this,
 * never the repository, and every mutation is announced on the event
 * bus — which is how views stay fresh today and how the AI assistant
 * will observe the user's life in v0.3.
 */

import { bus } from "../core/events.js";
import {
  MemoryType,
  TaskStatus,
  createMemory,
  createLink,
  normalizeTags,
  deriveTitle,
} from "../data/models.js";
import * as repo from "../data/repository.js";

/**
 * Quick Capture: turn one raw text blob into a structured memory with
 * minimal friction. Rules:
 *   - "#tag" tokens anywhere become tags (and are removed from text).
 *   - First line becomes the title, remaining lines the content.
 * @param {string} rawText
 * @param {{type?: string, occurredAt?: string}} [opts]
 */
export async function capture(rawText, opts = {}) {
  const { text, tags } = extractTags(rawText);
  const lines = text.split("\n");
  const title = deriveTitle(lines[0] ?? "");
  const content = lines.slice(1).join("\n").trim();

  const memory = createMemory({
    type: opts.type ?? MemoryType.NOTE,
    title,
    content,
    tags,
    occurredAt: opts.occurredAt,
  });

  await repo.insertMemory(memory);
  bus.emit("memory:created", { memory });
  return memory;
}

/**
 * Pull "#tag" tokens out of free text.
 * @param {string} raw
 * @returns {{text: string, tags: string[]}}
 */
export function extractTags(raw) {
  const tags = [];
  const text = String(raw ?? "")
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, lead, tag) => {
      tags.push(tag);
      return lead;
    })
    .replace(/[ \t]+/g, " ")
    .trim();
  return { text, tags: normalizeTags(tags) };
}

/**
 * Convert any memory into a task — the brief's "everything can become
 * actionable" promise. Idempotent for memories that are already tasks.
 * @param {string} id
 */
export async function convertToTask(id) {
  const memory = await repo.getMemory(id);
  if (!memory) throw new Error("Memory not found.");
  if (memory.type === MemoryType.TASK) return memory;

  memory.extra.convertedFrom = memory.type;
  memory.type = MemoryType.TASK;
  memory.status = TaskStatus.PENDING;

  await repo.updateMemory(memory);
  bus.emit("memory:updated", { memory });
  return memory;
}

/**
 * Move a task through its lifecycle. Completion stamps
 * `extra.completedAt`, which the daily journal aggregates.
 * @param {string} id
 * @param {string} status One of TaskStatus.
 */
export async function setTaskStatus(id, status) {
  if (!Object.values(TaskStatus).includes(status)) {
    throw new Error(`Unknown task status: ${status}`);
  }
  const memory = await repo.getMemory(id);
  if (!memory) throw new Error("Memory not found.");
  if (memory.type !== MemoryType.TASK) {
    throw new Error("Only tasks have a status.");
  }

  memory.status = status;
  memory.extra.completedAt =
    status === TaskStatus.COMPLETED ? new Date().toISOString() : null;

  await repo.updateMemory(memory);
  bus.emit("memory:updated", { memory });
  if (status === TaskStatus.COMPLETED) bus.emit("task:completed", { memory });
  return memory;
}

/**
 * Edit core fields of a memory.
 * @param {string} id
 * @param {{title?:string, content?:string, tags?:string[], dueAt?:string|null, priority?:number|null}} changes
 */
export async function editMemory(id, changes) {
  const memory = await repo.getMemory(id);
  if (!memory) throw new Error("Memory not found.");

  if (changes.title !== undefined) memory.title = changes.title.trim();
  if (changes.content !== undefined) memory.content = changes.content;
  if (changes.tags !== undefined) memory.tags = normalizeTags(changes.tags);
  if (changes.dueAt !== undefined) memory.dueAt = changes.dueAt;
  if (changes.priority !== undefined) memory.priority = changes.priority;
  if (!memory.title) memory.title = deriveTitle(memory.content);

  await repo.updateMemory(memory);
  bus.emit("memory:updated", { memory });
  return memory;
}

/**
 * Set or clear a task's due time. Changing the due time re-arms the
 * reminder (clears extra.remindedAt) so the task will ring again at
 * its new moment.
 * @param {string} id
 * @param {string|null} dueAtIso ISO UTC, or null to remove the reminder.
 */
export async function setDueDate(id, dueAtIso) {
  const memory = await repo.getMemory(id);
  if (!memory) throw new Error("Memory not found.");
  memory.dueAt = dueAtIso;
  memory.extra.remindedAt = null;
  await repo.updateMemory(memory);
  bus.emit("memory:updated", { memory });
  return memory;
}

/**
 * Soft-delete a memory.
 * @param {string} id
 */
export async function deleteMemory(id) {
  const ok = await repo.softDeleteMemory(id);
  if (ok) bus.emit("memory:deleted", { id });
  return ok;
}

/**
 * Link two memories — quietly feeding the v0.4 memory graph from day one.
 * @param {string} sourceId @param {string} targetId @param {string} [linkType]
 */
export async function linkMemories(sourceId, targetId, linkType) {
  const link = createLink(sourceId, targetId, linkType);
  await repo.insertLink(link);
  bus.emit("link:created", { link });
  return link;
}

/** All live memories, newest first. */
export const listAll = repo.listMemories;

/** Links touching one memory. */
export const linksFor = repo.listLinksFor;
