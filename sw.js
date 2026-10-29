// Gemmer appens egne filer i browseren, så den åbner hurtigt.
// Tælles op sammen med VERSION i app.js.
const CACHE = 'transskription-v11';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' går uden om browserens egen mellemlagring, så det ikke er en
  // gammel udgave, der bliver gemt.
  const requests = SHELL.map((path) => new Request(path, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('transskription-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Appens egne filer hentes fra nettet, så man altid får den nyeste udgave.
// GitHub Pages lader browseren genbruge filer i 10 minutter. cache: 'no-cache'
// får browseren til at spørge GitHub, om der er en ny. Uden net bruges den gemte.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    try {
      const res = await fetch(event.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  }));
});
