/* ===== Yetkaz.uz — "AI maslahat" (buyurtma odati aniqlash) =====
   Haqiqiy AI/ML EMAS — mijozning telefon raqami bo'yicha butun buyurtma
   tarixini (orders.items_json) tahlil qilib, "har doim shu taomni, shu
   payt atrofida buyurtma qiladi" degan ODATNI qidiradigan oddiy statistik
   qoida. Toshkent vaqti bo'yicha ishlaydi (hours.js — sayt bilan YAGONA
   manba), bugun allaqachon shu taom buyurilgan bo'lsa taklif qilinmaydi. */
import { db } from './db.js';
import { parts } from './hours.js';
import { parseItems, prettyPhone } from './orders-core.js';

/* SQLite created_at (UTC 'YYYY-MM-DD HH:MM:SS') → ms — orders-core.js dagi
   stampUtc bilan AYNAN bir xil formula. */
function stampUtc(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

const MIN_DAYS = 3;          /* kamida shuncha ALOHIDA kunda takrorlansa — "odat" */
const HOUR_WINDOW = 2;       /* hozirgi soat odat soatidan shuncha soatgacha farq qilsa taklif qilinadi */
const LOOKBACK_DAYS = 45;    /* shundan uzoqroq eski buyurtmalar hisobga olinmaydi */

/* Bitta buyurtmadagi HAR BIR (takrorlanmas) taom — {key,name,emoji} */
function dishesOf(order) {
  const lines = parseItems(order.items_json);
  if (!lines.length) return [];
  const seen = new Set(), out = [];
  for (const l of lines) {
    if (!l || !l.name) continue;
    const key = order.rest + '|' + l.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: l.name, emoji: l.emoji || '🍽️' });
  }
  return out;
}

/* Shu telefon uchun hozir taklif qilsa bo'ladigan "odat" taomni topadi.
   Topilmasa (yoki hali vaqti bo'lmasa / bugun allaqachon olingan) — null. */
/* `at` — ixtiyoriy: "hozir" sifatida hisoblanadigan Date (test uchun; berilmasa
   haqiqiy hozirgi vaqt). Production kodi buni hech qachon bermaydi. */
export function detectHabit(phone, at) {
  const p = prettyPhone(phone);
  if (!p) return null;
  let rows;
  try {
    rows = db.prepare(
      `SELECT rest, items_json, created_at FROM orders
       WHERE phone = ? AND status <> 'cancelled' AND created_at IS NOT NULL
       ORDER BY created_at ASC`
    ).all(p);
  } catch (e) { return null; }
  if (!rows.length) return null;

  const now = (at instanceof Date ? at : new Date()).getTime();
  const cutoff = now - LOOKBACK_DAYS * 86400000;
  const today = parts(new Date(now));
  const todayKey = `${today.y}-${today.mo}-${today.d}`;
  const nowH = today.h + today.mi / 60;

  /* dishKey -> { rest, name, emoji, days:Set<"y-mo-d">, hours:number[], todayYet:boolean } */
  const map = new Map();
  for (const r of rows) {
    const ms = stampUtc(r.created_at);
    if (!ms || ms < cutoff) continue;
    const pt = parts(new Date(ms));
    const dayKey = `${pt.y}-${pt.mo}-${pt.d}`;
    for (const d of dishesOf(r)) {
      let e = map.get(d.key);
      if (!e) { e = { rest: r.rest, name: d.name, emoji: d.emoji, days: new Set(), hours: [], todayYet: false }; map.set(d.key, e); }
      if (!e.days.has(dayKey)) { e.days.add(dayKey); e.hours.push(pt.h + pt.mi / 60); }
      if (dayKey === todayKey) e.todayYet = true;
    }
  }

  let best = null;
  for (const e of map.values()) {
    if (e.todayYet) continue;                 /* bugun allaqachon olgan */
    if (e.days.size < MIN_DAYS) continue;      /* hali "odat" darajasida emas */
    const avg = e.hours.reduce((s, h) => s + h, 0) / e.hours.length;
    const spread = Math.max(...e.hours) - Math.min(...e.hours);
    if (spread > HOUR_WINDOW * 2) continue;    /* soatlari barqaror emas */
    if (Math.abs(nowH - avg) > HOUR_WINDOW) continue; /* hali vaqti emas / o'tib ketgan */
    if (!best || e.days.size > best.days.size) best = e;
  }
  if (!best) return null;
  const avgH = Math.round(best.hours.reduce((s, h) => s + h, 0) / best.hours.length);
  return { rest: best.rest, name: best.name, emoji: best.emoji, days: best.days.size, hour: avgH };
}
