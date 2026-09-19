/* ===== /api/events — tadbirlar (kabinet yaratadi, admin/restoran ko'radi) =====
   Ruxsat naqshi orders.js GET / bilan bir xil mantiq: rol bo'yicha qat'iy
   filtrlangan (admin hammasi, restoran FAQAT o'ziniki, user FAQAT o'ziniki). */
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requireRole } from '../auth.js';

const router = Router();

function rowToEvent(r) {
  return {
    id: r.id, user: r.user, phone: r.phone || '', rest: r.rest, addr: r.addr || '',
    eventDate: r.event_date, name: r.name, dish: r.dish || '', headcount: r.headcount || 0,
    advanceDays: r.advance_days || 0, discountPct: r.discount_pct || 0,
    /* Restoran javobi — tadbirga AYNAN qaysi taom tayyorlanadi (mijozga boradi) */
    restDish: r.rest_dish || '',
    status: r.status, createdAt: r.created_at,
  };
}

/* POST /api/events — kabinet mijozi o'z tadbirini yuboradi */
router.post('/', requireRole('user'), (req, res) => {
  const b = req.body || {};
  const rest = String(b.rest || '').trim();
  const eventDate = String(b.event_date || '').trim();
  const name = String(b.name || '').trim();
  if (!rest) return res.status(400).json({ error: 'Restoranni tanlang' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return res.status(400).json({ error: 'Sanani to`g`ri tanlang' });
  if (!name) return res.status(400).json({ error: 'Tadbir nomini kiriting' });

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  const info = db.prepare(
    `INSERT INTO events (account_id, user, phone, rest, addr, event_date, name, dish, headcount, advance_days)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    req.user.id, (acc && acc.name) || req.user.name, (acc && acc.phone) || '', rest,
    String(b.addr || (acc && (acc.addr_region ? `${acc.addr_region}, ${acc.addr_mahalla} mahallasi, ${acc.addr_street}` : '')) || ''),
    eventDate, name, String(b.dish || '').trim().slice(0, 200), Math.max(0, Number(b.headcount) || 0), Math.max(1, Number(b.advance_days) || 1)
  );
  res.status(201).json(rowToEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid)));
});

/* GET /api/events — rol bo'yicha qat'iy filtrlangan */
router.get('/', authRequired, (req, res) => {
  let rows;
  if (req.user.role === 'admin') rows = db.prepare('SELECT * FROM events ORDER BY event_date ASC').all();
  else if (req.user.role === 'restoran') rows = db.prepare('SELECT * FROM events WHERE rest = ? ORDER BY event_date ASC').all(req.user.name);
  else if (req.user.role === 'user') rows = db.prepare('SELECT * FROM events WHERE account_id = ? ORDER BY event_date ASC').all(req.user.id);
  else return res.status(403).json({ error: 'Ruxsat berilmagan' });
  res.json(rows.map(rowToEvent));
});

/* PATCH /api/events/:id — restoran javobi: chegirma va/yoki TAYYORLANADIGAN TAOM.
   Admin — istalganiga; restoran — FAQAT o'ziniki.
   MUHIM: maydonlar ALOHIDA yangilanadi. Ilgari faqat `discountPct` bor edi va
   har PATCH uni qayta yozardi — endi `restDish` ni saqlaganда chegirma
   o'chib ketmaydi (va aksincha). */
router.patch('/:id', requireRole('restoran', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Tadbir topilmadi' });
  if (req.user.role === 'restoran' && row.rest !== req.user.name) {
    return res.status(403).json({ error: 'Bu tadbir sizga tegishli emas' });
  }
  const b = req.body || {};
  let changed = false;
  if (b.discountPct !== undefined) {
    const pct = Math.max(0, Math.min(90, Number(b.discountPct) || 0));
    db.prepare('UPDATE events SET discount_pct = ? WHERE id = ?').run(pct, id);
    changed = true;
  }
  if (b.restDish !== undefined) {
    db.prepare('UPDATE events SET rest_dish = ? WHERE id = ?').run(String(b.restDish || '').trim().slice(0, 200), id);
    changed = true;
  }
  if (!changed) return res.status(400).json({ error: 'O`zgartirish uchun ma`lumot yo`q' });

  /* Holat: chegirma bor -> 'discounted'; faqat taom belgilangan -> 'answered';
     ikkalasi ham yo'q -> yana 'pending' (restoran javobini bekor qildi). */
  const after = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  const status = (after.discount_pct > 0) ? 'discounted'
    : (String(after.rest_dish || '').trim() ? 'answered' : 'pending');
  db.prepare('UPDATE events SET status = ? WHERE id = ?').run(status, id);
  res.json(rowToEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(id)));
});

export default router;
