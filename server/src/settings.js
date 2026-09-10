/* ===== Sayt sozlamalari — YAGONA manba =====
   Admin panelida to'ldiriladi, bazada saqlanadi va sayt/bot/mini ilova
   HAMMASI shu yerдан o'qiydi. Kodga raqam yozib qo'yilmaydi — admin bir joyda
   o'zgartirsa, hamma joyda o'zgaradi.

   Hozircha:
     owner_phone — sayt egasining raqami. Mijoz taomga qo'yilgan miqdor
                   cheklovidan oshsa, "shu raqamga qo'ng'iroq qiling" deb
                   AYNAN shu raqam ko'rsatiladi (pricing.js). */
import { db } from './db.js';

/* Ruxsat etilgan kalitlar — begona kalit bazani ifloslantirmasin.
   support_*    — «Yordam / murojaat» kontaktlari: mijoz, restoran, kuryer
                  panellarida va bosh sahifada ko'rsatiladi (admin yozib qo'yadi).
   support_*_on — admin har bir kontaktni ALOHIDA yoqib/o'chiradi ("1"/"0").
                  Masalan telefonni ishlatmasa — o'chiradi, faqat username qoladi.
   pay_*_on / pay_extra — to'lov turlari (admin kartani o'chirsa — hamma joyда
                  kartadan to'lov o'chadi). */
export const KEYS = [
  'owner_phone', 'owner_name',
  'support_phone', 'support_username', 'support_link', 'support_note',
  'support_phone_on', 'support_username_on', 'support_link_on',
  'pay_cash_on', 'pay_card_on', 'pay_extra',
  /* ===== REYTING (yulduzcha) sozlamalari — admin boshqaradi =====
     dish_rating_src : taom yulduzchasi nimadan — 'sales' (sotuv soni),
                       'reviews' (mijoz baholari), 'blend' (3+ baho bo'lsa baho,
                       aks holda sotuv). Standart: 'sales'.
     dish_star_tN    : N-yulduz uchun kerakli SOTUV soni (done buyurtmalardan).
                       Standart: 1★=5, 2★=15, 3★=30, 4★=60, 5★=100. */
  'dish_rating_src',
  'dish_star_t1', 'dish_star_t2', 'dish_star_t3', 'dish_star_t4', 'dish_star_t5',
];

/* Taom yulduzcha bosqichlari — [t1..t5] o'suvchi butun sonlar (admin sozlamasi) */
export function dishStarThresholds() {
  const def = [5, 15, 30, 60, 100];
  const out = def.map((d, i) => {
    const v = parseInt(getSetting('dish_star_t' + (i + 1), ''), 10);
    return Number.isFinite(v) && v > 0 ? v : d;
  });
  /* O'suvchi bo'lsin — buzuq kiritilса ham grafik/yulduzcha adashmasin */
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out;
}
export function dishRatingSrc() {
  const v = String(getSetting('dish_rating_src', 'sales')).toLowerCase();
  return ['sales', 'reviews', 'blend'].includes(v) ? v : 'sales';
}
/* Sotuv soni -> 0..5 yulduz (admin bosqichlari bo'yicha) */
export function starsForSales(sold, thr) {
  const t = thr || dishStarThresholds();
  const n = Math.max(0, Number(sold) || 0);
  let s = 0;
  for (let i = 0; i < t.length; i++) if (n >= t[i]) s = i + 1;
  return s;
}

/* Boolean sozlama: bo'sh yoki "1"/"true"/"on" -> true. Standart (yozilmagan) -> `def`. */
export function getBool(key, def = true) {
  const raw = getSetting(key, '');
  if (raw === '') return def;
  return raw === '1' || raw === 'true' || raw === 'on';
}

export function getSetting(key, def = '') {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return r && r.value != null && r.value !== '' ? r.value : def;
  } catch (e) { return def; }
}

export function setSetting(key, value) {
  const k = String(key);
  if (!KEYS.includes(k)) return false;
  /* pay_extra — JSON massiv (10 tagacha to'lov turi), uzunroq bo'lishi mumkin */
  const max = k === 'pay_extra' ? 4000 : 200;
  try {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(k, String(value == null ? '' : value).slice(0, max));
    return true;
  } catch (e) { return false; }
}

/* Custom to'lov turlari — [{id, label, note}] JSON massiv sifatida saqlanadi */
function payExtra() {
  try {
    const v = JSON.parse(getSetting('pay_extra', '[]'));
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && x.label)
      .slice(0, 10)
      .map((x, i) => ({
        id: String(x.id || ('extra' + i)).slice(0, 30),
        label: String(x.label).slice(0, 40),
        note: String(x.note || '').slice(0, 200),
      }));
  } catch (e) { return []; }
}

/* Ommaviy sozlamalar (mijozga ham ko'rinadi) */
export function publicSettings() {
  /* support_*_on — kontakt YOZILGAN bo'lsagina ta'sirli; bo'sh bo'lsa baribir ko'rinmaydi */
  const sp = getSetting('support_phone', ''), su = getSetting('support_username', ''), sl = getSetting('support_link', '');
  return {
    ownerPhone: getSetting('owner_phone', ''),
    ownerName: getSetting('owner_name', ''),
    supportPhone: sp,
    supportUsername: su,
    supportLink: sl,
    supportNote: getSetting('support_note', ''),
    /* Har bir kontakt YOQILGANMI (admin o'chirgan bo'lsa — false) */
    supportPhoneOn: !!sp && getBool('support_phone_on', true),
    supportUsernameOn: !!su && getBool('support_username_on', true),
    supportLinkOn: !!sl && getBool('support_link_on', true),
    /* ===== TO'LOV TURLARI ===== */
    payCashOn: getBool('pay_cash_on', true),
    payCardOn: getBool('pay_card_on', true),
    payExtra: payExtra(),
    /* ===== REYTING ===== sayt/panellar yulduzcha bosqichini shundan biladi */
    dishRatingSrc: dishRatingSrc(),
    dishStarThresholds: dishStarThresholds(),
  };
}

/* To'lov turi ID si HOZIR ruxsat etilganmi? (server buyurtмa yaratishда tekshiradi) */
export function payMethodAllowed(id) {
  const m = String(id || '').toLowerCase();
  if (m === 'card' || m === 'karta') return getBool('pay_card_on', true);
  if (m === 'cash' || m === 'naqd') return getBool('pay_cash_on', true);
  return payExtra().some((x) => x.id === id);
}
