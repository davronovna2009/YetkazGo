/* ===== /api/overrides, /api/dishes, /api/discounts — taom o'zgartirishlari =====
   Base katalog frontend (data.js) da qoladi; bu yerda faqat
   qo'shilgan / o'chirilgan / chegirmali taomlar saqlanadi. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { liveRatings } from '../ratings.js';

const router = Router();
const key = (rest, name) => `${rest}|${name}`;

/* Ruxsat etilgan taom turlari — restoran paneli 3 xil forma ko'rsatadi */
const KINDS = ['taom', 'ichimlik', 'shirinlik'];

/* Egalik: restoran FAQAT o'z nomi bilan ishlay oladi (body.rest e'tiborsiz qoldiriladi);
   admin esa istalgan restoranni ko'rsatishi mumkin. Shu boshqa restoranni buzishni to'sadi. */
function restFor(req) {
  return req.user && req.user.role === 'restoran' ? req.user.name : String(req.body?.rest || '');
}

function addedRow(r, live) {
  const lr = live && live.dishes[r.name];
  return {
    id: r.id, name: r.name, nameCyr: r.name_cyr || '', emoji: r.emoji, price: r.price,
    rest: r.rest, cat: r.cat, kw: r.kw, photo: r.photo,
    /* Reyting JONLI (izohlardan) — baho bo'lmasa 0 */
    rating: lr ? lr.rating : 0, ratingCount: lr ? lr.count : 0, sold: r.sold, badge: r.badge,
    weight: r.weight || '', ingredients: r.ingredients || '', descr: r.descr || '',
    /* Taom turi va cheklov + tur maydonlari */
    kind: r.kind || 'taom', maxQty: r.max_qty || 0,
    volume: r.volume || '', dtype: r.dtype || '', allergens: r.allergens || '',
  };
}

/* Umumiy override snapshot — STORE.overrides() bilan bir xil shakl.
   `live` berilmasa — o'zi hisoblaydi (chaqiruvchi tejashi uchun uzatishi mumkin). */
export function getOverrides(live) {
  const lr = live || liveRatings();
  const added = db.prepare('SELECT * FROM added_dishes').all().map((r) => addedRow(r, lr));
  const removed = db.prepare('SELECT rest, name FROM removed_dishes').all().map(r => key(r.rest, r.name));
  const discounts = {};
  for (const d of db.prepare('SELECT rest, name, pct FROM discounts').all()) discounts[key(d.rest, d.name)] = d.pct;
  const soldout = db.prepare('SELECT rest, name FROM soldout_dishes').all().map((r) => key(r.rest, r.name));
  return { added, removed, discounts, soldout };
}

/* GET /api/overrides — ommaviy (katalog uchun kerak) */
router.get('/overrides', (_req, res) => res.json(getOverrides()));

/* POST /api/dishes — restoran yangi taom qo'shadi */
router.post('/dishes', requireRole('restoran', 'admin'), (req, res) => {
  const b = req.body || {};
  const id = Number(b.id) || Date.now();
  const rest = restFor(req);
  if (!rest) return res.status(400).json({ error: 'rest kerak' });
  /* Narx manfiy yoki kasr bo'lmasin — buyurtma summasi shundan hisoblanadi (pricing.js) */
  const price = Math.max(0, Math.round(Number(b.price) || 0));
  const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'taom';
  const maxQty = Math.max(0, Number(b.maxQty) || 0);
  /* Reyting endi izohlardan hisoblanadi — bazaga 0 yozamiz (eski ustun qoladi) */
  db.prepare(
    `INSERT OR REPLACE INTO added_dishes (id, name, name_cyr, emoji, price, rest, cat, kw, photo, rating, sold, badge, weight, ingredients, descr, kind, max_qty, volume, dtype, allergens)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, String(b.name || ''), String(b.nameCyr || ''), String(b.emoji || '🍽️'),
    price, rest, String(b.cat || 'Fastfood'),
    String(b.kw || ''), String(b.photo || ''), 0,
    Number(b.sold) || 0, String(b.badge || ''),
    String(b.weight || '').slice(0, 40), String(b.ingredients || '').slice(0, 300), String(b.descr || '').slice(0, 300),
    kind, maxQty,
    String(b.volume || '').slice(0, 40), String(b.dtype || '').slice(0, 40), String(b.allergens || '').slice(0, 300)
  );
  res.status(201).json(addedRow(db.prepare('SELECT * FROM added_dishes WHERE id = ?').get(id), liveRatings()));
});

/* DELETE /api/dishes — taomni o'chirish (rest+name) */
router.delete('/dishes', requireRole('restoran', 'admin'), (req, res) => {
  const rest = restFor(req);
  const name = String(req.body?.name || '');
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  db.prepare('DELETE FROM added_dishes WHERE rest = ? AND name = ?').run(rest, name);
  db.prepare('INSERT OR IGNORE INTO removed_dishes (rest, name) VALUES (?,?)').run(rest, name);
  res.json({ ok: true });
});

/* POST /api/discounts — chegirma o'rnatish (pct=0 -> olib tashlash).
   pct 0..100 oralig'iga qisiladi: endi summa SHU foiz bo'yicha serverда
   hisoblanadi (pricing.js), shuning uchun tekshirilmagan pct manfiy narx bergan
   bo'lardi (masalan pct=200 -> narx manfiy). */
router.post('/discounts', requireRole('restoran', 'admin'), (req, res) => {
  const rest = restFor(req);
  const name = String(req.body?.name || '');
  const pct = Math.max(0, Math.min(100, Math.round(Number(req.body?.pct) || 0)));
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  if (pct > 0) db.prepare('INSERT OR REPLACE INTO discounts (rest, name, pct) VALUES (?,?,?)').run(rest, name, pct);
  else db.prepare('DELETE FROM discounts WHERE rest = ? AND name = ?').run(rest, name);
  res.json({ ok: true });
});

/* POST /api/soldout — taomni "sotuvda yo'q" / qaytadan sotuvga qo'yish */
router.post('/soldout', requireRole('restoran', 'admin'), (req, res) => {
  const rest = restFor(req);
  const name = String(req.body?.name || '');
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  if (req.body?.soldout) db.prepare('INSERT OR IGNORE INTO soldout_dishes (rest, name) VALUES (?,?)').run(rest, name);
  else db.prepare('DELETE FROM soldout_dishes WHERE rest = ? AND name = ?').run(rest, name);
  res.json({ ok: true });
});

export default router;
