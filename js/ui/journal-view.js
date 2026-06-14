/**
 * MemoryOS — ui/journal-view.js
 *
 * Daily Journal: today's page, created automatically on first visit.
 * A serif heading, a free-writing reflection box (auto-saved), and the
 * day read back to you — what you captured, what you completed.
 * Arrows step backward and forward through past days.
 */

import { bus } from "../core/events.js";
import * as journal from "../services/journal-service.js";
import { el, emptyState, formatDayHeading, memoryCard } from "./components.js";
import { openCapture } from "./capture.js";

const SAVE_DELAY_MS = 600;

export class JournalView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.key = journal.dayKey();
    this.saveTimer = null;
    this.unsubscribes = [];
  }

  async mount() {
    const refresh = ({ memory }) => {
      // Re-render on changes to anything that isn't this page's own
      // autosave (which would fight the user's cursor).
      if (memory && memory.extra?.dayKey === this.key) return;
      this.render();
    };
    this.unsubscribes = [
      bus.on("memory:created", refresh),
      bus.on("memory:updated", refresh),
      bus.on("memory:deleted", () => this.render()),
    ];
    await this.render();
  }

  unmount() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    clearTimeout(this.saveTimer);
  }

  async render() {
    const { key, page, captured, completedTasks } = await journal.getDayBundle(this.key);
    const isToday = key === journal.dayKey();

    const goToday = !isToday
      ? el("button.btn.btn-quiet", {
          type: "button",
          title: "Go to today",
          onclick: () => { this.key = journal.dayKey(); this.render(); }
        }, "Today")
      : null;

    const heading = el(
      "header.view-head.journal-head",
      {},
      el(
        "div.journal-nav",
        {},
        this._navButton("‹", -1, "Previous day"),
        el(
          "h2.day-heading.journal-heading",
          {},
          formatDayHeading(key),
          isToday ? el("span.today-pill", {}, "Today") : null
        ),
        this._navButton("›", +1, "Next day", isToday),
        goToday
      ),
      el(
        "div.journal-actions",
        {},
        el("button.btn.btn-primary", {
          type: "button",
          onclick: () => {
            // Pre-select Journal type then open capture
            openCapture("journal");
          }
        }, "+ New journal entry"),
        el("button.btn.btn-quiet", {
          type: "button",
          onclick: () => {
            // Open quick capture with no pre-selection for any type
            openCapture();
          }
        }, "+ Quick capture")
      )
    );

    const reflection = el("textarea.journal-text", {
      placeholder: isToday
        ? "How did today go? Write freely — it saves as you type.\n\nTip: the first line becomes the title shown in your Second Brain timeline."
        : "Notes for this day…",
      "aria-label": "Journal reflection",
      rows: "6",
    });
    reflection.value = page.content;
    const saveState = el("p.journal-save", { "aria-live": "polite" }, "");
    reflection.addEventListener("input", () => {
      saveState.textContent = "Saving…";
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(async () => {
        await journal.saveJournalContent(key, reflection.value);
        saveState.textContent = "Saved";
      }, SAVE_DELAY_MS);
    });

    const capturedSection = el(
      "section.journal-section",
      {},
      el("h3.section-heading", {}, "Captured this day"),
      ...(captured.length
        ? captured.map((memory) => memoryCard(memory))
        : [emptyState(
            isToday ? "Nothing captured yet today." : "Nothing was captured this day.",
            isToday ? "Press Ctrl+K (⌘K) to save your first memory of the day." : null
          )])
    );

    const completedSection = completedTasks.length
      ? el(
          "section.journal-section",
          {},
          el("h3.section-heading", {}, "Completed this day"),
          ...completedTasks.map((task) => memoryCard(task, { showTime: false }))
        )
      : null;

    this.container.replaceChildren(
      heading,
      el("section.journal-section", {}, reflection, saveState),
      capturedSection,
      ...(completedSection ? [completedSection] : [])
    );
  }

  _navButton(glyph, deltaDays, label, disabled = false) {
    return el(
      "button.btn.btn-quiet.journal-arrow",
      {
        type: "button",
        "aria-label": label,
        disabled: disabled ? "disabled" : null,
        onclick: () => {
          this.key = shiftDay(this.key, deltaDays);
          this.render();
        },
      },
      glyph
    );
  }
}

/** @param {string} key "YYYY-MM-DD" @param {number} delta */
function shiftDay(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  return journal.dayKey(new Date(y, m - 1, d + delta));
}
