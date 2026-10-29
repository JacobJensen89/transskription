// Gemmer appens egne filer i browseren, så den kan åbnes uden internet.
// Sprogmodellen gemmes separat af modelbiblioteket selv.
// Tælles op sammen med VERSION i app.js.
const CACHE = 'transskription-v3';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'worker.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/transformers.js', 'vendor/ort-wasm-simd-threaded.asyncify.mjs',
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
// Uden net bruges den gemte. De store filer i vendor/ skifter sjældent og
// tages derfor direkte fra det gemte.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached && url.pathname.includes('/vendor/')) return cached;
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
