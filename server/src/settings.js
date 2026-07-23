/* ===== Sayt sozlamalari — YAGONA manba =====
   Admin panelida to'ldiriladi, bazada saqlanadi va sayt/bot/mini ilova
   HAMMASI shu yerдан o'qiydi. Kodga raqam yozib qo'yilmaydi — admin bir joyda
   o'zgartirsa, hamma joyda o'zgaradi.

   Hozircha:
     owner_phone — sayt egasining raqami. Mijoz taomga qo'yilgan miqdor
                   cheklovidan oshsa, "shu raqamga qo'ng'iroq qiling" deb
                   AYNAN shu raqam ko'rsatiladi (pricing.js). */
import { db } from './db.js';

/* Ruxsat etilgan kalitlar — begona kalit bazani ifloslantirmasin */
export const KEYS = ['owner_phone', 'owner_name'];

export function getSetting(key, def = '') {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(String(key));
    return r && r.value != null && r.value !== '' ? r.value : def;
  } catch (e) { return def; }
}

export function setSetting(key, value) {
  if (!KEYS.includes(String(key))) return false;
  try {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run(String(key), String(value == null ? '' : value).slice(0, 200));
    return true;
  } catch (e) { return false; }
}

/* Ommaviy sozlamalar (mijozga ham ko'rinadi) */
export function publicSettings() {
  return {
    ownerPhone: getSetting('owner_phone', ''),
    ownerName: getSetting('owner_name', ''),
  };
}
