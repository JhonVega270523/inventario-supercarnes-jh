const cacheName = "supercarnes-jh-shell-v1";
const shellFiles = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./logo-data.js",
  "./Logo-JH.png",
  "./xlsx.full.min.js",
  "./html2pdf.bundle.min.js",
  "./manifest.webmanifest",
  "./pwa-icon-192.png",
  "./pwa-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => cache.addAll(shellFiles.map(file => new URL(file, self.registration.scope).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith("supercarnes-jh-shell-") && key !== cacheName)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(cacheName).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request, { ignoreSearch: true });
          return cachedPage || caches.match(new URL("./index.html", self.registration.scope).href);
        })
    );
    return;
  }

  if (!["style", "script", "image", "font"].includes(request.destination)) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(cacheName).then(cache => cache.put(request, copy));
        }
        return response;
      }))
  );
});
