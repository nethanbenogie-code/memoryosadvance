/**
 * MemoryOS — ui/second-brain-view.js
 *
 * Project Mnemosyne: the Second Brain Timeline.
 *
 * This is the central view of MemoryOS — not a social feed, not a task
 * board, but a calm chronological record of a life. The design enforces
 * the philosophy: no engagement counters, no infinite scroll, no
 * algorithmic sorting. Newest meaningful events first. Full stop.
 *
 * Sections:
 *   1. Today's Memory Context — anchors the user before they open
 *      anything else. On-this-day memories, upcoming anniversaries.
 *   2. The Second Brain Timeline — every meaningful memory, grouped by
 *      month, filterable by category.
 */

import { bus } from "../core/events.js";
import { MemoryType, ImportanceLevel, TaskStatus } from "../data/models.js";
import {
  getSecondBrainTimeline,
  getTodayContext,
  getLifeStats,
  SB_CATEGORIES,
} from "../services/mnemosyne-service.js";
import { openMemoryCardCapture } from "./memory-card-capture.js";
import { openCognitiveLinkingExplainer } from "./cognitive-linking-onboarding.js";
import { el, emptyState, formatDayHeading } from "./components.js";
import { showToast } from "./celebration.js";
import * as memoryService from "../services/memory-service.js";

const IMPORTANCE_COLOR = {
  [ImportanceLevel.LOW]: "var(--ink-soft)",
  [ImportanceLevel.MEDIUM]: "var(--c-note)",
  [ImportanceLevel.HIGH]: "var(--c-idea)",
  [ImportanceLevel.MILESTONE]: "var(--c-task)",
};

const IMPORTANCE_LABEL = {
  [ImportanceLevel.LOW]: "",
  [ImportanceLevel.MEDIUM]: "",
  [ImportanceLevel.HIGH]: "★ Important",
  [ImportanceLevel.MILESTONE]: "⬟ Life milestone",
};

export class SecondBrainView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.category = "all";
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
    const [context, timeline, stats] = await Promise.all([
      getTodayContext(),
      getSecondBrainTimeline({ category: this.category }),
      getLifeStats(),
    ]);

    this.container.replaceChildren(
      el("header.view-head", {},
        el("h2.view-title", {}, "Second Brain"),
        el("div.sb-head-actions", {},
          el("button.btn.btn-quiet.sb-guide-link", {
            type: "button",
            onclick: () => openCognitiveLinkingExplainer(),
          }, "How Cognitive Linking works"),
          el("button.btn.btn-primary.mc-fab-btn", {
            type: "button",
            onclick: () => openMemoryCardCapture(),
          }, "+ Memory Card")
        )
      ),
      this._statsBar(stats),
      this._todayContext(context),
      this._categoryFilters(),
      timeline.length
        ? this._timeline(timeline)
        : this._emptyTimeline()
    );
  }

  /* ----------------------- stats bar ----------------------- */

  _statsBar(stats) {
    if (stats.totalMemories === 0) return el("span");
    const items = [
      stats.memoryCards && [stats.memoryCards, "memory cards"],
      stats.journalEntries && [stats.journalEntries, "journal entries"],
      stats.learningRecords && [stats.learningRecords, "learning records"],
      stats.peopleTagged && [stats.peopleTagged, "people"],
      stats.yearsOfMemory > 1 && [stats.yearsOfMemory, "years of memory"],
    ].filter(Boolean);

    return el(
      "div.sb-stats",
      {},
      ...items.map(([n, label]) =>
        el("span.sb-stat", {},
          el("strong", {}, String(n)),
          ` ${label}`
        )
      )
    );
  }

  /* -------------------- today's context -------------------- */

  _todayContext(ctx) {
    const sections = [];

    if (ctx.upcomingAnniversaries.length) {
      sections.push(
        el("div.ctx-section", {},
          el("h3.ctx-heading", {}, "Upcoming anniversaries"),
          ...ctx.upcomingAnniversaries.slice(0, 3).map((a) =>
            el("div.ctx-item", {},
              el("span.ctx-icon", {}, "📅"),
              el("div.ctx-body", {},
                el("strong", {}, a.memory.title),
                el("span.ctx-meta", {},
                  a.daysAway === 0
                    ? `Today! ${a.yearsAgo} year${a.yearsAgo !== 1 ? "s" : ""} ago`
                    : `In ${a.daysAway} day${a.daysAway !== 1 ? "s" : ""} · ${a.yearsAgo} year${a.yearsAgo !== 1 ? "s" : ""} ago`
                )
              )
            )
          )
        )
      );
    }

    if (ctx.onThisDay.length) {
      sections.push(
        el("div.ctx-section", {},
          el("h3.ctx-heading", {}, "On this day in past years"),
          ...ctx.onThisDay.slice(0, 3).map((m) =>
            el("div.ctx-item.ctx-clickable", {
              onclick: () => scrollToMemory(m.id),
              title: "Click to find in your timeline",
            },
              el("span.ctx-icon", {}, typeIcon(m.type)),
              el("div.ctx-body", {},
                el("strong", {}, m.title),
                el("span.ctx-meta", {}, new Date(m.occurredAt).getFullYear())
              )
            )
          )
        )
      );
    }

    if (ctx.recentReflections.length) {
      const latest = ctx.recentReflections[0];
      sections.push(
        el("div.ctx-section", {},
          el("h3.ctx-heading", {}, "A recent reflection"),
          el("blockquote.ctx-quote", {}, `"${latest.extra.reflection}"`,
            el("cite", {}, `— ${latest.title}`)
          )
        )
      );
    }

    if (!sections.length) return el("span");

    return el("section.ctx-widget", {},
      el("h3.ctx-widget-title", {}, "Today's Memory Context"),
      ...sections
    );
  }

  /* ------------------- category filters -------------------- */

  _categoryFilters() {
    return el(
      "div.filter-row.sb-filters",
      { role: "toolbar", "aria-label": "Filter timeline by category" },
      ...SB_CATEGORIES.map(({ id, label }) =>
        el("button.chip.chip-select", {
          type: "button",
          "aria-pressed": String(this.category === id),
          onclick: () => { this.category = id; this.render(); },
        }, label)
      )
    );
  }

  /* -------------------- the timeline itself ---------------- */

  _timeline(memories) {
    // Group by year → month
    const groups = new Map();
    for (const m of memories) {
      const d = new Date(m.occurredAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }

    return el("div.sb-timeline", {},
      ...[...groups.entries()].map(([key, items]) => {
        const [year, month] = key.split("-").map(Number);
        const heading = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
          year: "numeric", month: "long",
        });
        return el("section.sb-month", {},
          el("h3.sb-month-heading", {}, heading),
          ...items.map((m) => this._memoryEntry(m))
        );
      })
    );
  }

  _memoryEntry(memory) {
    const isCard = memory.type === MemoryType.MEMORY_CARD;
    const importance = memory.extra?.importanceLevel ?? ImportanceLevel.LOW;
    const isMilestone = importance === ImportanceLevel.MILESTONE;

    const day = new Date(memory.occurredAt).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });

    const header = el("div.sb-entry-head", {},
      el("span.sb-day", {}, day),
      el("span.chip", { dataset: { type: memory.type } }, typeLabel(memory.type)),
      isMilestone || importance === ImportanceLevel.HIGH
        ? el("span.sb-importance", {
            style: `color:${IMPORTANCE_COLOR[importance]}`,
          }, IMPORTANCE_LABEL[importance])
        : null,
    );

    // For journal entries with only the auto-generated title,
    // display the date part more elegantly
    const isAutoTitle = memory.type === "journal" && /^Journal — \d{4}-\d{2}-\d{2}$/.test(memory.title);
    const displayTitle = isAutoTitle
      ? formatDayHeadingShort(memory.occurredAt)
      : memory.title;
    const title = el("h3.sb-entry-title", {}, displayTitle);

    // For journal pages, prefer showing content over empty state
    const isJournal = memory.type === "journal";
    const displayBody = memory.content?.trim()
      ? truncate(memory.content, 200)
      : (isJournal ? "No reflection written for this day yet." : null);
    const body = displayBody
      ? el(`p.sb-entry-body${!memory.content?.trim() ? ".sb-entry-empty" : ""}`, {}, displayBody)
      : null;

    // Memory Card extras
    const extras = [];
    if (isCard) {
      const people = memory.extra?.people ?? [];
      if (people.length) {
        extras.push(el("p.sb-extra", {},
          el("span.sb-extra-icon", {}, "👥"),
          people.join(", ")
        ));
      }
      if (memory.extra?.location) {
        extras.push(el("p.sb-extra", {},
          el("span.sb-extra-icon", {}, "📍"),
          memory.extra.location
        ));
      }
      const media = memory.extra?.externalMedia ?? [];
      if (media.length) {
        extras.push(
          el("div.sb-media-refs", {},
            el("p.sb-extra-label", {}, "Photos stored at:"),
            ...media.map((ref) =>
              el("span.sb-media-chip", {}, mediaIcon(ref.type), " ", ref.label)
            )
          )
        );
      }
      if (memory.extra?.reflection) {
        extras.push(
          el("blockquote.sb-reflection", {}, `"${memory.extra.reflection}"`)
        );
      }
    }

    const tags = memory.tags.length
      ? el("div.card-tags", {},
          ...memory.tags.map((t) =>
            el("span.chip.chip-tag", {}, `#${t}`)
          )
        )
      : null;

    const actions = el("div.sb-entry-actions", {},
      isCard
        ? el("button.btn.btn-quiet", {
            type: "button",
            onclick: () => openMemoryCardCapture({
              title: memory.title,
              description: memory.content,
              ...memory.extra,
              tags: memory.tags,
            }),
          }, "Edit")
        : null,
      el("button.btn.btn-quiet.btn-danger", {
        type: "button",
        onclick: () => {
          if (confirm(`Archive "${memory.title}"?`)) {
            memoryService.deleteMemory(memory.id);
          }
        },
      }, "Archive")
    );

    return el(
      `article.sb-entry${isMilestone ? ".sb-milestone" : ""}`,
      { dataset: { id: memory.id, type: memory.type } },
      header, title, body,
      ...extras,
      tags,
      actions
    );
  }

  _emptyTimeline() {
    const e = emptyState(
      this.category === "all"
        ? "Your Second Brain timeline begins with your first Memory Card."
        : `No ${SB_CATEGORIES.find(c => c.id === this.category)?.label ?? "entries"} yet.`,
      "Click \"+ Memory Card\" to preserve your first meaningful memory."
    );
    if (this.category === "all") {
      e.append(
        el("button.btn.btn-quiet.sb-guide-link", {
          type: "button",
          onclick: () => openCognitiveLinkingExplainer(),
        }, "How Cognitive Linking works")
      );
    }
    return e;
  }
}

/* ----------------------------- helpers ----------------------------- */

function typeLabel(type) {
  const labels = {
    memory_card: "Memory Card", journal: "Journal", note: "Note",
    idea: "Idea", task: "Achievement", event: "Event", meeting: "Meeting",
    learning: "Learning", article: "Article", goal: "Goal",
  };
  return labels[type] ?? type;
}

function typeIcon(type) {
  const icons = {
    memory_card: "🃏", journal: "✎", note: "📝", idea: "💡",
    task: "✅", event: "📅", meeting: "🤝", learning: "📚",
    article: "📰", goal: "🎯",
  };
  return icons[type] ?? "◉";
}

function mediaIcon(type) {
  const icons = {
    facebook_album: "📘", google_photos: "📷", icloud: "☁",
    local_folder: "💾", external_drive: "🔌", url: "🔗", other: "📦",
  };
  return icons[type] ?? "📦";
}

function formatDayHeadingShort(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

function truncate(text, max) {
  const clean = (text ?? "").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function scrollToMemory(id) {
  const el_ = document.querySelector(`[data-id="${id}"]`);
  el_?.scrollIntoView({ behavior: "smooth", block: "center" });
}
