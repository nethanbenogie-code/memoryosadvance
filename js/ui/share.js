/**
 * MemoryOS — ui/share.js
 *
 * "Tell a friend": share the app itself. On phones, one tap opens the
 * native share sheet (Facebook, Messenger, WhatsApp, X, Telegram —
 * whatever the user has). On desktops without the Web Share API, a
 * fallback dialog offers direct social links and Copy link.
 *
 * Privacy note: these are plain share links — no SDKs, no tracking
 * pixels, no social scripts loaded into the app. The buttons simply
 * open each network's own share page in a new tab.
 */

import { el } from "./components.js";
import { showToast } from "./celebration.js";

const SHARE_TEXT =
  "MemoryOS — a free second brain that keeps your memories private, on your own device. Works on phone and desktop, even offline.";

/** The canonical app URL (resolved lazily — and correct wherever hosted). */
function appUrl() {
  return new URL("./", location.href).href;
}

/** Entry point: native share first, dialog fallback. */
export async function shareApp() {
  if (navigator.share) {
    try {
      await navigator.share({ title: "MemoryOS", text: SHARE_TEXT, url: appUrl() });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // user closed the sheet
      // fall through to the dialog on any real failure
    }
  }
  openShareDialog();
}

/* --------------------------- fallback dialog --------------------------- */

let dialog = null;

function socialTargets() {
  const url = encodeURIComponent(appUrl());
  const text = encodeURIComponent(SHARE_TEXT);
  return [
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${url}`],
    ["X / Twitter", `https://twitter.com/intent/tweet?text=${text}&url=${url}`],
    ["WhatsApp", `https://wa.me/?text=${text}%20${url}`],
    ["Telegram", `https://t.me/share/url?url=${url}&text=${text}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${url}`],
    ["Email", `mailto:?subject=${encodeURIComponent("Try MemoryOS")}&body=${text}%0A%0A${url}`],
  ];
}

function openShareDialog() {
  if (!dialog) {
    dialog = el("dialog.capture.share-dialog", { "aria-label": "Share MemoryOS" });
    document.body.append(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  const grid = el(
    "div.share-grid",
    {},
    socialTargets().map(([name, href]) =>
      el(
        "a.btn.share-link",
        { href, target: "_blank", rel: "noopener noreferrer" },
        name
      )
    ),
    el(
      "button.btn.share-link",
      {
        type: "button",
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(appUrl());
            showToast("Link copied — paste it anywhere.", { accent: true });
            dialog.close();
          } catch {
            showToast("Couldn't copy — long-press the address bar instead.");
          }
        },
      },
      "Copy link"
    )
  );

  dialog.replaceChildren(
    el(
      "div.capture-inner",
      {},
      el("h3.share-title", {}, "Share MemoryOS"),
      el(
        "p.backup-hint",
        {},
        "Know someone who forgets things? Everyone gets their own private copy — nobody can see anyone else's memories."
      ),
      grid
    )
  );
  dialog.showModal();
}
