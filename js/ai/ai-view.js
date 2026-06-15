/**
 * MemoryOS — ai/ai-view.js
 *
 * The AI Assistant panel — your personal reasoning engine.
 * Knows your memories, journal, tasks, and Memory Cards.
 * Ask it anything about your own life.
 */

import { bus } from "../core/events.js";
import * as ai from "./ai-service.js";
import { el } from "../ui/components.js";
import { showToast } from "../ui/celebration.js";

export class AIView {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    this.thinking = false;
  }

  async mount() {
    if (await ai.isReady()) {
      await this.renderChat();
    } else {
      this.renderSetup();
    }
  }

  unmount() {}

  /* ─────────────────── API key setup screen ──────────────────── */

  async renderSetup() {
    const ollamaCfg = await ai.getOllamaConfig();
    const keyInput = el("input.lock-input.ai-key-input", {
      type: "password",
      placeholder: "sk-ant-api...",
      autocomplete: "off",
      spellcheck: "false",
      "aria-label": "Anthropic API key",
      style: "text-align:left; font-family: monospace; font-size:13px;",
    });
    keyInput.style.cssText += ";-webkit-text-fill-color:var(--ink);caret-color:var(--accent);";

    const saveBtn = el("button.btn.btn-primary", { type: "button" }, "Connect AI");
    const error = el("p.lock-error", { "aria-live": "polite" }, "");

    saveBtn.addEventListener("click", async () => {
      const key = keyInput.value.trim();
      if (!key.startsWith("sk-ant-")) {
        error.textContent = "That doesn't look like an Anthropic API key. It should start with sk-ant-";
        return;
      }
      saveBtn.disabled = true;
      await ai.setApiKey(key);
      await ai.setProvider("anthropic");
      await this.renderChat();
    });

    const offlineBtn = el("button.btn.btn-quiet", {
      type: "button",
      style: "margin-top:16px;",
    }, "Run fully offline instead — no key");
    offlineBtn.addEventListener("click", async () => {
      await ai.setProvider("webllm");
      await this.renderChat();
    });

    // ── Local Ollama option ──────────────────────────────────────────
    const ollamaUrl = el("input.lock-input", {
      type: "text", value: ollamaCfg.baseUrl, spellcheck: "false",
      "aria-label": "Ollama server address",
      style: "text-align:left;font-family:monospace;font-size:13px;-webkit-text-fill-color:var(--ink);caret-color:var(--accent);",
    });
    const ollamaModel = el("input.lock-input", {
      type: "text", value: ollamaCfg.model, spellcheck: "false",
      "aria-label": "Ollama model name",
      style: "text-align:left;font-family:monospace;font-size:13px;-webkit-text-fill-color:var(--ink);caret-color:var(--accent);",
    });
    const ollamaStatus = el("p.lock-error", { "aria-live": "polite" }, "");
    const ollamaConnect = el("button.btn.btn-primary", { type: "button" }, "Test & connect");

    ollamaConnect.addEventListener("click", async () => {
      const base = ollamaUrl.value.trim() || "http://localhost:11434";
      const model = ollamaModel.value.trim() || "llama3.2";
      ollamaConnect.disabled = true;
      ollamaStatus.style.color = "var(--ink-soft)";
      ollamaStatus.textContent = "Checking your Ollama server…";
      try {
        const { models } = await ai.checkOllama(base);
        await ai.setOllamaConfig({ baseUrl: base, model });
        await ai.setProvider("ollama");
        if (models.length && !models.some((m) => m === model || m.startsWith(model + ":"))) {
          ollamaStatus.style.color = "var(--ink-soft)";
          ollamaStatus.textContent = `Connected, but "${model}" isn't pulled yet. Run: ollama pull ${model}`;
        }
        await this.renderChat();
      } catch (err) {
        ollamaStatus.style.color = "";
        ollamaStatus.textContent = err.message === "OLLAMA_UNREACHABLE"
          ? "Couldn't reach Ollama there. Is it running? If MemoryOS is installed as an app, you may need to allow this origin (see note)."
          : `Couldn't connect: ${err.message}`;
        ollamaConnect.disabled = false;
      }
    });

    const ollamaPanel = el("div.ai-ollama-panel", { hidden: true },
      el("label.mc-label", {}, "Ollama server address"),
      ollamaUrl,
      el("label.mc-label", { style: "margin-top:8px;" }, "Model"),
      ollamaModel,
      ollamaStatus,
      ollamaConnect,
      el("p.ai-privacy", {},
        "Runs entirely on your machine — nothing leaves your network, no key needed. Start it with ",
        el("code", {}, "ollama serve"),
        " and pull a model with ",
        el("code", {}, "ollama pull llama3.2"),
        ". If MemoryOS is installed as an app and the connection is blocked, start Ollama with ",
        el("code", {}, "OLLAMA_ORIGINS=* "),
        "so the browser is allowed to reach it."
      )
    );

    const ollamaToggle = el("button.btn.btn-quiet", { type: "button" },
      "Use my local Ollama server (e.g. llama3.2)");
    ollamaToggle.addEventListener("click", () => {
      ollamaPanel.hidden = !ollamaPanel.hidden;
      if (!ollamaPanel.hidden) ollamaUrl.focus();
    });

    keyInput.addEventListener("keydown", e => {
      if (e.key === "Enter") saveBtn.click();
    });

    this.container.replaceChildren(
      el("header.view-head", {}, el("h2.view-title", {}, "AI Assistant")),
      el("div.ai-setup", {},
        el("div.ai-setup-icon", {}, "◈"),
        el("h3.ai-setup-title", {}, "Connect your AI brain"),
        el("p.ai-setup-desc", {},
          "The AI assistant reads your memories, journal, tasks, and Memory Cards to give you personal insights — not generic answers."
        ),
        el("p.ai-setup-desc", {},
          "It uses the Anthropic API (the same AI that powers Claude). You need an API key from ",
          el("a", { href: "https://console.anthropic.com", target: "_blank", rel: "noopener" }, "console.anthropic.com"),
          ". Your key is stored only on this device."
        ),
        el("label.mc-label", { for: "ai-key" }, "Anthropic API Key"),
        keyInput,
        error,
        saveBtn,
        el("p.ai-privacy", {}, "🔒 Your API key and your memories never leave your device except to call the Anthropic API directly."),
        el("div.ai-alt-options", {},
          ollamaToggle,
          ollamaPanel,
          offlineBtn,
          el("p.ai-privacy", {}, "Offline mode runs a small AI model inside your browser via WebGPU — no key, no server, and no internet after the first load (~900MB, cached). Needs Chrome or Edge.")
        )
      )
    );
    keyInput.focus();
  }

  /* ─────────────────────── chat interface ───────────────────── */

  async renderChat() {
    const provider = await ai.getProvider();
    const suggestions = await ai.getSuggestedPrompts();
    const history = ai.getHistory();

    const messagesEl = el("div.ai-messages", { role: "log", "aria-live": "polite" });
    const inputEl = el("textarea.ai-input", {
      placeholder: "Ask anything about your memories, tasks, or journal…",
      rows: "3",
      "aria-label": "Message to AI assistant",
    });
    inputEl.style.cssText = "-webkit-text-fill-color:var(--ink);caret-color:var(--accent);";

    const sendBtn = el("button.btn.btn-primary.ai-send", { type: "button" }, "Ask");
    const clearBtn = el("button.btn.btn-quiet", { type: "button", onclick: () => {
      ai.clearHistory();
      this.renderChat();
    }}, "Clear chat");

    const settingsBtn = provider !== "anthropic"
      ? el("button.btn.btn-quiet", { type: "button", onclick: () => {
          ai.clearHistory();
          this.renderSetup();
        }}, "AI settings")
      : el("button.btn.btn-quiet", { type: "button", onclick: async () => {
          if (confirm("Remove your API key and disconnect the AI?")) {
            await ai.setApiKey(null);
            ai.clearHistory();
            this.renderSetup();
          }
        }}, "Disconnect");

    // Render history
    if (history.length === 0) {
      messagesEl.append(this._welcome(suggestions, inputEl, sendBtn));
    } else {
      for (const msg of history) {
        messagesEl.append(this._bubble(msg.role, msg.content));
      }
    }

    const send = async () => {
      const text = inputEl.value.trim();
      if (!text || this.thinking) return;

      this.thinking = true;
      sendBtn.disabled = true;
      inputEl.value = "";

      // Remove welcome screen if present
      messagesEl.querySelector(".ai-welcome")?.remove();

      // Add user bubble
      messagesEl.append(this._bubble("user", text));

      // Add thinking bubble
      const thinkingEl = this._bubble("assistant", "…", true);
      messagesEl.append(thinkingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        const response = await ai.chat(text, (status) => {
          thinkingEl.textContent = status;
        });
        thinkingEl.remove();
        messagesEl.append(this._bubble("assistant", response));
      } catch (err) {
        thinkingEl.remove();
        if (err.message === "NO_API_KEY") {
          this.renderSetup();
          return;
        }
        if (err.message === "NO_WEBGPU") {
          messagesEl.append(this._bubble("error", "Offline AI needs WebGPU — use Chrome or Edge, or switch to an API key from AI settings."));
        } else if (err.message === "OLLAMA_UNREACHABLE") {
          messagesEl.append(this._bubble("error", "Can't reach your Ollama server. Make sure it's running (ollama serve). If MemoryOS is installed as an app, start Ollama with OLLAMA_ORIGINS=* so the browser is allowed to connect. You can check the address in AI settings."));
        } else if (err.message === "OLLAMA_MODEL_MISSING") {
          messagesEl.append(this._bubble("error", "Ollama is running, but that model isn't pulled yet. Run `ollama pull llama3.2` (or your model name), or change the model in AI settings."));
        } else if (err.message === "WEBLLM_LOST") {
          messagesEl.append(this._bubble("error", "The offline model lost access to your device's GPU — this can happen under low memory, sometimes with a very large question. Reload the page to restart it, try a narrower date range, or switch to an API key in AI settings."));
        } else if (err.message === "INVALID_KEY") {
          messagesEl.append(this._bubble("error", "Your API key was rejected. Please reconnect with a valid key."));
        } else if (err.message === "RATE_LIMITED") {
          messagesEl.append(this._bubble("error", "Rate limited — wait a moment and try again."));
        } else {
          messagesEl.append(this._bubble("error", `Something went wrong: ${err.message}`));
        }
      } finally {
        this.thinking = false;
        sendBtn.disabled = false;
        messagesEl.scrollTop = messagesEl.scrollHeight;
        inputEl.focus();
      }
    };

    sendBtn.addEventListener("click", send);
    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });

    this.container.replaceChildren(
      el("header.view-head", {},
        el("h2.view-title", {}, "AI Assistant"),
        el("div.ai-header-actions", {}, clearBtn, settingsBtn)
      ),
      messagesEl,
      el("div.ai-compose", {},
        inputEl,
        sendBtn
      )
    );

    inputEl.focus();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /* ─────────────────────── welcome screen ────────────────────── */

  _welcome(suggestions, inputEl, sendBtn) {
    const host = el("div.ai-welcome");
    host.append(
      el("div.ai-welcome-icon", {}, "◈"),
      el("p.ai-welcome-text", {},
        "I know your memories, journal, tasks, and Memory Cards. Ask me anything about your own life."
      ),
      el("div.ai-suggestions", {},
        ...suggestions.map(prompt =>
          el("button.btn.ai-suggestion", {
            type: "button",
            onclick: () => {
              inputEl.value = prompt;
              sendBtn.click();
            }
          }, prompt)
        )
      )
    );
    return host;
  }

  /* ───────────────────────── chat bubble ─────────────────────── */

  _bubble(role, content, isThinking = false) {
    const bubble = el(`div.ai-bubble.ai-bubble-${role}`, {});
    if (isThinking) {
      bubble.innerHTML = '<span class="ai-thinking"><span></span><span></span><span></span></span>';
    } else {
      // Render markdown-like formatting for assistant responses
      bubble.innerHTML = formatResponse(content);
    }
    return bubble;
  }
}

/* ────────────────────── response formatter ─────────────────────────── */

/**
 * Light markdown-to-HTML for AI responses.
 * Bold, italic, inline code, bullet lists, numbered lists, line breaks.
 */
function formatResponse(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    // Wrap in paragraph
    .replace(/^(?!<[hup])(.+)/, "<p>$1</p>");
}
