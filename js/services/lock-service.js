/**
 * MemoryOS — services/lock-service.js
 *
 * Optional app lock with recovery code.
 *
 * What this is: a lock on the door. It keeps other people who use this
 * device out of your memories — family, coworkers, anyone who picks up
 * your phone. The password never leaves the device and is never stored:
 * only a salted PBKDF2-SHA256 hash (310k iterations) is kept.
 *
 * What this is NOT (stated honestly, here and in the manual): the data
 * in IndexedDB is not encrypted by this lock. Full encryption would
 * make "forgot password" mean "memories gone forever" — the wrong trade
 * for an app whose first duty is to never lose a memory. If demand
 * exists, encryption can ship later as a separate, clearly-marked mode.
 *
 * Recovery, with no server: at setup we generate a recovery code,
 * show it ONCE, and store only its hash. "Forgot password" = enter the
 * recovery code, set a new password, receive a NEW recovery code.
 * If both are lost there is deliberately no bypass — a lock with a
 * bypass button is not a lock.
 */

import { bus } from "../core/events.js";
import * as repo from "../data/repository.js";

const ITERATIONS = 310_000;
const META_KEY = "lock";

/** Session state: relocks on every full app load. */
let unlocked = false;

/* ------------------------------ crypto ------------------------------ */

/**
 * PBKDF2-SHA256 → hex. Pure given (secret, saltHex); unit-testable.
 * @param {string} secret @param {string} saltHex
 */
export async function hashSecret(secret, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations: ITERATIONS,
    },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Unambiguous alphabet: no I, L, O, 0, 1. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "XXXX-XXXX-XXXX" — ~58 bits of entropy, writable on paper. */
export function generateRecoveryCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

/** Forgiving input: case, spaces, and dashes don't matter. */
export function normalizeRecoveryCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z2-9]/g, "");
}

/* ---------------------------- lock lifecycle ---------------------------- */

export async function isLockEnabled() {
  return !!(await repo.getMeta(META_KEY));
}

export function isUnlocked() {
  return unlocked;
}

/**
 * Enable the lock. Returns the recovery code — display it ONCE, then
 * it exists nowhere but the user's paper and a hash.
 * @param {string} password @param {string} [hint] optional user-written hint
 */
export async function setupLock(password, hint = "") {
  requirePassword(password);
  const recoveryCode = generateRecoveryCode();
  await writeLockRecord(password, recoveryCode, hint);
  unlocked = true;
  bus.emit("lock:changed", { enabled: true });
  return recoveryCode;
}

/** @param {string} password */
export async function unlockWithPassword(password) {
  const lock = await repo.getMeta(META_KEY);
  if (!lock) {
    unlocked = true;
    return true;
  }
  const hash = await hashSecret(password, lock.passSalt);
  if (!constantEqual(hash, lock.passHash)) return false;
  unlocked = true;
  bus.emit("lock:unlocked", {});
  return true;
}

/** Check a recovery code without changing any state. */
export async function verifyRecoveryCode(code) {
  const lock = await repo.getMeta(META_KEY);
  if (!lock) return false;
  const hash = await hashSecret(normalizeRecoveryCode(code), lock.recoverySalt);
  return constantEqual(hash, lock.recoveryHash);
}

/**
 * Forgot-password flow: a valid recovery code sets a new password and
 * issues a NEW recovery code (the old one is spent).
 * @returns {Promise<string|null>} new recovery code, or null if the code was wrong.
 */
export async function resetWithRecoveryCode(code, newPassword) {
  requirePassword(newPassword);
  if (!(await verifyRecoveryCode(code))) return null;
  const lock = await repo.getMeta(META_KEY);
  const newCode = generateRecoveryCode();
  await writeLockRecord(newPassword, newCode, lock.hint ?? "");
  unlocked = true;
  bus.emit("lock:unlocked", {});
  return newCode;
}

/** @returns {Promise<boolean>} false if the current password was wrong. */
export async function changePassword(currentPassword, newPassword) {
  requirePassword(newPassword);
  if (!(await unlockWithPassword(currentPassword))) return false;
  const lock = await repo.getMeta(META_KEY);
  const code = generateRecoveryCode(); // changing the password re-keys recovery too
  await writeLockRecord(newPassword, code, lock.hint ?? "");
  return code;
}

/** @returns {Promise<boolean>} false if the password was wrong. */
export async function disableLock(currentPassword) {
  if (!(await unlockWithPassword(currentPassword))) return false;
  await repo.setMeta(META_KEY, null);
  bus.emit("lock:changed", { enabled: false });
  return true;
}

export async function getHint() {
  const lock = await repo.getMeta(META_KEY);
  return lock?.hint || null;
}

/** Relock the session (e.g., a "Lock now" button). */
export function lockNow() {
  unlocked = false;
  bus.emit("lock:locked", {});
}

/* ------------------------------- helpers ------------------------------- */

async function writeLockRecord(password, recoveryCode, hint) {
  const passSalt = randomSaltHex();
  const recoverySalt = randomSaltHex();
  await repo.setMeta(META_KEY, {
    passSalt,
    passHash: await hashSecret(password, passSalt),
    recoverySalt,
    recoveryHash: await hashSecret(normalizeRecoveryCode(recoveryCode), recoverySalt),
    hint: hint?.trim() || null,
    updatedAt: new Date().toISOString(),
  });
}

function requirePassword(password) {
  if (typeof password !== "string" || password.length < 4) {
    throw new Error("The password needs at least 4 characters.");
  }
}

/** Length-safe comparison over hex strings. */
export function constantEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
