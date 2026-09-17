/* ===== /api/likes — mijozning "yoqtirgan" taomlari (kabinet, yurakcha tugma) =====
   Faqat ro'yxatdan o'tgan (login qilgan) foydalanuvchi uchun — akkauntга
   bog'liq, guest'da yo'q (guest'ning doimiy identifikatori yo'q). */
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

/* GET /api/likes — joriy akkaunt yoqtirgan taomlar ro'yxati */
router.get('/', authRequired, (req, res) => {
  const rows = db.prepare('SELECT rest, name FROM likes WHERE account_id = ?').all(req.user.id);
  res.json(rows);
});

/* POST /api/likes/toggle { rest, name } — bor bo'lsa o'chiradi, yo'q bo'lsa qo'shadi.
   `name` bo'sh bo'lishi mumkin — bu holda RESTORANNING O'ZI (kartochkadagi
   yurakcha) yoqtirilgan hisoblanadi, aniq taom emas. */
router.post('/toggle', authRequired, (req, res) => {
  const rest = String(req.body?.rest || '').trim();
  const name = String(req.body?.name || '').trim();
  if (!rest) return res.status(400).json({ error: 'Restoran aniqlanmadi' });
  const exists = db.prepare('SELECT 1 FROM likes WHERE account_id = ? AND rest = ? AND name = ?')
    .get(req.user.id, rest, name);
  if (exists) {
    db.prepare('DELETE FROM likes WHERE account_id = ? AND rest = ? AND name = ?').run(req.user.id, rest, name);
    return res.json({ liked: false });
  }
  db.prepare('INSERT INTO likes (account_id, rest, name) VALUES (?,?,?)').run(req.user.id, rest, name);
  res.json({ liked: true });
});

export default router;
