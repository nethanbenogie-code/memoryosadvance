/**
 * MemoryOS — app.js
 *
 * Bootstrap: open the database, warm the search index, wire navigation,
 * register the service worker. Views are mounted into one host element;
 * a tiny view registry stands in for a router until the app earns one.
 */

import { bus } from "./core/events.js";
import { openDatabase } from "./data/db.js";
import * as memoryService from "./services/memory-service.js";
import { searchIndex } from "./services/search-service.js";
import * as semantic from "./services/semantic-service.js";
import { initCapture, openCapture, bindCaptureShortcut } from "./ui/capture.js";
import { el } from "./ui/components.js";
import { TimelineView } from "./ui/timeline-view.js";
import { SearchView } from "./ui/search-view.js";
import { TasksView } from "./ui/tasks-view.js";
import { JournalView } from "./ui/journal-view.js";
import { BackupView } from "./ui/backup-view.js";
import { showToast } from "./ui/celebration.js";
import { getBackupStatus } from "./services/backup-service.js";
import { shareApp } from "./ui/share.js";
import { AboutView } from "./ui/about-view.js";
import { ManualView } from "./ui/manual-view.js";
import { SecondBrainView } from "./ui/second-brain-view.js";
import { AIView } from "./ai/ai-view.js";
import { initMemoryCardCapture } from "./ui/memory-card-capture.js";
import { maybeShowCognitiveLinkingOnboarding } from "./ui/cognitive-linking-onboarding.js";
import { isLockEnabled, lockNow } from "./services/lock-service.js";
import { showLockScreen } from "./ui/lock-screen.js";
import { initCelebrations } from "./ui/celebration.js";
import { startReminderLoop } from "./services/reminder-service.js";

const VIEWS = [
  { id: "brain", label: "Second Brain", icon: "◈", View: SecondBrainView },
  { id: "timeline", label: "Timeline", icon: "◷", View: TimelineView },
  { id: "search", label: "Search", icon: "⌕", View: SearchView },
  { id: "tasks", label: "Tasks", icon: "☑", View: TasksView },
  { id: "journal", label: "Journal", icon: "✎", View: JournalView },
  { id: "backup", label: "Backup", icon: "⛉", View: BackupView },
  { id: "ai", label: "AI Assistant", icon: "◈", View: AIView },
  { id: "about", label: "About MemoryOS", icon: "◈", View: AboutView, hidden: true },
  { id: "manual", label: "User manual", icon: "✦", View: ManualView, hidden: true },
];

let currentView = null;
let currentId = null;

async function main() {
  // Request persistent storage at boot. This tells the browser this
  // data matters and should not be evicted when disk space is low.
  // Works silently — no permission prompt shown to the user on most
  // browsers when the app is installed as a PWA.
  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  await openDatabase();
  if (await isLockEnabled()) await showLockScreen();
  searchIndex.build(await memoryService.listAll());

  // Build the semantic index in the background. Non-blocking: the model
  // downloads once (~25MB) then caches; the app is fully usable meanwhile,
  // and lexical search + AI keep working even if this never finishes.
  semantic.indexAll().catch((e) => console.warn("[semantic] initial index:", e));

  const host = document.getElementById("view-host");
  const sideNav = document.getElementById("side-nav");
  const tabBar = document.getElementById("tab-bar");

  for (const { id, label, icon, hidden } of VIEWS) {
    if (hidden) continue;
    sideNav.append(navButton(id, label, icon, "nav-item"));
    tabBar.append(navButton(id, label, icon, "tab-item"));
  }

  // Sidebar footer: About and the in-app User Manual.
  const sideLinks = document.getElementById("side-links");
  for (const { id, label } of VIEWS.filter((v) => v.hidden)) {
    sideLinks.append(
      el(
        "button.side-link",
        { type: "button", dataset: { view: id }, onclick: () => showView(id, host) },
        label
      )
    );
  }

  // Views (and anything else) can request navigation via the bus.
  bus.on("navigate", ({ view }) => showView(view, host));

  // "Lock now": relock the session and show the lock screen again.
  bus.on("lock:locked", async () => {
    await showLockScreen();
  });

  document.getElementById("capture-btn").addEventListener("click", openCapture);
  document.getElementById("share-btn").addEventListener("click", shareApp);
  document.getElementById("fab").addEventListener("click", openCapture);

  initCapture();
  initMemoryCardCapture();
  bindCaptureShortcut();
  initCelebrations();
  startReminderLoop();

  await showView("brain", host);
  registerServiceWorker();

  // First-run only: introduce Cognitive Linking (the Family Archive is its
  // most relatable example). Non-blocking and self-gating — shows exactly
  // once, and never for a user who was already using MemoryOS.
  maybeShowCognitiveLinkingOnboarding();

  // After a restore, rebuild the search index and re-render the open view.
  bus.on("backup:restored", async () => {
    searchIndex.build(await memoryService.listAll());
    semantic.indexAll().catch((e) => console.warn("[semantic] reindex after restore:", e));
    const id = currentId;
    currentId = null;
    showView(id, host);
  });

  // Backup nudge for people who don't read: an amber dot on the Backup
  // tab whenever backups are stale, plus one gentle toast per session.
  updateBackupAttention();
  bus.on("backup:done", updateBackupAttention);
  bus.on("memory:created", updateBackupAttention);

  let nudged = false;
  async function updateBackupAttention() {
    const status = await getBackupStatus();
    for (const button of document.querySelectorAll('[data-view="backup"]')) {
      button.toggleAttribute("data-attention", status.stale);
    }
    if (status.stale && !nudged) {
      nudged = true;
      showToast(
        status.lastBackupAt
          ? `It's been ${status.daysSince} days since your last backup.`
          : "Tip: back up your memories — it takes one tap."
      );
    }
  }

  function navButton(id, label, icon, className) {
    return el(
      `button.${className}`,
      {
        type: "button",
        dataset: { view: id },
        onclick: () => showView(id, host),
        "aria-label": label,
      },
      el("span.nav-icon", { "aria-hidden": "true" }, icon),
      el("span.nav-label", {}, label)
    );
  }
}

/**
 * @param {string} id
 * @param {HTMLElement} host
 */
async function showView(id, host) {
  if (id === currentId) return;
  const entry = VIEWS.find((v) => v.id === id);
  if (!entry) return;

  currentView?.unmount?.();
  host.replaceChildren();

  currentView = new entry.View(host);
  currentId = id;
  await currentView.mount();

  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-current", String(button.dataset.view === id));
  }
  bus.emit("view:changed", { view: id });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("./sw.js")
    .catch((err) => console.warn("[sw] registration failed:", err));
}

main().catch((err) => {
  console.error("[app] fatal startup error:", err);
  document.getElementById("view-host").replaceChildren(
    el(
      "div.empty",
      {},
      el("p.empty-message", {}, "MemoryOS couldn't start."),
      el("p.empty-hint", {}, "Open the browser console for details, then reload.")
    )
  );
});
