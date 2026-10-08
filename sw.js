/* Service worker da Ludoteca: instalável e com abertura offline.
   Estratégia "rede primeiro": online sempre pega a versão nova; sem rede usa o cache.
   `cache: 'no-cache'` faz o navegador revalidar com o servidor em vez de reaproveitar o
   cache HTTP (o GitHub Pages manda max-age=600 e deixaria o app até 10 min desatualizado).
   Ao mudar a lista SHELL, aumente CACHE. */
const CACHE = 'ludoteca-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/base.css',
  './assets/css/hub.css',
  './assets/css/ui.css',
  './assets/js/games.js',
  './assets/js/hub.js',
  './assets/js/backbar.js',
  './assets/js/util.js',
  './assets/js/net.js',
  './assets/js/lobby.js',
  './assets/vendor/peerjs.min.js',
  './assets/vendor/qrcode.js',
  './assets/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
