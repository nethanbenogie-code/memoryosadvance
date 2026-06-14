/**
 * MemoryOS — ui/memory-card-capture.js
 *
 * The Memory Card creation dialog. Richer than quick capture but still
 * designed for calm, unhurried use — the opposite of a social media
 * post. The user is preserving meaning, not performing for an audience.
 *
 * Cognitive Link Builder: instead of API integrations, we give the user
 * a structured text field to record WHERE the photos actually are. This
 * "wired link" in their mind is the point — not uploading the photos.
 */

import { MemoryType, MemoryType as MT, ImportanceLevel, MediaType, createMediaRef } from "../data/models.js";
import * as memoryService from "../services/memory-service.js";
import { el } from "./components.js";
import { showToast } from "./celebration.js";

const CATEGORIES = [
  "personal", "family", "friends", "travel", "work",
  "health", "learning", "milestone", "celebration", "other",
];

const IMPORTANCE_LABELS = {
  [ImportanceLevel.LOW]: "Low",
  [ImportanceLevel.MEDIUM]: "Meaningful",
  [ImportanceLevel.HIGH]: "Important",
  [ImportanceLevel.MILESTONE]: "Life milestone",
};

const MEDIA_TYPE_LABELS = {
  [MediaType.FACEBOOK_ALBUM]: "Facebook album",
  [MediaType.GOOGLE_PHOTOS]: "Google Photos",
  [MediaType.ICLOUD]: "iCloud",
  [MediaType.LOCAL_FOLDER]: "Local folder",
  [MediaType.EXTERNAL_DRIVE]: "External drive",
  [MediaType.URL]: "URL / link",
  [MediaType.OTHER]: "Other",
};

let dialog = null;

export function initMemoryCardCapture() {
  dialog = el("dialog.mc-dialog", { "aria-label": "Create Memory Card" });
  document.body.append(dialog);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}

export function openMemoryCardCapture(prefill = {}) {
  if (!dialog) initMemoryCardCapture();
  renderForm(prefill);
  dialog.showModal();
}

/* ------------------------------ form --------------------------------- */

function renderForm(prefill = {}) {
  let mediaRefs = prefill.externalMedia ?? [];

  // --- fields ---
  const titleInput = field("input", "Memory title *", {
    type: "text", placeholder: "e.g. Family Reunion 2026",
    value: prefill.title ?? "", autocomplete: "off",
  });
  const dateInput = field("input", "Date it happened", {
    type: "date", value: prefill.date ?? todayValue(),
  });
  const categorySelect = fieldSelect("Category", CATEGORIES, prefill.category ?? "personal");
  const descInput = field("textarea", "Description", {
    placeholder: "What happened? Who was there? What made it worth remembering?",
    rows: "3",
  });
  if (prefill.description) descInput.querySelector("textarea").value = prefill.description;

  const peopleInput = field("input", "People (comma-separated)", {
    type: "text", placeholder: "Mom, Dad, Anna, Carlo",
    value: (prefill.people ?? []).join(", "),
  });
  const locationInput = field("input", "Location", {
    type: "text", placeholder: "Grandmother's house, Mainit, Surigao del Norte",
    value: prefill.location ?? "",
  });
  const importanceSelect = fieldSelect(
    "Importance",
    Object.entries(IMPORTANCE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    String(prefill.importanceLevel ?? ImportanceLevel.MEDIUM),
    true
  );
  const reflectionInput = field("textarea", "Reflection (your words, for future you)", {
    placeholder: '"Need to make this an annual tradition." / "I felt so proud."',
    rows: "2",
  });
  if (prefill.reflection) reflectionInput.querySelector("textarea").value = prefill.reflection;

  // --- cognitive link builder ---
  const mediaHost = el("div.mc-media-list");

  // Use a single refreshMedia function so every operation
  // (add, remove) goes through the same path and mediaRefs
  // stays in sync with what's rendered.
  function refreshMedia() {
    renderMediaList(mediaHost, mediaRefs, (updated) => {
      mediaRefs = updated;
      refreshMedia();
    });
  }
  refreshMedia();

  const addMediaBtn = el(
    "button.btn.btn-quiet.mc-add-media",
    { type: "button", onclick: () => openMediaRefEditor(null, (ref) => {
      mediaRefs = [...mediaRefs, ref];
      refreshMedia();
    })},
    "+ Add where the photos are stored"
  );

  // --- tags ---
  const tagsInput = field("input", "Tags", {
    type: "text", placeholder: "#family #reunion #2026",
    value: (prefill.tags ?? []).map(t => "#" + t).join(" "),
  });

  const error = el("p.lock-error", { "aria-live": "polite" }, "");
  const saveBtn = el("button.btn.btn-primary.mc-save", { type: "button" }, "Save Memory Card");

  saveBtn.addEventListener("click", async () => {
    const title = titleInput.querySelector("input").value.trim();
    if (!title) { error.textContent = "Please add a title."; return; }

    const dateVal = dateInput.querySelector("input").value;
    const occurredAt = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

    const people = peopleInput.querySelector("input").value
      .split(",").map(p => p.trim()).filter(Boolean);
    const rawTags = tagsInput.querySelector("input").value;

    saveBtn.disabled = true;
    try {
      await memoryService.capture(
        `${title}\n${descInput.querySelector("textarea").value}`,
        {
          type: MemoryType.MEMORY_CARD,
          occurredAt,
          extra: {
            people,
            location: locationInput.querySelector("input").value.trim(),
            externalMedia: mediaRefs,
            importanceLevel: Number(importanceSelect.querySelector("select").value),
            reflection: reflectionInput.querySelector("textarea").value.trim(),
            category: categorySelect.querySelector("select").value,
          },
        }
      );
      showToast("Memory Card saved.", { accent: true });
      dialog.close();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });

  dialog.replaceChildren(
    el(
      "div.mc-inner",
      {},
      el("div.mc-header", {},
        el("h2.mc-title", {}, "New Memory Card"),
        el("p.mc-subtitle", {}, "Preserve the meaning. The photos can stay wherever they already are.")
      ),
      el("div.mc-form", {},
        titleInput, dateInput, categorySelect,
        descInput, peopleInput, locationInput,
        importanceSelect, reflectionInput,
        el("div.mc-section-label", {}, "Where are the photos?"),
        mediaHost, addMediaBtn,
        tagsInput,
      ),
      error,
      el("div.mc-foot", {},
        el("button.btn.btn-quiet", { type: "button", onclick: () => dialog.close() }, "Cancel"),
        saveBtn
      )
    )
  );
}

/* -------------------- cognitive link editor ------------------------- */

function openMediaRefEditor(existing, onSave) {
  const overlay = el("div.mc-overlay");
  document.body.append(overlay);

  const typeSelect = fieldSelect(
    "Storage type",
    Object.entries(MEDIA_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
    existing?.type ?? MediaType.OTHER,
    true
  );
  const labelInput = field("input", "Description / path", {
    type: "text",
    placeholder: "e.g. Facebook → MemoryOS - Family Archive → Family Reunion 2026",
    value: existing?.label ?? "",
  });
  const exampleHint = el("p.mc-hint", {}, cognitiveHint(existing?.type ?? MediaType.OTHER));
  typeSelect.querySelector("select").addEventListener("change", (e) => {
    exampleHint.textContent = cognitiveHint(e.target.value);
  });

  // Store direct references to the actual inputs so we never
  // accidentally query through the wrapper div and get undefined.
  const labelEl = labelInput.querySelector("input");
  const typeEl = typeSelect.querySelector("select");

  const saveBtn = el("button.btn.btn-primary", { type: "button" }, existing ? "Update" : "Add");
  const doSave = () => {
    const label = labelEl.value.trim();
    if (!label) {
      labelEl.style.borderColor = "var(--c-task)";
      labelEl.focus();
      return;
    }
    labelEl.style.borderColor = "";
    onSave(createMediaRef({ label, type: typeEl.value }));
    overlay.remove();
  };
  saveBtn.addEventListener("click", doSave);
  // Also allow Enter key inside the label input to confirm
  labelEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); doSave(); }
  });

  overlay.replaceChildren(
    el("div.mc-mini-card", {},
      el("h3.mc-title", {}, "Where are the photos?"),
      typeSelect, labelInput, exampleHint,
      el("p.mc-hint.mc-privacy", {},
        "MemoryOS stores only this text reference — no photos are uploaded or accessed."
      ),
      el("div.mc-foot", {},
        el("button.btn.btn-quiet", { type: "button", onclick: () => overlay.remove() }, "Cancel"),
        saveBtn
      )
    )
  );
  labelInput.querySelector("input")?.focus();
}

function cognitiveHint(type) {
  const hints = {
    [MediaType.FACEBOOK_ALBUM]: 'e.g. "Facebook → MemoryOS - Family Archive → Family Reunion 2026"',
    [MediaType.GOOGLE_PHOTOS]: 'e.g. "Google Photos → Travel → Japan 2025"',
    [MediaType.ICLOUD]: 'e.g. "iCloud → Shared Albums → Family 2026"',
    [MediaType.LOCAL_FOLDER]: 'e.g. "D:\\Photos\\2026\\Family Reunion"',
    [MediaType.EXTERNAL_DRIVE]: 'e.g. "Family Backup SSD → 2026 → Events"',
    [MediaType.URL]: "Paste a link to the album or shared folder",
    [MediaType.OTHER]: 'Describe where the photos are — any text that helps future-you find them',
  };
  return hints[type] ?? "";
}

function renderMediaList(host, refs, onChange) {
  host.replaceChildren(
    ...refs.map((ref, i) =>
      el("div.mc-media-ref", {},
        el("span.mc-media-icon", {}, mediaIcon(ref.type)),
        el("span.mc-media-label", {}, ref.label),
        el("button.btn.btn-quiet", {
          type: "button",
          "aria-label": "Remove",
          onclick: () => { onChange(refs.filter((_, j) => j !== i)); renderMediaList(host, refs.filter((_, j) => j !== i), onChange); }
        }, "×")
      )
    )
  );
}

function mediaIcon(type) {
  const icons = {
    [MediaType.FACEBOOK_ALBUM]: "📘",
    [MediaType.GOOGLE_PHOTOS]: "📷",
    [MediaType.ICLOUD]: "☁",
    [MediaType.LOCAL_FOLDER]: "💾",
    [MediaType.EXTERNAL_DRIVE]: "🔌",
    [MediaType.URL]: "🔗",
    [MediaType.OTHER]: "📦",
  };
  return icons[type] ?? "📦";
}

/* ------------------------------ helpers ------------------------------ */

function field(tag, label, attrs = {}) {
  const id = "mc-" + label.replace(/\W+/g, "-").toLowerCase();
  const input = el(tag, { id, ...attrs });
  if (attrs.type === "textarea" || tag === "textarea") {
    Object.entries(attrs).forEach(([k, v]) => {
      if (k !== "type") input.setAttribute(k, v);
    });
    input.style.cssText = "width:100%;font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;resize:vertical;-webkit-text-fill-color:var(--ink);caret-color:var(--accent)";
  } else {
    input.style.cssText = "width:100%;font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;-webkit-text-fill-color:var(--ink);caret-color:var(--accent)";
  }
  return el("div.mc-field", {},
    el("label.mc-label", { for: id }, label),
    tag === "textarea" ? el("textarea", { id, ...attrs, style: input.style.cssText }) : input
  );
}

function fieldSelect(label, options, selected, isValueLabel = false) {
  const id = "mc-" + label.replace(/\W+/g, "-").toLowerCase();
  const select = el("select", { id });
  select.style.cssText = "width:100%;font:inherit;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px;-webkit-text-fill-color:var(--ink)";
  for (const opt of options) {
    const value = isValueLabel ? opt.value : opt;
    const label_ = isValueLabel ? opt.label : opt;
    const o = el("option", { value: String(value) }, label_);
    if (String(value) === String(selected)) o.selected = true;
    select.append(o);
  }
  return el("div.mc-field", {}, el("label.mc-label", { for: id }, label), select);
}

function todayValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
