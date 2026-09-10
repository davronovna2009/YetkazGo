/* ===== JONLI REYTINGLAR — YAGONA manba =====
   Hech qayerda "qotib qolgan" yoki qo'lda yozilgan yulduzcha yo'q:

   - TAOM (mahsulot) yulduzchasi: SOTUV soniga qarab (admin bosqichlari) —
     ko'p sotilgan taom ko'proq yulduz oladi. Sotuv = FAQAT yetkazilgan
     (status='done') buyurtmalar tarkibidan (items_json) dona bilan sanaladi.
     Admin `dish_rating_src` = 'reviews' qilsa — mijoz baholari o'rtachasi;
     'blend' qilsa — 3+ baho bo'lsa baho, aks holda sotuv.
   - RESTORAN yulduzchasi: shu restoranga tegishli mijoz baholari o'rtachasi
     (haqiqiy izohlar; baho yo'q bo'lsa 0 -> panel "—" ko'rsatadi).
   - KURYER yulduzchasi: `dish` maydoni "🛵 Kuryer: <ism>" bo'lgan baholar
     o'rtachasi.

   Soxta 4.5/4.8 YO'Q — baho/sotuv bo'lmasa 0 qaytadi. */
import { db } from './db.js';
import { dishStarThresholds, dishRatingSrc, starsForSales } from './settings.js';

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

/* ===== REAL SOTUV — yetkazilgan buyurtmalar tarkibidan (dona bilan) =====
   items_json: [{id,name,emoji,qty,...}]. Buyurtma yorlig'i ("Osh +2 ta") emas,
   HAR QATOR o'z dona soni bilan sanaladi. Qaytaradi: Map<taom nomi, dona>. */
export function dishSales() {
  const m = new Map();
  let rows = [];
  try {
    rows = db.prepare("SELECT items_json, item FROM orders WHERE status = 'done'").all();
  } catch (e) { return m; }
  for (const r of rows) {
    let lines = [];
    try { lines = JSON.parse(r.items_json || '[]'); } catch (e) { lines = []; }
    if (Array.isArray(lines) && lines.length) {
      for (const l of lines) {
        const name = String((l && l.name) || '').trim();
        if (!name) continue;
        const qty = Math.max(0, Number(l && l.qty) || 0) || 1;
        m.set(name, (m.get(name) || 0) + qty);
      }
    }
  }
  return m;
}

/* Barcha jonli reytinglar bir marta hisoblanadi (bootstrap uchun tejamkor).
   Qaytaradi: { rests:{nom:{rating,count}}, dishes:{nom:{rating,count,sold}}, couriers:{...} } */
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

  const outAvg = (map) => {
    const o = {};
    for (const [k, list] of map) { if (k) o[k] = { rating: avg(list), count: list.length }; }
    return o;
  };

  /* ===== TAOM yulduzchasi ===== */
  const src = dishRatingSrc();
  const thr = dishStarThresholds();
  const sales = dishSales();
  const dishes = {};
  /* Barcha nomlar: sotilganlar + baho olganlar */
  const names = new Set([...sales.keys(), ...byDish.keys()]);
  for (const name of names) {
    if (!name) continue;
    const sold = sales.get(name) || 0;
    const revs = byDish.get(name) || [];
    const revAvg = avg(revs);
    let rating;
    if (src === 'reviews') rating = revAvg;
    else if (src === 'blend') rating = revs.length >= 3 ? revAvg : starsForSales(sold, thr);
    else rating = starsForSales(sold, thr);        // 'sales' (standart)
    dishes[name] = { rating, count: revs.length, sold, reviewAvg: revAvg };
  }

  return { rests: outAvg(byRest), dishes, couriers: outAvg(byCour) };
}

/* Bitta restoran reytingi (kerak bo'lganda) */
export function restRating(name) {
  const r = liveRatings().rests[String(name || '')];
  return r ? r.rating : 0;
}
