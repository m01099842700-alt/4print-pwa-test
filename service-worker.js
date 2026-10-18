const CACHE_NAME = "4print-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        const results = await Promise.allSettled(APP_SHELL.map(path => cache.add(path)));
        const failed = results
          .map((result, index) => ({result, path: APP_SHELL[index]}))
          .filter(item => item.result.status === "rejected");
        if (failed.length) console.warn("تعذر تخزين بعض الملفات:", failed.map(item => item.path));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("4print-shell-") && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // تجنب تخزين استجابات API أو أي بيانات ديناميكية في ذاكرة الواجهة.
  if (new URL(request.url).searchParams.has("api")) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy).catch(error => {
            console.warn("تعذر تخزين الملف:", error);
          }));
        }
        return response;
      });
    })
  );
});
