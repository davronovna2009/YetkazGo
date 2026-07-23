/* ===== JONLI REYTINGLAR — YAGONA manba =====
   Ilgari `restaurants.rating` va `added_dishes.rating` ustunlarida QO'LDA
   yozilgan son turardi: mijozlar baho bersa ham o'zgarmasdi. Endi reyting
   HAR SO'ROVDA haqiqiy izohlardan (reviews jadvali) hisoblanadi.

   - Taom reytingi: shu taom nomiga berilgan baholar o'rtachasi.
   - Restoran reytingi: shu restoranga tegishli barcha baholar o'rtachasi
     (izohdagi `rest` maydoni yoki taom nomi orqali topiladi).
   - Kuryer reytingi: `dish` maydoni "🛵 Kuryer: <ism>" ko'rinishida bo'ladi.

   Baho bo'lmasa 0 qaytadi — panellar buni "—" deb ko'rsatadi (soxta 4.5 emas). */
import { db } from './db.js';

const KURYER_RE = /^🛵\s*Kuryer:\s*/;

function allReviews() {
  try { return db.prepare('SELECT rating, dish, rest FROM reviews').all(); }
  catch (e) { return []; }
}

/* O'rtacha (1 xonali kasr) — baho yo'q bo'lsa 0 */
function avg(list) {
  if (!list.length) return 0;
  const s = list.reduce((a, r) => a + (Number(r.rating) || 0), 0);
  return Math.round((s / list.length) * 10) / 10;
}

/* Taom nomi -> qaysi restoran (added_dishes bo'yicha) */
function dishRestMap() {
  const m = new Map();
  try {
    for (const d of db.prepare('SELECT name, rest FROM added_dishes').all()) {
      if (!m.has(d.name)) m.set(d.name, d.rest);
    }
  } catch (e) { /* jim */ }
  return m;
}

/* Barcha jonli reytinglar bir marta hisoblanadi (bootstrap uchun tejamkor).
   Qaytaradi: { rests: {nom: {rating, count}}, dishes: {...}, couriers: {...} } */
export function liveRatings() {
  const rows = allReviews();
  const dr = dishRestMap();
  const byRest = new Map(), byDish = new Map(), byCour = new Map();

  const push = (map, key, r) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  };

  for (const r of rows) {
    const dish = String(r.dish || '');
    if (KURYER_RE.test(dish)) {                 // kuryer bahosi
      push(byCour, dish.replace(KURYER_RE, '').trim(), r);
      continue;
    }
    push(byDish, dish, r);
    /* Restoran: izohdagi `rest`, bo'lmasa taom katalogidan topamiz */
    push(byRest, String(r.rest || '') || dr.get(dish) || '', r);
  }

  const out = (map) => {
    const o = {};
    for (const [k, list] of map) { if (k) o[k] = { rating: avg(list), count: list.length }; }
    return o;
  };
  return { rests: out(byRest), dishes: out(byDish), couriers: out(byCour) };
}

/* Bitta restoran reytingi (kerak bo'lganda) */
export function restRating(name) {
  const r = liveRatings().rests[String(name || '')];
  return r ? r.rating : 0;
}
