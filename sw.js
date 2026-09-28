/* e-PTA Mobile service worker: bewaart alleen de app zelf, nooit gegevens of inlogverkeer.
   Verhoog VERSIE bij elke nieuwe uitgave, dan halen telefoons de nieuwe bestanden op. */
const VERSIE = 'epta-mobile-1.2';
const SCHIL = ['./', './index.html', './model.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(SCHIL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSIE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// eerst het netwerk (altijd de nieuwste app), zonder verbinding de bewaarde kopie
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Microsoft-verkeer niet aanraken
  if (u.search.includes('code=') || u.search.includes('error=')) return;   // terugkomst van het inloggen
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request, kopie)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
