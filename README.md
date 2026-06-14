# MemoryOS

A **local-first personal memory operating system** — a digital extension of human memory. Capture anything in two seconds, see your life as a timeline, search every memory instantly, turn anything into a task with reminders that ring when due, earn points and streaks for finishing things, back up everything with one tap (or automatically, daily), share the app to any social network in one tap, optionally lock it behind a password with paper recovery codes, and let each day write its own journal page.

**Your data never leaves your device.** MemoryOS stores everything in your browser's IndexedDB. The website only delivers the code; no server ever sees a memory.

Works on desktop and mobile as an installable Progressive Web App (PWA) — add it to your home screen and it runs offline.

**New here?** Read the [User Manual](docs/USER-MANUAL.md) — installing on your phone, capturing, search, the AI assistant, tasks, the journal, and how your data is protected. See the [changelog](CHANGELOG.md) for what's new.

## Run it locally

Any static file server works (ES modules require http://, not file://):

```bash
cd memoryos
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

1. Create a repository (e.g. `memoryos`) and push this folder's contents to the `main` branch.
2. In the repo: **Settings → Pages → Source: Deploy from a branch → Branch: main, folder: / (root)**.
3. Your app is live at `https://<username>.github.io/memoryos/` — open it on any phone or desktop, then use the browser's **Install app / Add to Home Screen**.

Every `git push` redeploys. To ship an update users actually receive offline, bump `CACHE_VERSION` in `sw.js`.

## Architecture

Everything in MemoryOS is a **Memory Object** — note, idea, task, event, journal page, person, project — one shape, one store. Type-specific fields live in `extra`, so new types never require a migration.

Time is first-class and precise: `createdAt` is when you captured it, `occurredAt` is when it happened (the timeline sorts on this), `modifiedAt` is the future sync key, and `deletedAt` is a tombstone — MemoryOS never hard-deletes a memory.

Strict layering, enforced by convention:

```
UI views  →  services  →  repository  →  IndexedDB
(js/ui)      (js/services)  (js/data)
```

```
index.html             app shell
sw.js                  offline cache (versioned, cache-first)
manifest.webmanifest   PWA install metadata
css/app.css            full design system (light + dark)
js/
  app.js               bootstrap, navigation, view registry
  core/ids.js          UUIDv7 — time-ordered, sync-safe IDs
  core/events.js       event bus (the seam future AI plugs into)
  data/models.js       Memory Object model, types, links
  data/db.js           IndexedDB + versioned migrations
  data/repository.js   the only module that touches the database
  services/            capture, tasks, lexical + semantic search, daily journal
  ui/                  timeline (the spine), search, tasks, journal, quick capture
  ai/                  assistant: personal-context engine, cloud + offline providers
```

Design notes: serif type is reserved exclusively for *time* (day headings, the journal); no webfonts, because an offline-first app must not depend on a font CDN; full dark mode via `prefers-color-scheme`.

## Roadmap

- **v0.2** — task reminders with system notifications, a humane rewards system (points, levels, streaks), and one-tap / shared / automatic backups with merge-safe restore — **shipped**. Next: edit-in-place, calendar view, weekly planning.
- **v0.3** — AI assistant over your own knowledge base: meaning-based (semantic) retrieval of your memories, a reasoning chat grounded in your own data, and a fully **offline** in-browser model option (WebLLM) alongside the cloud one — **shipped**. The `embeddings` store reserved since v0.1 now backs on-device semantic search.
- **v0.4** — the memory graph: relationship visualization over the `links` store that has been accumulating since v0.1.
- **v0.5** — optional multi-device sync (last-write-wins on `modifiedAt`, tombstone propagation).
- **v1.0** — persistent companion: context-aware reminders, pattern recognition, intelligent planning.

## License

MIT — see `LICENSE`.
