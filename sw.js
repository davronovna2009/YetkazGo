/* ===== Yetkaz.uz — Service Worker (PWA) =====
   Maqsad: Android'da o'rnatiladigan, offline ishlaydigan ilova.
   MUHIM: /api va /uploads umuman ushlanmaydi — backend xatti-harakati o'zgarmaydi.
   Statik fayllar uchun "network-first": onlayn bo'lsa HAR DOIM yangi versiya,
   offline bo'lsangina keshdan beriladi (eskirish bo'lmaydi). */
/* v26 — Kabinet «Taomlar» bo'limida bosh saytdagi kabi AKSIYA banneri: restoran
   e'lonlari navbatма-navbat aylanadi, bosilганda «Aksiyalar» modali; e'lon/chegirма
   yo'q bo'lsa yashiriladi. (v25 — «Yordam / murojaat» kontaktlari YAGONA manba (support.js): admin har
   birini (telefon/username/havola) alohida yoqib/o'chiradi; "sayt ma'muriyatiga
   murojaat qiling" degan matn o'rniga HAMMA joyда (sayt, kabinet, restoran,
   kuryer login-eslatmasi, footer) shu kontaktlar chiqadi. Admin panelга «To'lov
   turlari» bo'limi: naqd/karta yoqish-o'chirish + custom to'lov turi qo'shish;
   karta o'chirilса — saytда, kabinetда va serverда kartadan to'lov to'siladi.
   Kuryer «Ishdan javob so'rash» oqimi to'liq testlandi (E2E). npm test — 314 ta.
   (v24 — Admin restoran/kuryer BARCHA maydonini tahrirlaydi (emoji, kirill nomi,
   kw, eta, masofa, ish vaqti, avto raqami, pasport...). Yordam kontaktlari.
   Bosh sahifa «Aksiya» bo'limi FAQAT aksiya/reklamaga tushgan taomlarni
   ko'rsatadi (reklamasiz taom ko'rinmaydi; taom bo'lmasa karta chizilmaydi).
   (v23 — Panellararo hisob-kitob 1 so'mgacha moslashtirildi (kabinet "jami
   sarflagan" faqat done; buyurtma dublikati tuzatildi; restoran taom jadvali
   proporsional taqsimot; admin karta muhrlangan foizdan). Chegirмa zanjiri
   testlandi. Login/parolni FAQAT admin o'zgartiradi — restoran/kuryer/mijoz
   panellaridan olib tashlandi; admin «Loginlar» bo'limi kartali qilindi va
   ishonchli yuklanadi. To'liq test: server/test (npm test).
   (v22 — Sayt komissiyasi MIJOZGA ko'rinmaydi: ommaviy bootstrap/restaurants
   javobidан komissiya olib tashlandi. Restoran o'z komissiyasini sessiyadан
   (login/me), admin esa /admin/restaurants (autentifikatsiyalangan) orqali
   oladi — panellar buzilmaydi. To'liq E2E test o'tdi (32/32).
   (v21 — Loginsiz (ghost) restoran/kuryer tuzatildi: `restaurants`да bor, lekin
   `accounts`да yo'q bo'lsa (Loginlarда ko'rinmay, Restoranlarда turib qolgan)
   — boot'да akkaunt avtomatik tiklanadi va logда parol ko'rsatiladi. Admin
   «Restoranlar»/«Kuryerlar» endi HAR DOIM backenddan (eski localStorage kesh
   arvohlari tozalandi). Restoran/kuryer yaratish atomar (transaksiya).
   (v20 — Login xatosi tuzatildi: restoran/kuryer loginini o'zgartirsa accounts
   va restaurants/couriers jadvallari birga yangilanadi (ilgari "ikki joyda
   ikki xil" edi); boot'da eski drift yarashtiriladi. Restoran/kuryer o'chirish
   DARHOL bajariladi (localStorage'даги 6 soatlik kechikish olib tashlandi —
   Versal shundan ketmayotgan edi). Admin panelга alohida «Daromad» bo'limi:
   dashboarddagi daromad/grafik/moliya shu yerga ko'chdi, dashboard operativ qoldi.
   (v19 — HAR TAOMGA IZOH ("sous bilan yuboring"): savatда yoziladi, restoran va
   kuryer panelida ajratib ko'rsatiladi. Restoran nomi panelning birinchi
   sahifasida va sayt restoran sahifasida yopishib turadi. Moliya real bo'ldi:
   komissiya foizi buyurtma yaratilganda, kuryer haqi yetkazilganda buyurtmaga
   muhrlanadi; admin panelда xarajat va sof foyda bo'limi.
   (v18 — admin panelда «Loginlar» bo'limi: barcha akkaunt loginini ko'radi va
   istalganiga yangi parol o'rnatadi (bir marta ko'rsatiladi).
   (v17 — hisoblar izolyatsiyasi; admin va restoran e'lonlarni o'chiradi.
   (v16 — telefonда bildirishnoma; shubhali buyurtma FAQAT hajm bo'yicha;
    bitta kuryer bo'lsa hamma buyurtma unga.
   (v15 — taom cheklovi + 3 xil taom, jonli reyting, bot/sayt statistikasi,
    mehmon mijozlar, kuryer daromadi, shikoyatlar; v14 — buyurtma tarkibi rasm
    bilan; v13 — bot FAQAT MIJOZ uchun; v6 — narx serverda + CSP/nonce.) */
const CACHE = 'yetkaz-v26';
const ASSETS = [
  '/index.html', '/admin.html', '/restoran.html', '/kuryer.html', '/kabinet.html',
  '/assets/css/styles.css', '/assets/css/admin.css',
  '/assets/js/safe.js', '/assets/js/hours.js', '/assets/js/order-items.js', '/assets/js/complaint-box.js',
  '/assets/js/store.js', '/assets/js/support.js', '/assets/js/i18n.js', '/assets/js/data.js', '/assets/js/app.js',
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

/* Bildirishnoma bosilganда — panelni ochamiz yoki fokuslamaymiz.
   Telefonда bildirishnoma service worker orqali chiqadi (notify.js), shuning
   uchun bosilganда shu yerда ushlanadi. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      /* Ochiq panel bo'lsa — o'shani fokuslaymiz */
      for (const c of cls) {
        if ('focus' in c) { try { c.focus(); return; } catch (err) {} }
      }
      /* Aks holda yangi oyna — restoran/kuryer paneliga qaytamiz (oxirgi yo'l) */
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Backend so'rovlari va yuklangan rasmlar — har doim tarmoqdan (keshlanmaydi).
  // `/img/` — bazadagi rasmlar; ular `Cache-Control: immutable` bilan keladi,
  // shuning uchun brauzerning O'Z keshi yetarli (SW keshini shishirmaymiz).
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads') || url.pathname.startsWith('/img/')) return;
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
