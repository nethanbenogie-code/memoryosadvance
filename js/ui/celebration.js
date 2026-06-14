/**
 * MemoryOS — ui/celebration.js
 *
 * The happy mode. When a task is completed, reward the brain within the
 * same second: a confetti burst, a soft rising chime, and a toast with
 * the points earned and a rotating word of praise. Immediate feedback +
 * visible progress + gentle variety — positive reinforcement only,
 * never guilt.
 *
 * Reduced-motion users get the toast and chime without the confetti.
 */

import { bus } from "../core/events.js";
import { pointsFor, randomPraise } from "../services/rewards-service.js";
import { el } from "./components.js";

const TOAST_MS = 3200;
const CONFETTI_PIECES = 26;
const CONFETTI_COLORS = ["#4c4ed9", "#7c3aed", "#b26a00", "#0f766e", "#be185d", "#15803d"];

/* ------------------------------- toast ------------------------------- */

let toastHost = null;

/**
 * Show a transient toast.
 * @param {string} message
 * @param {{accent?: boolean}} [opts]
 */
export function showToast(message, opts = {}) {
  if (!toastHost) {
    toastHost = el("div.toast-host", { "aria-live": "polite" });
    document.body.append(toastHost);
  }
  const toast = el(`div.toast${opts.accent ? ".toast-accent" : ""}`, {}, message);
  toastHost.append(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, TOAST_MS);
}

/* ------------------------------ confetti ----------------------------- */

function burstConfetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = el("div.confetti-host", { "aria-hidden": "true" });
  for (let i = 0; i < CONFETTI_PIECES; i++) {
    const piece = el("span.confetti");
    piece.style.setProperty("--dx", `${(Math.random() * 2 - 1) * 240}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty("--delay", `${Math.random() * 120}ms`);
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    if (Math.random() > 0.5) piece.style.borderRadius = "50%";
    host.append(piece);
  }
  document.body.append(host);
  setTimeout(() => host.remove(), 1600);
}

/* -------------------------------- chime ------------------------------ */

let audioCtx = null;

/**
 * A two-note rising chime (E5 → A5) synthesized in WebAudio — no audio
 * files to download, nothing to cache. Fails silently where audio is
 * blocked; sound is garnish, never load-bearing.
 * @param {"reward"|"reminder"} kind
 */
function chime(kind = "reward") {
  try {
    audioCtx = audioCtx ?? new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const notes = kind === "reward" ? [659.25, 880.0] : [880.0, 659.25];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.12;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* audio unavailable — stay silent */
  }
}

/* ------------------------------- wiring ------------------------------ */

/** Subscribe the happy mode to the event bus. Call once at boot. */
export function initCelebrations() {
  bus.on("task:completed", ({ memory }) => {
    const points = pointsFor(memory);
    burstConfetti();
    chime("reward");
    showToast(`+${points} points · ${randomPraise()}`, { accent: true });
  });

  bus.on("reminder:due", ({ memory }) => {
    chime("reminder");
    showToast(`⏰ Due now: ${memory.title}`);
  });
}
