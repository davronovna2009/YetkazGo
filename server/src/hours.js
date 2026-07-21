/* ===== Yetkaz.uz — VAQT bo'yicha YAGONA manba (server) =====

   Server Render'да UTC bilan ishlaydi, mijoz telefoni esa o'z mintaqasida.
   Shuning uchun "restoran hozir ochiqmi" degan savolga HAR DOIM shu modul
   javob beradi va u vaqtni **Asia/Tashkent (UTC+5)** bo'yicha hisoblaydi.

   Frontend nusxasi: `assets/js/hours.js` — mantiq AYNAN bir xil bo'lishi shart
   (biri o'zgarsa — ikkinchisi ham). Frontend faqat ko'rsatadi, RAD ETISH
   qarori esa shu yerда (pricing.js orqali) qabul qilinadi. */

export const TZ = 'Asia/Tashkent';

let FMT = null;
try {
  FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
} catch (e) { FMT = null; }

const pad = (n) => String(n).padStart(2, '0');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);

/* Paytni Toshkent vaqtiga ajratadi */
export function parts(date) {
  let d = date instanceof Date ? date : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  if (FMT) {
    try {
      const o = {};
      for (const p of FMT.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
      return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute };
    } catch (e) { /* zaxira */ }
  }
  /* O'zbekistonда yozgi vaqt yo'q — doim UTC+5 */
  const t = new Date(d.getTime() + 5 * 3600000);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

/* Hozir Toshkentда soat nechada (0–23) */
export function tashHour() { return parts().h; }

/* Hozir Toshkentда "HH:MM" */
export function tashClock() { const p = parts(); return `${pad(p.h)}:${pad(p.mi)}`; }

/* open/close ni xavfsiz oraliqqa keltiradi (0–23 / 1–24) */
export function normalizeHours(openH, closeH, defOpen = 9, defClose = 23) {
  let o = Math.max(0, Math.min(23, int(openH, defOpen)));
  let c = Math.max(0, Math.min(24, int(closeH, defClose)));
  if (c === 0) c = 24;                 // "00:00 да yopiladi" = 24:00
  return { o, c };
}

/* Ish vaqti hozir ochiqmi:
     closeH > openH   → oddiy kun (09–23)
     closeH <= openH  → tungi smena (20–02)
     closeH === openH → 24 soat */
export function isOpenNow(openH, closeH, defOpen = 9, defClose = 23) {
  const { o, c } = normalizeHours(openH, closeH, defOpen, defClose);
  if (o === c) return true;
  const h = tashHour();
  if (c > o) return h >= o && h < c;
  return h >= o || h < c;
}

/* "09:00–23:00" / "24 soat" */
export function hoursText(openH, closeH, defOpen = 9, defClose = 23) {
  const { o, c } = normalizeHours(openH, closeH, defOpen, defClose);
  if (o === c) return '24 soat';
  return `${pad(o)}:00–${pad(c)}:00`;
}

/* --- Qulay qobiqlar: baza qatorlari (restaurants / couriers) --- */
export const restIsOpen = (row) => isOpenNow(row?.open_h, row?.close_h, 9, 23);
export const restHoursText = (row) => hoursText(row?.open_h, row?.close_h, 9, 23);
export const courierIsOpen = (row) => isOpenNow(row?.open_h, row?.close_h, 8, 22);
export const courierHoursText = (row) => hoursText(row?.open_h, row?.close_h, 8, 22);
