/* ===== /api/complaints — restoran va kuryerdan ADMINGA shikoyat =====
   Restoran yoki kuryer o'z panelidan shikoyat yuboradi (mavzu + matn +
   ixtiyoriy buyurtma raqami). Admin panelida ular ro'yxatda chiqadi: admin
   javob yozadi va shikoyatni yopadi.

   Ko'rish qoidasi: xodim FAQAT O'Z shikoyatlarini ko'radi, admin — hammasini. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

const TOPICS = ['mijoz', 'kuryer', 'restoran', 'tolov', 'texnik', 'boshqa'];
const STATUSES = ['new', 'seen', 'closed'];

function row(c) {
  return {
    id: c.id, role: c.role, login: c.login, name: c.name || '',
    topic: c.topic || 'boshqa', text: c.text, orderId: c.order_id || 0,
    status: c.status || 'new', reply: c.reply || '', replyAt: c.reply_at || '',
    created_at: c.created_at,
  };
}

/* GET /api/complaints — admin hammasini, xodim faqat o'zinikini */
router.get('/', requireRole('admin', 'restoran', 'kuryer'), (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT * FROM complaints ORDER BY id DESC').all()
    : db.prepare('SELECT * FROM complaints WHERE login = ? ORDER BY id DESC').all(req.user.login);
  res.json(rows.map(row));
});

/* POST /api/complaints — restoran/kuryer shikoyat yuboradi */
router.post('/', requireRole('restoran', 'kuryer'), (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 1500);
  if (text.length < 5) return res.status(400).json({ error: 'Shikoyat matnini to`liqroq yozing' });
  const topic = TOPICS.includes(String(b.topic)) ? String(b.topic) : 'boshqa';
  const orderId = Math.max(0, Number(b.orderId) || 0);

  /* Buyurtma raqami berilса — u HAQIQATAN shu xodimga tegishli bo'lsin */
  if (orderId) {
    const o = db.prepare('SELECT rest, courier FROM orders WHERE id = ?').get(orderId);
    if (!o) return res.status(404).json({ error: 'Bunday buyurtma topilmadi' });
    const mine = req.user.role === 'restoran' ? o.rest === req.user.name : o.courier === req.user.name;
    if (!mine) return res.status(403).json({ error: 'Bu buyurtma sizga tegishli emas' });
  }

  const info = db.prepare(
    'INSERT INTO complaints (role, login, name, topic, text, order_id) VALUES (?,?,?,?,?,?)'
  ).run(req.user.role, req.user.login, String(req.user.name || ''), topic, text, orderId);
  res.status(201).json(row(db.prepare('SELECT * FROM complaints WHERE id = ?').get(info.lastInsertRowid)));
});

/* POST /api/complaints/:id/reply — admin javob yozadi (holat 'seen' bo'ladi) */
router.post('/:id/reply', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT 1 FROM complaints WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Shikoyat topilmadi' });
  const reply = String(req.body?.reply || '').trim().slice(0, 1500);
  db.prepare(
    `UPDATE complaints SET reply = ?, reply_at = datetime('now'),
            status = CASE WHEN status = 'new' THEN 'seen' ELSE status END
      WHERE id = ?`
  ).run(reply, id);
  res.json(row(db.prepare('SELECT * FROM complaints WHERE id = ?').get(id)));
});

/* PATCH /api/complaints/:id — admin holatni o'zgartiradi (ko'rildi / yopildi) */
router.patch('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT 1 FROM complaints WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Shikoyat topilmadi' });
  const status = String(req.body?.status || '');
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Holat noto`g`ri' });
  db.prepare('UPDATE complaints SET status = ? WHERE id = ?').run(status, id);
  res.json(row(db.prepare('SELECT * FROM complaints WHERE id = ?').get(id)));
});

/* DELETE /api/complaints/:id — admin o'chiradi */
router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM complaints WHERE id = ?').run(id);
  res.json({ ok: true, id });
});

export default router;
