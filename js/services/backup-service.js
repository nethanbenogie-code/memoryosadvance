/**
 * MemoryOS — services/backup-service.js
 *
 * Backup designed for people who never read popups:
 *
 *   1. "Back up now"  — one tap, one JSON file, zero decisions.
 *   2. "Share backup" — the phone's native share sheet (Drive, WhatsApp,
 *      email) — how files actually move on phones.
 *   3. Automatic backups — pick a folder ONCE (Chrome/Edge); MemoryOS
 *      silently writes a dated backup file every day after that.
 *   4. Restore is a MERGE, never a wipe: records are matched by id and
 *      the newer modifiedAt wins. Restoring the same file five times in
 *      a row changes nothing — safe to click blindly, by design. This
 *      is the UUIDv7 + modifiedAt architecture paying its first
 *      dividend; v0.5 sync will use this exact rule.
 *
 * Snapshots include soft-deleted tombstones, so a restore never
 * resurrects memories the user chose to remove.
 */

import { bus } from "../core/events.js";
import * as repo from "../data/repository.js";

export const BACKUP_FORMAT = "memoryos-backup";
export const BACKUP_SCHEMA = 1;
export const STALE_AFTER_DAYS = 7;

/* ------------------------------ snapshot ------------------------------ */

/** Build a complete, restorable snapshot of the database. */
export async function buildSnapshot() {
  const [memories, links] = await Promise.all([
    repo.listMemoriesRaw(),
    repo.listAllLinks(),
  ]);
  return {
    format: BACKUP_FORMAT,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    counts: { memories: memories.length, links: links.length },
    memories,
    links,
  };
}

/** "memoryos-backup-2026-06-13-1430.json" */
export function backupFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `memoryos-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-` +
    `${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`
  );
}

function snapshotBlob(snapshot) {
  // Pretty-printed on purpose: a user who opens it in Notepad should
  // see their own words and trust the file.
  return new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
}

/* --------------------------- one-tap actions --------------------------- */

/** Download a backup file. Returns the filename. */
export async function downloadBackup() {
  const snapshot = await buildSnapshot();
  const blob = snapshotBlob(snapshot);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await markBackedUp("download");
  return a.download;
}

/** Can this device share files natively? */
export function canShareBackup() {
  try {
    const probe = new File(["x"], "probe.json", { type: "application/json" });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** Open the native share sheet with the backup file. */
export async function shareBackup() {
  const snapshot = await buildSnapshot();
  const file = new File([snapshotBlob(snapshot)], backupFilename(), {
    type: "application/json",
  });
  await navigator.share({
    files: [file],
    title: "MemoryOS backup",
    text: "My MemoryOS backup file.",
  });
  await markBackedUp("share");
}

/* ------------------------------- restore ------------------------------- */

/**
 * Pure merge planner — fully unit-testable.
 * Rule per memory id: absent → insert; present → newer modifiedAt wins.
 * Links are immutable: insert when the id is new, otherwise skip.
 * @param {Array} existingMemories raw (tombstones included)
 * @param {Array} existingLinks
 * @param {Object} snapshot
 */
export function planMerge(existingMemories, existingLinks, snapshot) {
  const byId = new Map(existingMemories.map((m) => [m.id, m]));
  const linkIds = new Set(existingLinks.map((l) => l.id));

  const memoriesToWrite = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const incoming of snapshot.memories ?? []) {
    if (!incoming?.id) continue;
    const existing = byId.get(incoming.id);
    if (!existing) {
      memoriesToWrite.push(incoming);
      inserted++;
    } else if ((incoming.modifiedAt ?? "") > (existing.modifiedAt ?? "")) {
      memoriesToWrite.push(incoming);
      updated++;
    } else {
      unchanged++;
    }
  }

  const linksToWrite = (snapshot.links ?? []).filter(
    (l) => l?.id && !linkIds.has(l.id)
  );

  return {
    memoriesToWrite,
    linksToWrite,
    report: { inserted, updated, unchanged, newLinks: linksToWrite.length },
  };
}

/** Validate that parsed JSON really is one of our backups. */
export function validateSnapshot(data) {
  if (!data || typeof data !== "object") return "Not a readable backup file.";
  if (data.format !== BACKUP_FORMAT) return "This file is not a MemoryOS backup.";
  if (data.schema > BACKUP_SCHEMA) {
    return "This backup was made by a newer MemoryOS. Update the app, then restore.";
  }
  if (!Array.isArray(data.memories)) return "This backup file is incomplete.";
  return null; // valid
}

/**
 * Restore from a user-chosen file. Merge-safe and atomic.
 * @param {File} file
 * @returns {Promise<{inserted:number,updated:number,unchanged:number,newLinks:number}>}
 */
export async function restoreFromFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file couldn't be read as a backup.");
  }
  const problem = validateSnapshot(data);
  if (problem) throw new Error(problem);

  const [existingMemories, existingLinks] = await Promise.all([
    repo.listMemoriesRaw(),
    repo.listAllLinks(),
  ]);
  const { memoriesToWrite, linksToWrite, report } = planMerge(
    existingMemories,
    existingLinks,
    data
  );

  if (memoriesToWrite.length || linksToWrite.length) {
    await repo.bulkUpsert(memoriesToWrite, linksToWrite);
  }
  bus.emit("backup:restored", { report });
  return report;
}

/* --------------------------- automatic backup --------------------------- */

/** Is the silent folder-backup feature available on this browser? */
export function autoBackupSupported() {
  return "showDirectoryPicker" in window;
}

/**
 * One-time setup: the user picks a folder; the handle is persisted in
 * IndexedDB (handles are structured-cloneable) and an immediate backup
 * is written so the feature visibly works.
 */
export async function setupAutoBackupFolder() {
  const dir = await window.showDirectoryPicker({ mode: "readwrite" });
  await repo.setMeta("autoBackupDir", dir);
  await writeAutoBackup(dir);
  return dir.name;
}

/** Turn automatic backups off. */
export async function disableAutoBackup() {
  await repo.setMeta("autoBackupDir", null);
}

/**
 * Called at boot: if a folder is configured, permission still stands,
 * and today's file hasn't been written yet — write it, silently.
 * Returns a status string for the Backup view.
 */
export async function runAutoBackupIfDue() {
  const dir = await repo.getMeta("autoBackupDir");
  if (!dir) return "off";
  let permission = "denied";
  try {
    permission = await dir.queryPermission({ mode: "readwrite" });
  } catch {
    return "off";
  }
  if (permission !== "granted") return "needs-permission";

  const last = await repo.getMeta("lastAutoBackupDay");
  const today = new Date().toISOString().slice(0, 10);
  if (last === today) return "ok";

  try {
    await writeAutoBackup(dir);
    return "ok";
  } catch (err) {
    console.warn("[backup] auto backup failed:", err);
    return "failed";
  }
}

/**
 * Re-grant folder permission (must run inside a user gesture) and write.
 */
export async function reauthorizeAutoBackup() {
  const dir = await repo.getMeta("autoBackupDir");
  if (!dir) return "off";
  const permission = await dir.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") return "needs-permission";
  await writeAutoBackup(dir);
  return "ok";
}

/** @param {FileSystemDirectoryHandle} dir */
async function writeAutoBackup(dir) {
  const snapshot = await buildSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  const fileHandle = await dir.getFileHandle(`memoryos-backup-${today}.json`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(snapshotBlob(snapshot));
  await writable.close();
  await repo.setMeta("lastAutoBackupDay", today);
  await markBackedUp("auto");
}

/* -------------------------------- status -------------------------------- */

/** @param {string} how */
async function markBackedUp(how) {
  await repo.setMeta("lastBackupAt", new Date().toISOString());
  await repo.setMeta("lastBackupHow", how);
  bus.emit("backup:done", { how });
}

/**
 * Everything the UI needs to show backup health and decide on nudges.
 */
export async function getBackupStatus() {
  const [lastBackupAt, lastBackupHow, autoDir, memories] = await Promise.all([
    repo.getMeta("lastBackupAt"),
    repo.getMeta("lastBackupHow"),
    repo.getMeta("autoBackupDir"),
    repo.listMemories(),
  ]);
  const daysSince = lastBackupAt
    ? Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86_400_000)
    : null;
  return {
    memoryCount: memories.length,
    lastBackupAt,
    lastBackupHow,
    daysSince,
    autoConfigured: !!autoDir,
    stale:
      memories.length > 0 &&
      (lastBackupAt == null || daysSince >= STALE_AFTER_DAYS),
  };
}
