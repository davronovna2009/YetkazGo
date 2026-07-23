/* ===== Buyurtma yaratishning YAGONA manbasi =====
   Saytdan (POST /api/orders) ham, Telegram botdan ham AYNAN shu funksiya
   chaqiriladi. Logika ikki joyда takrorlanmasin — aks holda biri tuzatilib,
   ikkinchisi eskirib qoladi (narx, kuryer biriktirish, telefon tekshiruvi). */
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { priceOrder, PriceError } from './pricing.js';
import { courierIsOpen } from './hours.js';
import { phoneStatus, checkSpam } from './blocks.js';
import { callRule, suspicionCheck, totalQty } from './order-rules.js';

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
  const items = parseItems(r.items_json);
  return {
    id: r.id, user: r.user, phone: r.phone || '', rest: r.rest, item: r.item, emoji: r.emoji,
    amount: r.amount, addr: r.addr, pay: r.pay, courier: r.courier,
    status: r.status, eta: r.eta, time: r.time, reason: r.reason || '', delivery: r.delivery || 0,
    /* Buyurtma qayerdan kelgan — panellarda ko'rsatiladi ('sayt' | 'telegram') */
    source: r.source || (r.tg_chat_id ? 'telegram' : 'sayt'),
    paid: r.paid ? 1 : 0, paid_at: r.paid_at || '',
    items,
    /* Jami dona soni — eski buyurtmalar uchun tarkibdan hisoblanadi */
    qtyTotal: r.qty_total || totalQty(items),
    /* Katta buyurtma: kuryer yo'lga chiqishdan oldin mijozga qo'ng'iroq qilishi shart */
    callRequired: r.call_required ? 1 : 0,
    callDone: r.call_done ? 1 : 0,
    callBy: r.call_by || '',
    callAt: r.call_at || '',
    /* Shubhali buyurtma — admin tasdig'ini kutmoqda (status = 'review') */
    suspicious: r.suspicious ? 1 : 0,
    suspiciousReason: r.suspicious_reason || '',
    approvedBy: r.approved_by || '',
    created_at: r.created_at, done_at: r.done_at || '',
  };
}

/* Bitta kuryerда bir vaqtda bo'lishi mumkin bo'lgan FAOL buyurtmalar soni.
   Kuryer 2 tadan ko'p buyurtma olmaydi — aks holda hammasini kechiktiradi. */
export const MAX_ACTIVE_PER_COURIER = 2;

/* Faol (hali yetkazilmagan) bosqichlar. 'review' YO'Q: admin tasdiqlamagan
   buyurtma kuryerga umuman ko'rinmaydi, demak yukni ham oshirmaydi. */
const ACTIVE_STATUSES = "('new','accepted','ready','ontheway')";

/* SQLite created_at (UTC 'YYYY-MM-DD HH:MM:SS') → ms */
function stampUtc(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

/* Kuryer QACHON bo'sh bo'ladi — faol buyurtmalarining eng kech muddati
   (buyurtma vaqti + eta). Buyurtmasi yo'q bo'lsa — hozir bo'sh.
   "Eng yetib borish vaqti kam kuryer" AYNAN shu qiymat eng kichigi. */
function courierFreeAt(name) {
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT created_at, eta FROM orders WHERE courier = ? AND status IN ${ACTIVE_STATUSES}`
    ).all(String(name || ''));
  } catch (e) { return 0; }
  let latest = 0;
  for (const o of rows) {
    const t = stampUtc(o.created_at);
    if (!t) continue;
    const eta = Math.max(5, Math.min(120, Number(o.eta) || 15));
    latest = Math.max(latest, t + eta * 60000);
  }
  return latest;
}

/* Restoranga eng mos faol kuryerni tanlash.

   QOIDA (mijoz talabi):
     1) Kuryerда 2 tadan KAM faol buyurtma bo'lsa — eng kam yuklanganiga beramiz.
        Bir xil yukda: avval SHU restoranning kuryeri.
     2) HAMMA kuryerда 2 tadan bo'lsa — eng tez bo'shaydigan, ya'ni yetib borish
        vaqti eng kam kuryerga beramiz (buyurtma navbatда kutadi, yo'qolmaydi).

   ISH VAQTI: kuryer paneli "ish vaqtingizdan tashqarida buyurtmalar sizga
   tushmaydi" deb yozadi — shuning uchun avval AYNAN hozir ish vaqtida bo'lgan
   kuryerlar orasidan tanlaymiz (hours.js, Asia/Tashkent). Bunday kuryer
   topilmasa — buyurtma egasiz qolmasligi uchun qolganlarga tushamiz. */
export function assignCourier(rest) {
  const restName = String(rest || '');
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT c.name, c.rest, c.open_h, c.close_h,
              (SELECT COUNT(*) FROM orders o WHERE o.courier = c.name AND o.status IN ${ACTIVE_STATUSES}) AS load
         FROM couriers c
        WHERE c.active = 1 AND c.on_leave = 0`
    ).all();
  } catch (e) { return ''; }
  if (!rows.length) return '';

  /* Ish vaqtidagilar ustuvor; hech kim ish vaqtida bo'lmasa — hammasi */
  const onShift = rows.filter(courierIsOpen);
  const pool = onShift.length ? onShift : rows;

  /* ===== BITTA KURYER — HAMMA BUYURTMA UNGA =====
     Faqat bitta faol kuryer bo'lsa, 2 talik cheklov QO'LLANMAYDI: barcha
     buyurtma o'shanga boradi (aks holda 3-buyurtmadan keyin egasiz qolardi).
     2 talik cheklov FAQAT bir nechta kuryer bo'lganда ishlaydi. */
  if (pool.length === 1) return pool[0].name;

  /* Shu restoranniki oldinroq turishi uchun (bir xil yukda hal qiluvchi omil) */
  const mineFirst = (a, b) => (a.rest === restName ? 0 : 1) - (b.rest === restName ? 0 : 1);

  /* 1) Bo'sh joyi bor kuryerlar — eng kam yuklanganidan boshlab */
  const free = pool.filter((c) => (c.load || 0) < MAX_ACTIVE_PER_COURIER);
  if (free.length) {
    free.sort((a, b) => (a.load - b.load) || mineFirst(a, b) || a.name.localeCompare(b.name));
    return free[0].name;
  }

  /* 2) Hammasi to'la — eng tez bo'shaydiganini (yetib borish vaqti eng kam) tanlaymiz */
  const withFree = pool.map((c) => ({ c, freeAt: courierFreeAt(c.name) }));
  withFree.sort((a, b) => (a.freeAt - b.freeAt) || mineFirst(a.c, b.c) || a.c.name.localeCompare(b.c.name));
  return withFree[0].c.name;
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
  /* eta — mijoz beradi, lekin aqlli oraliqqa qisamiz (0 bo'lsa frontendда NaN chiqadi) */
  const eta = Math.max(5, Math.min(120, Number(b.eta) || 15));
  const tgChatId = b.tgChatId ? String(b.tgChatId) : '';

  /* Manba: Telegram chat_id bo'lsa — botning mini ilovasidan, aks holda saytdan.
     Panellar shuni "🤖 Telegram" / "🌐 Sayt" deb ko'rsatadi. */
  const source = tgChatId ? 'telegram' : 'sayt';

  /* ===== KATTA / SHUBHALI BUYURTMA (order-rules.js) =====
     - shubhali bo'lsa: status 'review' — restoran ham, kuryer ham KO'RMAYDI,
       faqat admin panelida chiqadi. Admin tasdiqlagach 'new' bo'ladi.
     - katta bo'lsa: kuryerга "avval mijozga qo'ng'iroq qiling" sharti qo'yiladi. */
  const suspect = suspicionCheck({ amount: priced.amount, lines: priced.lines });
  const call = callRule(priced.amount, priced.lines);
  const status = suspect.suspicious ? 'review' : 'new';

  /* Kuryer FAQAT haqiqiy buyurtmaga biriktiriladi. Shubhali buyurtma admin
     tasdiqlaganda biriktiriladi (routes/orders.js: /approve) — aks holda
     tekshiruvda turgan buyurtma kuryerning 2 ta o'rnini bejiz band qilardi. */
  const courier = suspect.suspicious ? '' : (assignCourier(priced.rest) || String(b.courier || ''));

  const info = db.prepare(
    `INSERT INTO orders (user, phone, rest, item, emoji, amount, addr, pay, courier, status, eta, time, token, delivery, items_json, tg_chat_id, source,
                         qty_total, call_required, suspicious, suspicious_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    String(b.user || ''), phone, priced.rest, priced.item, priced.emoji,
    priced.amount, String(b.addr || ''), String(b.pay || 'card'),
    courier, status, eta, String(b.time || ''), token, 0, JSON.stringify(priced.lines), tgChatId, source,
    totalQty(priced.lines), call.required ? 1 : 0, suspect.suspicious ? 1 : 0, suspect.reason
  );

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  return { order: rowToOrder(row), token, lines: priced.lines };
}
