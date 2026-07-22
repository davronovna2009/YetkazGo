/* ===== Buyurtma yaratishning YAGONA manbasi =====
   Saytdan (POST /api/orders) ham, Telegram botdan ham AYNAN shu funksiya
   chaqiriladi. Logika ikki joyда takrorlanmasin — aks holda biri tuzatilib,
   ikkinchisi eskirib qoladi (narx, kuryer biriktirish, telefon tekshiruvi). */
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { priceOrder, PriceError } from './pricing.js';
import { courierIsOpen } from './hours.js';
import { phoneStatus, checkSpam } from './blocks.js';

/* --- Telefon: O'zbekiston (+998 va 9 ta raqam) --- */
const UZ_OPERATORS = ['20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'];
export function normalizePhone(p) {
  return String(p == null ? '' : p).replace(/\D/g, '');
}
export function validPhone(p) {
  const d = normalizePhone(p);
  if (!/^998\d{9}$/.test(d)) return false;
  return UZ_OPERATORS.includes(d.slice(3, 5));
}
export function prettyPhone(p) {
  const d = normalizePhone(p);
  if (!/^998\d{9}$/.test(d)) return String(p || '');
  return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

/* Buyurtma tarkibi (server narxlagan qatorlar). Eski buyurtmalarда bo'sh bo'lishi mumkin. */
export function parseItems(s) {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/* Tashqariga token CHIQMAYDI (sabotaj himoyasi) — faqat yaratuvchiga qaytadi */
export function rowToOrder(r) {
  return {
    id: r.id, user: r.user, phone: r.phone || '', rest: r.rest, item: r.item, emoji: r.emoji,
    amount: r.amount, addr: r.addr, pay: r.pay, courier: r.courier,
    status: r.status, eta: r.eta, time: r.time, reason: r.reason || '', delivery: r.delivery || 0,
    paid: r.paid ? 1 : 0, paid_at: r.paid_at || '',
    items: parseItems(r.items_json),
    created_at: r.created_at, done_at: r.done_at || '',
  };
}

/* Restoranga eng mos (eng kam yuklangan) faol kuryerni tanlash.

   ISH VAQTI: kuryer paneli "ish vaqtingizdan tashqarida buyurtmalar sizga
   tushmaydi" deb yozadi — shuning uchun avval AYNAN hozir ish vaqtida bo'lgan
   kuryerlar orasidan tanlaymiz (hours.js, Asia/Tashkent). Bunday kuryer
   topilmasa — buyurtma egasiz qolmasligi uchun oddiy tartibga qaytamiz. */
export function assignCourier(rest) {
  const all = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return []; } };
  /* Faol (hali yetkazilmagan) buyurtmalar — buyurtma tasdiqsiz to'g'ridan kuryerga
     borgani uchun 'new'/'accepted' ham yukni hisoblashda inobatga olinadi. */
  const ACTIVE = "('new','accepted','ready','ontheway')";
  const LOAD = `(SELECT COUNT(*) FROM orders o WHERE o.courier = c.name AND o.status IN ${ACTIVE})`;

  /* Avval shu restoranning kuryerlari, keyin qolgan hammasi — ikkalasi ham
     yuk bo'yicha saralangan. Ish vaqti tekshiruvi JS tomonda (mintaqa uchun). */
  const mine = all(
    `SELECT c.name, c.open_h, c.close_h FROM couriers c
      WHERE c.rest = ? AND c.active = 1 AND c.on_leave = 0 ORDER BY ${LOAD} ASC, RANDOM()`,
    String(rest || '')
  );
  const others = all(
    `SELECT c.name, c.open_h, c.close_h FROM couriers c
      WHERE c.active = 1 AND c.on_leave = 0 ORDER BY ${LOAD} ASC, RANDOM()`
  );

  for (const list of [mine, others]) {
    const onShift = list.find(courierIsOpen);
    if (onShift) return onShift.name;
  }
  /* Hech kim ish vaqtida emas — baribir kimgadir biriktiramiz (buyurtma yo'qolmasin) */
  const any = mine[0] || others[0];
  return any ? any.name : '';
}

/* Chaqiruvchiga tushunarli xato — HTTP status bilan birga */
export class OrderError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}

/* Buyurtma yaratadi.

   XAVFSIZLIK: narx MIJOZDAN OLINMAYDI. Mijoz faqat `items: [{id, qty}]` yuboradi,
   summa server tomonда bazadagi haqiqiy narx/chegirma bo'yicha hisoblanadi
   (pricing.js). Mijozning `amount`, `status`, `rest`, `item`, `emoji` maydonlari
   ataylab E'TIBORSIZ qoldiriladi.

   b.tgChatId — Telegram botdan kelgan buyurtmada mijozning chat_id'si.
   Shu orqali unga holat o'zgarishi haqida xabar yuboriladi.

   Qaytaradi: { order, token, lines } — token FAQAT shu yerда beriladi. */
export function createOrder(b = {}) {
  if (!validPhone(b.phone)) {
    throw new OrderError('Telefon raqamini to`g`ri kiriting: +998 XX XXX XX XX', 400);
  }
  const phone = prettyPhone(b.phone);

  /* ===== AVTOMATIK CHEKLOVLAR (blocks.js) — sayt o'zi qo'llaydi =====
     1) Raqam allaqachon bloklangan yoki 5 daqiqalik pauzadami?
        429 — "juda ko'p urinish", 403 — bloklangan raqam.
     2) Spam: qisqa vaqtда juda ko'p buyurtma → raqam SHU YERДА bloklanadi. */
  const st = phoneStatus(phone);
  if (!st.ok) throw new OrderError(st.message, st.blocked ? 403 : 429);

  const spam = checkSpam(phone, b.user);
  if (spam) throw new OrderError(spam.message, 403);

  let priced;
  try {
    priced = priceOrder(b.items);
  } catch (e) {
    if (e instanceof PriceError) throw new OrderError(e.message, e.status);
    console.error('Narxlash xatosi:', e);
    throw new OrderError('Buyurtmani hisoblab bo`lmadi', 500);
  }

  /* Sabotajga qarshi maxfiy "track token" — mehmon shu token bilan buyurtmasini
     bekor qila/qabul qila oladi. Token faqat shu javobda qaytadi. */
  const token = randomBytes(16).toString('hex');
  const courier = assignCourier(priced.rest) || String(b.courier || '');
  /* eta — mijoz beradi, lekin aqlli oraliqqa qisamiz (0 bo'lsa frontendда NaN chiqadi) */
  const eta = Math.max(5, Math.min(120, Number(b.eta) || 15));
  const tgChatId = b.tgChatId ? String(b.tgChatId) : '';

  const info = db.prepare(
    `INSERT INTO orders (user, phone, rest, item, emoji, amount, addr, pay, courier, status, eta, time, token, delivery, items_json, tg_chat_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    String(b.user || ''), phone, priced.rest, priced.item, priced.emoji,
    priced.amount, String(b.addr || ''), String(b.pay || 'card'),
    courier, 'new', eta, String(b.time || ''), token, 0, JSON.stringify(priced.lines), tgChatId
  );

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  return { order: rowToOrder(row), token, lines: priced.lines };
}
