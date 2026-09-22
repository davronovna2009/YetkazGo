/* ===== /api/orders — buyurtmalar ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
/* Buyurtma yaratish/o'qish yordamchilari — sayt va bot uchun BITTA manba */
import { createOrder, OrderError, rowToOrder, parseItems, prettyPhone, assignCourier, sealCourierFee, courierPhoneOf, guestOrderStatus, validPhone, clampEta } from '../orders-core.js';
/* Katta/shubhali buyurtma qoidalari (kuryer qo'ng'irog'i, admin tekshiruvi) */
import { rulesSnapshot } from '../order-rules.js';
/* Telegram xabarlari (bot o'chiq bo'lsa — jim o'tadi).
   Bot FAQAT MIJOZ bilan ishlaydi; restoran/kuryer o'z panelida ko'radi.
   notifyOps* — ixtiyoriy operatorlar guruhi (TG_CHAT_OPS) uchun. */
import { notifyCustomerStatus, notifyNewOrder, notifyOpsStatus } from '../bot.js';
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

/* Buyurtma bosqichlari — boshqa qiymat bazaga tushmasin.
   'review' — shubhali buyurtma, ADMIN tasdig'ini kutmoqda (order-rules.js).
   Bu bosqichni panellar PATCH orqali qo'ya olmaydi: faqat server o'zi (buyurtma
   yaratilganда) va admin /approve · /reject orqali chiqaradi. */
const STATUSES = ['new', 'accepted', 'ready', 'ontheway', 'arrived', 'done', 'cancelled'];

/* Admin tasdig'ini kutayotgan buyurtma — restoran va kuryer uni KO'RMAYDI */
const REVIEW = 'review';

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
      // Restoran — faqat O'Z restoraniga tushgan buyurtmalar.
      // Shubhali (admin tekshiruvidagi) buyurtma bu yerда KO'RINMAYDI —
      // u avval adminга boradi, admin tasdiqlagach restoranga tushadi.
      where.push('rest = ?'); params.push(req.user.name);
      where.push('status <> ?'); params.push(REVIEW);
      break;
    case 'kuryer':
      // Kuryer — faqat O'ZIGA biriktirilgan buyurtmalar (tekshiruvdagilar yo'q)
      where.push('courier = ?'); params.push(req.user.name);
      where.push('status <> ?'); params.push(REVIEW);
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

/* GET /api/orders/guest-status?phone=... — ochiq: checkout boshlanishidan OLDIN
   frontend shu bilan tekshiradi ("2-marta guest buyurtma" xato-va-orqaga-qaytarish
   o'rniga, oldindan ogohlantiradi). Bu FAQAT maslahat — haqiqiy to'siq createOrder
   ichida (POST /). Noto'g'ri raqamда shunchaki blocked:false (createOrder o'zi
   format xatosini aytadi). MUHIM: bu :id dan OLDIN turishi kerak (aks holda
   "guest-status" :id sifatida ushlanib qolardi). */
router.get('/guest-status', (req, res) => {
  const phone = String(req.query.phone || '');
  if (!validPhone(phone)) return res.json({ blocked: false, hasAccount: false });
  res.json(guestOrderStatus(phone));
});

/* POST /api/orders — ochiq (mehmon checkout: bosh sahifadan ham buyurtma berish mumkin).
   Butun logika orders-core.js da — bot ham AYNAN shuni chaqiradi.
   `authed` — faqat haqiqiy ro'yxatdan o'tgan MIJOZ (role==='user') tokeni bilan
   true bo'ladi; shundagina guest-cheklovi (orders-core.js: guestOrderStatus)
   chetlab o'tiladi. Admin/restoran/kuryer tokeni bu yerga tushmaydi (ular bu
   endpointdan mijoz sifatida foydalanmaydi). */
router.post('/', (req, res) => {
  let created;
  try {
    const authed = !!(req.user && req.user.role === 'user');
    created = createOrder(req.body || {}, { authed });
  } catch (e) {
    if (e instanceof OrderError) return res.status(e.status).json({ error: e.message, code: e.code || undefined });
    console.error('Buyurtma yaratish xatosi:', e);
    return res.status(500).json({ error: 'Buyurtmani yaratib bo`lmadi' });
  }

  /* Telegram xabarnomasini bloklamasdan yuboramiz (tarkibi bilan).
     Shubhali buyurtma hali HAQIQIY buyurtma emas — u admin tekshiruvida turadi,
     shuning uchun "yangi buyurtma" xabari admin tasdiqlaganда yuboriladi
     (/:id/approve). Mijozga esa holatni darrov aytamiz. */
  if (created.order.status === REVIEW) notifyCustomerStatus({ ...created.order, tg_chat_id: req.body?.tgChatId || '' }, '');
  else notifyNewOrder(created.order, created.lines);

  /* Javobда token QAYTADI — frontend uni localStorage'da saqlab, keyin
     bekor qilish/qabul qilishda yuboradi. */
  res.status(201).json({ ...created.order, token: created.token });
});

/* GET /api/orders/:id — ochiq: mehmon o'z buyurtmasi holatini kuzatishi uchun (faqat id+status).
   Kuryer telefoni FAQAT to'g'ri `token` bilan so'ralса va kuryer yo'lga chiqgan
   bo'lsa qaytadi — aks holda id'ni sanab ko'rgan har kim (bu endpoint ochiq,
   tizimga kirish shart emas) kuryerlarning telefon raqamini yig'ib olardi. */
router.get('/:id', (req, res) => {
  const o = db.prepare('SELECT id, status, reason, courier, token FROM orders WHERE id = ?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const out = { id: o.id, status: o.status, reason: o.reason };
  const tokenOk = o.token && String(req.query.token || '') === o.token;
  if (tokenOk && o.courier && (o.status === 'ontheway' || o.status === 'arrived')) {
    out.courier = o.courier;
    out.courierPhone = courierPhoneOf(o.courier);
  }
  res.json(out);
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
  /* 'review' ham bekor qilinadi — mijoz admin tekshiruvini kutmasdan voz kechishi mumkin */
  if ([REVIEW, 'new', 'accepted', 'ready'].includes(o.status)) {
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

  if (!alreadyCancelled) notifyOpsStatus(updated);

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
    /* Kuryer haqi shu buyurtmaga muhrlanadi — xarajat hisoboti keyin o'zgarmaydi */
    sealCourierFee(id);
    /* Buyurtma muvaffaqiyatli yakunlandi — bekor qilish hisobi nolga qaytadi */
    clearOnSuccess(o.phone);
  }
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

/* ===== KATTA BUYURTMA: kuryerning tasdiqlovchi qo'ng'irog'i =====
   POST /api/orders/:id/call-confirm — kuryer mijozga qo'ng'iroq qilib
   "rostdan shuncha buyurtma berdingizmi?" deb so'radi va mijoz TASDIQLADI.
   Shundan keyingina «Yo'lga chiqdim» tugmasi ishlaydi.
   Mijoz rad etsa — kuryer buyurtmani bekor qiladi (odatdagi bekor qilish). */
router.post('/:id/call-confirm', requireRole('kuryer', 'restoran', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (req.user.role === 'kuryer' && o.courier !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });
  if (req.user.role === 'restoran' && o.rest !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });
  if (o.status === REVIEW)
    return res.status(409).json({ error: 'Buyurtma administrator tekshiruvida' });

  db.prepare("UPDATE orders SET call_done = 1, call_by = ?, call_at = datetime('now') WHERE id = ?")
    .run(String(req.user.name || req.user.login || ''), id);
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

/* ===== GURUH BUYURTMASI: bitta a'zoning naqd ulushi "olindi" deb belgilash =====
   POST /api/orders/:id/group-paid { index } — kuryer (yetkazayotgan) yoki
   restoran/admin shu buyurtmaning group_breakdown massividagi `index`-chi
   a'zosini paid=true qiladi. Karta to'lovi bu yerdan EMAS — pay.html/QR
   oqimi orqali (kelajakda kengaytiriladi). */
router.post('/:id/group-paid', requireRole('kuryer', 'restoran', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (req.user.role === 'kuryer' && o.courier !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });
  if (req.user.role === 'restoran' && o.rest !== req.user.name)
    return res.status(403).json({ error: 'Ruxsat berilmagan' });
  let bd = [];
  try { bd = o.group_breakdown ? JSON.parse(o.group_breakdown) : []; } catch (e) { bd = []; }
  const idx = Number(req.body?.index);
  if (!Array.isArray(bd) || !bd[idx]) return res.status(400).json({ error: 'Guruh a`zosi topilmadi' });
  bd[idx].paid = true;
  db.prepare('UPDATE orders SET group_breakdown = ? WHERE id = ?').run(JSON.stringify(bd), id);
  res.json(rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id)));
});

/* ===== SHUBHALI BUYURTMA: admin qarori =====
   POST /api/orders/:id/approve — admin tasdiqlaydi: buyurtma 'new' bo'ladi,
   kuryer AYNAN SHU PAYTDA biriktiriladi (2 ta cheklovi bilan) va restoran
   panelida paydo bo'ladi. */
router.post('/:id/approve', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (o.status !== REVIEW) return res.status(409).json({ error: 'Bu buyurtma tekshiruvda emas' });

  const courier = o.courier || assignCourier(o.rest) || '';
  db.prepare(
    `UPDATE orders SET status = 'new', courier = ?, approved_by = ?, approved_at = datetime('now')
      WHERE id = ?`
  ).run(courier, String(req.user.name || req.user.login || 'admin'), id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  /* Endi u haqiqiy buyurtma — mijozga va operatorlar guruhiga xabar beramiz */
  notifyCustomerStatus(updated, REVIEW);
  notifyNewOrder(rowToOrder(updated), parseItems(updated.items_json));
  res.json(rowToOrder(updated));
});

/* POST /api/orders/:id/reject — admin rad etadi (soxta/noreal buyurtma).
   Buyurtma bekor qilinadi, sabab mijozga ko'rinadi. */
router.post('/:id/reject', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  if (o.status !== REVIEW) return res.status(409).json({ error: 'Bu buyurtma tekshiruvda emas' });

  const reason = String(req.body?.reason || 'Buyurtma tekshiruvdan o`tmadi').slice(0, 200);
  db.prepare(
    `UPDATE orders SET status = 'cancelled', reason = ?, approved_by = ?, approved_at = datetime('now')
      WHERE id = ?`
  ).run(reason, String(req.user.name || req.user.login || 'admin'), id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  notifyCustomerStatus(updated, REVIEW);
  res.json(rowToOrder(updated));
});

/* GET /api/orders/rules — panellar chegaralarni ko'rsatishi uchun (ochiq son) */
router.get('/rules/limits', (_req, res) => res.json(rulesSnapshot()));

/* GET /api/orders/stats/source — "Bot va sayt reytingi":
   necha foiz buyurtma Telegram botdan, necha foiz saytdan kelgan.
   Rol bo'yicha cheklangan: restoran O'Z buyurtmalari bo'yicha, admin — hammasi. */
router.get('/stats/source', requireRole('restoran', 'admin'), (req, res) => {
  let sql = "SELECT source, tg_chat_id, id, user, phone FROM orders WHERE status <> 'cancelled'";
  const params = [];
  if (req.user.role === 'restoran') { sql += ' AND rest = ?'; params.push(req.user.name); }
  const rows = db.prepare(sql).all(...params);

  let telegram = 0, sayt = 0;
  for (const o of rows) {
    const src = o.source || (o.tg_chat_id ? 'telegram' : 'sayt');
    if (src === 'telegram') telegram++; else sayt++;
  }
  const total = telegram + sayt;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  res.json({
    total, telegram, sayt,
    telegramPct: pct(telegram), saytPct: pct(sayt),
  });
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

  /* ===== 1) ADMIN TEKSHIRUVIDAGI buyurtma qulflangan =====
     Shubhali buyurtmani faqat admin /approve yoki /reject orqali harakatga
     keltiradi. Aks holda restoran/kuryer uni oddiy PATCH bilan ochib olardi. */
  if (existing.status === REVIEW) {
    return res.status(409).json({
      error: 'Bu buyurtma administrator tekshiruvida. Tasdiqlangach ishlay boshlaydi.',
    });
  }

  /* ===== 2) KATTA BUYURTMA — avval mijozga QO'NG'IROQ =====
     10 donadan ko'p yoki 300 000 so'mdan qimmat buyurtmada kuryer yo'lga
     chiqishdan oldin mijoz bilan gaplashib tasdiqlashi shart (order-rules.js).
     Tugma frontendда ham bekitiladi, lekin haqiqiy to'siq SHU YERDA. */
  if (patch.status === 'ontheway' && existing.call_required && !existing.call_done) {
    return res.status(409).json({
      error: 'Katta buyurtma: avval mijozga qo`ng`iroq qilib tasdiqlang, keyin yo`lga chiqing.',
      needCall: true,
    });
  }

  const sets = [], params = [];
  for (const k of ALLOWED) {
    /* Yetkazish vaqti — sayt bo'ylab minimum 29 daqiqa (orders-core.js) */
    if (k === 'eta' && k in patch) { sets.push('eta = ?'); params.push(clampEta(patch.eta)); continue; }
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
  /* Yetkazildi — kuryerning O'SHA PAYTDAGI haqi buyurtmaga muhrlanadi (xarajat) */
  if (patch.status === 'done' && existing.status !== 'done') sealCourierFee(id);
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  /* Telegram botdan buyurtma bergan mijozga holat o'zgarganini bildiramiz.
     Bloklamaydi — bot o'chiq yoki xato bo'lsa jim o'tadi. */
  if ('status' in patch && patch.status !== existing.status) {
    notifyCustomerStatus(updated, existing.status);
    /* Restoran ↔ kuryer bir-birini O'Z PANELIDA ko'radi (bot ularga yozmaydi).
       Operatorlar guruhi bo'lsa — yakuniy bosqichlar u yerга ham boradi. */
    notifyOpsStatus(updated);
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
      sealCourierFee(o.id);      // kuryer haqi xarajat sifatida yozilsin
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
