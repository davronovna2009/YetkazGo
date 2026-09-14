/* ===== /api/bootstrap, /api/restaurants, /api/couriers ===== */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { requireRole, hashPassword } from '../auth.js';
import { getOverrides } from './dishes.js';
import { liveRatings } from '../ratings.js';
import { publicSettings, setSetting, KEYS } from '../settings.js';
import { toImageUrl } from './upload.js';
import { detectHabit } from '../habit.js';

const router = Router();

/* Test rejimida (npm test) kesh O'CHIQ — E2E yozib darhol o'qiydi, hammasi
   DARHOL yangi bo'lishi kerak. Boshqa joyda (rate-limit) ham shu bayroq. */
const IS_TEST = process.env.NODE_ENV === 'test';

/* Restoran/kuryer reytingi — bazadagi qotib qolgan son emas, JONLI hisob
   (ratings.js: mijozlar bergan izohlar o'rtachasi).
   MUHIM: `live` ni tekshiruvchi — `.map(restRow)` chaqirilса Array.map INDEKSni
   ikkinchi argument qilib beradi (son). Shuning uchun `live` haqiqiy obyekt
   ekanini tekshiramiz, aks holda o'zimiz hisoblaymiz. */
function ratingsOf(live) { return (live && live.rests) ? live : liveRatings(); }
/* MUHIM: `commission` — SAYT KOMISSIYASI. U MIJOZGA/ommaviy saytga
   KO'RSATILMAYDI. Shuning uchun ommaviy javoblarда (bootstrap, ochiq
   /restaurants) bu maydon UMUMAN yuborilmaydi — hatto tarmoq so'rovida ham
   ko'rinmaydi. Faqat autentifikatsiyalangan joylar (restoran o'zi, admin)
   `withCommission=true` bilan oladi. */
function restRow(r, live, withCommission = false) {
  const lr = ratingsOf(live).rests[r.name];
  const out = {
    id: r.id, name: r.name, nameCyr: r.name_cyr, emoji: r.emoji, kw: r.kw,
    rating: lr ? lr.rating : 0, ratingCount: lr ? lr.count : 0,
    eta: r.eta, dist: r.dist, photo: r.photo, login: r.login,
    openH: r.open_h != null ? r.open_h : 9, closeH: r.close_h != null ? r.close_h : 23,
    addr: r.addr || '', owner: r.owner || '', email: r.email || '', descr: r.descr || '', hours: r.hours || '', area: r.area || '',
    active: !!r.active,
  };
  if (withCommission) {
    out.commission = r.commission != null ? r.commission : 18;
    /* Restoran telefoni accounts.phone da turadi (restaurants jadvalида ustun yo'q).
       Admin panel tahrirlash formasi shundan oladi. */
    try {
      const acc = db.prepare("SELECT phone FROM accounts WHERE login = ? AND role = 'restoran'").get(r.login);
      out.phone = acc ? (acc.phone || '') : '';
    } catch (e) { out.phone = ''; }
  }
  return out;
}
/* HAQIQIY yetkazishlar soni va to'langan haq — buyurtmalardan hisoblanadi.
   Ilgari `couriers.deliveries` ustuni ishlatilardi: uni admin qo'lда kiritardi
   va u hech qachon o'zi ko'paymasdi — panelda "0 ta yetkazgan" turaverardi,
   daromad esa (deliveries × fee) shundan kelib chiqib soxta chiqardi. */
function courierDone(name, fee) {
  try {
    /* courier_fee — yetkazilgan paytda muhrlangan haq. Muhrlanmagan (eski)
       buyurtmalar uchun kuryerning JORIY haqiga tushamiz. */
    return db.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN courier_fee >= 0 THEN courier_fee ELSE ? END), 0) AS earned'
      + " FROM orders WHERE courier = ? AND status = 'done'"
    ).get(Math.max(0, Number(fee) || 0), String(name || '')) || { n: 0, earned: 0 };
  } catch (e) { return { n: 0, earned: 0 }; }
}

/* Kuryerning O'RTACHA yetkazish vaqti (daqiqa) — yetkazilgan buyurtmalar
   bo'yicha: buyurtma kelgan paytdan "Yetkazdim"gacha. Ma'lumot yo'q -> 0.
   Ustama: eng tez / eng sekin ham qaytaramiz (kuryer ma'lumotida ko'rinadi). */
function courierSpeed(name) {
  let rows = [];
  try {
    rows = db.prepare(
      "SELECT created_at, arrived_at, done_at FROM orders WHERE courier = ? AND status = 'done'"
    ).all(String(name || ''));
  } catch (e) { return { avgMin: 0, fastMin: 0, slowMin: 0, n: 0 }; }
  const st = (s) => { if (!s) return 0; const t = Date.parse(String(s).replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : 0; };
  const mins = [];
  for (const r of rows) {
    const a = st(r.created_at), b = st(r.arrived_at || r.done_at || '');
    if (a && b && b >= a) mins.push(Math.round((b - a) / 60000));
  }
  if (!mins.length) return { avgMin: 0, fastMin: 0, slowMin: 0, n: 0 };
  const sum = mins.reduce((x, y) => x + y, 0);
  return {
    avgMin: Math.round(sum / mins.length),
    fastMin: Math.min(...mins),
    slowMin: Math.max(...mins),
    n: mins.length,
  };
}

function courRow(c, live) {
  const lr = ratingsOf(live).couriers[c.name];
  const fee = c.fee != null ? c.fee : 0;
  const d = courierDone(c.name, fee);
  const sp = courierSpeed(c.name);
  return {
    id: c.id, name: c.name, emoji: c.emoji, rest: c.rest, login: c.login,
    /* deliveries — REAL yetkazilgan buyurtmalar soni (jadvaldagi qo'l bilan
       kiritilgan son emas). earned — o'sha buyurtmalar uchun to'langan haq. */
    phone: c.phone, deliveries: d.n, earned: d.earned,
    /* O'RTACHA yetkazish vaqti (daqiqa) + eng tez/sekin — real buyurtmalardan */
    avgDeliveryMin: sp.avgMin, fastDeliveryMin: sp.fastMin, slowDeliveryMin: sp.slowMin,
    rating: lr ? lr.rating : 0, ratingCount: lr ? lr.count : 0,
    fee: c.fee != null ? c.fee : 0, transport: c.transport || '', plate: c.plate || '', address: c.address || '', email: c.email || '', birthdate: c.birthdate || '', passport: c.passport || '',
    active: !!c.active,
    openH: c.open_h != null ? c.open_h : 8, closeH: c.close_h != null ? c.close_h : 22,
    onLeave: !!c.on_leave, leaveReason: c.leave_reason || '', leaveStatus: c.leave_status || 'none',
  };
}

/* GET /api/bootstrap — bosh sahifa va panellar uchun ommaviy snapshot.
   Buyurtmalar (maxfiy) alohida /api/orders orqali (token bilan) olinadi. */
/* ===== BOOTSTRAP KESHI — TEJAMKOR ko'p foydalanuvchida =====
   Bu ENG KO'P so'raladigan endpoint: HAR ochiq panel/sahifa uni 5 soniyada bir
   so'raydi (assets/js/store.js). Foydalanuvchi ko'paysa (10, 100, 1000 ulanish),
   bu yerдаgi bir necha SELECT (izohlar, e'lonlar, restoranlar, taomlar, reyting,
   sozlamalar) har mijozга alohida QAYTA bajarilса — server sekinlashadi.
   Qisqa (2 soniyalik) keshda BARCHA mijozlar bitta hisobни baham ko'radi:
   server yuki mijozlar soniga BOG'LIQ EMAS, faqat kesh oynasiga bog'liq bo'ladi.
   Test rejimida O'CHIQ — E2E yozib darhol yangi natijani ko'rishi shart. */
const BOOT_CACHE_MS = IS_TEST ? 0 : 2000;
let _bootCache = null, _bootCacheAt = 0;

router.get('/bootstrap', (_req, res) => {
  const now = Date.now();
  if (_bootCache && (now - _bootCacheAt) < BOOT_CACHE_MS) { res.json(_bootCache); return; }
  /* Izohlar — admin javobi (reply) bilan birga: saytda izoh ostida ko'rinadi,
     admin panelida esa boshqariladi (o'chirish / javob yozish). */
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC').all().map(r => ({
    id: r.id, name: r.name, ava: r.ava, rating: r.rating, dish: r.dish, rest: r.rest || '',
    text: r.text, textCyr: r.text_cyr || '', flagged: !!r.flagged, date: r.date,
    reply: r.reply || '', replyAt: r.reply_at || '', created_at: r.created_at || '',
  }));
  const announcements = db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 20').all().map(a => ({
    id: a.id, rest: a.rest, text: a.text, emoji: a.emoji, tag: a.tag, dish: a.dish, img: a.img || '',
  }));
  /* Bonuslar — kabinet "Bonuslar" bo'limi va reklama banner shu yerdan oladi */
  const bonuses = db.prepare('SELECT * FROM bonuses WHERE active = 1 ORDER BY id DESC').all().map(b => ({
    id: b.id, scope: b.scope, rest: b.rest || '', title: b.title, descr: b.descr || '',
    image: b.image || '', type: b.type, target: b.target || 0, rewardText: b.reward_text || '',
  }));
  /* Reytinglar BIR MARTA hisoblanadi va restoran/taomlarga tarqatiladi */
  const live = liveRatings();
  const restaurants = db.prepare('SELECT * FROM restaurants WHERE active = 1 ORDER BY id').all()
    .map((r) => restRow(r, live));
  _bootCache = {
    reviews, overrides: getOverrides(live), announcements, restaurants, bonuses,
    /* Taom va kuryer reytinglari — sayt yulduzchalarni SHU YERDAN oladi */
    ratings: { dishes: live.dishes, couriers: live.couriers },
    /* Sayt egasining raqami (miqdor cheklovi xabarida ko'rsatiladi) */
    settings: publicSettings(),
  };
  _bootCacheAt = now;
  res.json(_bootCache);
});

/* GET /api/settings — ommaviy (sayt egasi raqami). PATCH — faqat admin. */
router.get('/settings', (_req, res) => res.json(publicSettings()));

/* GET /api/habit?phone=... — "AI maslahat": shu telefon HOZIR (Toshkent
   vaqti bo'yicha) odatiy buyurtma vaqtida bo'lsa va hali bugun olmagan
   bo'lsa — taklif qilinadigan taomni qaytaradi (server/src/habit.js).
   Ochiq endpoint — sayt hali login talab qilmaydi (mehmon ham tekshiriladi). */
router.get('/habit', (req, res) => {
  const phone = String(req.query.phone || '');
  if (!phone) return res.json({ dish: null });
  let dish = null;
  try { dish = detectHabit(phone); } catch (e) { dish = null; }
  res.json({ dish });
});

const BOOL01 = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? '1' : '0');
router.patch('/settings', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  for (const k of KEYS) { if (b[k] != null && k !== 'pay_extra') setSetting(k, b[k]); }
  /* Frontend camelCase yuborsa ham qabul qilamiz */
  const camel = {
    ownerPhone: 'owner_phone', ownerName: 'owner_name',
    supportPhone: 'support_phone', supportUsername: 'support_username',
    supportLink: 'support_link', supportNote: 'support_note',
  };
  for (const [c, k] of Object.entries(camel)) { if (b[c] != null) setSetting(k, b[c]); }
  /* Boolean toggle'lar — "1"/"0" ga normallashtiriladi */
  const bools = {
    supportPhoneOn: 'support_phone_on', supportUsernameOn: 'support_username_on', supportLinkOn: 'support_link_on',
    payCashOn: 'pay_cash_on', payCardOn: 'pay_card_on',
    dailyReportOn: 'daily_report_on',
  };
  for (const [c, k] of Object.entries(bools)) { if (b[c] != null) setSetting(k, BOOL01(b[c])); }
  /* ===== REYTING sozlamalari ===== */
  if (b.dishRatingSrc != null || b.dish_rating_src != null) {
    const v = String(b.dishRatingSrc != null ? b.dishRatingSrc : b.dish_rating_src).toLowerCase();
    if (['sales', 'reviews', 'blend'].includes(v)) setSetting('dish_rating_src', v);
  }
  /* dishStarThresholds: [t1..t5] massiv YOKI alohida dish_star_tN */
  if (Array.isArray(b.dishStarThresholds)) {
    b.dishStarThresholds.slice(0, 5).forEach((v, i) => {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) setSetting('dish_star_t' + (i + 1), String(Math.min(100000, n)));
    });
  }
  for (let i = 1; i <= 5; i++) {
    const k = 'dish_star_t' + i;
    if (b[k] != null) { const n = parseInt(b[k], 10); if (Number.isFinite(n) && n > 0) setSetting(k, String(Math.min(100000, n))); }
  }
  /* Custom to'lov turlari — massiv, JSON matn sifatida saqlanadi */
  if (b.payExtra != null || b.pay_extra != null) {
    const raw = b.payExtra != null ? b.payExtra : b.pay_extra;
    let arr = [];
    try { arr = Array.isArray(raw) ? raw : JSON.parse(String(raw || '[]')); } catch (e) { arr = []; }
    const clean = (Array.isArray(arr) ? arr : [])
      .filter((x) => x && x.label)
      .slice(0, 10)
      .map((x, i) => ({
        id: String(x.id || ('extra' + i)).replace(/[^a-z0-9_]/gi, '').slice(0, 30) || ('extra' + i),
        label: String(x.label).slice(0, 40),
        note: String(x.note || '').slice(0, 200),
      }));
    setSetting('pay_extra', JSON.stringify(clean));
  }
  res.json(publicSettings());
});

/* GET /api/restaurants */
router.get('/restaurants', (_req, res) => {
  const live = liveRatings();
  res.json(db.prepare('SELECT * FROM restaurants ORDER BY id').all().map((r) => restRow(r, live)));
});

/* GET /api/couriers — admin */
router.get('/couriers', requireRole('admin'), (_req, res) => {
  const live = liveRatings();
  res.json(db.prepare('SELECT * FROM couriers ORDER BY id').all().map((c) => courRow(c, live)));
});

/* GET /api/admin/restaurants — ADMIN uchun to'liq ro'yxat (KOMISSIYA bilan).
   Ommaviy /bootstrap va /restaurants komissiyani yubormaydi (mijozga ko'rinmasin);
   admin panel esa komissiyani shu autentifikatsiyalangan endpoint'дан oladi.
   Barcha restoranlar (nofaol ham) qaytadi — admin hammasini boshqaradi. */
router.get('/admin/restaurants', requireRole('admin'), (_req, res) => {
  const live = liveRatings();
  res.json(db.prepare('SELECT * FROM restaurants ORDER BY id').all().map((r) => restRow(r, live, true)));
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
  /* Ish vaqti — admin bergan bo'lsa AYNAN shu, aks holda standart 9–23.
     Ilgari bu ustunlar INSERT'ga qo'shilmasdi: admin 24 soat qo'ysa ham yangi
     restoran 09:00–23:00 bo'lib qolar va shu vaqtdan tashqarida buyurtma
     qabul qilmasdi (pricing.js ish vaqtini tekshiradi). */
  const openH = b.openH != null ? Math.max(0, Math.min(23, Number(b.openH) || 0)) : 9;
  const closeH = b.closeH != null ? Math.max(1, Math.min(24, Number(b.closeH) || 24)) : 23;
  /* ATOMAR: akkaunt va restoran BIRGA yaratiladi. Ilgari ikki alohida INSERT
     edi — biri o'tib, ikkinchisi yiqilsa (masalan nom band), yarim yaratilib
     "loginsiz restoran" yoki "restoransiz akkaunt" qolib ketardi. Transaksiya
     ikkovини bir vaqtda muvaffaqiyatli qiladi yoki ikkovини ham bekor qiladi. */
  const createRest = db.transaction(() => {
    db.prepare('INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)')
      .run(login, hashPassword(pass), 'restoran', name, String(b.phone || ''), 'restoran.html');
    db.prepare('INSERT INTO restaurants (name, name_cyr, emoji, kw, rating, eta, dist, photo, login, commission, addr, owner, email, descr, hours, area, open_h, close_h) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, String(b.nameCyr || ''), String(b.emoji || '🏪'), String(b.kw || ''), Number(b.rating) || 0,
           Number(b.eta) || 20, String(b.dist || ''), String(b.photo || ''), login, commission,
           String(b.addr || ''), String(b.owner || ''), String(b.email || ''), String(b.descr || ''), String(b.hours || ''), String(b.area || ''),
           openH, closeH);
  });
  try { createRest(); }
  catch (e) { console.error('Restoran yaratish xatosi:', e.message); return res.status(500).json({ error: 'Restoranni yaratib bo`lmadi' }); }
  res.status(201).json(restRow(db.prepare('SELECT * FROM restaurants WHERE name = ?').get(name), null, true));
});

/* DELETE /api/restaurants — login BO'LMASA nom bo'yicha (restoran + akkaunt).
   ESKI (login'siz/bo'sh login bilan yaratilgan chala) yozuvlar login orqali
   topilmay, "o'chirib bo'lmaydigan" bo'lib saytда abadiy qolib ketardi —
   shuning uchun `name` bo'yicha ham topib o'chiramiz. */
router.delete('/restaurants', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  const nameIn = String(req.body?.name || '').trim();
  if (!login && !nameIn) return res.status(400).json({ error: 'login yoki name kerak' });
  const r = login
    ? db.prepare('SELECT name, login FROM restaurants WHERE login = ?').get(login)
    : db.prepare('SELECT name, login FROM restaurants WHERE name = ?').get(nameIn);
  if (!r) return res.json({ ok: true }); // allaqachon yo'q — maqsadga erishildi
  const name = r.name;
  /* Restoran o'chirilganda uning TAOMLARI, e'lonlari va chegirmalari ham
     ketishi kerak — aks holda ular "yetim" bo'lib katalogда/saytда qolib
     ketardi (o'chirilgan restoranning taomlari ko'rinaverardi).
     Buyurtma TARIXI (orders) esa ataylab qoldiriladi — moliya hisoboti va
     nizolar uchun kerak. */
  db.prepare('DELETE FROM restaurants WHERE name = ?').run(name);
  /* Akkaunt — HAQIQIY login orqali (r.login), so'ralган login emas: agar
     restoran bo'sh login bilan yaratilgan bo'lsa ham, akkaunt nom bo'yicha
     topib o'chiriladi. */
  if (r.login) db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'restoran'").run(r.login);
  db.prepare("DELETE FROM accounts WHERE name = ? AND role = 'restoran'").run(name);
  for (const t of ['added_dishes', 'removed_dishes', 'discounts', 'soldout_dishes', 'announcements']) {
    try { db.prepare(`DELETE FROM ${t} WHERE rest = ?`).run(name); } catch (e) { /* jadval yo'q */ }
  }
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

  /* Kuryer ish vaqti — admin bergan bo'lsa AYNAN shu, aks holda standart 8–22 */
  const cOpenH = b.openH != null ? Math.max(0, Math.min(23, Number(b.openH) || 0)) : 8;
  const cCloseH = b.closeH != null ? Math.max(1, Math.min(24, Number(b.closeH) || 24)) : 22;
  /* ATOMAR: akkaunt va kuryer BIRGA yaratiladi (restorandagi kabi) — yarim
     yaratilib "loginsiz kuryer" qolib ketmasin. */
  const createCour = db.transaction(() => {
    db.prepare('INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)')
      .run(login, hashPassword(pass), 'kuryer', name, String(b.phone || ''), 'kuryer.html');
    db.prepare('INSERT INTO couriers (name, emoji, rest, login, phone, deliveries, rating, fee, transport, plate, address, email, birthdate, passport, open_h, close_h) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(name, String(b.emoji || '🛵'), String(b.rest || ''), login, String(b.phone || ''), Number(b.deliveries) || 0, Number(b.rating) || 0, Number(b.fee) || 0,
           String(b.transport || ''), String(b.plate || ''), String(b.address || ''), String(b.email || ''), String(b.birthdate || ''), String(b.passport || ''),
           cOpenH, cCloseH);
  });
  try { createCour(); }
  catch (e) { console.error('Kuryer yaratish xatosi:', e.message); return res.status(500).json({ error: 'Kuryerni yaratib bo`lmadi' }); }
  res.status(201).json(courRow(db.prepare('SELECT * FROM couriers WHERE login = ?').get(login)));
});

/* DELETE /api/couriers — login BO'LMASA nom bo'yicha (restorandagidek chala
   yaratilgan/login'i bo'sh eski yozuvlar ham o'chsin). */
router.delete('/couriers', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  const nameIn = String(req.body?.name || '').trim();
  if (!login && !nameIn) return res.status(400).json({ error: 'login yoki name kerak' });
  const c = login
    ? db.prepare('SELECT id, name, login FROM couriers WHERE login = ?').get(login)
    : db.prepare('SELECT id, name, login FROM couriers WHERE name = ?').get(nameIn);
  if (!c) return res.json({ ok: true }); // allaqachon yo'q — maqsadga erishildi
  db.prepare('DELETE FROM couriers WHERE id = ?').run(c.id);
  if (c.login) db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'kuryer'").run(c.login);
  db.prepare("DELETE FROM accounts WHERE name = ? AND role = 'kuryer'").run(c.name);
  res.json({ ok: true });
});

/* ===== Admin: tahrirlash (ism, telefon, parol, komissiya, fee) ===== */

/* POST /api/restaurants/photo — restoran EGASI faqat O'Z rasmini o'zgartiradi (admin — istalganini) */
router.post('/restaurants/photo', requireRole('restoran', 'admin'), (req, res) => {
  /* data: URL bo'lsa — /img/ ga aylantiramiz (bootstrap javobi shishmasin) */
  const photo = toImageUrl(req.body?.photo || '');
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

  res.json(restRow(db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login), null, true));
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
  /* Barcha matnli maydonlar — admin to'liq tahrirlaydi */
  for (const col of ['owner', 'email', 'addr', 'area', 'descr', 'hours', 'kw', 'dist']) {
    if (b[col] != null) db.prepare(`UPDATE restaurants SET ${col} = ? WHERE login = ?`).run(String(b[col]).slice(0, 500), login);
  }
  /* Kirill nomi (frontend camelCase yuboradi) */
  if (b.nameCyr != null) db.prepare('UPDATE restaurants SET name_cyr = ? WHERE login = ?').run(String(b.nameCyr).slice(0, 120), login);
  /* Yetkazish vaqti (daqiqa) — 5..120 */
  if (b.eta != null) db.prepare('UPDATE restaurants SET eta = ? WHERE login = ?').run(Math.max(5, Math.min(120, Number(b.eta) || 20)), login);
  if (b.pass) db.prepare("UPDATE accounts SET pass_hash = ? WHERE login = ? AND role = 'restoran'").run(hashPassword(String(b.pass)), login);

  res.json(restRow(db.prepare('SELECT * FROM restaurants WHERE login = ?').get(login), null, true));
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

/* GET /api/users — foydalanuvchilar (admin).
   Ikki guruh:
     registered — ro'yxatdan o'tganlar (accounts, role='user')
     guest      — ro'yxatdan O'TMASDAN buyurtma berganlar (orders, telefon
                  accounts'da yo'q). Mijoz kartochkasini ochganда shu ma'lumot
                  hamma joyda bir xil ko'rinadi. */
const digits = (s) => String(s || '').replace(/\D/g, '');
router.get('/users', requireRole('admin'), (_req, res) => {
  const accs = db.prepare("SELECT id, login, name, phone, email, created_at FROM accounts WHERE role = 'user' ORDER BY id DESC").all();
  const knownPhones = new Set(accs.map((u) => digits(u.phone)).filter(Boolean));

  const registered = accs.map((u) => ({
    id: u.id, type: 'registered', login: u.login, name: u.name, phone: u.phone || '', email: u.email || '',
    joined: (u.created_at || '').slice(0, 10),
  }));

  /* Mehmonlar — buyurtmalardan telefon bo'yicha guruhlab */
  const orders = db.prepare("SELECT user, phone, addr, amount, rest, created_at FROM orders WHERE status <> 'cancelled'").all();
  const gmap = new Map();
  for (const o of orders) {
    const d = digits(o.phone);
    if (!d || knownPhones.has(d)) continue;       // ro'yxatdan o'tganlar bu yerда emas
    if (!gmap.has(d)) gmap.set(d, { phone: o.phone, name: o.user || '', addr: o.addr || '', count: 0, spent: 0, rests: new Set(), last: '' });
    const g = gmap.get(d);
    g.count++; g.spent += (o.amount || 0);
    if (o.rest) g.rests.add(o.rest);
    if (o.user && !g.name) g.name = o.user;
    if ((o.created_at || '') > g.last) g.last = o.created_at || '';
    if (o.addr && !g.addr) g.addr = o.addr;
  }
  const guests = [...gmap.entries()].map(([d, g], i) => ({
    id: 'g_' + d, type: 'guest', name: g.name || 'Mehmon', phone: g.phone,
    addr: g.addr, orders: g.count, spent: g.spent, rests: g.rests.size,
    last: (g.last || '').slice(0, 10),
  })).sort((a, b) => b.orders - a.orders);

  res.json({ registered, guests });
});

/* PATCH /api/users — admin foydalanuvchi ma'lumotini tahrirlaydi
   (restoran/kuryerdagi kabi: ism, telefon, email, login, parol).
   Nom o'zgarsa — buyurtmalardagi `user` ham yangilanadi, aks holda mijoz
   o'z buyurtmalarini ko'rmay qolardi (GET /api/orders `user = ?` bo'yicha). */
router.patch('/users', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const id = Number(b.id);
  if (!id) return res.status(400).json({ error: 'id kerak' });
  const u = db.prepare("SELECT * FROM accounts WHERE id = ? AND role = 'user'").get(id);
  if (!u) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  if (b.login != null) {
    const login = String(b.login).trim();
    if (login.length < 3) return res.status(400).json({ error: 'Login kamida 3 belgi bo`lsin' });
    if (login !== u.login && db.prepare('SELECT 1 FROM accounts WHERE login = ?').get(login)) {
      return res.status(409).json({ error: 'Bu login band' });
    }
    db.prepare('UPDATE accounts SET login = ? WHERE id = ?').run(login, id);
  }
  if (b.name != null) {
    const name = String(b.name).trim();
    if (name && name !== u.name) {
      db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name, id);
      db.prepare('UPDATE orders SET user = ? WHERE user = ?').run(name, u.name);
    }
  }
  if (b.phone != null) db.prepare('UPDATE accounts SET phone = ? WHERE id = ?').run(String(b.phone).slice(0, 40), id);
  if (b.email != null) db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(String(b.email).slice(0, 120), id);
  if (b.pass) {
    if (String(b.pass).length < 6) return res.status(400).json({ error: 'Parol kamida 6 belgi bo`lsin' });
    db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(String(b.pass)), id);
  }

  const n = db.prepare('SELECT id, login, name, phone, email, created_at FROM accounts WHERE id = ?').get(id);
  res.json({ id: n.id, login: n.login, name: n.name, phone: n.phone || '', email: n.email || '', joined: (n.created_at || '').slice(0, 10) });
});

/* ===== LOGINLAR RO'YXATI + PAROL YANGILASH (faqat admin) =====
   Parollar bazada XESHLANGAN — hech qachon qaytarilmaydi. Bu yerда admin
   barcha akkauntlar loginini bir joyдан ko'radi va kerak bo'lsa yangi parol
   o'rnatadi (yangi parol javobда BIR MARTA qaytadi — nusxa olib egasiga beriladi). */

/* GET /api/accounts — barcha akkauntlar (login, rol, ism, telefon). Parolsiz. */
router.get('/accounts', requireRole('admin'), (_req, res) => {
  const rows = db.prepare(
    'SELECT id, login, role, name, phone, email, created_at FROM accounts ORDER BY role, login'
  ).all();
  res.json(rows.map((a) => ({
    id: a.id, login: a.login, role: a.role, name: a.name || '',
    phone: a.phone || '', email: a.email || '', joined: (a.created_at || '').slice(0, 10),
  })));
});

/* POST /api/accounts/reset-password — istalgan akkauntга yangi parol.
   body: { login, pass? } — pass berilmasa tasodifiy kuchli parol yaratiladi.
   Javob: { ok, login, role, name, pass } — pass FAQAT shu javobда ko'rinadi. */
router.post('/accounts/reset-password', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const acc = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
  if (!acc) return res.status(404).json({ error: 'Akkaunt topilmadi' });

  let pass = String(req.body?.pass || '').trim();
  if (!pass) pass = 'yz-' + randomBytes(6).toString('base64url');   // tasodifiy kuchli parol
  if (pass.length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgi bo`lsin' });

  db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(pass), acc.id);
  res.json({ ok: true, login: acc.login, role: acc.role, name: acc.name || '', pass });
});

/* POST /api/accounts/update — istalgan akkaunt LOGIN va/yoki PAROLINI o'zgartirish.
   FAQAT ADMIN. Restoran/kuryer/mijoz o'zi login/parolini O'ZGARTIRA OLMAYDI —
   /api/auth/me endi bularni qabul qilmaydi.
   body: { login (joriy), newLogin?, pass? }
   Javob: { ok, login, role, name, pass? } — pass FAQAT o'zgartirilsa va shu javobда. */
router.post('/accounts/update', requireRole('admin'), (req, res) => {
  const b = req.body || {};
  const login = String(b.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const acc = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
  if (!acc) return res.status(404).json({ error: 'Akkaunt topilmadi' });

  const newLogin = b.newLogin != null ? String(b.newLogin).trim() : '';
  const pass = b.pass != null ? String(b.pass).trim() : '';
  if (!newLogin && !pass) return res.status(400).json({ error: 'newLogin yoki pass kerak' });

  const tx = db.transaction(() => {
    if (newLogin && newLogin !== acc.login) {
      if (newLogin.length < 3) throw Object.assign(new Error('Login kamida 3 belgi bo`lsin'), { code: 400 });
      if (db.prepare('SELECT 1 FROM accounts WHERE login = ? AND id <> ?').get(newLogin, acc.id)) {
        throw Object.assign(new Error('Bu login band'), { code: 409 });
      }
      db.prepare('UPDATE accounts SET login = ? WHERE id = ?').run(newLogin, acc.id);
      /* Login nusxasi restaurants/couriers jadvalида ham turadi (ko'p so'rov shu
         nusxa bo'yicha kalitlanadi) — birga yangilaymiz, aks holda "ikki joyда
         ikki xil" bo'lib qolardi. */
      if (acc.role === 'restoran') db.prepare('UPDATE restaurants SET login = ? WHERE login = ?').run(newLogin, acc.login);
      else if (acc.role === 'kuryer') db.prepare('UPDATE couriers SET login = ? WHERE login = ?').run(newLogin, acc.login);
    }
    if (pass) {
      if (pass.length < 4) throw Object.assign(new Error('Parol kamida 4 belgi bo`lsin'), { code: 400 });
      db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(pass), acc.id);
    }
  });
  try { tx(); }
  catch (e) { return res.status(e.code || 500).json({ error: e.message || 'Yangilab bo`lmadi' }); }

  const n = db.prepare('SELECT login, role, name FROM accounts WHERE id = ?').get(acc.id);
  const out = { ok: true, login: n.login, role: n.role, name: n.name || '' };
  if (pass) out.pass = pass;
  res.json(out);
});

/* DELETE /api/accounts — akkauntni BUTUNLAY o'chirish (login bo'yicha).
   Nega kerak: restoran/kuryer profili (restaurants/couriers jadvali)
   o'chirilgach ham, ba'zan akkaunt (accounts jadvali) qolib ketadi —
   "arvoh login". U "Restoranlar"/"Kuryerlar" bo'limida KO'RINMAYDI (chunki
   o'sha jadvalда qatori yo'q), lekin "Loginlar"da ko'rinaveradi va u bilan
   HALI HAM tizimga kirish mumkin bo'lib qoladi. Shu yerда uni ham,
   restaurants/couriers'даgi mos qatorni ham (bo'lsa) birga tozalaymiz. */
router.delete('/accounts', requireRole('admin'), (req, res) => {
  const login = String(req.body?.login || '').trim();
  if (!login) return res.status(400).json({ error: 'login kerak' });
  const acc = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
  if (!acc) return res.json({ ok: true }); // allaqachon yo'q — maqsadga erishildi
  if (req.user && req.user.login === acc.login) {
    return res.status(400).json({ error: "O'zingizning akkauntingizni o'chira olmaysiz" });
  }
  db.prepare('DELETE FROM accounts WHERE id = ?').run(acc.id);
  if (acc.role === 'restoran') {
    const r = db.prepare('SELECT name FROM restaurants WHERE login = ? OR name = ?').get(acc.login, acc.name);
    db.prepare('DELETE FROM restaurants WHERE login = ? OR name = ?').run(acc.login, acc.name);
    const name = r ? r.name : acc.name;
    if (name) {
      for (const t of ['added_dishes', 'removed_dishes', 'discounts', 'soldout_dishes', 'announcements']) {
        try { db.prepare(`DELETE FROM ${t} WHERE rest = ?`).run(name); } catch (e) { /* jadval yo'q */ }
      }
    }
  } else if (acc.role === 'kuryer') {
    db.prepare('DELETE FROM couriers WHERE login = ? OR name = ?').run(acc.login, acc.name);
  }
  res.json({ ok: true });
});

export default router;
