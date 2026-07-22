/* ===== Telefon raqami cheklovlari — SAYT O'ZI, AVTOMATIK qo'llaydi =====
   Hech kim tugma bosmaydi: qoida buzilgan zahoti server o'zi cheklaydi va
   bloklaydi. Admin faqat KEYIN ko'radi va xohlasa blokni ochadi.

   1-QOIDA — buyurtmani ketma-ket bekor qilish:
     1-bekor  → hech narsa (faqat yoziladi)
     2-bekor  → OGOHLANTIRISH + 5 daqiqaga buyurtma berish cheklanadi
     3-bekor  → raqam AVTOMATIK BLOKLANADI

   2-QOIDA — spam buyurtma (soxta buyurtma yog'diruvi):
     10 daqiqa ichida 6 ta buyurtma → raqam AVTOMATIK BLOKLANADI

   Muvaffaqiyatli yakunlangan (done) buyurtma bekor qilish hisobini NOLGA
   qaytaradi — bir marta adashib bekor qilgan mijoz abadiy "jazoda" qolmaydi. */
import { db } from './db.js';

/* Telefon yordamchilari shu yerда takrorlangan (orders-core.js dagi bilan bir xil):
   orders-core.js bu modulni import qiladi — teskari import halqa hosil qilardi. */
function normalizePhone(p) { return String(p == null ? '' : p).replace(/\D/g, ''); }
function prettyPhone(p) {
  const d = normalizePhone(p);
  if (!/^998\d{9}$/.test(d)) return String(p || '');
  return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

/* 1-qoida: bekor qilish */
export const PAUSE_MIN = 5;
export const WARN_AT = 2;    // shu bekorда ogohlantirish + pauza
export const BLOCK_AT = 3;   // shu bekorда butunlay bloklash

/* 2-qoida: spam buyurtma — shuncha daqiqada shuncha buyurtma = blok */
export const SPAM_WINDOW_MIN = 10;
export const SPAM_MAX = 6;

/* Avtomatik blok bo'lganда adminlarga xabar berish uchun ilgak.
   To'g'ridan-to'g'ri bot.js ni import qilmaymiz: bot.js → orders-core.js →
   blocks.js zanjiri bor, teskari import halqa hosil qilardi. app.js ulaydi. */
let onAutoBlock = null;
export function setAutoBlockNotifier(fn) { onAutoBlock = typeof fn === 'function' ? fn : null; }
function fireAutoBlock(phone, name, reason) {
  if (!onAutoBlock) return;
  try { onAutoBlock(prettyPhone(phone), name, reason); }
  catch (e) { console.warn('[BLOCK] xabar yuborilmadi:', e.message); }
}

const row = (phone) => {
  try { return db.prepare('SELECT * FROM phone_blocks WHERE phone = ?').get(phone) || null; }
  catch (e) { return null; }
};

/* Cheklov tugash paytigacha necha soniya qolganini qaytaradi (0 = cheklov yo'q) */
function secondsLeft(until) {
  if (!until) return 0;
  const t = Date.parse(String(until).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

/* Buyurtma berishga ruxsat bormi?
   Qaytaradi: { ok:true } yoki { ok:false, blocked, seconds, message } */
export function phoneStatus(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { ok: true };
  const r = row(phone);
  if (!r) return { ok: true };

  if (r.blocked) {
    return {
      ok: false, blocked: true, seconds: 0,
      message: 'Bu telefon raqami buyurtmalarni qayta-qayta bekor qilgani uchun '
             + 'BLOKLANGAN. Blokni faqat administrator ochadi.',
    };
  }
  const left = secondsLeft(r.until);
  if (left > 0) {
    const min = Math.ceil(left / 60);
    return {
      ok: false, blocked: false, seconds: left,
      message: `Siz buyurtmani ko'p marta bekor qildingiz. Yana ${min} daqiqadan `
             + 'keyin buyurtma bera olasiz. Keyingi bekor qilishda raqamingiz bloklanadi.',
    };
  }
  return { ok: true };
}

/* ===== 2-QOIDA: spam buyurtma =====
   Bitta raqamdan qisqa vaqtда juda ko'p buyurtma — bu odatiy mijoz emas.
   Sayt O'ZI bloklaydi (createOrder shu funksiyani chaqiradi).
   Qaytaradi: null (hammasi joyida) yoki { message } (bloklandi). */
export function checkSpam(phoneRaw, userName) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const pretty = prettyPhone(phone);

  let cnt = 0;
  try {
    /* Admin blokni ochgan bo'lsa — O'SHA PAYTGACHA bo'lgan buyurtmalar
       hisobga OLINMAYDI. Aks holda oyna ichidagi eski buyurtmalar mijozni
       darhol qayta bloklab, adminning blokni ochgani foydasiz bo'lardi. */
    const prev = row(phone);
    const since = (prev && prev.unblocked_at) || '';

    /* Buyurtmalarда telefon "chiroyli" ko'rinishда saqlanadi (orders-core.js) */
    const r = db.prepare(
      `SELECT COUNT(*) AS n FROM orders
        WHERE phone = ?
          AND created_at > datetime('now', '-${SPAM_WINDOW_MIN} minutes')
          AND (? = '' OR created_at > ?)`
    ).get(pretty, since, since);
    cnt = (r && r.n) || 0;
  } catch (e) { return null; }

  if (cnt < SPAM_MAX) return null;

  autoBlock(phone, userName, `${SPAM_WINDOW_MIN} daqiqada ${cnt} ta buyurtma (spam)`);
  return {
    message: `Bu raqamdan juda ko'p buyurtma yuborildi (${SPAM_WINDOW_MIN} daqiqada ${cnt} ta). `
           + 'Raqam avtomatik bloklandi. Blokni administrator ochadi.',
  };
}

/* Sayt O'ZI bloklaydi (source = 'auto') — hamma avtomatik qoidalar shuni chaqiradi */
function autoBlock(phone, userName, reason) {
  try {
    db.prepare(
      `INSERT INTO phone_blocks (phone, pretty, cancels, blocked, until, last_name, reason, source, last_cancel)
       VALUES (?,?,?,1,'',?,?,'auto',datetime('now'))
       ON CONFLICT(phone) DO UPDATE SET
         blocked = 1, until = '', reason = excluded.reason, source = 'auto',
         last_name = excluded.last_name, last_cancel = datetime('now')`
    ).run(phone, prettyPhone(phone), BLOCK_AT, String(userName || ''), String(reason || ''));
    console.log(`[BLOCK] AVTOMATIK: ${prettyPhone(phone)} bloklandi — ${reason}`);
    fireAutoBlock(phone, userName, reason);
  } catch (e) {
    console.warn('[BLOCK] avtomatik bloklab bo`lmadi:', e.message);
  }
}

/* Mijoz buyurtmani bekor qildi — hisobni oshiramiz va oqibatini qaytaramiz.
   Qaytaradi: { cancels, blocked, pausedSeconds, level, message } */
export function registerCancel(phoneRaw, userName) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { cancels: 0, blocked: false, pausedSeconds: 0, level: 0, message: '' };

  const r = row(phone);
  const cancels = (r ? r.cancels : 0) + 1;
  const blocked = cancels >= BLOCK_AT ? 1 : 0;
  /* 2-bekorда 5 daqiqalik pauza; bloklanganда pauza kerak emas */
  const pause = (!blocked && cancels >= WARN_AT) ? PAUSE_MIN : 0;

  const untilSql = pause ? `datetime('now', '+${pause} minutes')` : `''`;
  try {
    db.prepare(
      `INSERT INTO phone_blocks (phone, pretty, cancels, blocked, until, last_name, reason, source, last_cancel)
       VALUES (?,?,?,?,${untilSql},?,?,'auto',datetime('now'))
       ON CONFLICT(phone) DO UPDATE SET
         cancels = excluded.cancels,
         blocked = excluded.blocked,
         until   = excluded.until,
         pretty  = excluded.pretty,
         last_name = excluded.last_name,
         reason  = excluded.reason,
         source  = 'auto',
         last_cancel = datetime('now')`
    ).run(
      phone, prettyPhone(phone), cancels, blocked,
      String(userName || (r && r.last_name) || ''),
      blocked ? `${cancels} marta buyurtma bekor qilingan` : ''
    );
  } catch (e) {
    console.warn('[BLOCK] yozib bo`lmadi:', e.message);
  }

  if (blocked) {
    const why = `${cancels} marta buyurtma bekor qilingan`;
    console.log(`[BLOCK] AVTOMATIK: ${prettyPhone(phone)} bloklandi — ${why}`);
    fireAutoBlock(phone, userName, why);
    return {
      cancels, blocked: true, pausedSeconds: 0, level: 3,
      message: '⛔ Raqamingiz BLOKLANDI. Siz buyurtmalarni qayta-qayta bekor qildingiz. '
             + 'Blokni faqat administrator ochadi.',
    };
  }
  if (pause) {
    return {
      cancels, blocked: false, pausedSeconds: PAUSE_MIN * 60, level: 2,
      message: `⚠️ Ogohlantirish! Siz ${cancels} marta buyurtma bekor qildingiz. `
             + `${PAUSE_MIN} daqiqa davomida buyurtma bera olmaysiz. `
             + 'Yana bir marta bekor qilsangiz — raqamingiz bloklanadi.',
    };
  }
  return {
    cancels, blocked: false, pausedSeconds: 0, level: 1,
    message: 'Buyurtma bekor qilindi. Eslatma: buyurtmani qayta-qayta bekor qilsangiz, '
           + 'raqamingiz vaqtincha cheklanadi.',
  };
}

/* Buyurtma muvaffaqiyatli yakunlandi (done) — hisobni tozalaymiz.
   Bloklangan raqamga TEGMAYDI (uni faqat admin ochadi). */
export function clearOnSuccess(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return;
  try {
    db.prepare("UPDATE phone_blocks SET cancels = 0, until = '' WHERE phone = ? AND blocked = 0").run(phone);
  } catch (e) { /* jim */ }
}

/* ===== Admin uchun ===== */
export function listBlocks() {
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT * FROM phone_blocks
        WHERE blocked = 1 OR cancels > 0
        ORDER BY blocked DESC, last_cancel DESC`
    ).all();
  } catch (e) { return []; }
  return rows.map((r) => ({
    phone: r.phone,
    pretty: r.pretty || prettyPhone(r.phone),
    cancels: r.cancels || 0,
    blocked: !!r.blocked,
    pausedSeconds: r.blocked ? 0 : secondsLeft(r.until),
    name: r.last_name || '',
    reason: r.reason || '',
    /* 'auto' — saytning o'zi bloklagan, 'admin' — administrator qo'lда */
    source: r.source || 'auto',
    lastCancel: r.last_cancel || '',
  }));
}

/* Admin blokni ochadi — hisob ham nolga tushadi (mijoz toza boshlaydi).
   MUHIM: hisob nolga tushmasa, mijoz bitta bekor qilishда darrov qayta
   bloklanardi va admin blokni ochgani foydasiz bo'lardi. */
export function unblockPhone(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  try {
    /* unblocked_at — "toza varaq" payti: spam qoidasi shundan OLDINGI
       buyurtmalarni sanamaydi (aks holda mijoz darrov qayta bloklanardi). */
    db.prepare(
      `UPDATE phone_blocks
          SET blocked = 0, cancels = 0, until = '', reason = '',
              unblocked_at = datetime('now')
        WHERE phone = ?`
    ).run(phone);
    return true;
  } catch (e) { return false; }
}

/* Admin qo'lda bloklaydi (source = 'admin' — ro'yxatda shunday ko'rinadi) */
export function blockPhone(phoneRaw, reason) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  try {
    db.prepare(
      `INSERT INTO phone_blocks (phone, pretty, cancels, blocked, reason, source, last_cancel)
       VALUES (?,?,?,1,?,'admin',datetime('now'))
       ON CONFLICT(phone) DO UPDATE SET blocked = 1, reason = excluded.reason,
         source = 'admin', last_cancel = datetime('now')`
    ).run(phone, prettyPhone(phone), BLOCK_AT, String(reason || 'Admin tomonidan bloklandi'));
    return true;
  } catch (e) { return false; }
}

/* Ro'yxatdan butunlay o'chirish (tarixni tozalash) */
export function forgetPhone(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return false;
  try { db.prepare('DELETE FROM phone_blocks WHERE phone = ?').run(phone); return true; }
  catch (e) { return false; }
}
