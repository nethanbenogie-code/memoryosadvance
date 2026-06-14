/**
 * MemoryOS — ui/about-view.js
 *
 * About MemoryOS: what it's for, what changes in daily life, and the
 * promises the app makes. The copy aims for an honest positive outlook
 * — encouragement grounded in what the app really does, not hype.
 */

import { bus } from "../core/events.js";
import { el } from "./components.js";
import { shareApp } from "./share.js";

export class AboutView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
  }

  async mount() {
    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "About MemoryOS")),

      el(
        "p.about-thesis",
        {},
        "Your memory is for thinking. MemoryOS does the remembering."
      ),

      section("What this is", [
        "MemoryOS is a personal memory operating system — a second brain that lives entirely on your own device. Every note, idea, task, event, and journal entry becomes a memory you can find again in seconds, placed on the timeline of your life.",
        "It is free, open source, and private by design: no account, no ads, no server. Nothing you write ever leaves your device unless you back it up somewhere yourself.",
      ]),

      section("The goal", [
        "Most of what stresses us isn't the work itself — it's the carrying: the appointment you might forget, the idea you're afraid to lose, the promise you made last week. MemoryOS exists to take over the carrying.",
        "The loop is simple: capture anything in two seconds, trust that you'll find it when you need it, and act on it when its time comes. Over months, the app grows into something rare — an honest record of your days that belongs to no one but you.",
      ]),

      section("What changes in daily life", [
        "A quieter head. When every loose thought has a place to land, your mind stops rehearsing them in the background. People often notice this first: less mental juggling, easier focus, even easier sleep.",
        "Less worry about forgetting. Reminders ring when things are due, and the red badge catches anything that slipped. You stop relying on anxiety as your alarm clock.",
        "Visible progress. Every finished task earns points; streaks grow; the journal collects each day's wins under \"Completed this day.\" On hard days, that page is proof you are moving — evidence, not just a feeling.",
        "A practice of reflection. Three honest sentences in the journal each evening is a small act with a long reach: you notice what went well, what mattered, and what to let go of. Re-reading old pages later, you see how far you've come — and gratitude tends to follow naturally from that.",
        "A kinder system. MemoryOS celebrates and never scolds. No guilt notifications, no broken-streak shaming, no red numbers designed to make you anxious. A tool you'll still like in five years has to be gentle with you on your worst days.",
      ]),

      section("Our promises", [
        "Your memories stay on your device. Private by architecture, not by policy.",
        "Free and open source, forever. No ads, no tracking, no account.",
        "Deletion is reversible, encouragement is real, and nothing here is designed to manipulate you into using the app more than serves you.",
      ]),

      el(
        "div.about-actions",
        {},
        el(
          "button.btn.btn-primary",
          { type: "button", onclick: () => bus.emit("navigate", { view: "manual" }) },
          "Read the user manual"
        ),
        el("button.btn", { type: "button", onclick: shareApp }, "♡ Share MemoryOS")
      )
    );
  }

  unmount() {}
}

/** @param {string} heading @param {string[]} paragraphs */
function section(heading, paragraphs) {
  return el(
    "section.journal-section",
    {},
    el("h3.section-heading", {}, heading),
    ...paragraphs.map((text) => el("p.about-text", {}, text))
  );
}
