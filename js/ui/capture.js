/**
 * MemoryOS — ui/capture.js
 *
 * Quick Capture: the most important two seconds in the product. One
 * textarea, type chips, Enter to save. "#tags" typed inline become
 * tags automatically. Opened by the capture button, the FAB, or
 * Ctrl/Cmd+K from anywhere.
 */

import { MemoryType } from "../data/models.js";
import * as memoryService from "../services/memory-service.js";
import { el } from "./components.js";

const CAPTURE_TYPES = [
  MemoryType.NOTE,
  MemoryType.IDEA,
  MemoryType.TASK,
  MemoryType.EVENT,
  MemoryType.JOURNAL,
  MemoryType.LEARNING,
  MemoryType.ARTICLE,
];

/** @type {HTMLDialogElement|null} */
let dialog = null;
let selectedType = MemoryType.NOTE;

/** Build the dialog once and attach it to the document. */
export function initCapture() {
  dialog = el("dialog.capture", { "aria-label": "Quick capture" });

  const typeRow = el(
    "div.capture-types",
    { role: "radiogroup", "aria-label": "Memory type" },
    ...CAPTURE_TYPES.map((type) =>
      el(
        "button.chip.chip-select",
        {
          type: "button",
          dataset: { type },
          role: "radio",
          "aria-checked": String(type === selectedType),
          onclick: (event) => selectType(type, event.currentTarget),
        },
        type[0].toUpperCase() + type.slice(1)
      )
    )
  );

  const textarea = el("textarea.capture-text", {
    placeholder: "What do you want to remember?  First line is the title — #tags welcome.",
    "aria-multiline": "true",
    rows: "4",
    "aria-label": "Memory text",
  });

  const hint = el("p.capture-hint", {}, "Enter to save · Shift+Enter for a new line · Esc to close");

  const saveBtn = el(
    "button.btn.btn-primary",
    { type: "button", onclick: save },
    "Save memory"
  );

  dialog.append(
    el("div.capture-inner", {}, typeRow, textarea, el("div.capture-foot", {}, hint, saveBtn))
  );
  document.body.append(dialog);

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  });

  // Close when clicking the backdrop.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  async function save() {
    const raw = textarea.value.trim();
    if (!raw) return;
    saveBtn.disabled = true;
    try {
      await memoryService.capture(raw, { type: selectedType });
      textarea.value = "";
      dialog.close();
    } catch (err) {
      console.error("[capture] save failed:", err);
      hint.textContent = "Couldn't save — try again.";
    } finally {
      saveBtn.disabled = false;
    }
  }

  function selectType(type, button) {
    selectedType = type;
    for (const chip of typeRow.children) {
      chip.setAttribute("aria-checked", String(chip === button));
    }
    // Give context-aware placeholder hints
    if (type === "journal") {
      textarea.placeholder = "Write your journal entry. First line is the title, or leave blank for today's date.";
    } else if (type === "task") {
      textarea.placeholder = "What needs to be done? First line is the title — #tags welcome.";
    } else if (type === "learning") {
      textarea.placeholder = "What did you learn? Book title, course, skill — first line is the title.";
    } else if (type === "article") {
      textarea.placeholder = "Article title or paste the URL. First line is the title — #tags welcome.";
    } else {
      textarea.placeholder = "What do you want to remember?  First line is the title — #tags welcome.";
    }
    textarea.focus();
  }
}

/**
 * Open the capture dialog with the textarea focused.
 * @param {string} [preselect] Optional MemoryType to pre-select.
 */
export function openCapture(preselect) {
  if (!dialog) return;
  if (preselect) {
    const chip = dialog.querySelector(`[data-type="${preselect}"]`);
    if (chip) {
      // Manually replicate selectType without using .click() to avoid
      // any side-effects when the dialog isn't open yet.
      for (const c of dialog.querySelectorAll(".chip-select")) {
        c.setAttribute("aria-checked", "false");
      }
      chip.setAttribute("aria-checked", "true");
      // Update selectedType and placeholder directly
      selectedType = preselect;
      const textarea = dialog.querySelector("textarea");
      if (textarea) {
        if (preselect === "journal") {
          textarea.placeholder = "Write your journal entry. First line is the title, or leave blank for today's date.";
        } else if (preselect === "task") {
          textarea.placeholder = "What needs to be done? First line is the title — #tags welcome.";
        } else if (preselect === "learning") {
          textarea.placeholder = "What did you learn? Book title, course, skill — first line is the title.";
        } else if (preselect === "article") {
          textarea.placeholder = "Article title or paste the URL. First line is the title — #tags welcome.";
        } else {
          textarea.placeholder = "What do you want to remember?  First line is the title — #tags welcome.";
        }
      }
    }
  }
  // Guard: showModal() throws if the dialog is already open
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("textarea")?.focus();
}

/** Global shortcut: Ctrl/Cmd+K from anywhere in the app. */
export function bindCaptureShortcut() {
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCapture();
    }
  });
}
