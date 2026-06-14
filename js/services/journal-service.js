/**
 * MemoryOS — services/journal-service.js
 *
 * The Daily Journal: one journal Memory Object per local calendar day,
 * created on first visit, plus an aggregation of everything else that
 * happened that day. The journal page is itself a memory — searchable,
 * linkable, on the timeline like everything else.
 *
 * Day boundaries are LOCAL time (a journal day is a human day), while
 * storage stays UTC. The conversion lives here and only here.
 */

import { bus } from "../core/events.js";
import { MemoryType, TaskStatus, createMemory } from "../data/models.js";
import * as repo from "../data/repository.js";

/**
 * "YYYY-MM-DD" key for a Date, in the user's local timezone.
 * @param {Date} [date]
 */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * UTC ISO bounds [start, end) of a local calendar day.
 * @param {string} key "YYYY-MM-DD"
 */
export function dayBounds(key) {
  const [y, m, d] = key.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Fetch the day's journal page, creating it on first visit.
 * @param {string} [key] defaults to today.
 */
export async function getOrCreateDailyPage(key = dayKey()) {
  const existing = await findJournal(key);
  if (existing) return existing;

  const { startIso } = dayBounds(key);
  const page = createMemory({
    type: MemoryType.JOURNAL,
    title: `Journal — ${key}`,
    content: "",
    occurredAt: startIso,
    extra: { dayKey: key },
  });
  await repo.insertMemory(page);
  bus.emit("memory:created", { memory: page });
  return page;
}

/**
 * Everything the journal view needs for one day:
 *   page           — the journal memory itself
 *   captured       — memories that occurred that day (journal excluded)
 *   completedTasks — tasks COMPLETED that day, regardless of when created
 * @param {string} [key]
 */
export async function getDayBundle(key = dayKey()) {
  const page = await getOrCreateDailyPage(key);
  const { startIso, endIso } = dayBounds(key);

  const captured = (await repo.listMemoriesInRange(startIso, endIso)).filter(
    // Exclude the auto-created daily page itself, but INCLUDE any
    // additional journal entries the user captured during the day.
    (m) => !(m.type === MemoryType.JOURNAL && m.id === page.id)
  );

  const tasks = await repo.listMemoriesByType(MemoryType.TASK);
  const completedTasks = tasks.filter(
    (t) =>
      t.status === TaskStatus.COMPLETED &&
      t.extra.completedAt &&
      t.extra.completedAt >= startIso &&
      t.extra.completedAt < endIso
  );

  return { key, page, captured, completedTasks };
}

/**
 * Save the user's written reflection for the day.
 * @param {string} key @param {string} content
 */
export async function saveJournalContent(key, content) {
  const page = await getOrCreateDailyPage(key);
  page.content = content;
  // Derive a meaningful title from the first non-empty line of content,
  // so the Second Brain timeline shows what was actually written instead
  // of just "Journal — 2026-06-13". Fall back to the date if blank.
  const firstLine = content.split("\n").map(l => l.trim()).find(l => l);
  page.title = firstLine
    ? (firstLine.length > 72 ? firstLine.slice(0, 71) + "…" : firstLine)
    : `Journal — ${key}`;
  await repo.updateMemory(page);
  bus.emit("memory:updated", { memory: page });
  return page;
}

/** @param {string} key */
async function findJournal(key) {
  const journals = await repo.listMemoriesByType(MemoryType.JOURNAL);
  return journals.find((j) => j.extra.dayKey === key) ?? null;
}
