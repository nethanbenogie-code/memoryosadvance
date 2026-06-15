/**
 * MemoryOS — ui/memory-detail.js
 *
 * A calm, read-first detail view for any memory. Click a card anywhere in
 * the app and this opens, showing the COMPLETE record — full journal text,
 * the whole note or idea, a Memory Card's people/place/reflection and the
 * Cognitive Links to where its media lives. Nothing is truncated here.
 *
 * Read-only by default, with Archive always available and Edit for the
 * types that have a dedicated editor (Memory Cards). It writes nothing
 * itself except through memory-service.
 */

import { el } from "./components.js";
import { MemoryType, ImportanceLevel } from "../data/models.js";
import * as memoryService from "../services/memory-service.js";
import { openMemoryCardCapture } from "./memory-card-capture.js";

let overlay = null;

/**
 * Open the detail view for a memory.
 * @param {import("../data/models.js").MemoryObject} memory
 */
export function openMemoryDetail(memory) {
  if (!memory) return;
  close();

  const isCard = memory.type === MemoryType.MEMORY_CARD;
  const x = memory.extra ?? {};
  const fullDate = new Date(memory.occurredAt).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const closeX = el("button.md-close", {
    type: "button", "aria-label": "Close", onclick: close,
  }, "×");

  const blocks = [
    el("div.md-head", {},
      el("div.md-meta", {},
        el("span.chip", { dataset: { type: memory.type } }, typeLabel(memory.type)),
        el("span.md-date", {}, fullDate),
      ),
      el("h2.md-title", {}, displayTitle(memory)),
    ),
  ];

  const content = (memory.content ?? "").trim();
  if (content) {
    blocks.push(el("div.md-content", {}, content)); // CSS preserves line breaks
  } else if (memory.type === MemoryType.JOURNAL) {
    blocks.push(el("p.md-empty", {}, "No reflection was written for this day."));
  }

  if (isCard) {
    if (x.people?.length) blocks.push(detailRow("People", x.people.join(", ")));
    if (x.location) blocks.push(detailRow("Location", x.location));
    if (x.importanceLevel && x.importanceLevel !== ImportanceLevel.LOW) {
      blocks.push(detailRow("Importance", importanceText(x.importanceLevel)));
    }
    const media = x.externalMedia ?? [];
    if (media.length) {
      blocks.push(el("div.md-section", {},
        el("p.md-label", {}, "Photos & media stored at"),
        ...media.map(renderMediaRef),
      ));
    }
    if (x.reflection) {
      blocks.push(el("blockquote.md-reflection", {}, `"${x.reflection}"`));
    }
  }

  if (memory.tags?.length) {
    blocks.push(el("div.card-tags.md-tags", {},
      ...memory.tags.map((t) => el("span.chip.chip-tag", {}, `#${t}`)),
    ));
  }

  const archiveBtn = el("button.btn.btn-quiet.btn-danger", {
    type: "button",
    onclick: () => {
      if (confirm(`Archive "${memory.title || "this memory"}"? It moves to the archive, not oblivion.`)) {
        memoryService.deleteMemory(memory.id);
        close();
      }
    },
  }, "Archive");

  const rightBtns = [];
  if (isCard) {
    rightBtns.push(el("button.btn.btn-primary", {
      type: "button",
      onclick: () => {
        close();
        openMemoryCardCapture({
          title: memory.title,
          description: memory.content,
          ...x,
          tags: memory.tags,
        });
      },
    }, "Edit"));
  }
  rightBtns.push(el("button.btn.btn-quiet", { type: "button", onclick: close }, "Close"));

  blocks.push(el("div.mc-foot.md-foot", {}, archiveBtn, el("div.md-foot-right", {}, ...rightBtns)));

  overlay = el("div.mc-overlay.md-overlay", {
    role: "dialog", "aria-modal": "true",
    "aria-label": `Details: ${displayTitle(memory)}`,
  },
    el("div.mc-mini-card.md-card", {}, closeX, ...blocks),
  );

  document.body.append(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKeydown);
  closeX.focus();
}

function renderMediaRef(ref) {
  const icon = mediaIcon(ref.type);
  if (/^https?:\/\//i.test(ref.path || "")) {
    return el("a.md-media.md-media-link", {
      href: ref.path, target: "_blank", rel: "noopener noreferrer",
    }, `${icon} `, ref.label || ref.path, el("span.md-media-open", { "aria-hidden": "true" }, " ↗"));
  }
  const detail = ref.path && ref.type !== "url" ? ` — ${ref.path}` : "";
  return el("div.md-media", {}, `${icon} `, (ref.label || "Media") + detail);
}

function detailRow(label, value) {
  return el("div.md-row", {},
    el("span.md-row-label", {}, label),
    el("span.md-row-value", {}, value),
  );
}

function onKeydown(e) { if (e.key === "Escape") close(); }

function close() {
  document.removeEventListener("keydown", onKeydown);
  overlay?.remove();
  overlay = null;
}

/* ----------------------------- helpers ----------------------------- */

function displayTitle(memory) {
  if (memory.type === MemoryType.JOURNAL && /^Journal — \d{4}-\d{2}-\d{2}$/.test(memory.title || "")) {
    return new Date(memory.occurredAt).toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }
  return memory.title || "(untitled)";
}

function importanceText(level) {
  return { [ImportanceLevel.MEDIUM]: "Notable", [ImportanceLevel.HIGH]: "★ Important",
    [ImportanceLevel.MILESTONE]: "⬟ Life milestone" }[level] ?? "";
}

function typeLabel(type) {
  const labels = {
    memory_card: "Memory Card", journal: "Journal", note: "Note", idea: "Idea",
    task: "Achievement", event: "Event", meeting: "Meeting", learning: "Learning",
    article: "Article", goal: "Goal",
  };
  return labels[type] ?? type;
}

function mediaIcon(type) {
  const icons = {
    facebook_album: "📘", google_photos: "📷", icloud: "☁",
    local_folder: "💾", external_drive: "🔌", url: "🔗", other: "📦",
  };
  return icons[type] ?? "📦";
}
