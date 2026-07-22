/* ===== /api/reviews — izohlar (admin nazorati bilan) =====
   Saytga yozilgan HAR BIR izoh admin panelida ko'rinadi: admin uni o'chira
   oladi yoki egasiga rasmiy javob yozadi (javob saytda izoh ostida chiqadi). */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

function rowToReview(r) {
  return {
    id: r.id, name: r.name, ava: r.ava, rating: r.rating, dish: r.dish, rest: r.rest || '',
    text: r.text, textCyr: r.text_cyr || '', flagged: !!r.flagged, date: r.date,
    /* Admin javobi — saytda izoh ostida "Yetkaz javobi" bo'lib ko'rinadi */
    reply: r.reply || '', replyAt: r.reply_at || '',
    created_at: r.created_at || '',
  };
}

/* GET /api/reviews — ommaviy (bosh sahifada ham ko'rinadi) */
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM reviews ORDER BY id DESC').all().map(rowToReview));
});

/* POST /api/reviews — izoh/reyting qoldirish.
   Ruxsat: yo tizimga kirgan foydalanuvchi, yo HAQIQIY buyurtma token'i
   (mehmon mijoz o'z buyurtmasi uchun taom/kuryer reytingi beradi). */
router.post('/', (req, res) => {
  const b = req.body || {};
  const authed = !!req.user;   // attachUser (global) sarlavhadan aniqlaydi
  let okToken = false;
  if (!authed && b.orderToken) {
    okToken = !!db.prepare('SELECT 1 FROM orders WHERE token = ?').get(String(b.orderToken));
  }
  if (!authed && !okToken) return res.status(401).json({ error: 'Ruxsat yo`q' });
  const rating = Math.max(1, Math.min(5, Number(b.rating) || 5));
  const date = String(b.date || new Date().toLocaleDateString('ru-RU'));
  const info = db.prepare(
    'INSERT INTO reviews (name, ava, rating, dish, rest, text, text_cyr, flagged, date) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(
    String(b.name || ''), String(b.ava || '👤'), rating, String(b.dish || ''), String(b.rest || ''),
    String(b.text || ''), String(b.textCyr || ''), b.flagged ? 1 : 0, date
  );
  res.status(201).json(rowToReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid)));
});

/* ===== ADMIN NAZORATI ===== */

/* DELETE /api/reviews/:id — adminni bezovta qilgan / haqoratli izohni o'chirish */
router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT 1 FROM reviews WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'Izoh topilmadi' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

/* POST /api/reviews/:id/reply — admin izoh egasiga javob yozadi.
   Bo'sh matn yuborilsa — javob olib tashlanadi. */
router.post('/:id/reply', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Izoh topilmadi' });
  const reply = String(req.body?.reply || '').trim().slice(0, 600);
  if (reply) {
    db.prepare("UPDATE reviews SET reply = ?, reply_at = datetime('now') WHERE id = ?").run(reply, id);
  } else {
    db.prepare("UPDATE reviews SET reply = '', reply_at = '' WHERE id = ?").run(id);
  }
  res.json(rowToReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id)));
});

export default router;
