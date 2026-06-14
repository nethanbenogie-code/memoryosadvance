# Changelog

All notable changes to MemoryOS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses the
`CACHE_VERSION` in `sw.js` as its release version — bumping it is how an
update reaches users offline.

## [0.3.10] — 2026-06-14

### Added
- **Assistant can save to memory (opt-in).** A "Saving" toggle in the AI
  header (off by default) lets the assistant propose notes, ideas, tasks,
  events, or Memory Cards. Every write is shown first with Save / Cancel —
  nothing is written without confirmation. Saves go through the normal
  capture pipeline, so they index for search and semantic retrieval.
- Cross-provider: works with the cloud key, WebLLM, and Ollama via a
  structured-output action block (no reliance on tool-calling).

## [0.3.9] — 2026-06-14

### Added
- Device capability check: opening the AI Assistant now probes WebGPU,
  f16 support, GPU buffer limits, and RAM. If the device can't run the
  in-browser model, the offline option is disabled with a message steering
  the user to the Anthropic API (Claude).

### Changed
- The in-browser default model is now the 3B (was 1B). Low-RAM devices can
  still pick 1B from the dropdown.

## [0.3.8] — 2026-06-13

### Added
- Offline model is now **selectable** — a light 1B (low-RAM devices) or a
  3B (8GB+ RAM, recommended) — chosen on the AI setup screen.
- **Local Ollama** provider: point MemoryOS at Ollama running on the same
  machine to use larger, faster models on the GPU natively, still fully
  local and key-free. Clear errors when Ollama isn't running or the model
  isn't pulled.

### Changed
- AI setup screen reorganized into three clear options: Anthropic key,
  in-browser (WebLLM, with model picker), and local Ollama.
- Manual section 8 updated for the model picker and Ollama.

## [0.3.7] — 2026-06-13

### Fixed
- AI assistant no longer refuses the user's own data. The system prompt now
  states plainly that all context belongs to the user being spoken to — their
  own private second brain — so it surfaces journals, tasks, and notes on
  request instead of citing "privacy".
- The assistant now knows it is read-only: asked to save or change something,
  it points the user to Quick Capture instead of pretending to have saved it.
- Scope clarified: it defers heavy arithmetic / external lookups rather than
  guessing, keeping focus on the user's memories.

## [0.3.6] — 2026-06-13

### Added
- Full **AI Assistant** section in the User Manual (section 8), covering the
  offline and cloud modes, meaning-based memory retrieval, privacy, and
  troubleshooting.
- This changelog.

### Changed
- Manual intro now lists seven views (adds **AI Assistant**); new cross-links
  from Search, Working Offline, and Privacy; following sections renumbered
  with all inline references updated.
- README roadmap: v0.3 marked **shipped**.

_App shell unchanged from 0.3.5 — this release is documentation only._

## [0.3.5] — 2026-06-13

### Changed
- Internal cleanup: corrected a stale JSDoc parameter name on `chat()`
  (`onStream` → `onStatus`). No behavior change.

## [0.3.4] — 2026-06-13

### Added
- **Offline AI** via WebLLM: the assistant can now run fully inside the
  browser through WebGPU — no API key, no server. The model downloads once
  (~900 MB), is cached, and works with no internet thereafter.
- A setup choice between the cloud (Anthropic key) and offline (WebLLM)
  providers, persisted per device, with a provider-aware
  **Disconnect** / **AI settings** control and a clear WebGPU-unsupported
  message.

### Changed
- `ai-service.chat()` routes between the cloud and offline paths over the
  same personal-context pipeline, so both reason over your memories
  identically; only the final generation step differs.

## [0.3.3] — 2026-06-13

### Added
- **Semantic search** (`services/semantic-service.js`): on-device embeddings
  (transformers.js, MiniLM) stored in the `embeddings` store that the v1
  schema reserved for exactly this — no migration needed. Vector retrieval
  sits beside the existing lexical search rather than replacing it.
- Retrieval-augmented AI context: the assistant now leads with the memories
  most **relevant** to your question instead of the most recent, scaling past
  the previous ~40-memory cap.
- Automatic embedding on memory create/update/delete via the event bus;
  background index build at startup and after a restore.
- Repository accessors for the embeddings store (`putEmbedding`,
  `listEmbeddings`, `deleteEmbeddingsFor`), keeping IndexedDB access in one
  layer.

## [0.3.2] — baseline

- Starting point for the semantic/AI work above (the Project Mnemosyne
  second-brain release).

---

_Earlier releases (v0.1–v0.3.1) predate this changelog; see the roadmap in
the README for their highlights._
