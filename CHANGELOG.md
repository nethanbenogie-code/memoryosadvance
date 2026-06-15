# Changelog

All notable changes to MemoryOS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses the
`CACHE_VERSION` in `sw.js` as its release version — bumping it is how an
update reaches users offline.

## [0.3.12] — 2026-06-14

### Added
- **Local Ollama provider for the AI assistant.** Point MemoryOS at an Ollama
  server you run yourself (default `http://localhost:11434`, model `llama3.2`)
  for a capable model that stays entirely on your machine — no key, no cloud.
  The setup screen gained a **Use my local Ollama server** option that probes
  the server (`/api/tags`), lists pulled models, and warns if the chosen model
  isn't installed. Chats post to `/api/chat` with `stream:false` and a raised
  `num_ctx` (8192) so the personal context isn't silently truncated.
  - New service API: `getOllamaConfig`, `setOllamaConfig`, `checkOllama`, and an
    `ollama` value for `setProvider`. `isReady()` treats Ollama as keyless.
  - Clear, actionable errors: `OLLAMA_UNREACHABLE` (server down / origin
    blocked) and `OLLAMA_MODEL_MISSING` (model not pulled), each surfaced with
    guidance (including the `OLLAMA_ORIGINS=*` hint for installed-app origins).
  - The system-prompt size clamp now applies to both local providers (a larger
    budget for Ollama than the in-browser model).

### Changed
- `CACHE_VERSION` → `memoryos-v0.3.12`.
- User Manual §8 and §18: document the Ollama option and its setup/troubleshooting.

## [0.3.11] — 2026-06-14

### Added
- **Click a card to read it in full.** New `ui/memory-detail.js` opens a calm,
  read-first detail view for any memory — the complete journal entry, note, or
  idea (no truncation), and for a Memory Card its people, location, importance,
  reflection, and Cognitive Links. URL pointers render as clickable links;
  folder/drive pointers show as text. Edit (Memory Cards), Archive, and Close
  are available from the view; Escape or the backdrop closes it.
  - Timeline entries now expose a keyboard-accessible clickable region
    (`role=button`, Enter/Space) that opens the detail; the per-card Archive/
    Edit buttons still act directly without opening it.
  - "On this day" items open the detail view directly instead of just scrolling.
  - Search results are clickable too (`memoryCard` gained an `onOpen` option).

### Changed
- `CACHE_VERSION` → `memoryos-v0.3.11`; detail module precached for offline.
- User Manual §2: documents click-to-read.

## [0.3.10] — 2026-06-14

### Fixed
- **Offline (WebLLM) assistant no longer wedges after a mid-session failure.**
  Previously, if the in-browser model's engine was disposed or lost its GPU
  device (e.g. memory pressure), the service kept a permanent reference to the
  dead engine, so every later message failed with "Object has already been
  disposed" / "Model not loaded" until a full reload. The engine is now
  self-healing: on those errors it rebuilds once from cached weights and
  retries, surfacing a clear, actionable message (`WEBLLM_LOST`) only if the
  rebuild also fails.
- Engine initialization is serialized behind a single in-flight promise, so
  two quick sends can't create two engines and dispose one another.
- The offline system prompt is now clamped to a safe size, so a large
  date-range context block can't overflow the small model's window or
  exhaust GPU memory (a likely trigger of the disposal above).

### Changed
- `CACHE_VERSION` → `memoryos-v0.3.10`.
- User Manual §18: troubleshooting note for the offline model recovering
  mid-session, and a reminder that the small offline model is less precise.

## [0.3.9] — 2026-06-14

### Added
- **The AI assistant can now answer by date or period.** When a question
  refers to a time ("what happened last June?", "my notes from last week",
  "what did I learn in May?", "in 2024", "June 12, 2025"), the assistant
  fetches exactly the memories stored in that range — not just recent ones —
  and answers from them. It can combine a kind with a period ("tasks this
  month", "Memory Cards from 2025"), states the date range it used, and says
  plainly when nothing is recorded for a period instead of inventing entries.
  - New `services/time-query-service.js`: a pure, deterministic parser that
    turns natural-language time and kind expressions into a date range +
    type filter. Provider-agnostic (works in cloud and offline modes).
  - `ai/ai-service.js`: new `buildDatedContext()` leads the model's context
    with an authoritative "… from <period>" block, fetched via the existing
    `repository.listMemoriesInRange()`. System-prompt guidance updated to use
    it. Re-runs every turn, so follow-ups like "what about May?" just work.

### Changed
- `CACHE_VERSION` → `memoryos-v0.3.9`; new service precached for offline use.
- User Manual §8: documents asking the assistant by date or period.

## [0.3.8] — 2026-06-14

### Changed
- **Generalized the onboarding from "Family Archive" to "Cognitive Linking"** —
  the actual primitive of MemoryOS. The intro now teaches the universal idea
  (store the *meaning* and an invisible *pointer*; the media stays where it
  lives), with Family as the most relatable example among several suggested
  archives (Travel, Learning, Work, Friends). Each example archive name is
  tap-to-copy, following the convention `MemoryOS - <Topic> Archive`.
- The intro is now **strictly show-once**: it is marked seen the moment it
  appears on first launch, so it never returns on its own (it can still be
  reopened from the **How Cognitive Linking works** link).
- Renamed `ui/family-archive-onboarding.js` → `ui/cognitive-linking-onboarding.js`
  and its exports (`maybeShowCognitiveLinkingOnboarding`,
  `openCognitiveLinkingExplainer`); service helpers renamed to match
  (`…CognitiveLinkingIntro`). The persisted "seen" flag keeps its legacy key,
  so anyone who already dismissed the intro is not shown it again.
- `CACHE_VERSION` → `memoryos-v0.3.8`.
- User Manual: section 1 and section 4 reworded around Cognitive Linking as the
  universal concept, with Family as one example.

## [0.3.7] — 2026-06-14

### Added
- **Family Archive onboarding** (`ui/family-archive-onboarding.js`): a calm,
  dismissable explainer that introduces the core habit — keep your photos in
  one private album (`MemoryOS - Family Archive`) wherever they already live,
  and create a matching Memory Card here. It auto-opens on the **first launch**
  of the app (and on relaunch until dismissed), and can be reopened any time
  from a **How the Family Archive works** link in the Second Brain header and
  empty state. A user who was already using MemoryOS before this release is
  detected on first boot and never interrupted. Includes a one-tap copy of the
  album name and an explicit privacy note. State lives in two `meta` flags via
  the Mnemosyne service (`familyArchiveIntroSeenAt`, `firstLaunchAt`) — no
  schema change, no DB-layer access from the UI.

### Changed
- `CACHE_VERSION` → `memoryos-v0.3.7`; the new module is precached in the app
  shell so it works offline on first install.
- User Manual: documents the first-launch welcome (section 1) and how to
  reopen the Family Archive guide (section 4).

### Fixed
- Removed a duplicated block of entries in `typeLabel()` (`data/models.js`).
- Deleted a stray `{css,js,...}` directory left by an un-expanded `mkdir`.

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
