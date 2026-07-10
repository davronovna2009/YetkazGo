/* ===== /api/bootstrap, /api/restaurants, /api/couriers ===== */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { getOverrides } from './dishes.js';

const router = Router();

function restRow(r) {
  return {
    id: r.id, name: r.name, nameCyr: r.name_cyr, emoji: r.emoji, kw: r.kw,
    rating: r.rating, eta: r.eta, dist: r.dist, photo: r.photo, login: r.login,
    commission: r.commission != null ? r.commission : 18,
    openH: r.open_h != null ? r.open_h : 9, closeH: r.close_h != null ? r.close_h : 23,
    addr: r.addr || '', owner: r.owner || '', email: r.email || '', descr: r.descr || '', hours: r.hours || '', area: r.area || '',
    active: !!r.active,
  };
}
function courRow(c) {
  return {
    id: c.id, name: c.name, emoji: c.emoji, rest: c.rest, login: c.login,
    phone: c.phone, deliveries: c.deliveries, rating: c.rating,
    fee: c.fee != null ? c.fee : 0, transport: c.transport || '', plate: c.plate || '', address: c.address || '', email: c.email || '', birthdate: c.birthdate || '', passport: c.passport || '',
    active: !!c.active,
    openH: c.open_h != null ? c.open_h : 8, closeH: c.close_h != null ? c.close_h : 22,
    onLeave: !!c.on_leave, leaveReason: c.leave_reason || '', leaveStatus: c.leave_status || 'none',
  };
}

/* GET /api/bootstrap — bosh sahifa va panellar uchun ommaviy snapshot.
   Buyurtmalar (maxfiy) alohida /api/orders orqali (token bilan) olinadi. */
router.get('/bootstrap', (_req, res) => {
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all().map(r => ({
    id: r.id, name: r.name, ava: r.ava, rating: r.rating, dish: r.dish,
    text: r.text, textCyr: r.text_cyr || '', flagged: !!r.flagged, date: r.date,
  }));
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 20').all().map(a => ({
    id: a.id, rest: a.rest, text: a.text, emoji: a.emoji, tag: a.tag, dish: a.dish, img: a.img || '',
  }));
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE active = 1 ORDER BY id').all().map(restRow);
  res.json({ reviews, overrides: getOverrides(), announcements, restaurants });
});

/* GET /api/restaurants */
router.get('/restaurants', (_req, res) => {
  res.json(db.prepare('SELECT * FROM restaurants ORDER BY id').all().map(restRow));
});

/* GET /api/couriers — admin */
router.get('/couriers', requireRole('admin'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM couriers ORDER BY id').all().map(courRow));
});

/* ===== Admin: restoran qo'shish / o'chirish ===== */

/* POST /api/restaurants — yangi restoran + uning akkaunti */
router.post('/restaurants', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const login = String(b.login || '').trim();
  const pass = String(b.pass || '');
  if (!name || !login || !pass) return res.status(400).json({ error: 'name, login, pass kerak' });
  if (db.prepare('SELECT 1 FROM accounts WHERE login = ?').get(login)) return res.status(409).json({ error: 'Bu login band' });
  if (db.prepare('SELECT 1 FROM restaurants WHERE name = ?').get(name)) return res.status(409).json({ error: 'Bu nom band' });

  const commission = Math.max(0, Math.min(50, Number(b.commission) || 18));
  db.prepare('INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)')
    .run(login, hashPassword(pass), 'restoran', name, String(b.phone || ''), 'restoran.html');
  db.prepare('INSERT INTO restaurants (name, name_cyr, emoji, kw, rating, eta, dist, photo, login, commission, addr, owner, email, descr, hours, area) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, String(b.nameCyr || ''), String(b.emoji || '🏪'), String(b.kw || ''), Number(b.rating) || 0,
         Number(b.eta) || 20, String(b.dist || ''), String(b.photo || ''), login, commission,
         String(b.addr || ''), String(b.owner || ''), String(b.email || ''), String(b.descr || ''), String(b.hours || ''), String(b.area || ''));
  res.status(201).json(restRow(db.prepare('SELECT * FROM restaurants WHERE name = ?').get(name)));
});

/* DELETE /api/restaurants — login bo'yicha (restoran + akkaunt) */
router.delete('/restaurants', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  db.prepare('DELETE FROM restaurants WHERE login = ?').run(login);
  db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'restoran'").run(login);
  res.json({ ok: true });
});

/* ===== Admin: kuryer qo'shish / o'chirish ===== */

/* POST /api/couriers — yangi kuryer + akkaunt */
router.post('/couriers', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const login = String(b.login || '').trim();
  const pass = String(b.pass || '');
  if (!name || !login || !pass) return res.status(400).json({ error: 'name, login, pass kerak' });
  if (db.prepare('SELECT 1 FROM accounts WHERE login = ?').get(login)) return res.status(409).json({ error: 'Bu login band' });

  db.prepare('INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)')
    .run(login, hashPassword(pass), 'kuryer', name, String(b.phone || ''), 'kuryer.html');
  db.prepare('INSERT INTO couriers (name, emoji, rest, login, phone, deliveries, rating, fee, transport, plate, address, email, birthdate, passport) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(name, String(b.emoji || '🛵'), String(b.rest || ''), login, String(b.phone || ''), Number(b.deliveries) || 0, Number(b.rating) || 0, Number(b.fee) || 0,
         String(b.transport || ''), String(b.plate || ''), String(b.address || ''), String(b.email || ''), String(b.birthdate || ''), String(b.passport || ''));
  res.status(201).json(courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)));
});

/* DELETE /api/couriers — login bo'yicha */
router.delete('/couriers', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  db.prepare('DELETE FROM couriers WHERE login = ?').run(login);
  db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'kuryer'").run(login);
  res.json({ ok: true });
});

/* ===== Admin: tahrirlash (ism, telefon, parol, komissiya, fee) ===== */

/* POST /api/restaurants/photo — restoran EGASI faqat O'Z rasmini o'zgartiradi (admin — istalganini) */
router.post('/restaurants/photo', requireRole('restoran', 'admin'), (req, res) => {
  const photo = String(req.body?.photo || '');
  let login = req.user.role === 'restoran' ? req.user.login : String(req.body?.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const r = db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login);
  if (!r) return res.status(404).json({ error: 'Restoran topilmadi' });
  db.prepare('UPDATE restaurants SET photo = ? WHERE login = ?').run(photo, login);
  res.json({ ok: true, photo });
});

/* PATCH /api/restaurants/me — restoran EGASI o'z ommaviy ma'lumotini tahrirlaydi
   (saytda ko'rinadigan: tavsif, manzil, ish vaqti, yetkazish hududi). Nom/komissiya
   admin ixtiyorida qoladi. */
router.patch('/restaurants/me', requireRole('restoran'), (req, res) => {
  const b = req.body || {};
  const login = req.user.login;
  const r = db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login);
  if (!r) return res.status(404).json({ error: 'Restoran topilmadi' });

  if (b.descr != null) db.prepare('UPDATE restaurants SET descr = ? WHERE login = ?').run(String(b.descr).slice(0, 500), login);
  if (b.addr  != null) db.prepare('UPDATE restaurants SET addr = ? WHERE login = ?').run(String(b.addr).slice(0, 200), login);
  if (b.area  != null) db.prepare('UPDATE restaurants SET area = ? WHERE login = ?').run(String(b.area).slice(0, 200), login);
  if (b.hours != null) db.prepare('UPDATE restaurants SET hours = ? WHERE login = ?').run(String(b.hours).slice(0, 100), login);
  if (b.email != null) db.prepare('UPDATE restaurants SET email = ? WHERE login = ?').run(String(b.email).slice(0, 120), login);
  if (b.openH  != null) db.prepare('UPDATE restaurants SET open_h = ? WHERE login = ?').run(Math.max(0, Math.min(23, Number(b.openH) || 0)), login);
  if (b.closeH != null) db.prepare('UPDATE restaurants SET close_h = ? WHERE login = ?').run(Math.max(1, Math.min(24, Number(b.closeH) || 24)), login);

  res.json(restRow(db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login)));
});

/* PATCH /api/restaurants — login bo'yicha tahrir */
router.patch('/restaurants', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const login = String(b.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const r = db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login);
  if (!r) return res.status(404).json({ error: 'Restoran topilmadi' });

  const newName = b.name != null ? String(b.name).trim() : r.name;
  const phone = b.phone != null ? String(b.phone) : null;
  const emoji = b.emoji != null ? String(b.emoji) : null;
  const commission = b.commission != null ? Math.max(0, Math.min(50, Number(b.commission) || 0)) : null;

  // Nom o'zgarsa — bog'liq yozuvlarni ham yangilaymiz (yaxlitlik uchun)
  if (newName && newName !== r.name) {
    if (db.prepare('SELECT 1 FROM restaurants WHERE name = ? AND login <> ?').get(newName, login))
      return res.status(409).json({ error: 'Bu nom band' });
    db.prepare('UPDATE restaurants SET name = ? WHERE login = ?').run(newName, login);
    db.prepare('UPDATE orders SET rest = ? WHERE rest = ?').run(newName, r.name);
    db.prepare('UPDATE added_dishes SET rest = ? WHERE rest = ?').run(newName, r.name);
    db.prepare('UPDATE removed_dishes SET rest = ? WHERE rest = ?').run(newName, r.name);
    db.prepare('UPDATE discounts SET rest = ? WHERE rest = ?').run(newName, r.name);
    db.prepare('UPDATE announcements SET rest = ? WHERE rest = ?').run(newName, r.name);
    db.prepare("UPDATE accounts SET name = ? WHERE login = ? AND role = 'restoran'").run(newName, login);
  }
  if (phone != null) {
    db.prepare("UPDATE accounts SET phone = ? WHERE login = ? AND role = 'restoran'").run(phone, login);
  }
  if (emoji != null) db.prepare('UPDATE restaurants SET emoji = ? WHERE login = ?').run(emoji, login);
  if (b.photo != null) db.prepare('UPDATE restaurants SET photo = ? WHERE login = ?').run(String(b.photo), login);
  if (commission != null) db.prepare('UPDATE restaurants SET commission = ? WHERE login = ?').run(commission, login);
  if (b.openH != null) db.prepare('UPDATE restaurants SET open_h = ? WHERE login = ?').run(Math.max(0, Math.min(23, Number(b.openH) || 0)), login);
  if (b.closeH != null) db.prepare('UPDATE restaurants SET close_h = ? WHERE login = ?').run(Math.max(1, Math.min(24, Number(b.closeH) || 24)), login);
  /* Chala qolgan ma'lumotlarni ham to'ldirish/tahrirlash (admin) */
  for (const col of ['owner', 'email', 'addr', 'area', 'descr', 'hours']) {
    if (b[col] != null) db.prepare(`UPDATE restaurants SET ${col} = ? WHERE login = ?`).run(String(b[col]).slice(0, 500), login);
  }
  if (b.pass) db.prepare("UPDATE accounts SET pass_hash = ? WHERE login = ? AND role = 'restoran'").run(hashPassword(String(b.pass)), login);

  res.json(restRow(db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login)));
});

/* PATCH /api/couriers — login bo'yicha tahrir */
router.patch('/couriers', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const login = String(b.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });

  const newName = b.name != null ? String(b.name).trim() : c.name;
  if (newName && newName !== c.name) {
    db.prepare('UPDATE couriers SET name = ? WHERE login = ?').run(newName, login);
    db.prepare('UPDATE orders SET courier = ? WHERE courier = ?').run(newName, c.name);
    db.prepare("UPDATE accounts SET name = ? WHERE login = ? AND role = 'kuryer'").run(newName, login);
  }
  if (b.phone != null) {
    db.prepare('UPDATE couriers SET phone = ? WHERE login = ?').run(String(b.phone), login);
    db.prepare("UPDATE accounts SET phone = ? WHERE login = ? AND role = 'kuryer'").run(String(b.phone), login);
  }
  if (b.rest != null) db.prepare('UPDATE couriers SET rest = ? WHERE login = ?').run(String(b.rest), login);
  if (b.fee != null) db.prepare('UPDATE couriers SET fee = ? WHERE login = ?').run(Math.max(0, Number(b.fee) || 0), login);
  /* Ish vaqtini FAQAT admin belgilaydi */
  if (b.openH  != null) db.prepare('UPDATE couriers SET open_h = ? WHERE login = ?').run(Math.max(0, Math.min(23, Number(b.openH) || 0)), login);
  if (b.closeH != null) db.prepare('UPDATE couriers SET close_h = ? WHERE login = ?').run(Math.max(1, Math.min(24, Number(b.closeH) || 24)), login);
  /* Chala qolgan profil maydonlarini ham to'ldirish/tahrirlash (admin) */
  for (const col of ['transport', 'plate', 'address', 'email', 'birthdate', 'passport', 'emoji']) {
    if (b[col] != null) db.prepare(`UPDATE couriers SET ${col} = ? WHERE login = ?`).run(String(b[col]).slice(0, 120), login);
  }
  if (b.pass) db.prepare("UPDATE accounts SET pass_hash = ? WHERE login = ? AND role = 'kuryer'").run(hashPassword(String(b.pass)), login);

  res.json(courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)));
});

/* ===== Kuryer O'ZI boshqaradigan sozlamalar ===== */
const COUR_ACTIVE = "('new','accepted','ready','ontheway')";

/* PATCH /api/couriers/me — kuryer O'Z profil ma'lumotini to'ldiradi.
   MUHIM: ish vaqti (open_h/close_h) bu yerda O'ZGARMAYDI — uni FAQAT admin belgilaydi. */
router.patch('/couriers/me', requireRole('kuryer'), (req, res) => {
  const b = req.body || {};
  const login = req.user.login;
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  /* Kuryer o'z profil ma'lumotlarini ham to'ldiradi/tahrirlaydi (pasport — admin ixtiyorida) */
  for (const col of ['transport', 'plate', 'address', 'email', 'birthdate']) {
    if (b[col] != null) db.prepare(`UPDATE couriers SET ${col} = ? WHERE login = ?`).run(String(b[col]).slice(0, 120), login);
  }
  res.json(courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)));
});

/* GET /api/couriers/me — kuryer O'Z to'liq ma'lumotini oladi (profilni to'ldirish uchun) */
router.get('/couriers/me', requireRole('kuryer'), (req, res) => {
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(req.user.login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  res.json(courRow(c));
});

/* Kuryerning doimiy to'lov tokenini ta'minlaydi (yo'q bo'lsa yaratadi) */
function ensurePayToken(login) {
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return null;
  if (!c.pay_token) {
    const tok = randomBytes(12).toString('hex');
    db.prepare('UPDATE couriers SET pay_token = ? WHERE login = ?').run(tok, login);
    c.pay_token = tok;
  }
  return c;
}

/* GET /api/couriers/me/qr — kuryer O'Z DOIMIY to'lov QR'ini oladi (rasm data-URI + havola).
   Mijoz eshikда shu QR'ni skanerlaydi -> /pay.html ochiladi -> to'lovni tasdiqlaydi. */
router.get('/couriers/me/qr', requireRole('kuryer'), async (req, res) => {
  const c = ensurePayToken(req.user.login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/pay.html?k=${c.pay_token}`;
  let qr = '';
  try { qr = await QRCode.toDataURL(url, { width: 320, margin: 1 }); } catch (e) { /* rasm bo'lmasa — havola qaytadi */ }
  res.json({ url, qr, payToken: c.pay_token });
});

/* Faol (yetkazilmagan) buyurtmalarni boshqa faol kuryerga (imkon qadar shu restoranga
   biriktirilgan, eng kam yuklangan) o'tkazadi. O'tkazilganlar sonini qaytaradi. */
function reassignActiveOrders(courierName) {
  const orders = db.prepare(`SELECT * FROM orders WHERE courier = ? AND status IN ${COUR_ACTIVE}`).all(courierName);
  let reassigned = 0;
  for (const o of orders) {
    const alt = db.prepare(
      `SELECT name FROM couriers c WHERE c.active = 1 AND c.on_leave = 0 AND c.name <> ?
       ORDER BY (CASE WHEN c.rest = ? THEN 0 ELSE 1 END),
                (SELECT COUNT(*) FROM orders o2 WHERE o2.courier = c.name AND o2.status IN ${COUR_ACTIVE}) ASC,
                RANDOM() LIMIT 1`
    ).get(courierName, o.rest);
    if (alt && alt.name) { db.prepare('UPDATE orders SET courier = ? WHERE id = ?').run(alt.name, o.id); reassigned++; }
  }
  return reassigned;
}

/* POST /api/couriers/leave — kuryer ishdan javob SO'RAYDI (admin tasdiqlashi shart).
   So'rov 'pending' bo'ladi; kuryer admin qaroriga qadar ishда qoladi (buyurtma tushaveradi). */
router.post('/couriers/leave', requireRole('kuryer'), (req, res) => {
  const login = req.user.login;
  const reason = String((req.body && req.body.reason) || '').slice(0, 200);
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  if (c.on_leave) return res.status(409).json({ error: 'Siz allaqachon ishdan javobdasiz' });
  db.prepare("UPDATE couriers SET leave_status = 'pending', leave_reason = ? WHERE login = ?").run(reason, login);
  res.json({ ok: true, status: 'pending', courier: courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)) });
});

/* POST /api/couriers/leave-cancel — kuryer so'rovini bekor qiladi YOKI rad javobini tan oladi.
   leave_status ni 'none' ga qaytaradi. Tasdiqlangan (on_leave) holatда ishlamaydi — u yerда /return. */
router.post('/couriers/leave-cancel', requireRole('kuryer'), (req, res) => {
  const login = req.user.login;
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  if (c.on_leave) return res.status(409).json({ error: 'Tasdiqlangan javobда — «Ishga qaytish» dan foydalaning' });
  db.prepare("UPDATE couriers SET leave_status = 'none', leave_reason = '' WHERE login = ?").run(login);
  res.json({ ok: true, courier: courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)) });
});

/* POST /api/couriers/leave-decision — ADMIN ishdan-javob so'rovini tasdiqlaydi/rad etadi.
   approve=true  -> kuryer javobга chiqadi (active=0, on_leave=1), faol buyurtmalari boshqa kuryerga o'tadi.
   approve=false -> so'rov rad etiladi (leave_status='denied'), kuryer ishда qoladi. */
router.post('/couriers/leave-decision', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const login = String(b.login || '').trim();
  const approve = !!b.approve;
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  let reassigned = 0;
  if (approve) {
    db.prepare("UPDATE couriers SET active = 0, on_leave = 1, leave_status = 'approved' WHERE login = ?").run(login);
    reassigned = reassignActiveOrders(c.name);
  } else {
    db.prepare("UPDATE couriers SET active = 1, on_leave = 0, leave_status = 'denied' WHERE login = ?").run(login);
  }
  res.json({ ok: true, approve, reassigned, courier: courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)) });
});

/* POST /api/couriers/return — kuryer (tasdiqlangan javobдан) ishga qaytadi */
router.post('/couriers/return', requireRole('kuryer'), (req, res) => {
  const login = req.user.login;
  const c = db.prepare('SELECT * FROM couriers WHERE login = ?').get(login);
  if (!c) return res.status(404).json({ error: 'Kuryer topilmadi' });
  db.prepare("UPDATE couriers SET active = 1, on_leave = 0, leave_status = 'none', leave_reason = '' WHERE login = ?").run(login);
  res.json({ ok: true, courier: courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)) });
});

/* GET /api/couriers/status — restoran/admin/kuryer uchun MINIMAL kuryer holati
   (maxfiy maydonlarsiz). Restoran o'z kuryerlarining ishdan-javob holatini ko'radi. */
router.get('/couriers/status', requireRole('restoran', 'kuryer', 'admin'), (_req, res) => {
  const rows = db.prepare('SELECT id, name, rest, active, on_leave, leave_reason, leave_status, open_h, close_h FROM couriers ORDER BY name').all();
  res.json(rows.map((c) => ({
    id: c.id, name: c.name, rest: c.rest, active: !!c.active,
    onLeave: !!c.on_leave, leaveReason: c.leave_reason || '', leaveStatus: c.leave_status || 'none',
    openH: c.open_h != null ? c.open_h : 8, closeH: c.close_h != null ? c.close_h : 22,
  })));
});

/* ===== OMMAVIY TO'LOV (QR orqali) — mijoz login qilmasdan ochadi =====
   XAVFSIZLIK: QR kuryernikи (doimiy), lekin mijoz FAQAT O'Z telefoni bo'yicha
   O'Z buyurtmasini ko'radi/to'laydi. Shunда boshqa mijozlar ma'lumoti sizmaydi
   va begona buyurtmани "to'landi" deb belgilab bo'lmaydi. */
const PAY_ACTIVE = "('new','accepted','ready','ontheway','arrived')";
function payNormPhone(p) { return String(p == null ? '' : p).replace(/\D/g, ''); }
/* Telefon mosligi (oxirgi raqamlar bo'yicha — +998 bilan yoki bilamsiz kiritса ham) */
function phoneMatches(a, b) {
  const x = payNormPhone(a), y = payNormPhone(b);
  if (x.length < 7 || y.length < 7) return false;
  return x.endsWith(y) || y.endsWith(x);
}

/* GET /api/pay/:token — QR skanerlanganda: FAQAT kuryer nomi (mijozlar ma'lumoti YO'Q) */
router.get('/pay/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token kerak' });
  const c = db.prepare('SELECT name, emoji FROM couriers WHERE pay_token = ?').get(token);
  if (!c) return res.status(404).json({ error: 'QR yaroqsiz' });
  res.json({ courier: c.name, emoji: c.emoji || '🛵' });
});

/* POST /api/pay/:token/lookup — mijoz O'Z telefoni bo'yicha FAQAT O'Z buyurtmalarini oladi */
router.post('/pay/:token/lookup', (req, res) => {
  const token = String(req.params.token || '').trim();
  const phone = payNormPhone(req.body && req.body.phone);
  const c = db.prepare('SELECT * FROM couriers WHERE pay_token = ?').get(token);
  if (!c) return res.status(404).json({ error: 'QR yaroqsiz' });
  if (phone.length < 7) return res.status(400).json({ error: 'Telefon raqamini to`liq kiriting' });
  const rows = db.prepare(
    `SELECT id, item, emoji, amount, pay, phone FROM orders
     WHERE courier = ? AND paid = 0 AND status IN ${PAY_ACTIVE} ORDER BY id DESC`
  ).all(c.name).filter((o) => phoneMatches(o.phone, phone));
  res.json({
    courier: c.name, emoji: c.emoji || '🛵',
    orders: rows.map((o) => ({ id: o.id, item: o.item, emoji: o.emoji, amount: o.amount, pay: o.pay })),
  });
});

/* POST /api/pay/:token/:orderId — mijoz O'Z buyurtmasini to'laydi (telefon MOS kelishi shart) */
router.post('/pay/:token/:orderId', (req, res) => {
  const token = String(req.params.token || '').trim();
  const id = Number(req.params.orderId);
  const phone = payNormPhone(req.body && req.body.phone);
  const c = db.prepare('SELECT * FROM couriers WHERE pay_token = ?').get(token);
  if (!c) return res.status(404).json({ error: 'QR yaroqsiz' });
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (o.courier !== c.name) return res.status(403).json({ error: 'Bu buyurtma bu kuryerга tegishli emas' });
  if (!phoneMatches(o.phone, phone)) return res.status(403).json({ error: 'Telefon raqami mos kelmadi' });
  if (o.status === 'cancelled') return res.status(409).json({ error: 'Buyurtma bekor qilingan' });
  if (o.paid) return res.json({ ok: true, already: true, order: { id: o.id, item: o.item, amount: o.amount } });
  db.prepare("UPDATE orders SET paid = 1, paid_at = datetime('now') WHERE id = ?").run(id);
  res.json({ ok: true, order: { id: o.id, item: o.item, amount: o.amount } });
});

/* GET /api/users — ro'yxatdan o'tgan foydalanuvchilar (admin) */
router.get('/users', requireRole('admin'), (_req, res) => {
  const rows = db.prepare("SELECT id, login, name, phone, created_at FROM accounts WHERE role = 'user' ORDER BY id DESC").all();
  res.json(rows.map((u) => ({ id: u.id, login: u.login, name: u.name, phone: u.phone || '', joined: (u.created_at || '').slice(0, 10) })));
});

export default router;
