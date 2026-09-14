/* ===== /api/bonuses — admin/restoran bonuslari (kabinet ko'radi) =====
   Egalik naqshi routes/announcements.js bilan BIR XIL: restoran FAQAT o'z
   nomidan (scope='restoran', rest=o'zi) yaratadi/o'chiradi, admin istalganini.
   "Kim bajardi" (qualifiers) — SAQLANGAN hisoblagich EMAS, har chaqiruvda
   orders/accounts jadvalidan JONLI hisoblanadi (guestOrderStatus/detectHabit
   bilan bir xil yondashuv — eskirish/sinxron-buzilish xavfi yo'q). */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { toImageUrl } from './upload.js';

const router = Router();

function rowToBonus(r) {
  return {
    id: r.id, scope: r.scope, rest: r.rest || '', title: r.title, descr: r.descr || '',
    image: r.image || '', type: r.type, target: r.target || 0, rewardText: r.reward_text || '',
    active: !!r.active, createdAt: r.created_at,
  };
}

/* GET /api/bonuses — ommaviy (kabinet + reklama banner shu yerdan oladi) */
router.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM bonuses WHERE active = 1 ORDER BY id DESC').all().map(rowToBonus));
});

/* POST /api/bonuses — admin (istalgan scope/rest) yoki restoran (scope='restoran', rest=o'zi) */
router.post('/', requireRole('restoran', 'admin'), (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Sarlavha kerak' });
  const type = ['order_count', 'referral', 'custom'].includes(b.type) ? b.type : 'custom';
  const scope = req.user.role === 'restoran' ? 'restoran' : (b.scope === 'restoran' ? 'restoran' : 'admin');
  const rest = req.user.role === 'restoran' ? req.user.name : (scope === 'restoran' ? String(b.rest || '') : '');
  const image = toImageUrl(b.image || '');
  const info = db.prepare(
    `INSERT INTO bonuses (scope, rest, title, descr, image, type, target, reward_text)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(scope, rest, title, String(b.descr || ''), image, type, Math.max(0, Number(b.target) || 0), String(b.rewardText || ''));
  res.status(201).json(rowToBonus(db.prepare('SELECT * FROM bonuses WHERE id = ?').get(info.lastInsertRowid)));
});

/* DELETE /api/bonuses/:id — egasi (restoran o'zinikini) yoki admin */
router.delete('/:id', requireRole('restoran', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM bonuses WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Bonus topilmadi' });
  if (req.user.role === 'restoran' && row.rest !== req.user.name) {
    return res.status(403).json({ error: 'Bu bonus sizga tegishli emas' });
  }
  db.prepare('DELETE FROM bonuses WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

/* GET /api/bonuses/:id/qualifiers — admin (istalganiga) yoki restoran (FAQAT o'ziniki).
   Oxirgi 7 kun ichida shartga mos kelgan mijozlar — jonli hisoblanadi. */
router.get('/:id/qualifiers', requireRole('restoran', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const bonus = db.prepare('SELECT * FROM bonuses WHERE id = ?').get(id);
  if (!bonus) return res.status(404).json({ error: 'Bonus topilmadi' });
  /* Admin-scope (umumiy) bonuslarni HAR QANDAY restoran ko'ra oladi ("kim
     bajardi" — umumiy targ'ibot). Faqat BOSHQA restoranning O'Z bonusini
     ko'ra olmaydi. */
  if (req.user.role === 'restoran' && bonus.scope === 'restoran' && bonus.rest !== req.user.name) {
    return res.status(403).json({ error: 'Bu bonus sizga tegishli emas' });
  }
  const target = Math.max(1, Number(bonus.target) || 1);

  if (bonus.type === 'order_count') {
    const rows = bonus.scope === 'restoran' && bonus.rest
      ? db.prepare(
          `SELECT phone, MAX(user) AS user, COUNT(*) AS cnt FROM orders
           WHERE created_at > datetime('now','-7 days') AND status <> 'cancelled' AND rest = ? AND phone <> ''
           GROUP BY phone HAVING COUNT(*) >= ? ORDER BY cnt DESC`
        ).all(bonus.rest, target)
      : db.prepare(
          `SELECT phone, MAX(user) AS user, COUNT(*) AS cnt FROM orders
           WHERE created_at > datetime('now','-7 days') AND status <> 'cancelled' AND phone <> ''
           GROUP BY phone HAVING COUNT(*) >= ? ORDER BY cnt DESC`
        ).all(target);
    return res.json(rows.map((r) => ({ user: r.user || '', phone: r.phone, count: r.cnt })));
  }

  if (bonus.type === 'referral') {
    const rows = db.prepare(
      `SELECT ref_by AS login, COUNT(*) AS cnt FROM accounts
       WHERE ref_by <> '' AND created_at > datetime('now','-7 days')
       GROUP BY ref_by HAVING COUNT(*) >= ? ORDER BY cnt DESC`
    ).all(target);
    return res.json(rows.map((r) => {
      const referrer = db.prepare('SELECT name, phone FROM accounts WHERE login = ?').get(r.login);
      return { user: (referrer && referrer.name) || r.login, phone: (referrer && referrer.phone) || '', count: r.cnt };
    }));
  }

  /* 'custom' — avtomatik kuzatuv yo'q, faqat ma'lumot uchun bonus */
  res.json([]);
});

export default router;
