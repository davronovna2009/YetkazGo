/* ===== /api/groups — GURUH BUYURTMASI =====
   Bir nechta mijoz BITTA yetkazishga (bitta manzilga) buyurtma beradi, lekin
   HAR KIM O'Z ulushini alohida to'laydi. Oqim:
     1) Biri "Guruh yaratish" — kod olinadi.
     2) Boshqalari shu kodni kiritib qo'shiladi.
     3) Har kim taomlarni O'Z nomi bilan qo'shadi (group_items).
     4) Istalgan a'zo "Tasdiqlash"ni bosadi -> BITTA orders yozuvi yaratiladi
        (orders-core.js: createOrder, opts.precomputed bilan — har a'zoning
        qatorlari ARALASHMAYDI, chunki priceOrder odatda bir xil taom id'sini
        bitta qatorga birlashtirib yuborardi). Har a'zoning ulushi/to'lovi
        orders.group_breakdown'да saqlanadi. */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { priceOrderLines, PriceError } from '../pricing.js';
import { minOrderAmount } from '../settings.js';
import { createOrder, OrderError, rowToOrder } from '../orders-core.js';
import { notifyNewOrder, notifyCustomerStatus } from '../bot.js';

const router = Router();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // chalkash bo'ladigan harflar (0/O, 1/I) olib tashlangan
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function memberOf(groupId, accountId) {
  return db.prepare('SELECT * FROM group_members WHERE group_id = ? AND account_id = ?').get(groupId, accountId);
}

function groupState(g) {
  const members = db.prepare('SELECT account_id, name, pay FROM group_members WHERE group_id = ? ORDER BY joined_at ASC').all(g.id);
  const items = db.prepare('SELECT * FROM group_items WHERE group_id = ? ORDER BY created_at ASC').all(g.id);
  return {
    id: g.id, code: g.code, rest: g.rest, addr: g.addr || '', status: g.status, orderId: g.order_id || null,
    createdBy: g.created_by,
    members: members.map((m) => ({ accountId: m.account_id, name: m.name, pay: m.pay })),
    items: items.map((it) => ({
      id: it.id, accountId: it.account_id, memberName: it.member_name, dishId: it.dish_id,
      dishRest: it.dish_rest, dishName: it.dish_name, emoji: it.emoji, qty: it.qty, note: it.note || '',
    })),
  };
}

/* POST /api/groups { rest } — yangi guruh yaratadi, o'zi birinchi a'zo bo'ladi */
router.post('/', requireRole('user'), (req, res) => {
  const rest = String(req.body?.rest || '').trim();
  if (!rest) return res.status(400).json({ error: 'Restoranni tanlang' });
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });

  let code = '';
  for (let i = 0; i < 8; i++) {
    const c = genCode();
    if (!db.prepare('SELECT 1 FROM groups WHERE code = ?').get(c)) { code = c; break; }
  }
  if (!code) return res.status(500).json({ error: 'Kod yaratib bo`lmadi, qayta urinib ko`ring' });

  const addr = acc.addr_region ? `${acc.addr_region}, ${acc.addr_mahalla} mahallasi, ${acc.addr_street}` : '';
  const info = db.prepare('INSERT INTO groups (code, created_by, rest, addr) VALUES (?,?,?,?)').run(code, acc.id, rest, addr);
  db.prepare('INSERT INTO group_members (group_id, account_id, name, pay) VALUES (?,?,?,?)').run(info.lastInsertRowid, acc.id, acc.name, 'cash');
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(groupState(g));
});

/* POST /api/groups/join { code } — mavjud (ochiq) guruhga qo'shiladi */
router.post('/join', requireRole('user'), (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Kodni kiriting' });
  const g = db.prepare('SELECT * FROM groups WHERE code = ?').get(code);
  if (!g) return res.status(404).json({ error: 'Bunday kodli guruh topilmadi' });
  if (g.status !== 'open') return res.status(409).json({ error: 'Bu guruh allaqachon yakunlangan' });
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });
  if (!memberOf(g.id, acc.id)) {
    db.prepare('INSERT INTO group_members (group_id, account_id, name, pay) VALUES (?,?,?,?)').run(g.id, acc.id, acc.name, 'cash');
  }
  res.json(groupState(g));
});

/* GET /api/groups/:id — FAQAT a'zolar ko'radi */
router.get('/:id', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  if (!memberOf(g.id, req.user.id)) return res.status(403).json({ error: 'Siz bu guruh a`zosi emassiz' });
  res.json(groupState(g));
});

/* POST /api/groups/:id/items { dishId, qty, note } — o'z nomidan taom qo'shadi */
router.post('/:id/items', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  if (g.status !== 'open') return res.status(409).json({ error: 'Bu guruh yakunlangan — endi taom qo`shib bo`lmaydi' });
  const mem = memberOf(g.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Siz bu guruh a`zosi emassiz' });

  const dishId = Number(req.body?.dishId);
  const qty = Math.max(1, Math.min(1000, Number(req.body?.qty) || 1));
  const note = String(req.body?.note || '').slice(0, 200);
  const dish = db.prepare('SELECT id, name, emoji, rest FROM added_dishes WHERE id = ?').get(dishId);
  if (!dish) return res.status(400).json({ error: 'Taom topilmadi' });
  if (dish.rest !== g.rest) return res.status(400).json({ error: 'Bu taom guruh restoraniga tegishli emas' });

  db.prepare(
    'INSERT INTO group_items (group_id, account_id, member_name, dish_id, dish_rest, dish_name, emoji, qty, note) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(g.id, req.user.id, mem.name, dish.id, dish.rest, dish.name, dish.emoji || '🍽️', qty, note);
  res.status(201).json(groupState(g));
});

/* DELETE /api/groups/:id/items/:itemId — FAQAT o'zi qo'shgan qatorini o'chiradi */
router.delete('/:id/items/:itemId', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  if (g.status !== 'open') return res.status(409).json({ error: 'Bu guruh yakunlangan' });
  const it = db.prepare('SELECT * FROM group_items WHERE id = ? AND group_id = ?').get(Number(req.params.itemId), g.id);
  if (!it) return res.status(404).json({ error: 'Qator topilmadi' });
  if (it.account_id !== req.user.id) return res.status(403).json({ error: 'Faqat o`zingiz qo`shgan taomni o`chira olasiz' });
  db.prepare('DELETE FROM group_items WHERE id = ?').run(it.id);
  res.json(groupState(g));
});

/* PATCH /api/groups/:id/pay { pay } — o'z to'lov turini belgilaydi */
router.patch('/:id/pay', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  const mem = memberOf(g.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Siz bu guruh a`zosi emassiz' });
  const pay = String(req.body?.pay || 'cash') === 'card' ? 'card' : 'cash';
  db.prepare('UPDATE group_members SET pay = ? WHERE group_id = ? AND account_id = ?').run(pay, g.id, req.user.id);
  res.json(groupState(g));
});

/* PATCH /api/groups/:id/addr { addr } — yetkazish manzili (istalgan a'zo yozadi) */
router.patch('/:id/addr', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  if (!memberOf(g.id, req.user.id)) return res.status(403).json({ error: 'Siz bu guruh a`zosi emassiz' });
  const addr = String(req.body?.addr || '').trim();
  db.prepare('UPDATE groups SET addr = ? WHERE id = ?').run(addr, g.id);
  res.json(groupState(g));
});

/* POST /api/groups/:id/confirm — guruhni YAKUNIY buyurtmaga aylantiradi.
   Har a'zoning qatorlari ALOHIDA narxlanadi (priceOrderLines) va birlashtiriladi
   — shu bilan bir xil taom ikki a'zoda bo'lsa ham ARALASHMAYDI. */
router.post('/:id/confirm', requireRole('user'), (req, res) => {
  const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(Number(req.params.id));
  if (!g) return res.status(404).json({ error: 'Guruh topilmadi' });
  if (g.status !== 'open') return res.status(409).json({ error: 'Bu guruh allaqachon yakunlangan' });
  const mem = memberOf(g.id, req.user.id);
  if (!mem) return res.status(403).json({ error: 'Siz bu guruh a`zosi emassiz' });
  if (!g.addr || !g.addr.trim()) return res.status(400).json({ error: 'Avval yetkazish manzilini kiriting' });

  const items = db.prepare('SELECT * FROM group_items WHERE group_id = ?').all(g.id);
  if (!items.length) return res.status(400).json({ error: 'Guruhda hali taom yo`q' });
  const members = db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(g.id);
  const memberById = new Map(members.map((m) => [m.account_id, m]));

  /* Har a'zoning qatorlarini ALOHIDA narxlaymiz (guruh a'zosi ichida bir xil
     taom bo'lsa — o'zida birlashadi, boshqa a'zoga aralashmaydi). */
  const byMember = new Map();
  for (const it of items) {
    if (!byMember.has(it.account_id)) byMember.set(it.account_id, []);
    byMember.get(it.account_id).push({ id: it.dish_id, qty: it.qty, note: it.note || '' });
  }

  const allLines = [];
  const breakdown = [];
  let combinedAmount = 0;
  let emoji = '🍽️';
  try {
    for (const [accountId, rawItems] of byMember) {
      const m = memberById.get(accountId);
      const memberName = (m && m.name) || 'Mijoz';
      const priced = priceOrderLines(rawItems);
      if (priced.rest !== g.rest) {
        throw new PriceError(400, `«${memberName}»ning taomlari guruh restoraniga (${g.rest}) mos kelmadi`);
      }
      /* Note'ga a'zo ismini yopishtiramiz — YZ_ITEMS (restoran/kuryer/admin)
         buni AVTOMATIK alohida ko'rsatadi, kod o'zgartirish shart emas. */
      const taggedLines = priced.lines.map((l) => ({
        ...l, note: '👤 ' + memberName + (l.note ? ' — ' + l.note : ''),
      }));
      allLines.push(...taggedLines);
      combinedAmount += priced.amount;
      emoji = taggedLines[0].emoji || emoji;
      breakdown.push({ name: memberName, amount: priced.amount, pay: (m && m.pay) || 'cash', paid: false });
    }
  } catch (e) {
    if (e instanceof PriceError) return res.status(e.status).json({ error: e.message });
    console.error('Guruh narxlash xatosi:', e);
    return res.status(500).json({ error: 'Guruh buyurtmasini hisoblab bo`lmadi' });
  }

  const minOrder = minOrderAmount();
  if (combinedAmount < minOrder) {
    return res.status(400).json({ error: `Guruh jami summasi kamida ${minOrder.toLocaleString('ru-RU')} so'm bo'lishi kerak (hozir ${combinedAmount.toLocaleString('ru-RU')} so'm)` });
  }

  const item = `Guruh buyurtmasi (${members.length} kishi)`;
  const confirmerAcc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  let created;
  try {
    created = createOrder(
      { user: mem.name, phone: (confirmerAcc && confirmerAcc.phone) || '', addr: g.addr, pay: mem.pay || 'cash' },
      { authed: true, groupId: g.id, groupBreakdown: breakdown, precomputed: { rest: g.rest, item, emoji, amount: combinedAmount, lines: allLines } }
    );
  } catch (e) {
    if (e instanceof OrderError) return res.status(e.status).json({ error: e.message });
    console.error('Guruh buyurtma yaratish xatosi:', e);
    return res.status(500).json({ error: 'Buyurtmani yaratib bo`lmadi' });
  }

  db.prepare("UPDATE groups SET status = 'confirmed', order_id = ? WHERE id = ?").run(created.order.id, g.id);

  if (created.order.status === 'review') notifyCustomerStatus({ ...created.order, tg_chat_id: '' }, '');
  else notifyNewOrder(created.order, created.lines);

  res.json({ group: groupState(db.prepare('SELECT * FROM groups WHERE id = ?').get(g.id)), order: rowToOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(created.order.id)) });
});

export default router;
