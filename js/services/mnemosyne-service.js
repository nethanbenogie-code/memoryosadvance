/**
 * MemoryOS — services/mnemosyne-service.js
 *
 * Project Mnemosyne: the Second Brain Timeline engine.
 *
 * This service answers the questions the product was built to answer:
 *   "What happened in my life?"
 *   "What mattered to me?"
 *   "What did I learn?"
 *   "What memories do I want to preserve?"
 *
 * It aggregates every type of memory into one unified chronological
 * stream, surfaces "on this day" reflections from past years, finds
 * upcoming anniversaries, and feeds the Today's Memory Context widget.
 *
 * Architecture note: Mnemosyne is a READ-ONLY aggregation layer. It
 * never writes; all writes go through memory-service. This keeps the
 * data model clean and makes the feature safe to add without risk of
 * touching existing functionality.
 */

import { MemoryType, TaskStatus, ImportanceLevel } from "../data/models.js";
import * as repo from "../data/repository.js";
import { dayKey, dayBounds } from "./journal-service.js";

/* ========================= SECOND BRAIN TIMELINE ========================= */

/**
 * All Second Brain Timeline categories, in display order.
 * Each maps to one or more MemoryTypes.
 */
export const SB_CATEGORIES = [
  { id: "all",         label: "All",           types: null },
  { id: "memory_card", label: "Memory Cards",  types: ["memory_card"] },
  { id: "journal",     label: "Journal",        types: ["journal"] },
  { id: "learning",    label: "Learning",       types: ["learning"] },
  { id: "article",     label: "Articles",       types: ["article"] },
  { id: "note",        label: "Notes",          types: ["note", "idea"] },
  { id: "task",        label: "Achievements",   types: ["task"] },
  { id: "event",       label: "Events",         types: ["event", "meeting"] },
];

/**
 * Fetch the full Second Brain Timeline — every meaningful memory,
 * newest occurredAt first, with optional category filtering.
 * Tasks appear only when completed (achievements, not noise).
 * @param {{category?: string, limit?: number}} [opts]
 * @returns {Promise<Array>}
 */
export async function getSecondBrainTimeline(opts = {}) {
  const all = await repo.listMemories();

  const filtered = all.filter((m) => {
    // Tasks: only completed ones belong on the life timeline
    if (m.type === MemoryType.TASK) {
      return m.status === TaskStatus.COMPLETED;
    }
    // Journal auto-pages are fine; other suppressed types
    if (m.type === MemoryType.REMINDER) return false;
    return true;
  });

  const categoryFilter = opts.category && opts.category !== "all"
    ? SB_CATEGORIES.find((c) => c.id === opts.category)
    : null;

  const result = categoryFilter?.types
    ? filtered.filter((m) => categoryFilter.types.includes(m.type))
    : filtered;

  return opts.limit ? result.slice(0, opts.limit) : result;
}

/* ======================= TODAY'S MEMORY CONTEXT ========================= */

/**
 * Everything needed to render the Today's Memory Context widget —
 * the dashboard that anchors the user in their own life before they
 * open social media.
 * @param {Date} [now]
 */
export async function getTodayContext(now = new Date()) {
  const [onThisDay, recentCards, upcomingAnniversaries, recentReflections] =
    await Promise.all([
      getOnThisDay(now),
      getRecentMemoryCards(5),
      getUpcomingAnniversaries(now, 14),
      getRecentReflections(3),
    ]);

  return { onThisDay, recentCards, upcomingAnniversaries, recentReflections, date: now };
}

/* ========================= ON THIS DAY ================================== */

/**
 * Journal entries and Memory Cards from the same calendar day in
 * previous years — the feature that makes the past feel present.
 * @param {Date} [now]
 * @param {number} [yearsBack] how many years to look back
 */
export async function getOnThisDay(now = new Date(), yearsBack = 10) {
  const all = await repo.listMemories();
  const month = now.getMonth();
  const day = now.getDate();
  const thisYear = now.getFullYear();

  return all
    .filter((m) => {
      if (![MemoryType.JOURNAL, MemoryType.MEMORY_CARD, MemoryType.EVENT].includes(m.type)) return false;
      const d = new Date(m.occurredAt);
      return (
        d.getMonth() === month &&
        d.getDate() === day &&
        d.getFullYear() < thisYear &&
        d.getFullYear() >= thisYear - yearsBack
      );
    })
    .sort((a, b) => (a.occurredAt > b.occurredAt ? -1 : 1));
}

/* ====================== UPCOMING ANNIVERSARIES ========================== */

/**
 * Memory Cards and Events whose anniversary (same month+day) falls
 * within the next N days — surfaces without requiring calendar access.
 * @param {Date} [now] @param {number} [withinDays]
 */
export async function getUpcomingAnniversaries(now = new Date(), withinDays = 30) {
  const all = await repo.listMemories();
  const results = [];

  for (const m of all) {
    if (![MemoryType.MEMORY_CARD, MemoryType.EVENT, MemoryType.MEETING].includes(m.type)) continue;
    const orig = new Date(m.occurredAt);
    const thisYear = now.getFullYear();

    // Try anniversary this calendar year, then next
    for (const year of [thisYear, thisYear + 1]) {
      const anniversary = new Date(year, orig.getMonth(), orig.getDate());
      const daysAway = Math.round((anniversary - now) / 86_400_000);
      if (daysAway >= 0 && daysAway <= withinDays) {
        results.push({
          memory: m,
          anniversary,
          daysAway,
          yearsAgo: thisYear - orig.getFullYear(),
        });
        break;
      }
    }
  }
  return results.sort((a, b) => a.daysAway - b.daysAway);
}

/* ====================== MEMORY CARDS =================================== */

/** Most recent Memory Cards. @param {number} [limit] */
export async function getRecentMemoryCards(limit = 10) {
  const all = await repo.listMemoriesByType(MemoryType.MEMORY_CARD);
  return all.slice(0, limit);
}

/** Memory Cards for a specific year. @param {number} year */
export async function getMemoryCardsByYear(year) {
  const all = await repo.listMemoriesByType(MemoryType.MEMORY_CARD);
  return all.filter((m) => new Date(m.occurredAt).getFullYear() === year);
}

/** All distinct years that have at least one Memory Card — for the year nav. */
export async function getMemoryCardYears() {
  const all = await repo.listMemoriesByType(MemoryType.MEMORY_CARD);
  const years = new Set(all.map((m) => new Date(m.occurredAt).getFullYear()));
  return [...years].sort((a, b) => b - a);
}

/* ====================== RECENT REFLECTIONS ============================== */

/**
 * Memories with a non-empty `extra.reflection` field, newest first.
 * These are the user's own words about their own life.
 * @param {number} [limit]
 */
export async function getRecentReflections(limit = 5) {
  const all = await repo.listMemories();
  return all
    .filter((m) => m.extra?.reflection?.trim())
    .slice(0, limit);
}

/* ====================== STATS FOR DASHBOARD ============================ */

/**
 * Lightweight life stats — shown on the dashboard to reinforce the
 * sense of accumulated meaning, not productivity metrics.
 */
export async function getLifeStats() {
  const all = await repo.listMemories();
  const cards = all.filter((m) => m.type === MemoryType.MEMORY_CARD);
  const completed = all.filter((m) => m.type === MemoryType.TASK && m.status === TaskStatus.COMPLETED);
  const journals = all.filter((m) => m.type === MemoryType.JOURNAL && m.content?.trim());
  const learning = all.filter((m) => m.type === MemoryType.LEARNING);
  const articles = all.filter((m) => m.type === MemoryType.ARTICLE);

  const people = new Set();
  for (const c of cards) {
    for (const p of c.extra?.people ?? []) people.add(p.toLowerCase().trim());
  }

  const years = new Set(all.map((m) => new Date(m.occurredAt).getFullYear()));

  return {
    totalMemories: all.length,
    memoryCards: cards.length,
    completedTasks: completed.length,
    journalEntries: journals.length,
    learningRecords: learning.length,
    savedArticles: articles.length,
    peopleTagged: people.size,
    yearsOfMemory: years.size,
    oldestMemory: all.length ? all[all.length - 1] : null,
  };
}

/* ========================= SEARCH HELPERS ============================== */

/** @param {string} personName */
export async function getMemoriesByPerson(personName) {
  const name = personName.toLowerCase().trim();
  const all = await repo.listMemories();
  return all.filter((m) =>
    (m.extra?.people ?? []).some((p) => p.toLowerCase().includes(name))
  );
}

/** @param {string} location */
export async function getMemoriesByLocation(location) {
  const loc = location.toLowerCase().trim();
  const all = await repo.listMemories();
  return all.filter((m) =>
    m.extra?.location?.toLowerCase().includes(loc)
  );
}
