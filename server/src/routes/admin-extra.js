/* ===== Qo'shimcha API =====
   1) /api/tg/*     — panelni (restoran/kuryer/admin) Telegram botga ulash
   2) /api/blocked  — bloklangan telefon raqamlari (ADMIN boshqaradi) */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { botUsername, BOT_ENABLED } from '../bot.js';
import { listBlocks, unblockPhone, blockPhone, forgetPhone, PAUSE_MIN, BLOCK_AT } from '../blocks.js';

const router = Router();

/* ================= TELEGRAMGA ULASH ================= */

/* Chalkashmaydigan belgilar (0/O, 1/I yo'q) — kodni qo'lда yozish oson bo'lsin */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  const b = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

/* Shu foydalanuvchi allaqachon ulanganmi? */
function currentChat(role, login) {
  try {
    if (role === 'restoran') {
      const r = db.prepare('SELECT tg_chat_id FROM restaurants WHERE login = ?').get(login);
      return (r && r.tg_chat_id) || '';
    }
    if (role === 'kuryer') {
      const c = db.prepare('SELECT tg_chat_id FROM couriers WHERE login = ?').get(login);
      return (c && c.tg_chat_id) || '';
    }
    if (role === 'admin') {
      const a = db.prepare('SELECT chat_id FROM tg_admins WHERE login = ?').get(login);
      return (a && a.chat_id) || '';
    }
  } catch (e) { /* jim */ }
  return '';
}

/* GET /api/tg/status — panel "ulanganmi?" deb so'raydi */
router.get('/tg/status', requireRole('restoran', 'kuryer', 'admin'), (req, res) => {
  res.json({
    botEnabled: BOT_ENABLED,
    botUsername: botUsername(),
    linked: !!currentChat(req.user.role, req.user.login),
  });
});

/* POST /api/tg/link — bir martalik ulash kodi (va deep-link havolasi) */
router.post('/tg/link', requireRole('restoran', 'kuryer', 'admin'), (req, res) => {
  if (!BOT_ENABLED) return res.status(503).json({ error: 'Telegram bot sozlanmagan (TG_TOKEN yo`q)' });
  const { role, login, name } = req.user;

  /* Eski ishlatilmagan kodlarni tozalaymiz — bitta egaда bitta faol kod */
  try { db.prepare('DELETE FROM tg_links WHERE role = ? AND login = ?').run(role, login); } catch (e) {}
  /* 1 soatdan eski kodlar ham keraksiz */
  try { db.prepare("DELETE FROM tg_links WHERE created_at < datetime('now','-1 hour')").run(); } catch (e) {}

  const code = makeCode();
  try {
    db.prepare('INSERT INTO tg_links (code, role, login, name) VALUES (?,?,?,?)')
      .run(code, role, login, String(name || login));
  } catch (e) {
    return res.status(500).json({ error: 'Kod yaratilmadi' });
  }

  const uname = botUsername();
  res.json({
    code,
    botUsername: uname,
    url: uname ? `https://t.me/${uname}?start=link_${code}` : '',
    linked: !!currentChat(role, login),
  });
});

/* POST /api/tg/unlink — Telegram ulanishini uzadi */
router.post('/tg/unlink', requireRole('restoran', 'kuryer', 'admin'), (req, res) => {
  const { role, login } = req.user;
  try {
    if (role === 'restoran') db.prepare("UPDATE restaurants SET tg_chat_id = '' WHERE login = ?").run(login);
    else if (role === 'kuryer') db.prepare("UPDATE couriers SET tg_chat_id = '' WHERE login = ?").run(login);
    else db.prepare('DELETE FROM tg_admins WHERE login = ?').run(login);
  } catch (e) {
    return res.status(500).json({ error: 'Uzib bo`lmadi' });
  }
  res.json({ ok: true, linked: false });
});

/* ================= BLOKLANGAN RAQAMLAR (ADMIN) ================= */

/* GET /api/blocked — ro'yxat (bloklangan + ogohlantirilgan raqamlar) */
router.get('/blocked', requireRole('admin'), (_req, res) => {
  res.json({ rules: { pauseMin: PAUSE_MIN, blockAt: BLOCK_AT }, list: listBlocks() });
});

/* POST /api/blocked/unblock — admin blokni ochadi */
router.post('/blocked/unblock', requireRole('admin'), (req, res) => {
  const phone = String(req.body?.phone || '');
  if (!unblockPhone(phone)) return res.status(400).json({ error: 'Telefon raqami noto`g`ri' });
  res.json({ ok: true, list: listBlocks() });
});

/* POST /api/blocked/block — admin qo'lда bloklaydi */
router.post('/blocked/block', requireRole('admin'), (req, res) => {
  const phone = String(req.body?.phone || '');
  const reason = String(req.body?.reason || 'Admin tomonidan bloklandi').slice(0, 200);
  if (!blockPhone(phone, reason)) return res.status(400).json({ error: 'Telefon raqami noto`g`ri' });
  res.json({ ok: true, list: listBlocks() });
});

/* DELETE /api/blocked — raqamni ro'yxatdan butunlay o'chiradi */
router.delete('/blocked', requireRole('admin'), (req, res) => {
  const phone = String(req.body?.phone || '');
  if (!forgetPhone(phone)) return res.status(400).json({ error: 'Telefon raqami noto`g`ri' });
  res.json({ ok: true, list: listBlocks() });
});

export default router;
