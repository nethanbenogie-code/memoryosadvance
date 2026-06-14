/**
 * MemoryOS — ui/backup-view.js
 *
 * The Backup view, written for people who don't read: one big button
 * that does the right thing, status in color (green fresh, amber stale),
 * and restore that's merge-safe so clicking it can never destroy data.
 */

import { bus } from "../core/events.js";
import * as backup from "../services/backup-service.js";
import { el, emptyState } from "./components.js";
import { showToast } from "./celebration.js";
import { shareApp } from "./share.js";
import * as lock from "../services/lock-service.js";

export class BackupView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.unsubscribes = [];
  }

  async mount() {
    const refresh = () => this.render();
    this.unsubscribes = [
      bus.on("backup:done", refresh),
      bus.on("backup:restored", refresh),
    ];
    await this.render();
  }

  unmount() {
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
  }

  async render() {
    const status = await backup.getBackupStatus();
    // Attach storage estimate to the status object for the card
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        status.storageUsed = est.usage ?? 0;
        status.storageQuota = est.quota ?? 0;
        status.persistent = await navigator.storage.persisted?.() ?? false;
      }
    } catch {}

    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "Backup")),
      this._statusCard(status),
      this._actions(status),
      backup.autoBackupSupported() ? await this._autoSection(status) : null,
      this._restoreSection(),
      await this._lockSection(),
      this._explainer(),
      this._tellAFriend(),
      this._learnMore()
    );
  }

  _statusCard(status) {
    let line;
    let tone = "fresh";
    if (status.memoryCount === 0) {
      line = "Nothing to back up yet — capture your first memory.";
      tone = "neutral";
    } else if (!status.lastBackupAt) {
      line = "Your memories have never been backed up.";
      tone = "stale";
    } else if (status.daysSince === 0) {
      line = "Backed up today. All good.";
    } else if (status.daysSince === 1) {
      line = "Last backup: yesterday.";
    } else {
      line = `Last backup: ${status.daysSince} days ago.`;
      if (status.stale) tone = "stale";
    }
    return el(
      "section.backup-status",
      { dataset: { tone } },
      el("p.backup-line", {}, line),
      el(
        "p.backup-sub",
        {},
        `${status.memoryCount} ${status.memoryCount === 1 ? "memory" : "memories"} on this device.`
      )
    );
  }

  _actions(status) {
    const download = el(
      "button.btn.btn-primary.backup-big",
      {
        type: "button",
        onclick: async () => {
          try {
            const name = await backup.downloadBackup();
            showToast(`Backup saved: ${name}`, { accent: true });
          } catch (err) {
            console.error(err);
            showToast("Backup failed — try again.");
          }
        },
        disabled: status.memoryCount === 0 ? "disabled" : null,
      },
      "⬇ Back up now"
    );

    const share = backup.canShareBackup()
      ? el(
          "button.btn.backup-big",
          {
            type: "button",
            onclick: async () => {
              try {
                await backup.shareBackup();
                showToast("Backup shared.", { accent: true });
              } catch (err) {
                if (err?.name !== "AbortError") {
                  console.error(err);
                  showToast("Sharing didn't finish — try Back up now instead.");
                }
              }
            },
            disabled: status.memoryCount === 0 ? "disabled" : null,
          },
          "📤 Share backup"
        )
      : null;

    return el(
      "section.backup-actions",
      {},
      download,
      share,
      el(
        "p.backup-hint",
        {},
        share
          ? "Back up now saves a file to this device. Share backup sends it to Google Drive, email, or any app — the safest place for a backup is a second place."
          : "Back up now saves a file to this device. Keep a copy somewhere else too — a USB drive, Google Drive, or email it to yourself."
      )
    );
  }

  async _autoSection(status) {
    const host = el("section.journal-section");
    host.append(el("h3.section-heading", {}, "Automatic backup"));

    if (!status.autoConfigured) {
      host.append(
        el(
          "p.backup-hint",
          {},
          "Set it once and forget it: choose a folder, and MemoryOS quietly saves a backup file there every day you use it."
        ),
        el(
          "button.btn",
          {
            type: "button",
            onclick: async () => {
              try {
                const folder = await backup.setupAutoBackupFolder();
                showToast(`Automatic backup on — saving to "${folder}".`, { accent: true });
              } catch (err) {
                if (err?.name !== "AbortError") {
                  console.error(err);
                  showToast("Couldn't set up that folder — try another one.");
                }
              }
            },
          },
          "Choose a backup folder"
        )
      );
      return host;
    }

    const state = await backup.runAutoBackupIfDue();
    if (state === "needs-permission") {
      host.append(
        el("p.backup-hint", {}, "Your browser paused automatic backups. One click turns them back on."),
        el(
          "button.btn.btn-primary",
          {
            type: "button",
            onclick: async () => {
              const result = await backup.reauthorizeAutoBackup();
              showToast(
                result === "ok" ? "Automatic backups are back on." : "Permission wasn't granted."
              );
              this.render();
            },
          },
          "Turn automatic backup back on"
        )
      );
    } else {
      host.append(
        el(
          "p.backup-hint",
          {},
          state === "failed"
            ? "Today's automatic backup couldn't be written — is the folder still there?"
            : "Automatic backup is on. A dated backup file is saved to your chosen folder once a day."
        )
      );
    }
    host.append(
      el(
        "button.btn.btn-quiet",
        {
          type: "button",
          onclick: async () => {
            await backup.disableAutoBackup();
            showToast("Automatic backup turned off.");
            this.render();
          },
        },
        "Turn off automatic backup"
      )
    );
    return host;
  }

  _restoreSection() {
    const input = el("input", {
      type: "file",
      accept: ".json,application/json",
      style: "display:none",
      "aria-hidden": "true",
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const report = await backup.restoreFromFile(file);
        const total = report.inserted + report.updated;
        showToast(
          total === 0
            ? "Already up to date — nothing in that backup was newer."
            : `Restored: ${report.inserted} added, ${report.updated} updated.`,
          { accent: true }
        );
      } catch (err) {
        showToast(err.message || "That file couldn't be restored.");
      } finally {
        input.value = "";
      }
    });

    return el(
      "section.journal-section",
      {},
      el("h3.section-heading", {}, "Restore"),
      el(
        "p.backup-hint",
        {},
        "Restoring adds what's missing and keeps whichever copy is newer. It never wipes anything — restoring the same file twice changes nothing."
      ),
      el("button.btn", { type: "button", onclick: () => input.click() }, "Restore from a backup file"),
      input
    );
  }

  _tellAFriend() {
    return el(
      "section.journal-section",
      {},
      el("h3.section-heading", {}, "Tell a friend"),
      el(
        "p.backup-hint",
        {},
        "If MemoryOS helps you, pass it on. Everyone gets their own private copy — free, no account, no ads."
      ),
      el("button.btn", { type: "button", onclick: shareApp }, "♡ Share MemoryOS")
    );
  }

  _learnMore() {
    return el(
      "section.journal-section",
      {},
      el("h3.section-heading", {}, "Learn more"),
      el(
        "div.about-actions",
        {},
        el(
          "button.btn",
          { type: "button", onclick: () => bus.emit("navigate", { view: "about" }) },
          "About MemoryOS"
        ),
        el(
          "button.btn",
          { type: "button", onclick: () => bus.emit("navigate", { view: "manual" }) },
          "User manual"
        )
      )
    );
  }

  async _lockSection() {
    const host = el("section.journal-section");
    host.append(el("h3.section-heading", {}, "App lock"));
    const enabled = await lock.isLockEnabled();

    if (!enabled) {
      const pass = el("input.due-input.lock-form-input", { type: "password", placeholder: "Password (4+ characters)", autocomplete: "new-password" });
      const confirm = el("input.due-input.lock-form-input", { type: "password", placeholder: "Repeat password", autocomplete: "new-password" });
      const hint = el("input.due-input.lock-form-input", { type: "text", placeholder: "Optional hint (don't write the password itself)" });
      const form = el("div.lock-form", {}, pass, confirm, hint,
        el("button.btn.btn-primary", { type: "button", onclick: async () => {
          if (pass.value.length < 4) return showToast("The password needs at least 4 characters.");
          if (pass.value !== confirm.value) return showToast("The two passwords don't match.");
          const code = await lock.setupLock(pass.value, hint.value);
          this._showRecoveryCode(host, code, "App lock is on. This recovery code is shown only once — write it on paper now. It's the ONLY way back in if you forget your password.");
        } }, "Turn on app lock")
      );
      host.append(
        el("p.backup-hint", {}, "Recommended if other people use this device. The lock asks for a password whenever MemoryOS opens. You'll get a recovery code in case you forget it — the lock keeps casual snoops out, like a PIN on your phone."),
        el("button.btn", { type: "button", onclick: (e) => { e.target.replaceWith(form); pass.focus(); } }, "Set up app lock")
      );
      return host;
    }

    const current = el("input.due-input.lock-form-input", { type: "password", placeholder: "Current password", autocomplete: "current-password" });
    const next = el("input.due-input.lock-form-input", { type: "password", placeholder: "New password (4+ characters)", autocomplete: "new-password" });
    const changeForm = el("div.lock-form", {}, current, next,
      el("button.btn", { type: "button", onclick: async () => {
        try {
          const code = await lock.changePassword(current.value, next.value);
          if (!code) return showToast("Current password doesn't match.");
          this._showRecoveryCode(host, code, "Password changed. Your OLD recovery code no longer works — write this new one on paper now.");
        } catch (err) { showToast(err.message); }
      } }, "Change password")
    );
    const offPass = el("input.due-input.lock-form-input", { type: "password", placeholder: "Current password", autocomplete: "current-password" });
    const offForm = el("div.lock-form", {}, offPass,
      el("button.btn.btn-quiet.btn-danger", { type: "button", onclick: async () => {
        if (await lock.disableLock(offPass.value)) { showToast("App lock turned off."); this.render(); }
        else showToast("Current password doesn't match.");
      } }, "Confirm: turn off lock")
    );

    host.append(
      el("p.backup-hint", {}, "App lock is on. MemoryOS asks for your password every time it opens."),
      el("div.about-actions", {},
        el("button.btn", { type: "button", onclick: () => lock.lockNow() }, "Lock now"),
        el("button.btn.btn-quiet", { type: "button", onclick: (e) => e.target.replaceWith(changeForm) }, "Change password"),
        el("button.btn.btn-quiet", { type: "button", onclick: (e) => e.target.replaceWith(offForm) }, "Turn off lock")
      )
    );
    return host;
  }

  _showRecoveryCode(host, code, message) {
    const block = el("div.lock-form", {},
      el("p.backup-hint", {}, message),
      el("p.lock-code", {}, code),
      el("button.btn", { type: "button", onclick: async (e) => {
        try { await navigator.clipboard.writeText(code); e.target.textContent = "Copied"; } catch {}
      } }, "Copy code"),
      el("button.btn.btn-primary", { type: "button", onclick: () => this.render() }, "I wrote it down — done")
    );
    host.replaceChildren(el("h3.section-heading", {}, "App lock"), block);
  }

  _explainer() {
    return el(
      "section.journal-section",
      {},
      el("h3.section-heading", {}, "Why this matters"),
      el(
        "p.backup-hint",
        {},
        "Your memories live only on this device — that's what keeps them private. A backup file is your safety net if this device is lost, broken, or its browser data gets cleared. One tap a week is enough."
      )
    );
  }
}

/** @param {number} bytes */
function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
