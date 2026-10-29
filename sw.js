// Gemmer appens egne filer i browseren, så den åbner hurtigt.
// Tælles op sammen med VERSION i app.js.
const CACHE = 'transskription-v5';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('transskription-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Appens egne filer hentes fra nettet, så man altid får den nyeste udgave.
// Uden net bruges den gemte.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    try {
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  }));
});
