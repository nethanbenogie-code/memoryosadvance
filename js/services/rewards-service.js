/**
 * MemoryOS — services/rewards-service.js
 *
 * Points, streaks, and levels.
 *
 * Architectural decision: rewards are DERIVED STATE, computed fresh from
 * completed tasks every time. Nothing is stored, so nothing can drift,
 * corrupt, or conflict during future sync — delete a task and its points
 * honestly disappear; restore it and they return. The reward system is
 * a lens over the truth, not a second ledger to keep consistent.
 *
 * Psychology, deliberately humane:
 *   - reward is immediate (celebration fires on the completion event)
 *   - progress is visible (points fill toward the next level)
 *   - streaks encourage but NEVER shame — a broken streak simply starts
 *     again at one; MemoryOS does not do guilt.
 */

import { TaskStatus } from "../data/models.js";

export const POINTS_BASE = 10;
export const POINTS_ON_TIME_BONUS = 5;
export const LEVEL_STEP = 100;

/** Level names — quiet flattery that compounds. */
const LEVEL_NAMES = [
  "Spark",
  "Collector",
  "Organizer",
  "Finisher",
  "Pathfinder",
  "Architect",
  "Keeper of Days",
  "Memory Master",
];

/**
 * Points for one completed task: a base award, plus a bonus for
 * finishing on or before its due time.
 * @param {Object} task
 */
export function pointsFor(task) {
  let points = POINTS_BASE;
  if (task.dueAt && task.extra?.completedAt && task.extra.completedAt <= task.dueAt) {
    points += POINTS_ON_TIME_BONUS;
  }
  return points;
}

/**
 * Compute the full reward picture from the live task list.
 * @param {Array} tasks  All task memories (any status).
 * @param {Date} [now]   Injectable for tests.
 * @returns {{
 *   totalPoints:number, todayPoints:number, completedCount:number,
 *   streak:number, level:number, levelName:string,
 *   intoLevel:number, levelStep:number, progress:number
 * }}
 */
export function computeRewards(tasks, now = new Date()) {
  const completed = tasks.filter(
    (t) => t.status === TaskStatus.COMPLETED && t.extra?.completedAt
  );

  const todayKey = localDayKey(now);
  const activeDays = new Set();
  let totalPoints = 0;
  let todayPoints = 0;

  for (const task of completed) {
    const points = pointsFor(task);
    totalPoints += points;
    const key = localDayKey(new Date(task.extra.completedAt));
    activeDays.add(key);
    if (key === todayKey) todayPoints += points;
  }

  // Streak: consecutive days with at least one completion, counting
  // back from today — or from yesterday, so a streak isn't "broken"
  // just because today's win hasn't happened yet.
  let streak = 0;
  const cursor = new Date(now);
  if (!activeDays.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (activeDays.has(localDayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const level = Math.floor(totalPoints / LEVEL_STEP) + 1;
  const levelName = LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)];
  const intoLevel = totalPoints % LEVEL_STEP;

  return {
    totalPoints,
    todayPoints,
    completedCount: completed.length,
    streak,
    level,
    levelName,
    intoLevel,
    levelStep: LEVEL_STEP,
    progress: intoLevel / LEVEL_STEP,
  };
}

/** Rotating encouragement — variety keeps the reward feeling alive. */
const PRAISE = [
  "Nice work!",
  "Done and dusted.",
  "That's momentum.",
  "Future you says thanks.",
  "One less thing on your mind.",
  "Quietly unstoppable.",
  "Another promise kept.",
];

export function randomPraise() {
  return PRAISE[Math.floor(Math.random() * PRAISE.length)];
}

/** @param {Date} date */
function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
