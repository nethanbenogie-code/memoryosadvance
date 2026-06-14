/**
 * MemoryOS — ui/timeline-view.js
 *
 * The Timeline: every memory on one line through time, grouped under
 * serif day headings, hung from the spine. Sorted by occurredAt —
 * event time, not capture time — and filterable by type.
 */

import { bus } from "../core/events.js";
import { MemoryType, typeLabel } from "../data/models.js";
import * as memoryService from "../services/memory-service.js";
import { el, emptyState, formatDayHeading, localDayKey, memoryCard } from "./components.js";
import { openCapture } from "./capture.js";

const FILTER_TYPES = [
  MemoryType.NOTE,
  MemoryType.IDEA,
  MemoryType.TASK,
  MemoryType.EVENT,
  MemoryType.JOURNAL,
];

export class TimelineView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.typeFilter = null; // null = everything
    this.unsubscribes = [];
  }

  async mount() {
    const refresh = () => this.render();
    this.unsubscribes = [
      bus.on("memory:created", refresh),
      bus.on("memory:updated", refresh),
      bus.on("memory:deleted", refresh),
    ];
    await this.render();
  }

  unmount() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
  }

  async render() {
    const memories = await memoryService.listAll();
    const filtered = this.typeFilter
      ? memories.filter((m) => m.type === this.typeFilter)
      : memories;

    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "Timeline"), this._filters()),
      filtered.length ? this._spine(filtered) : this._empty(memories.length)
    );
  }

  _filters() {
    const chip = (label, type) =>
      el(
        "button.chip.chip-select",
        {
          type: "button",
          dataset: type ? { type } : {},
          "aria-pressed": String(this.typeFilter === type),
          onclick: () => {
            this.typeFilter = type;
            this.render();
          },
        },
        label
      );
    return el(
      "div.filter-row",
      { role: "toolbar", "aria-label": "Filter by type" },
      chip("All", null),
      ...FILTER_TYPES.map((t) => chip(typeLabel(t) + "s", t))
    );
  }

  /** Group by local day, newest day first, and hang cards on the spine. */
  _spine(memories) {
    const groups = new Map();
    for (const memory of memories) {
      const key = localDayKey(memory.occurredAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(memory);
    }

    const todayKey = localDayKey(new Date().toISOString());
    const spine = el("div.spine", {});
    for (const [key, dayMemories] of groups) {
      spine.append(
        el(
          "section.spine-day",
          {},
          el(
            "h3.day-heading",
            {},
            formatDayHeading(key),
            key === todayKey ? el("span.today-pill", {}, "Today") : null
          ),
          ...dayMemories.map((memory) =>
            el("div.spine-item", { dataset: { type: memory.type } }, memoryCard(memory))
          )
        )
      );
    }
    return spine;
  }

  _empty(totalCount) {
    if (totalCount === 0) {
      return emptyState(
        "Your timeline begins with the first thing you save.",
        "Press Ctrl+K (⌘K on Mac) or tap + to capture a memory."
      );
    }
    const e = emptyState(`No ${typeLabel(this.typeFilter).toLowerCase()}s yet.`);
    e.append(
      el("button.btn.btn-primary", { type: "button", onclick: openCapture }, "Capture one")
    );
    return e;
  }
}
