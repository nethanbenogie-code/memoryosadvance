/**
 * MemoryOS — sw.js
 *
 * Offline strategy: the app shell is precached, served cache-first, and
 * refreshed in the background (stale-while-revalidate). User data never
 * passes through here — it lives in IndexedDB, untouched by caching.
 *
 * Releasing an update = bump CACHE_VERSION. Old caches are deleted on
 * activate, and GitHub Pages serves the new files on next load.
 */

const CACHE_VERSION = "memoryos-v0.3.10";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/core/ids.js",
  "./js/core/events.js",
  "./js/data/models.js",
  "./js/data/db.js",
  "./js/data/repository.js",
  "./js/services/memory-service.js",
  "./js/services/search-service.js",
  "./js/services/semantic-service.js",
  "./js/services/journal-service.js",
  "./js/services/rewards-service.js",
  "./js/services/reminder-service.js",
  "./js/services/backup-service.js",
  "./js/services/lock-service.js",
  "./js/services/mnemosyne-service.js",
  "./js/ai/ai-service.js",
  "./js/ai/ai-view.js",
  "./js/ui/components.js",
  "./js/ui/celebration.js",
  "./js/ui/backup-view.js",
  "./js/ui/share.js",
  "./js/ui/about-view.js",
  "./js/ui/manual-view.js",
  "./js/ui/lock-screen.js",
  "./js/ui/second-brain-view.js",
  "./js/ui/memory-card-capture.js",
  "./docs/USER-MANUAL.md",
  "./js/ui/capture.js",
  "./js/ui/timeline-view.js",
  "./js/ui/search-view.js",
  "./js/ui/tasks-view.js",
  "./js/ui/journal-view.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
