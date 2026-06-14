# Changelog

All notable changes to MemoryOS are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project uses the
`CACHE_VERSION` in `sw.js` as its release version — bumping it is how an
update reaches users offline.

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
