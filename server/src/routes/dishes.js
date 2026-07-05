/* ===== /api/overrides, /api/dishes, /api/discounts — taom o'zgartirishlari =====
   Base katalog frontend (data.js) da qoladi; bu yerda faqat
   qo'shilgan / o'chirilgan / chegirmali taomlar saqlanadi. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();
const key = (rest, name) => `${rest}|${name}`;

function addedRow(r) {
  return {
    id: r.id, name: r.name, nameCyr: r.name_cyr || '', emoji: r.emoji, price: r.price,
    rest: r.rest, cat: r.cat, kw: r.kw, photo: r.photo, rating: r.rating, sold: r.sold, badge: r.badge,
    weight: r.weight || '', ingredients: r.ingredients || '', descr: r.descr || '',
  };
}

/* Umumiy override snapshot — STORE.overrides() bilan bir xil shakl */
export function getOverrides() {
  const added = db.prepare('SELECT * FROM added_dishes').all().map(addedRow);
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
  db.prepare(
    `INSERT OR REPLACE INTO added_dishes (id, name, name_cyr, emoji, price, rest, cat, kw, photo, rating, sold, badge, weight, ingredients, descr)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, String(b.name || ''), String(b.nameCyr || ''), String(b.emoji || '🍽️'),
    Number(b.price) || 0, String(b.rest || ''), String(b.cat || 'Fastfood'),
    String(b.kw || ''), String(b.photo || ''), Number(b.rating) || 4.5,
    Number(b.sold) || 0, String(b.badge || ''),
    String(b.weight || '').slice(0, 40), String(b.ingredients || '').slice(0, 300), String(b.descr || '').slice(0, 300)
  );
  res.status(201).json(addedRow(db.prepare('SELECT * FROM added_dishes WHERE id = ?').get(id)));
});

/* DELETE /api/dishes — taomni o'chirish (rest+name) */
router.delete('/dishes', requireRole('restoran', 'admin'), (req, res) => {
  const rest = String(req.body?.rest || '');
  const name = String(req.body?.name || '');
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  db.prepare('DELETE FROM added_dishes WHERE rest = ? AND name = ?').run(rest, name);
  db.prepare('INSERT OR IGNORE INTO removed_dishes (rest, name) VALUES (?,?)').run(rest, name);
  res.json({ ok: true });
});

/* POST /api/discounts — chegirma o'rnatish (pct=0 -> olib tashlash) */
router.post('/discounts', requireRole('restoran', 'admin'), (req, res) => {
  const rest = String(req.body?.rest || '');
  const name = String(req.body?.name || '');
  const pct = Number(req.body?.pct) || 0;
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  if (pct > 0) db.prepare('INSERT OR REPLACE INTO discounts (rest, name, pct) VALUES (?,?,?)').run(rest, name, pct);
  else db.prepare('DELETE FROM discounts WHERE rest = ? AND name = ?').run(rest, name);
  res.json({ ok: true });
});

/* POST /api/soldout — taomni "sotuvda yo'q" / qaytadan sotuvga qo'yish */
router.post('/soldout', requireRole('restoran', 'admin'), (req, res) => {
  const rest = String(req.body?.rest || '');
  const name = String(req.body?.name || '');
  if (!rest || !name) return res.status(400).json({ error: 'rest va name kerak' });
  if (req.body?.soldout) db.prepare('INSERT OR IGNORE INTO soldout_dishes (rest, name) VALUES (?,?)').run(rest, name);
  else db.prepare('DELETE FROM soldout_dishes WHERE rest = ? AND name = ?').run(rest, name);
  res.json({ ok: true });
});

export default router;
