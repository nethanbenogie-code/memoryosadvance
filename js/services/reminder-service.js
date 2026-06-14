/**
 * MemoryOS — services/reminder-service.js
 *
 * Reminders for tasks with a due time.
 *
 * How it works: a lightweight loop checks for newly-due tasks every 30
 * seconds while MemoryOS is open (or sitting in a background tab), and
 * again the instant the app regains focus — so a reminder that came due
 * while the app was closed rings the moment you return.
 *
 * Honest limitation, stated rather than hidden: ringing while the app
 * is COMPLETELY closed requires a push server, and MemoryOS has no
 * server by design — no server may see your data. If true closed-app
 * alarms ever ship, they will be opt-in and end-to-end blind.
 *
 * Each task reminds once (extra.remindedAt guards repeats); changing a
 * task's due time re-arms it (memory-service clears the guard).
 */

import { bus } from "../core/events.js";
import { MemoryType, TaskStatus } from "../data/models.js";
import * as repo from "../data/repository.js";

const CHECK_INTERVAL_MS = 30_000;
let timer = null;

/** Start the reminder loop. Idempotent. Call once at boot. */
export function startReminderLoop() {
  if (timer) return;
  check();
  timer = setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) check();
  });
}

/**
 * Ask for system-notification permission. Called contextually — the
 * first time the user sets a due time, not ambushed at page load.
 * @returns {Promise<"granted"|"denied"|"default"|"unsupported">}
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Find newly-due tasks, mark them reminded, and announce them. */
async function check() {
  const nowIso = new Date().toISOString();
  let tasks;
  try {
    tasks = await repo.listMemoriesByType(MemoryType.TASK);
  } catch (err) {
    console.warn("[reminders] check failed:", err);
    return;
  }

  for (const task of tasks) {
    const isDue =
      task.dueAt &&
      task.dueAt <= nowIso &&
      task.status !== TaskStatus.COMPLETED &&
      !task.extra.remindedAt;
    if (!isDue) continue;

    task.extra.remindedAt = nowIso;
    await repo.updateMemory(task);
    bus.emit("memory:updated", { memory: task });
    bus.emit("reminder:due", { memory: task }); // in-app toast + chime
    showSystemNotification(task);               // OS-level, if permitted
  }
}

/** @param {Object} task */
async function showSystemNotification(task) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body: task.content?.trim() || "This task is due now.",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: task.id, // re-notifying the same task replaces, never stacks
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) {
      await registration.showNotification(`⏰ ${task.title}`, options);
    } else {
      new Notification(`⏰ ${task.title}`, options);
    }
  } catch (err) {
    console.warn("[reminders] system notification failed:", err);
  }
}
