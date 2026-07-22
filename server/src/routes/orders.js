/* ===== /api/orders — buyurtmalar ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
/* Buyurtma yaratish/o'qish yordamchilari — sayt va bot uchun BITTA manba */
import { createOrder, OrderError, rowToOrder, parseItems, prettyPhone } from '../orders-core.js';
/* Telegram xabarlari (bot o'chiq bo'lsa — jim o'tadi) */
import { notifyCustomerStatus, notifyNewOrder, notifyStaffStatus } from '../bot.js';
/* Telefon raqami cheklovlari — ketma-ket bekor qilishga qarshi */
import { registerCancel, clearOnSuccess } from '../blocks.js';

const router = Router();

/* Migratsiyalar (token/reason/delivery) db.js initSchema() da — jadval yaratilgandan
   keyin ishlaydi. Bu yerda (import paytida) yozilsa, yangi bazada jadval hali yo'q
   bo'lib jim yiqilardi va ustun umuman qo'shilmasdi. */

/* PATCH bilan o'zgartirsa BO'LADIGAN maydonlar (xodimlar uchun).
   Eslatma: 'paid' YO'Q — to'lov faqat QR endpointлари orqali (telefon tasdig'i bilan).
   MUHIM: 'amount', 'item', 'rest', 'emoji', 'user', 'phone', 'delivery' ham YO'Q —
   summa va tarkib buyurtma yaratilganда serverда hisoblanadi (pricing.js) va keyin
   O'ZGARMAYDI. Aks holda xodim narxni qayta yozib, tekshiruvni chetlab o'tardi.
   Panellar faqat status/reason yuboradi (kuryer.js:118, restoran.js:544,570). */
const ALLOWED = ['status', 'reason', 'courier', 'eta', 'time'];

/* Buyurtma bosqichlari — boshqa qiymat bazaga tushmasin */
const STATUSES = ['new', 'accepted', 'ready', 'ontheway', 'arrived', 'done', 'cancelled'];

/* Yangi buyurtma xabarnomasi (restoran + kuryer + admin/operator guruhi) —
   butun mantiq bot.js da: sayt va bot AYNAN bir xil xabar yuboradi. */

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

/* POST /api/orders — ochiq (mehmon checkout: bosh sahifadan ham buyurtma berish mumkin).
   Butun logika orders-core.js da — bot ham AYNAN shuni chaqiradi. */
router.post('/', (req, res) => {
  let created;
  try {
    created = createOrder(req.body || {});
  } catch (e) {
    if (e instanceof OrderError) return res.status(e.status).json({ error: e.message });
    console.error('Buyurtma yaratish xatosi:', e);
    return res.status(500).json({ error: 'Buyurtmani yaratib bo`lmadi' });
  }

  /* Telegram xabarnomasini bloklamasdan yuboramiz (tarkibi bilan) */
  notifyNewOrder(created.order, created.lines);

  /* Javobда token QAYTADI — frontend uni localStorage'da saqlab, keyin
     bekor qilish/qabul qilishda yuboradi. */
  res.status(201).json({ ...created.order, token: created.token });
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

/* POST /api/orders/:id/cancel — mijoz buyurtmani bekor qiladi (token yoki xodim talab qilinadi).

   MIJOZ bekor qilganда telefon raqami bo'yicha hisob yuritiladi (blocks.js):
     1-marta — ogohlantirishsiz
     2-marta — ogohlantirish + 5 daqiqaga buyurtma berish cheklanadi
     3-marta — raqam bloklanadi (admin panelidan ochiladi)
   XODIM (admin/restoran/kuryer) bekor qilsa — mijoz jazolanmaydi. */
const STAFF_ROLES = ['admin', 'restoran', 'kuryer'];

router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canMutate(o, req)) return res.status(403).json({ error: 'Ruxsat yo`q' });

  const alreadyCancelled = o.status === 'cancelled';
  if (['new', 'accepted', 'ready'].includes(o.status)) {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
  } else if (!alreadyCancelled) {
    return res.status(409).json({ error: 'Bu bosqichda bekor qilib bo`lmaydi (kuryer yo`lda)' });
  }

  const updated = rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  const byStaff = req.user && STAFF_ROLES.includes(req.user.role);

  /* Hisob FAQAT haqiqiy bekor qilishда oshadi (takroriy so'rov jazolamaydi).
     Bloklanса — adminlarga xabarni blocks.js ning O'ZI yuboradi
     (app.js: setAutoBlockNotifier), shuning uchun bu yerда takrorlamaymiz. */
  let penalty = null;
  if (!byStaff && !alreadyCancelled) penalty = registerCancel(o.phone, o.user);

  if (!alreadyCancelled) notifyStaffStatus(updated, o.status, byStaff ? req.user.role : '');

  res.json(Object.assign(updated, penalty ? {
    warn: penalty.message,
    warnLevel: penalty.level,       // 1 = eslatma, 2 = ogohlantirish+pauza, 3 = blok
    cancels: penalty.cancels,
    blocked: penalty.blocked,
    pausedSeconds: penalty.pausedSeconds,
  } : {}));
});

/* POST /api/orders/:id/received — mijoz "qabul qildim" deydi (arrived -> done) */
router.post('/:id/received', (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (!canMutate(o, req)) return res.status(403).json({ error: 'Ruxsat yo`q' });

  // Mijoz tasdiqlaganda — aniq yetkazilgan vaqtni yozamiz (done_at, UTC)
  if (o.status === 'arrived') {
    db.prepare("UPDATE orders SET status = 'done', done_at = datetime('now') WHERE id = ?").run(id);
    /* Buyurtma muvaffaqiyatli yakunlandi — bekor qilish hisobi nolga qaytadi */
    clearOnSuccess(o.phone);
  }
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
  if ('status' in patch && !STATUSES.includes(String(patch.status))) {
    return res.status(400).json({ error: 'Buyurtma holati noto`g`ri' });
  }
  const sets = [], params = [];
  for (const k of ALLOWED) {
    if (k in patch) { sets.push(`${k} = ?`); params.push(patch[k]); }
  }
  /* "done" ga o'tganda — aniq yetkazilgan vaqtni bir marta yozamiz (server tomonда, UTC) */
  if (patch.status === 'done' && existing.status !== 'done') {
    sets.push("done_at = datetime('now')");
  }
  /* Kuryer "Yetkazdim" bosgan payt — AUTO_CONFIRM_MIN dan keyin avtomatik tasdiq uchun */
  if (patch.status === 'arrived' && existing.status !== 'arrived') {
    sets.push("arrived_at = datetime('now')");
  }
  if (sets.length) {
    params.push(id);
    db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  /* Telegram botdan buyurtma bergan mijozga holat o'zgarganini bildiramiz.
     Bloklamaydi — bot o'chiq yoki xato bo'lsa jim o'tadi. */
  if ('status' in patch && patch.status !== existing.status) {
    notifyCustomerStatus(updated, existing.status);
    /* Ikkinchi tomon (restoran ↔ kuryer) va adminlar ham Telegramда ko'radi */
    notifyStaffStatus(updated, existing.status, req.user.role);
    /* Muvaffaqiyatli yakun — mijozning bekor qilish hisobi tozalanadi */
    if (patch.status === 'done') clearOnSuccess(updated.phone);
  }
  res.json(rowToOrder(updated));
});

/* ===== 30 daqiqalik AVTOMATIK TASDIQ =====
   Mijoz "Qabul qildim" bosmasa ham, kuryer "Yetkazdim" bosgandan 30 daqiqa
   o'tgach buyurtma o'zi 'done' bo'ladi. Aks holda buyurtma abadiy 'arrived'
   holatida osilib qolardi va kuryer daromadi (done bo'yicha hisoblanadi)
   hech qachon yozilmasdi.
   Eski (arrived_at yozilmagan) buyurtmalar uchun created_at ga tayanamiz. */
const AUTO_CONFIRM_MIN = 30;

export function autoConfirmArrived() {
  try {
    const WHERE = `status = 'arrived'
       AND datetime(COALESCE(NULLIF(arrived_at, ''), created_at), '+${AUTO_CONFIRM_MIN} minutes') <= datetime('now')`;
    /* Kimlar yopilishini OLDIN olamiz — keyin ularga Telegramда xabar beramiz */
    const due = db.prepare(`SELECT * FROM orders WHERE ${WHERE}`).all();
    if (!due.length) return;
    db.prepare(`UPDATE orders SET status = 'done', done_at = datetime('now') WHERE ${WHERE}`).run();
    console.log(`[AUTO] ${due.length} ta buyurtma ${AUTO_CONFIRM_MIN} daqiqadan keyin avtomatik tasdiqlandi`);
    for (const o of due) {
      notifyCustomerStatus({ ...o, status: 'done', auto: true }, 'arrived');
      clearOnSuccess(o.phone);
    }
  } catch (e) {
    console.warn('[AUTO] avtomatik tasdiq xatosi:', e.message);
  }
}

/* Har daqiqada tekshiramiz (server ishga tushganда app.js chaqiradi) */
export function startAutoConfirm() {
  autoConfirmArrived();                       // qayta ishga tushganда qolib ketganlarini darrov yopamiz
  const t = setInterval(autoConfirmArrived, 60 * 1000);
  if (t.unref) t.unref();                     // test/skript rejimida process'ni ushlab turmasin
  return t;
}

export default router;
