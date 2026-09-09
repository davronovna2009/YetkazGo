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
];

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
  };
}

/* To'lov turi ID si HOZIR ruxsat etilganmi? (server buyurtмa yaratishда tekshiradi) */
export function payMethodAllowed(id) {
  const m = String(id || '').toLowerCase();
  if (m === 'card' || m === 'karta') return getBool('pay_card_on', true);
  if (m === 'cash' || m === 'naqd') return getBool('pay_cash_on', true);
  return payExtra().some((x) => x.id === id);
}
