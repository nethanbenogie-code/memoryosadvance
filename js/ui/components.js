/**
 * MemoryOS — ui/components.js
 *
 * Small shared rendering vocabulary: a DOM helper, date formatting, and
 * the memory card every view composes. No framework — plain DOM keeps
 * the PWA tiny, fast, and dependency-free for the next decade.
 */

import { MemoryType, TaskStatus, typeLabel } from "../data/models.js";
import * as memoryService from "../services/memory-service.js";

/**
 * Create an element. `el("div.card", {onclick}, child1, child2)`
 * @param {string} spec "tag.class1.class2"
 * @param {Object} [attrs]
 * @param {...(Node|string|null)} children
 */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue;
    if (child instanceof Node) {
      node.append(child);
    } else if (Array.isArray(child)) {
      node.append(...child);
    } else {
      node.append(document.createTextNode(String(child)));
    }
  }
  return node;
}

/** "Thursday, June 12" — the serif day header on the timeline spine. */
export function formatDayHeading(isoOrKey) {
  const date = toLocalDate(isoOrKey);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "2:41 PM" in local time. */
export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local "YYYY-MM-DD" grouping key for an ISO timestamp. */
export function localDayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

/** A colored type chip. @param {string} type */
export function typeChip(type) {
  return el("span.chip", { dataset: { type } }, typeLabel(type));
}

/** A "#tag" chip. @param {string} tag @param {Function} [onClick] */
export function tagChip(tag, onClick) {
  return el(
    onClick ? "button.chip.chip-tag" : "span.chip.chip-tag",
    onClick ? { type: "button", onclick: () => onClick(tag) } : {},
    `#${tag}`
  );
}

const STATUS_LABELS = {
  [TaskStatus.PENDING]: "Pending",
  [TaskStatus.IN_PROGRESS]: "In progress",
  [TaskStatus.COMPLETED]: "Completed",
};

const NEXT_STATUS = {
  [TaskStatus.PENDING]: TaskStatus.IN_PROGRESS,
  [TaskStatus.IN_PROGRESS]: TaskStatus.COMPLETED,
  [TaskStatus.COMPLETED]: TaskStatus.PENDING,
};

/**
 * The memory card used across every view.
 * @param {Object} memory
 * @param {{onTagClick?: Function, showTime?: boolean}} [opts]
 */
export function memoryCard(memory, opts = {}) {
  const isTask = memory.type === MemoryType.TASK;

  const header = el(
    "div.card-head",
    {},
    typeChip(memory.type),
    opts.showTime === false ? null : el("span.card-time", {}, formatTime(memory.occurredAt))
  );

  const title = el("h3.card-title", {}, memory.title);
  if (isTask && memory.status === TaskStatus.COMPLETED) {
    title.classList.add("is-done");
  }

  const body = memory.content
    ? el("p.card-body", {}, truncate(memory.content, 280))
    : null;

  const tags = memory.tags.length
    ? el("div.card-tags", {}, ...memory.tags.map((t) => tagChip(t, opts.onTagClick)))
    : null;

  const actions = el("div.card-actions", {});
  if (isTask) {
    actions.append(
      el(
        "button.btn.btn-status",
        {
          type: "button",
          dataset: { status: memory.status },
          onclick: () => memoryService.setTaskStatus(memory.id, NEXT_STATUS[memory.status]),
          title: "Click to advance status",
        },
        STATUS_LABELS[memory.status] ?? memory.status
      ),
      dueControl(memory)
    );
  } else if (memory.type !== MemoryType.JOURNAL) {
    actions.append(
      el(
        "button.btn.btn-quiet",
        { type: "button", onclick: () => memoryService.convertToTask(memory.id) },
        "Make a task"
      )
    );
  }
  actions.append(
    el(
      "button.btn.btn-quiet.btn-danger",
      {
        type: "button",
        onclick: () => {
          if (confirm(`Delete "${memory.title}"? It moves to the archive, not oblivion.`)) {
            memoryService.deleteMemory(memory.id);
          }
        },
      },
      "Delete"
    )
  );

  return el(
    "article.card",
    { dataset: { id: memory.id, type: memory.type } },
    header,
    title,
    body,
    tags,
    actions
  );
}

/**
 * The due/reminder control on a task card.
 * No due time → an "⏰ Remind me" button that opens an inline editor.
 * Due time set → a badge ("Due Jun 14, 3:00 PM", red when overdue)
 * with an × to clear. Setting a time also asks for notification
 * permission — contextually, at the moment it makes sense.
 * @param {Object} memory
 */
function dueControl(memory) {
  const host = el("span.due-control");

  if (memory.dueAt) {
    const overdue =
      memory.status !== TaskStatus.COMPLETED &&
      memory.dueAt <= new Date().toISOString();
    host.append(
      el(
        `span.due-badge${overdue ? ".overdue" : ""}`,
        { title: overdue ? "This task is overdue" : "Reminder set" },
        `⏰ ${formatDue(memory.dueAt)}`
      ),
      el(
        "button.btn.btn-quiet.due-clear",
        {
          type: "button",
          "aria-label": "Remove reminder",
          onclick: () => memoryService.setDueDate(memory.id, null),
        },
        "×"
      )
    );
    return host;
  }

  const openEditor = () => {
    const input = el("input.due-input", {
      type: "datetime-local",
      value: defaultDueValue(),
      "aria-label": "Due date and time",
    });
    const setBtn = el(
      "button.btn.due-set",
      {
        type: "button",
        onclick: async () => {
          if (!input.value) return;
          const { requestNotificationPermission } = await import(
            "../services/reminder-service.js"
          );
          requestNotificationPermission();
          await memoryService.setDueDate(
            memory.id,
            new Date(input.value).toISOString()
          );
        },
      },
      "Set"
    );
    host.replaceChildren(input, setBtn);
    input.focus();
  };

  host.append(
    el("button.btn.btn-quiet", { type: "button", onclick: openEditor }, "⏰ Remind me")
  );
  return host;
}

/** "Jun 14, 3:00 PM" in local time. @param {string} iso */
function formatDue(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Default editor value: one hour from now, as a datetime-local string. */
function defaultDueValue() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** An empty-state block that invites action instead of apologizing. */
export function emptyState(message, hint) {
  return el(
    "div.empty",
    {},
    el("p.empty-message", {}, message),
    hint ? el("p.empty-hint", {}, hint) : null
  );
}

function truncate(text, max) {
  const clean = text.trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
