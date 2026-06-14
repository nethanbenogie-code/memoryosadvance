/**
 * MemoryOS — ai/ai-service.js
 *
 * The AI reasoning layer — Project Mnemosyne's intelligence engine.
 *
 * No server, no Python, no cloning. The Anthropic API runs from the
 * browser directly. The magic is in the CONTEXT: before every message,
 * we build a rich snapshot of the user's memories, journals, tasks, and
 * Memory Cards and hand it to the model as a system prompt. The model
 * then reasons over the user's actual life — not generic knowledge.
 *
 * This is the "Nustra Brain" concept, rebuilt in JS:
 *   User's data → structured context → AI reasoning → personal insight
 *
 * Architecture:
 *   - ai-service.js  (this file) — API calls, context building, history
 *   - ai-view.js     — the chat UI panel
 *
 * The API key is stored in IndexedDB via the meta store — never in
 * localStorage, never in a URL, never logged.
 */

import * as repo from "../data/repository.js";
import { MemoryType, TaskStatus, typeLabel } from "../data/models.js";
import { dayKey, dayBounds } from "../services/journal-service.js";
import * as semantic from "../services/semantic-service.js";

const ANTHROPIC_MODEL = "claude-sonnet-4-6";

/** Selectable in-browser models. q4f16 needs shader-f16 (most modern GPUs). */
export const WEBLLM_MODELS = [
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Fast & light — 1B (older / low-RAM devices, ~0.9GB)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Balanced — 3B (8GB+ RAM, recommended, ~1.8GB)" },
];
const DEFAULT_WEBLLM_MODEL = WEBLLM_MODELS[0].id;
const DEFAULT_OLLAMA_MODEL = "llama3.2";

const MAX_TOKENS = 1024;
const MAX_CONTEXT_MEMORIES = 40;
const API_URL = "https://api.anthropic.com/v1/messages";
const OLLAMA_URL = "http://localhost:11434/api/chat";

/* ─────────────────────────── API key management ──────────────────────── */

export async function getApiKey() {
  return await repo.getMeta("ai_api_key");
}

export async function setApiKey(key) {
  await repo.setMeta("ai_api_key", key?.trim() || null);
}

export async function hasApiKey() {
  const k = await getApiKey();
  return !!k;
}

/* ─────────────────────────── provider selection ──────────────────────── */
/* "anthropic" (cloud, needs a key) or "webllm" (in-browser, no key, no
 * server). Stored in the meta store so it persists per device. */

export async function getProvider() {
  return (await repo.getMeta("ai_provider")) || "anthropic";
}

export async function setProvider(provider) {
  await repo.setMeta("ai_provider", provider);
}

/** Selected in-browser model id (defaults to the light 1B). */
export async function getWebllmModel() {
  return (await repo.getMeta("ai_webllm_model")) || DEFAULT_WEBLLM_MODEL;
}
export async function setWebllmModel(id) {
  await repo.setMeta("ai_webllm_model", id);
}

/** Ollama model name, e.g. "llama3.2", "qwen2.5:3b". */
export async function getOllamaModel() {
  return (await repo.getMeta("ai_ollama_model")) || DEFAULT_OLLAMA_MODEL;
}
export async function setOllamaModel(name) {
  await repo.setMeta("ai_ollama_model", name || DEFAULT_OLLAMA_MODEL);
}

/** Ready to chat with the current provider? Anthropic needs a key;
 *  WebLLM needs nothing. The view uses this to decide what to show. */
export async function isReady() {
  const provider = await getProvider();
  if (provider === "webllm" || provider === "ollama") return true;
  return !!(await getApiKey());
}

/* ─────────────────────────── WebLLM (offline) ────────────────────────── */
/* A small model running fully in-browser via WebGPU. Loaded lazily on
 * first use (heavy download, then cached) so it never slows startup and
 * Node tests that merely import this module stay network-free. */

let _webllmEngine = null;
let _webllmModel = null;

async function ensureWebLLM(onStatus) {
  if (!navigator.gpu) throw new Error("NO_WEBGPU");
  const modelId = await getWebllmModel();
  if (_webllmEngine && _webllmModel === modelId) return _webllmEngine;
  const webllm = await import("https://esm.run/@mlc-ai/web-llm@0.2.83");
  _webllmEngine = await webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (p) =>
      onStatus?.(p.text || `Loading model ${Math.round((p.progress || 0) * 100)}%`),
  });
  _webllmModel = modelId;
  return _webllmEngine;
}

/* ─────────────────────────── context builder ─────────────────────────── */

/**
 * Build a rich personal context string from the user's actual data.
 * This is what makes the AI know YOUR life, not just answer generically.
 */
export async function buildContext() {
  const all = await repo.listMemories();
  if (!all.length) return "The user has no memories saved yet.";

  const now = new Date();
  const todayKey = dayKey(now);
  const { startIso: weekStart } = dayBounds(shiftKey(todayKey, -7));

  // Partition memories by type and recency
  const tasks = all.filter(m => m.type === MemoryType.TASK);
  const pending = tasks.filter(m => m.status === TaskStatus.PENDING);
  const inProgress = tasks.filter(m => m.status === TaskStatus.IN_PROGRESS);
  const recentDone = tasks
    .filter(m => m.status === TaskStatus.COMPLETED && m.extra?.completedAt >= weekStart)
    .slice(0, 10);

  const overdue = tasks.filter(m =>
    m.status !== TaskStatus.COMPLETED && m.dueAt && m.dueAt < now.toISOString()
  );

  const journals = all
    .filter(m => m.type === MemoryType.JOURNAL && m.content?.trim())
    .slice(0, 7);

  const memoryCards = all
    .filter(m => m.type === MemoryType.MEMORY_CARD)
    .slice(0, 10);

  const recentNotes = all
    .filter(m => [MemoryType.NOTE, MemoryType.IDEA].includes(m.type))
    .slice(0, 10);

  const learning = all
    .filter(m => m.type === MemoryType.LEARNING)
    .slice(0, 5);

  const articles = all
    .filter(m => m.type === MemoryType.ARTICLE)
    .slice(0, 5);

  const reflections = all
    .filter(m => m.extra?.reflection?.trim())
    .slice(0, 5);

  // Build the context document
  const lines = [
    `# MemoryOS Personal Context`,
    `Date: ${now.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" })}`,
    `Total memories: ${all.length}`,
    "",
  ];

  if (pending.length || inProgress.length) {
    lines.push("## Active Tasks");
    for (const t of [...inProgress, ...pending].slice(0, 15)) {
      const due = t.dueAt ? ` [due ${fmtDate(t.dueAt)}]` : "";
      const status = t.status === TaskStatus.IN_PROGRESS ? "🔄" : "⬜";
      lines.push(`${status} ${t.title}${due}`);
    }
    lines.push("");
  }

  if (overdue.length) {
    lines.push("## Overdue Tasks ⚠️");
    for (const t of overdue.slice(0, 8)) {
      lines.push(`- ${t.title} [was due ${fmtDate(t.dueAt)}]`);
    }
    lines.push("");
  }

  if (recentDone.length) {
    lines.push("## Completed This Week");
    for (const t of recentDone) {
      lines.push(`✅ ${t.title}`);
    }
    lines.push("");
  }

  if (journals.length) {
    lines.push("## Recent Journal Entries");
    for (const j of journals) {
      const date = fmtDate(j.occurredAt);
      const preview = j.content.trim().slice(0, 300);
      lines.push(`### ${date}`);
      lines.push(preview + (j.content.length > 300 ? "…" : ""));
      lines.push("");
    }
  }

  if (memoryCards.length) {
    lines.push("## Memory Cards (Important Life Events)");
    for (const c of memoryCards) {
      lines.push(`- **${c.title}** (${fmtDate(c.occurredAt)})`);
      if (c.extra?.people?.length) lines.push(`  People: ${c.extra.people.join(", ")}`);
      if (c.extra?.location) lines.push(`  Location: ${c.extra.location}`);
      if (c.extra?.reflection) lines.push(`  Reflection: "${c.extra.reflection}"`);
    }
    lines.push("");
  }

  if (recentNotes.length) {
    lines.push("## Recent Notes & Ideas");
    for (const n of recentNotes) {
      lines.push(`- **${n.title}** [${n.type}]${n.content ? ": " + n.content.slice(0, 120) : ""}`);
    }
    lines.push("");
  }

  if (learning.length) {
    lines.push("## Learning Records");
    for (const l of learning) {
      lines.push(`- ${l.title}${l.content ? ": " + l.content.slice(0, 80) : ""}`);
    }
    lines.push("");
  }

  if (articles.length) {
    lines.push("## Saved Articles");
    for (const a of articles) {
      lines.push(`- ${a.title}`);
    }
    lines.push("");
  }

  if (reflections.length) {
    lines.push("## Personal Reflections");
    for (const r of reflections) {
      lines.push(`- "${r.extra.reflection}" — ${r.title}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/* ────────────────────────── system prompt ───────────────────────────── */

function buildSystemPrompt(context) {
  return `You are the MemoryOS AI assistant — a personal reasoning engine that helps the user understand, reflect on, and act on their own life data. You are NOT a general-purpose chatbot. You reason specifically over the user's memories, journal entries, tasks, and personal records provided below.

ABOUT THIS DATA — READ CAREFULLY:
Everything in the context below belongs to the user you are talking to. It is their OWN private second brain, stored only on their own device. You are speaking directly to its owner. Therefore:
- NEVER refuse to share this information with them, and never describe it as a "private citizen's" data or a privacy concern. It is the user's own information. Withholding it from them makes no sense.
- When they ask for their journal, tasks, notes, phone numbers, or anything else in the context, surface it directly and plainly. That is your core job.
- If something they ask for is genuinely not in the context, say so briefly and honestly — don't refuse on "privacy" grounds, just say it isn't in their data.

YOU ARE READ-ONLY:
You can read and reason over the user's data, but you cannot create, edit, or delete it. If they ask you to save, add, remember, or change something ("save my number", "add a task", "remember this"), explain briefly that you can't write to their memory, and tell them to use Quick Capture — the + button, or Ctrl+K (⌘K on Mac). Don't pretend you saved it.

Your personality:
- Calm, thoughtful, and personal — like a trusted advisor who knows the user's life
- Concrete: reference specific memories, dates, tasks, and people by name when relevant
- Encouraging but honest — celebrate progress, gently surface what needs attention
- Never generic: every response should feel like it could only have been written for THIS user

Your capabilities:
- Answer questions about what the user has done, is doing, or needs to do
- Summarize periods of time (this week, last month, a specific date)
- Surface patterns: recurring themes, unfinished projects, people they mention often
- Help reflect: "What mattered most this week?", "What did I learn?"
- Suggest what to focus on next based on their tasks and journal

Scope:
- Your purpose is the user's own memories. You may answer a simple general question, but you are not a calculator or a search engine — for heavy arithmetic or current external facts, say briefly that it's outside what you do, rather than guessing.

What you must never do:
- Invent memories, tasks, or facts that aren't in the context
- Refuse the user access to their own data
- Pretend to know things outside the context window, or pretend to have saved something
- Be verbose — keep responses focused and scannable

---

${context}`;
}

/* ─────────────────────────── conversation ───────────────────────────── */

/** In-memory conversation history for the current session. */
let conversationHistory = [];

export function clearHistory() {
  conversationHistory = [];
}

export function getHistory() {
  return [...conversationHistory];
}

/**
 * Send a message to the AI and get a response. Routes to the selected
 * provider (Anthropic or in-browser WebLLM) and builds fresh personal
 * context on every call so the AI always sees current data.
 * @param {string} userMessage
 * @param {(status: string) => void} [onStatus] Progress callback — used by
 *   the WebLLM path to report model-load progress and "Thinking…".
 * @returns {Promise<string>} The full response text.
 */
export async function chat(userMessage, onStatus) {
  const provider = await getProvider();

  // Semantic retrieval: surface the memories most relevant to THIS question
  // and lead the context with them, so the model reasons over what matters
  // rather than only the most recent items. Best-effort.
  let relevant = "";
  try {
    const matches = await semantic.semanticSearch(userMessage, { limit: 6 });
    relevant = formatRelevant(matches);
  } catch (err) {
    console.warn("[ai] semantic retrieval skipped:", err);
  }

  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(relevant ? relevant + "\n" + context : context);

  conversationHistory.push({ role: "user", content: userMessage });
  const messages = conversationHistory.slice(-20); // bound to last 20 turns

  let assistantMessage;
  try {
    assistantMessage =
      provider === "webllm"
        ? await chatWebLLM(systemPrompt, messages, onStatus)
        : provider === "ollama"
        ? await chatOllama(systemPrompt, messages, onStatus)
        : await chatAnthropic(systemPrompt, messages);
  } catch (err) {
    conversationHistory.pop(); // drop the failed user turn
    throw err;
  }

  conversationHistory.push({ role: "assistant", content: assistantMessage });
  return assistantMessage;
}

/** Cloud path: the Anthropic API, called directly from the browser. */
async function chatAnthropic(systemPrompt, messages) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("NO_API_KEY");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("INVALID_KEY");
    if (response.status === 429) throw new Error("RATE_LIMITED");
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

/** Offline path: a small model running fully in-browser via WebGPU.
 *  Same personal context, zero network, zero key. */
async function chatWebLLM(systemPrompt, messages, onStatus) {
  const engine = await ensureWebLLM(onStatus);
  onStatus?.("Thinking…");
  const reply = await engine.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    temperature: 0.4,
    max_tokens: MAX_TOKENS,
  });
  return reply.choices[0].message.content.trim();
}

/** Local path: a model served by Ollama on this machine. Uses the device's
 *  GPU natively (faster than in-browser) and allows larger models, while
 *  staying fully local and key-free. Requires Ollama running with
 *  OLLAMA_ORIGINS set so the browser may reach it. */
async function chatOllama(systemPrompt, messages, onStatus) {
  onStatus?.("Thinking…");
  const model = await getOllamaModel();
  let res;
  try {
    res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
  } catch {
    throw new Error("OLLAMA_DOWN"); // not running / unreachable / CORS
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error("OLLAMA_MODEL"); // model not pulled
    throw new Error("OLLAMA_DOWN");
  }
  return (await res.json()).message.content.trim();
}

/* ─────────────────────── suggested prompts ──────────────────────────── */

/**
 * Context-aware suggested questions — different every time based on
 * what's actually in the user's data.
 */
export async function getSuggestedPrompts() {
  const all = await repo.listMemories();
  const tasks = all.filter(m => m.type === MemoryType.TASK);
  const overdue = tasks.filter(m =>
    m.status !== TaskStatus.COMPLETED && m.dueAt && m.dueAt < new Date().toISOString()
  );
  const pending = tasks.filter(m => m.status === TaskStatus.PENDING);
  const cards = all.filter(m => m.type === MemoryType.MEMORY_CARD);
  const journals = all.filter(m => m.type === MemoryType.JOURNAL && m.content?.trim());

  const prompts = ["What should I focus on today?"];

  if (overdue.length) prompts.push(`I have ${overdue.length} overdue task${overdue.length > 1 ? "s" : ""} — what should I do?`);
  if (pending.length > 3) prompts.push("Summarize my pending tasks by priority.");
  if (journals.length) prompts.push("What patterns do you see in my recent journal entries?");
  if (cards.length) prompts.push("What are the most important memories I've saved?");
  prompts.push("What did I accomplish this week?");
  prompts.push("What have I been learning lately?");
  prompts.push("What should I reflect on today?");

  return prompts.slice(0, 5);
}

/* ──────────────────────────── helpers ──────────────────────────────── */

/** Render semantically-matched memories as a focused, detailed block that
 *  leads the context. These are the items most relevant to the question. */
function formatRelevant(matches) {
  if (!matches?.length) return "";
  const lines = [
    "# Most Relevant Memories",
    "Retrieved by semantic similarity to the user's question — reason from these first.",
    "",
  ];
  for (const { memory, score } of matches) {
    const pct = Math.round(score * 100);
    lines.push(`## ${memory.title} — ${typeLabel(memory.type)} (${fmtDate(memory.occurredAt)}) · ${pct}% match`);
    if (memory.content?.trim()) lines.push(memory.content.trim().slice(0, 500));
    if (memory.extra?.people?.length) lines.push(`People: ${memory.extra.people.join(", ")}`);
    if (memory.extra?.location) lines.push(`Location: ${memory.extra.location}`);
    if (memory.extra?.reflection) lines.push(`Reflection: "${memory.extra.reflection}"`);
    lines.push("");
  }
  return lines.join("\n");
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

function shiftKey(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return dayKey(date);
}
