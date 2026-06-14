/**
 * MemoryOS — ui/lock-screen.js
 *
 * The full-screen lock shown at launch when the app lock is enabled.
 * Three states: unlock with password → (forgot?) enter recovery code →
 * set a new password and receive a NEW recovery code. The returned
 * promise resolves only when the user is in.
 */

import {
  unlockWithPassword,
  resetWithRecoveryCode,
  getHint,
} from "../services/lock-service.js";
import { el } from "./components.js";

/**
 * Show the lock screen. Resolves when unlocked.
 * @returns {Promise<void>}
 */
export function showLockScreen() {
  return new Promise((resolve) => {
    const overlay = el("div.lock-screen", { role: "dialog", "aria-label": "Unlock MemoryOS" });
    document.body.append(overlay);

    const done = () => {
      overlay.remove();
      resolve();
    };

    renderUnlock(overlay, done);
  });
}

/* ------------------------------ unlock ------------------------------ */

async function renderUnlock(overlay, done) {
  const hint = await getHint();

  const input = el("input.lock-input", {
    type: "password",
    placeholder: "Password",
    autocomplete: "current-password",
    "aria-label": "Password",
  });
  const error = el("p.lock-error", { "aria-live": "polite" }, "");
  const unlockBtn = el("button.btn.btn-primary.lock-btn", { type: "button" }, "Unlock");

  async function attempt() {
    if (!input.value) return;
    unlockBtn.disabled = true;
    const ok = await unlockWithPassword(input.value);
    unlockBtn.disabled = false;
    if (ok) return done();
    error.textContent = "That password doesn't match. Try again.";
    input.value = "";
    input.focus();
  }

  unlockBtn.addEventListener("click", attempt);
  input.addEventListener("keydown", (e) => e.key === "Enter" && attempt());

  overlay.replaceChildren(
    el(
      "div.lock-card",
      {},
      el("h1.wordmark", {}, "Memory", el("b", {}, "OS")),
      el("p.lock-line", {}, "Your memories are locked."),
      input,
      hint ? el("p.lock-hint", {}, `Hint: ${hint}`) : null,
      error,
      unlockBtn,
      el(
        "button.btn.btn-quiet",
        { type: "button", onclick: () => renderRecovery(overlay, done) },
        "Forgot password?"
      )
    )
  );
  input.focus();
}

/* ----------------------------- recovery ----------------------------- */

function renderRecovery(overlay, done) {
  const codeInput = el("input.lock-input", {
    type: "text",
    placeholder: "XXXX-XXXX-XXXX",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    "aria-label": "Recovery code",
  });
  const newPass = el("input.lock-input", {
    type: "password",
    placeholder: "New password",
    autocomplete: "new-password",
    "aria-label": "New password",
  });
  const confirm = el("input.lock-input", {
    type: "password",
    placeholder: "Repeat new password",
    autocomplete: "new-password",
    "aria-label": "Repeat new password",
  });
  const error = el("p.lock-error", { "aria-live": "polite" }, "");
  const resetBtn = el("button.btn.btn-primary.lock-btn", { type: "button" }, "Reset password");

  resetBtn.addEventListener("click", async () => {
    error.textContent = "";
    if (newPass.value.length < 4) {
      error.textContent = "The new password needs at least 4 characters.";
      return;
    }
    if (newPass.value !== confirm.value) {
      error.textContent = "The two passwords don't match.";
      return;
    }
    resetBtn.disabled = true;
    let newCode = null;
    try {
      newCode = await resetWithRecoveryCode(codeInput.value, newPass.value);
    } finally {
      resetBtn.disabled = false;
    }
    if (!newCode) {
      error.textContent = "That recovery code doesn't match. Check it character by character.";
      return;
    }
    renderNewCode(overlay, done, newCode);
  });

  overlay.replaceChildren(
    el(
      "div.lock-card",
      {},
      el("h2.lock-title", {}, "Reset with your recovery code"),
      el(
        "p.lock-line",
        {},
        "Enter the recovery code you wrote down when you set up the lock, then choose a new password."
      ),
      codeInput,
      newPass,
      confirm,
      error,
      resetBtn,
      el(
        "button.btn.btn-quiet",
        { type: "button", onclick: () => renderUnlock(overlay, done) },
        "Back"
      )
    )
  );
  codeInput.focus();
}

/* ----------------------- new recovery code handoff ----------------------- */

function renderNewCode(overlay, done, code) {
  const continueBtn = el(
    "button.btn.btn-primary.lock-btn",
    { type: "button", disabled: "disabled" },
    "I wrote it down — continue"
  );
  const ack = el("label.lock-ack", {});
  const check = el("input", { type: "checkbox" });
  check.addEventListener("change", () => {
    if (check.checked) continueBtn.removeAttribute("disabled");
    else continueBtn.setAttribute("disabled", "disabled");
  });
  ack.append(check, " I have written this code somewhere safe.");
  continueBtn.addEventListener("click", done);

  overlay.replaceChildren(
    el(
      "div.lock-card",
      {},
      el("h2.lock-title", {}, "Your new recovery code"),
      el(
        "p.lock-line",
        {},
        "Your old code no longer works. This new one is shown only once — write it on paper now."
      ),
      el("p.lock-code", {}, code),
      el(
        "button.btn",
        {
          type: "button",
          onclick: async (e) => {
            try {
              await navigator.clipboard.writeText(code);
              e.target.textContent = "Copied";
            } catch {
              /* clipboard unavailable — the code is on screen */
            }
          },
        },
        "Copy code"
      ),
      ack,
      continueBtn
    )
  );
}
