/* ===== /api/orders — buyurtmalar ===== */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { TG_TOKEN, TG_CHAT_OPS } from '../config.js';

const router = Router();

/* Migratsiyalar (token/reason/delivery) db.js initSchema() da — jadval yaratilgandan
   keyin ishlaydi. Bu yerda (import paytida) yozilsa, yangi bazada jadval hali yo'q
   bo'lib jim yiqilardi va ustun umuman qo'shilmasdi. */

const ALLOWED = ['user', 'phone', 'rest', 'item', 'emoji', 'amount', 'addr', 'pay', 'courier', 'status', 'eta', 'time', 'reason', 'delivery'];

/* Tashqariga token CHIQMAYDI (sabotaj himoyasi) — faqat yaratuvchiga POST javobida beriladi */
function rowToOrder(r) {
  return {
    id: r.id, user: r.user, phone: r.phone || '', rest: r.rest, item: r.item, emoji: r.emoji,
    amount: r.amount, addr: r.addr, pay: r.pay, courier: r.courier,
    status: r.status, eta: r.eta, time: r.time, reason: r.reason || '', delivery: r.delivery || 0,
    created_at: r.created_at, done_at: r.done_at || '',
  };
}

/* --- Telefon raqami validatsiyasi: O'zbekiston (+998 va 9 ta raqam) --- */
function normalizePhone(p) {
  const digits = String(p == null ? '' : p).replace(/\D/g, '');
  return digits;
}
// O'zbekiston mobil operatorlari rasmiy kodlari
const UZ_OPERATORS = ['20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'];
function validPhone(p) {
  const d = normalizePhone(p);              // 998 + 9 raqam = 12 raqam
  if (!/^998\d{9}$/.test(d)) return false;   // umumiy uzunlik/format
  return UZ_OPERATORS.includes(d.slice(3, 5)); // operator kodi rasmiy bo'lishi shart
}
function prettyPhone(p) {
  const d = normalizePhone(p);            // 998901234567
  if (!/^998\d{9}$/.test(d)) return String(p || '');
  return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

/* --- MarkdownV2 maxsus belgilarini ekranlash (Telegram crash bo'lmasligi uchun) --- */
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/* --- Yangi buyurtma -> Telegram guruhiga chiroyli xabarnoma (fire-and-forget) --- */
async function notifyTelegram(order) {
  if (!TG_TOKEN || !TG_CHAT_OPS) return;   // sozlanmagan bo'lsa — jim o'tamiz
  const e = mdEscape;
  const amount = e(Number(order.amount || 0).toLocaleString('ru-RU') + " so'm");
  const pay = order.pay === 'cash' ? '💵 Naqd' : '💳 Karta';
  const text =
    `🆕 *YANGI BUYURTMA* \\#${e(order.id)}\n\n` +
    `🍽️ *Taom:* ${e(order.item) || '—'}\n` +
    `💰 *Narxi:* ${amount}\n` +
    `🏪 *Restoran:* ${e(order.rest) || '—'}\n` +
    `👤 *Mijoz:* ${e(order.user) || '—'}\n` +
    `📞 *Telefon:* ${e(order.phone) || '—'}\n` +
    `📍 *Manzil:* ${e(order.addr) || '—'}\n` +
    `🛵 *Kuryer:* ${e(order.courier) || 'tayinlanmagan'}\n` +
    `💳 *To'lov:* ${e(pay)}`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_OPS,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) console.warn('[TG] javob xato:', r.status, await r.text().catch(() => ''));
  } catch (err) {
    console.warn('[TG] yuborib bo`lmadi:', err.message);
  }
}

/* GET /api/orders — ROL bo'yicha qat'iy cheklangan (PII leak yopilgan) */
router.get('/', authRequired, (req, res) => {
  let sql = 'SELECT * FROM orders';
  const where = [], params = [];

  switch (req.user.role) {
    case 'user':
      // Oddiy foydalanuvchi — faqat O'Z buyurtmalari
      where.push('user = ?'); params.push(req.user.name);
      break;
    case 'restoran':
      // Restoran — faqat O'Z restoraniga tushgan buyurtmalar
      where.push('rest = ?'); params.push(req.user.name);
      break;
    case 'kuryer':
      // Kuryer — faqat O'ZIGA biriktirilgan buyurtmalar
      where.push('courier = ?'); params.push(req.user.name);
      break;
    case 'admin':
      // Admin — hammasini ko'radi, ixtiyoriy filtrlar bilan
      if (req.query.rest)    { where.push('rest = ?');    params.push(String(req.query.rest)); }
      if (req.query.courier) { where.push('courier = ?'); params.push(String(req.query.courier)); }
      if (req.query.user)    { where.push('user = ?');    params.push(String(req.query.user)); }
      break;
    default:
      return res.status(403).json({ error: 'Ruxsat berilmagan' });
  }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params).map(rowToOrder));
});

/* Restoranga eng mos (eng kam yuklangan) faol kuryerni tanlash */
function assignCourier(rest) {
  const pick = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (e) { return null; } };
  // Faol (hali yetkazilmagan) buyurtmalar — buyurtma tasdiqsiz to'g'ridan kuryerga
  // borgani uchun 'new'/'accepted' ham yukni hisoblashda inobatga olinadi.
  const ACTIVE = "('new','accepted','ready','ontheway')";
  // 1) shu restoranga biriktirilgan kuryerlar ichidan eng kam faol buyurtmali (javobda bo'lmagan)
  let c = pick(
    `SELECT c.name FROM couriers c WHERE c.rest = ? AND c.active = 1 AND c.on_leave = 0
     ORDER BY (SELECT COUNT(*) FROM orders o WHERE o.courier = c.name AND o.status IN ${ACTIVE}) ASC, RANDOM() LIMIT 1`,
    String(rest || '')
  );
  // 2) bo'lmasa — har qanday faol kuryer (eng kam yuklangan, javobda bo'lmagan)
  if (!c) c = pick(
    `SELECT c.name FROM couriers c WHERE c.active = 1 AND c.on_leave = 0
     ORDER BY (SELECT COUNT(*) FROM orders o WHERE o.courier = c.name AND o.status IN ${ACTIVE}) ASC, RANDOM() LIMIT 1`
  );
  return c ? c.name : '';
}

/* POST /api/orders — ochiq (mehmon checkout: bosh sahifadan ham buyurtma berish mumkin) */
router.post('/', (req, res) => {
  const b = req.body || {};

  /* Telefon raqami majburiy va to'g'ri formatda bo'lishi shart */
  if (!validPhone(b.phone)) {
    return res.status(400).json({ error: 'Telefon raqamini to`g`ri kiriting: +998 XX XXX XX XX' });
  }
  const phone = prettyPhone(b.phone);

  /* Sabotajga qarshi maxfiy "track token" — mehmon shu token bilan buyurtmasini
     bekor qila/qabul qila oladi. Token faqat shu javobda qaytadi. */
  const token = randomBytes(16).toString('hex');

  /* Kuryer backendda avtomatik biriktiriladi (hardcoded emas) */
  const courier = assignCourier(b.rest) || String(b.courier || '');

  const info = db.prepare(
    `INSERT INTO orders (user, phone, rest, item, emoji, amount, addr, pay, courier, status, eta, time, token, delivery)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    String(b.user || ''), phone, String(b.rest || ''), String(b.item || ''), String(b.emoji || ''),
    Number(b.amount) || 0, String(b.addr || ''), String(b.pay || 'card'),
    courier, String(b.status || 'new'), Number(b.eta) || 15, String(b.time || ''), token, Number(b.delivery) || 0
  );

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);

  /* Telegram xabarnomasini bloklamasdan yuboramiz */
  notifyTelegram(rowToOrder(row));

  /* Javobда token QAYTADI — frontend uni localStorage'da saqlab, keyin
     bekor qilish/qabul qilishda yuboradi. */
  res.status(201).json({ ...rowToOrder(row), token });
});

/* GET /api/orders/:id — ochiq: mehmon o'z buyurtmasi holatini kuzatishi uchun (faqat id+status) */
router.get('/:id', (req, res) => {
  const o = db.prepare('SELECT id, status, reason FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  res.json(o);
});

/* Egalik tekshiruvi: yo token mos kelishi, yo xodim (admin/restoran/kuryer) bo'lishi shart */
function canMutate(order, req) {
  const provided = String(req.body?.token || '');
  if (req.user) {
    const role = req.user.role;
    // Xodimlar (admin/restoran/kuryer) — har doim
    if (['admin', 'restoran', 'kuryer'].includes(role)) return true;
    // Tizimga kirgan foydalanuvchi — faqat O'Z buyurtmasi (token shart emas)
    if (role === 'user' && order.user === req.user.name) return true;
  }
  // Mehmon (tokensiz kirgan) — maxfiy track token bilan
  if (order.token && provided === order.token) return true;
  // Eski (tokensiz) buyurtmalar uchun orqaga moslik
  if (!order.token) return true;
  return false;
}

/* POST /api/orders/:id/cancel — mijoz buyurtmani bekor qiladi (token yoki xodim talab qilinadi) */
router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canMutate(o, req)) return res.status(403).json({ error: 'Ruxsat yo`q' });

  if (['new', 'accepted', 'ready'].includes(o.status)) {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
  } else if (o.status !== 'cancelled') {
    return res.status(409).json({ error: 'Bu bosqichda bekor qilib bo`lmaydi (kuryer yo`lda)' });
  }
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

/* POST /api/orders/:id/received — mijoz "qabul qildim" deydi (arrived -> done) */
router.post('/:id/received', (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canMutate(o, req)) return res.status(403).json({ error: 'Ruxsat yo`q' });

  // Mijoz tasdiqlaganda — aniq yetkazilgan vaqtni yozamiz (done_at, UTC)
  if (o.status === 'arrived') db.prepare("UPDATE orders SET status = 'done', done_at = datetime('now') WHERE id = ?").run(id);
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

/* PATCH /api/orders/:id — statusni yangilash va h.k. (FAQAT restoran/kuryer/admin) */
router.patch('/:id', requireRole('restoran', 'kuryer', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  /* Egalik tekshiruvi (GET dagidek): restoran faqat O'Z restoranidagi,
     kuryer faqat O'ZIGA biriktirilgan buyurtmani o'zgartira oladi. Admin — hammasini. */
  if (req.user.role === 'restoran' && existing.rest !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });
  if (req.user.role === 'kuryer' && existing.courier !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });

  const patch = req.body || {};
  const sets = [], params = [];
  for (const k of ALLOWED) {
    if (k in patch) { sets.push(`${k} = ?`); params.push(patch[k]); }
  }
  /* "done" ga o'tganda — aniq yetkazilgan vaqtni bir marta yozamiz (server tomonда, UTC) */
  if (patch.status === 'done' && existing.status !== 'done') {
    sets.push("done_at = datetime('now')");
  }
  if (sets.length) {
    params.push(id);
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

export default router;
