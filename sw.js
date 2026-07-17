/* ===== Yetkaz.uz — Service Worker (PWA) =====
   Maqsad: Android'da o'rnatiladigan, offline ishlaydigan ilova.
   MUHIM: /api va /uploads umuman ushlanmaydi — backend xatti-harakati o'zgarmaydi.
   Statik fayllar uchun "network-first": onlayn bo'lsa HAR DOIM yangi versiya,
   offline bo'lsangina keshdan beriladi (eskirish bo'lmaydi). */
/* v6 — narx serverда hisoblanadi + CSP/nonce + safe.js (XSS himoyasi).
   Eski keshdagi app.js/store.js yangi backend bilan ishlamaydi va safe.js siz
   panellar yiqiladi, shuning uchun versiya oshirildi: eski kesh tozalanadi. */
const CACHE = 'yetkaz-v6';
const ASSETS = [
  '/index.html', '/admin.html', '/restoran.html', '/kuryer.html', '/kabinet.html',
  '/assets/css/styles.css', '/assets/css/admin.css',
  '/assets/js/safe.js',
  '/assets/js/store.js', '/assets/js/i18n.js', '/assets/js/data.js', '/assets/js/app.js',
  '/assets/js/admin.js', '/assets/js/restoran.js', '/assets/js/kuryer.js', '/assets/js/kabinet.js',
  '/assets/js/pwa-install.js',
  '/assets/logo.png', '/assets/logo.svg', '/assets/favicon-64.png',
  '/assets/apple-touch.png', '/assets/logo-maskable.png',
  '/manifest.webmanifest', '/kabinet.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Backend so'rovlari va yuklangan rasmlar — har doim tarmoqdan (keshlanmaydi)
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return;
  // Faqat shu origin
  if (url.origin !== self.location.origin) return;

  const isNav = req.mode === 'navigate';
  // Network-first: onlayn = yangi, offline = kesh.
  // MUHIM: faqat sahifa (navigate) so'roviga index.html fallback beriladi.
  // CSS/JS/rasm so'roviga HECH QACHON HTML qaytarilmaydi (uslub buzilmasligi uchun).
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => {
        if (r) return r;
        if (isNav) return caches.match('/index.html');
        return Response.error();
      }))
  );
});
