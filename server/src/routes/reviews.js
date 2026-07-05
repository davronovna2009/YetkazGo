/* ===== /api/reviews — izohlar ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

function rowToReview(r) {
  return {
    id: r.id, name: r.name, ava: r.ava, rating: r.rating, dish: r.dish,
    text: r.text, textCyr: r.text_cyr || '', flagged: !!r.flagged, date: r.date,
  };
}

/* GET /api/reviews — ommaviy (bosh sahifada ham ko'rinadi) */
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM reviews ORDER BY id DESC').all().map(rowToReview));
});

/* POST /api/reviews — kirgan foydalanuvchi izoh qoldiradi */
router.post('/', authRequired, (req, res) => {
  const b = req.body || {};
  const rating = Math.max(1, Math.min(5, Number(b.rating) || 5));
  const date = String(b.date || new Date().toLocaleDateString('ru-RU'));
  const info = db.prepare(
    'INSERT INTO reviews (name, ava, rating, dish, text, text_cyr, flagged, date) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    String(b.name || ''), String(b.ava || '👤'), rating, String(b.dish || ''),
    String(b.text || ''), String(b.textCyr || ''), b.flagged ? 1 : 0, date
  );
  res.status(201).json(rowToReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid)));
});

export default router;
