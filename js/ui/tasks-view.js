/**
 * MemoryOS — ui/tasks-view.js
 *
 * Tasks: every task grouped by status. Click a task's status button to
 * advance it (pending → in progress → completed → pending). Tasks are
 * just memories with a status — the board is one filtered read of the
 * same store the timeline uses.
 */

import { bus } from "../core/events.js";
import { MemoryType, TaskStatus, Priority } from "../data/models.js";
import * as repo from "../data/repository.js";
import { computeRewards } from "../services/rewards-service.js";
import { el, emptyState, memoryCard } from "./components.js";
import { openCapture } from "./capture.js";

const COLUMNS = [
  { status: TaskStatus.PENDING, label: "Pending" },
  { status: TaskStatus.IN_PROGRESS, label: "In progress" },
  { status: TaskStatus.COMPLETED, label: "Completed" },
];

const PRIORITY_ORDER = { [Priority.HIGH]: 0, [Priority.MEDIUM]: 1, [Priority.LOW]: 2 };

export class TasksView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
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
    const tasks = await repo.listMemoriesByType(MemoryType.TASK);
    tasks.sort(byPriorityThenDue);

    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "Tasks")),
      this._rewards(tasks),
      tasks.length ? this._board(tasks) : this._empty()
    );
  }

  /**
   * The rewards panel: level, points, streak, and progress toward the
   * next level. All derived live from the task list — nothing stored.
   */
  _rewards(tasks) {
    const r = computeRewards(tasks);
    if (r.completedCount === 0) return el("span");

    const bar = el(
      "div.level-bar",
      {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": String(r.levelStep),
        "aria-valuenow": String(r.intoLevel),
        "aria-label": "Progress to next level",
      },
      el("div.level-fill", { style: `width:${Math.round(r.progress * 100)}%` })
    );

    return el(
      "section.rewards",
      {},
      el(
        "div.rewards-row",
        {},
        el(
          "span.rewards-level",
          {},
          `Level ${r.level} · ${r.levelName}`
        ),
        r.streak >= 2
          ? el("span.rewards-streak", { title: "Days in a row with a completed task" }, `🔥 ${r.streak}-day streak`)
          : null
      ),
      el(
        "div.rewards-row.rewards-points",
        {},
        el("span", {}, `${r.totalPoints} points`),
        r.todayPoints > 0 ? el("span.rewards-today", {}, `+${r.todayPoints} today`) : null,
        el("span.rewards-next", {}, `${r.levelStep - r.intoLevel} to next level`)
      ),
      bar
    );
  }

  _board(tasks) {
    return el(
      "div.task-board",
      {},
      ...COLUMNS.map(({ status, label }) => {
        const column = tasks.filter((t) => t.status === status);
        return el(
          "section.task-column",
          { dataset: { status } },
          el("h3.column-heading", {}, label, el("span.column-count", {}, String(column.length))),
          ...(column.length
            ? column.map((task) => memoryCard(task, { showTime: false }))
            : [el("p.column-empty", {}, "Nothing here.")])
        );
      })
    );
  }

  _empty() {
    const e = emptyState(
      "No tasks yet.",
      "Capture one with the Task chip, or press \"Make a task\" on any memory."
    );
    e.append(el("button.btn.btn-primary", { type: "button", onclick: openCapture }, "Capture a task"));
    return e;
  }
}

function byPriorityThenDue(a, b) {
  const pa = PRIORITY_ORDER[a.priority] ?? 3;
  const pb = PRIORITY_ORDER[b.priority] ?? 3;
  if (pa !== pb) return pa - pb;
  const da = a.dueAt ?? "9999";
  const db = b.dueAt ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  return a.occurredAt < b.occurredAt ? 1 : -1;
}
