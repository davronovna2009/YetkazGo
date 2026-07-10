/* ===== /api/announcements — restoran e'lonlari/aksiyalari ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

function rowToAnn(r) {
  return { id: r.id, rest: r.rest, text: r.text, emoji: r.emoji, tag: r.tag, dish: r.dish, img: r.img || '' };
}

/* GET /api/announcements — ommaviy */
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 20').all().map(rowToAnn));
});

/* POST /api/announcements — restoran e'lon joylaydi */
router.post('/', requireRole('restoran', 'admin'), (req, res) => {
  const b = req.body || {};
  if (!String(b.text || '').trim()) return res.status(400).json({ error: 'Matn kerak' });
  /* Egalik: restoran FAQAT o'z nomidan e'lon joylaydi (admin — istalganidan) */
  const rest = req.user.role === 'restoran' ? req.user.name : String(b.rest || '');
  const info = db.prepare(
    'INSERT INTO announcements (rest, text, emoji, tag, dish, img) VALUES (?,?,?,?,?,?)'
  ).run(rest, String(b.text), String(b.emoji || '📢'), String(b.tag || ''), String(b.dish || ''), String(b.img || ''));
  res.status(201).json(rowToAnn(db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid)));
});

/* DELETE /api/announcements — rest+text bo'yicha o'chirish. Restoran FAQAT o'zinikini o'chira oladi. */
router.delete('/', requireRole('restoran', 'admin'), (req, res) => {
  const isRest = req.user.role === 'restoran';
  const rest = isRest ? req.user.name : String(req.body?.rest || '');
  const text = String(req.body?.text || '');
  if (!text) return res.status(400).json({ error: 'text kerak' });
  if (isRest || rest) db.prepare('DELETE FROM announcements WHERE rest = ? AND text = ?').run(rest, text);
  else db.prepare('DELETE FROM announcements WHERE text = ?').run(text);  // admin: restoran ko'rsatilmasa — matn bo'yicha
  res.json({ ok: true });
});

export default router;
