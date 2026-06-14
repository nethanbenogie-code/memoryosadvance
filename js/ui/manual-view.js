/**
 * MemoryOS — ui/manual-view.js
 *
 * The User Manual, readable inside the app — offline, on any device.
 *
 * Single source of truth: this view fetches docs/USER-MANUAL.md (which
 * is precached by the service worker) and renders it with a tiny
 * markdown renderer covering exactly the subset the manual uses:
 * headings, paragraphs, lists, bold/italic, inline code, and rules.
 * No markdown library — 60 lines we own beat a dependency we don't.
 */

import { el } from "./components.js";

const MANUAL_URL = "./docs/USER-MANUAL.md";

export class ManualView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
  }

  async mount() {
    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "User Manual")),
      el("p.backup-hint", {}, "Loading the manual…")
    );

    let markdown;
    try {
      const response = await fetch(MANUAL_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      markdown = await response.text();
    } catch (err) {
      console.warn("[manual] load failed:", err);
      this.container.replaceChildren(
        el("header.view-head", {}, el("h2.view-title", {}, "User Manual")),
        el(
          "div.empty",
          {},
          el("p.empty-message", {}, "The manual couldn't be loaded."),
          el("p.empty-hint", {}, "Check your connection once and reload — after that it works offline.")
        )
      );
      return;
    }

    const article = el("article.manual-content");
    article.innerHTML = renderMarkdown(markdown); // input is escaped inside
    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "User Manual")),
      article
    );
  }

  unmount() {}
}

/* --------------------------- mini markdown --------------------------- */

/**
 * Render the manual's markdown subset to HTML. All source text is
 * HTML-escaped before inline formatting, so the output is safe to
 * assign to innerHTML.
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdown(markdown) {
  const out = [];
  let paragraph = [];
  let inList = false;

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of String(markdown).split("\n")) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      flushParagraph();
      flushList();
      out.push("<hr/>");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = line.match(/^[-*]\s+(.*)$/);
    if (item) {
      flushParagraph();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

/** Escape, then apply inline formatting: **bold**, *italic*, `code`. */
function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** @param {string} text */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
