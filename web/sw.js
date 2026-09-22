// Makes the page itself work offline.
//
// The weights already survived offline — WebLLM keeps them in the Cache API
// and they persist. The PAGE did not. GitHub Pages serves index.html with
// `cache-control: max-age=600`, so ten minutes after a visit the browser has
// to ask the network again, and with no signal you get an error page rather
// than the app. The README claimed "works fully offline" on the strength of
// the weights alone; this is what makes that claim true.
//
// Strategy, deliberately boring:
//   same-origin  -> network first, fall back to cache.  A deploy is live the
//                   moment you are online, which matters because a stale
//                   service worker serving an old page forever is the classic
//                   way this feature ruins a site.
//   the CDN lib  -> cache first. It is pinned to an exact version in the URL,
//                   so it can never go stale, and it is 6 MB we should not
//                   re-download.
const VERSION = "sketchgpt-v2";
const SHELL = ["./", "./index.html", "./browser.html", "./sketch.mjs",
               "./stamps.mjs", "./rough.mjs", "./work.mjs"];

self.addEventListener("install", event => {
  // Never let one missing file fail the whole install — a page that is
  // partly cached offline still beats a page that is not cached at all.
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // The model weights are WebLLM's business: it has its own cache and its own
  // fallbacks, and wrapping multi-hundred-megabyte shards in a second cache
  // would double the storage for nothing.
  const isWeights = /huggingface\.co|hf\.co|raw\.githubusercontent/.test(url.hostname);
  if (isWeights) return;

  if (sameOrigin) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
        // A navigation to any path in scope should still open the app.
        if (request.mode === "navigate") {
          const shell = await caches.match("./browser.html");
          if (shell) return shell;
        }
        throw err;
      }
    })());
    return;
  }

  // Pinned third-party module (the WebLLM bundle): cache first, forever.
  if (/cdn\.jsdelivr\.net/.test(url.hostname)) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
      return fresh;
    })());
  }
});
