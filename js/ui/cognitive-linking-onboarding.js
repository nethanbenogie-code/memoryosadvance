/**
 * MemoryOS — ui/cognitive-linking-onboarding.js
 *
 * Cognitive Linking is the idea at the centre of MemoryOS. A Memory Card
 * stores the *meaning* of a moment and a *pointer* to where its media
 * actually lives — never the media itself. The link is invisible: it
 * lives in your mind, and the app only keeps the thread so you never lose
 * your way back.
 *
 * The Family Archive is the most relatable example of this, not the whole
 * of it. The same pattern fits travel, learning, work, friendships — any
 * theme you want to be able to return to. This explainer teaches the
 * universal idea, with Family as the easiest place to begin.
 *
 * It writes nothing to the memory store. Its only state is a single
 * "seen" flag, read and written through the Mnemosyne service — never the
 * database directly, keeping the UI → service → repository layering intact.
 */

import { el } from "./components.js";
import { showToast } from "./celebration.js";
import {
  SUGGESTED_ARCHIVES,
  markCognitiveLinkingIntroSeen,
  shouldAutoShowCognitiveLinkingIntro,
} from "../services/mnemosyne-service.js";
import { openMemoryCardCapture } from "./memory-card-capture.js";

/**
 * Show the intro automatically on first launch — see
 * `shouldAutoShowCognitiveLinkingIntro` for the exact gating. Shows
 * exactly once: it is marked seen the moment it appears, so it never
 * returns on its own. Non-blocking and self-contained — any failure is
 * swallowed so it can never interfere with app startup.
 */
export async function maybeShowCognitiveLinkingOnboarding() {
  try {
    if (await shouldAutoShowCognitiveLinkingIntro()) {
      // Strict show-once: record it as seen at the moment of display.
      await markCognitiveLinkingIntroSeen();
      openCognitiveLinkingExplainer({ firstRun: true });
    }
  } catch (err) {
    console.warn("[cognitive-linking] onboarding skipped:", err);
  }
}

let overlay = null;

/**
 * Open the Cognitive Linking explainer. Safe to call any number of times;
 * opening it always marks the intro as seen so it won't auto-open later.
 * @param {{firstRun?: boolean}} [opts]
 */
export function openCognitiveLinkingExplainer({ firstRun = false } = {}) {
  close();
  markCognitiveLinkingIntroSeen().catch(() => {});

  const startBtn = el(
    "button.btn.btn-primary",
    {
      type: "button",
      onclick: () => { close(); openMemoryCardCapture(); },
    },
    firstRun ? "Create my first Memory Card" : "Create a Memory Card"
  );

  const dismissBtn = el(
    "button.btn.btn-quiet",
    { type: "button", onclick: close },
    firstRun ? "I'll start later" : "Close"
  );

  overlay = el(
    "div.mc-overlay.fa-overlay",
    {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "How Cognitive Linking works",
    },
    el(
      "div.mc-mini-card.fa-card",
      {},
      el("div.fa-head", {},
        el("p.fa-eyebrow", {}, "The quiet idea behind MemoryOS"),
        el("h2.mc-title", {}, "Cognitive Linking"),
        el("p.mc-subtitle", {},
          "Your photos, files, and notes can stay wherever they already live. MemoryOS keeps only the thread back to them — the meaning, and a pointer. That thread is invisible: it lives in your mind. The app just makes sure you never lose it."
        )
      ),

      el("ol.fa-steps", {},
        faStep("1", "Name a place for what matters",
          el("span", {},
            "In whatever you already use — a Facebook album, a Google Photos album, a folder, a drive — keep a clearly-named archive per theme. The pattern is ",
            el("code.fa-album-name", {}, "MemoryOS - <Topic> Archive"),
            ". A few to start with:"
          )
        ),
        archiveChips(),
        faStep("2", "Put your best there",
          "When something matters, add a few items to the right archive. Nothing is uploaded to or copied into MemoryOS."
        ),
        faStep("3", "Link it with a Memory Card",
          "Back here, capture the meaning — who, where, a short reflection — and point to the archive. That pointer is the cognitive link: a thread from your mind back to the moment."
        )
      ),

      el("blockquote.fa-mantra", {},
        "Open MemoryOS first. Use social platforms as a personal archive, not an endless feed."
      ),

      el("p.fa-why", {},
        "The aim isn't to store more. It's to keep your own life easier to reach than the feed — so you return to what mattered to you before you're pulled into what everyone else is reacting to."
      ),

      el("p.mc-hint.mc-privacy", {},
        "MemoryOS never uploads, copies, or accesses your media. It stores only the meaning and a text pointer to where it lives — entirely on this device."
      ),

      el("div.mc-foot", {}, dismissBtn, startBtn)
    )
  );

  document.body.append(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKeydown);
  startBtn.focus();
}

/** Copyable example-archive chips — tap to copy the full archive name. */
function archiveChips() {
  return el(
    "div.fa-archives",
    { role: "list", "aria-label": "Example archives — tap to copy a name" },
    ...SUGGESTED_ARCHIVES.map(({ topic, name }) =>
      el("button.fa-archive-chip", {
        type: "button",
        role: "listitem",
        title: `Copy "${name}"`,
        onclick: () => copyName(name),
      },
        el("span.fa-archive-topic", {}, topic),
        el("span.fa-archive-copy", { "aria-hidden": "true" }, "⧉")
      )
    )
  );
}

async function copyName(name) {
  try {
    await navigator.clipboard.writeText(name);
    showToast(`Copied "${name}"`, { accent: true });
  } catch {
    showToast(`Use this name: ${name}`);
  }
}

function faStep(num, title, body) {
  return el("li.fa-step", {},
    el("span.fa-step-num", { "aria-hidden": "true" }, num),
    el("div.fa-step-body", {},
      el("strong.fa-step-title", {}, title),
      el("span.fa-step-text", {}, body)
    )
  );
}

function onKeydown(e) {
  if (e.key === "Escape") close();
}

function close() {
  document.removeEventListener("keydown", onKeydown);
  overlay?.remove();
  overlay = null;
}
