/**
 * MemoryOS — ui/search-view.js
 *
 * Search: live-as-you-type lexical search over every memory, with tag
 * and type filters. Backed entirely by the in-memory SearchIndex; no
 * database round-trips while typing.
 */

import { MemoryType, typeLabel } from "../data/models.js";
import { searchIndex } from "../services/search-service.js";
import { el, emptyState, memoryCard } from "./components.js";

const FILTER_TYPES = [
  MemoryType.NOTE,
  MemoryType.IDEA,
  MemoryType.TASK,
  MemoryType.EVENT,
  MemoryType.JOURNAL,
];

export class SearchView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.query = "";
    this.typeFilter = null;
    this.tagFilter = null;
  }

  async mount() {
    this.input = el("input.search-input", {
      type: "search",
      placeholder: "Search every memory…",
      value: this.query,
      "aria-label": "Search memories",
      oninput: (event) => {
        this.query = event.target.value;
        this.renderResults();
      },
    });

    this.resultsHost = el("div.search-results", {});
    this.filtersHost = el("div.search-filters", {});

    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "Search"), this.input),
      this.filtersHost,
      this.resultsHost
    );

    this.renderFilters();
    this.renderResults();
    this.input.focus();
  }

  unmount() {}

  renderFilters() {
    const typeChips = FILTER_TYPES.map((type) =>
      el(
        "button.chip.chip-select",
        {
          type: "button",
          dataset: { type },
          "aria-pressed": String(this.typeFilter === type),
          onclick: () => {
            this.typeFilter = this.typeFilter === type ? null : type;
            this.renderFilters();
            this.renderResults();
          },
        },
        typeLabel(type)
      )
    );

    const topTags = searchIndex.tagCounts().slice(0, 12);
    const tagChips = topTags.map(([tag, count]) =>
      el(
        "button.chip.chip-tag",
        {
          type: "button",
          "aria-pressed": String(this.tagFilter === tag),
          onclick: () => {
            this.tagFilter = this.tagFilter === tag ? null : tag;
            this.renderFilters();
            this.renderResults();
          },
        },
        `#${tag} · ${count}`
      )
    );

    this.filtersHost.replaceChildren(
      el("div.filter-row", { role: "toolbar", "aria-label": "Filter by type" }, typeChips),
      tagChips.length
        ? el("div.filter-row", { role: "toolbar", "aria-label": "Filter by tag" }, tagChips)
        : ""
    );
  }

  renderResults() {
    const hasInput = this.query.trim() || this.typeFilter || this.tagFilter;
    if (!hasInput) {
      this.resultsHost.replaceChildren(
        emptyState(
          "Type to search across every memory you've saved.",
          "Try a word from a title, a note's body, or a #tag."
        )
      );
      return;
    }

    const results = searchIndex.search(this.query, {
      type: this.typeFilter ?? undefined,
      tag: this.tagFilter ?? undefined,
    });

    if (!results.length) {
      this.resultsHost.replaceChildren(
        emptyState("No memories match.", "Loosen the filters or try a shorter word.")
      );
      return;
    }

    const cards = results.map((memory) =>
      memoryCard(memory, {
        onTagClick: (tag) => {
          this.tagFilter = tag;
          this.renderFilters();
          this.renderResults();
        },
      })
    );
    this.resultsHost.replaceChildren(
      el("p.result-count", {}, `${results.length} ${results.length === 1 ? "memory" : "memories"}`),
      ...cards
    );
  }
}
