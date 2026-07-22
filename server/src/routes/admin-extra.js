/* ===== /api/blocked — bloklangan telefon raqamlari (ADMIN boshqaradi) =====
   Telegramga ulash API si OLIB TASHLANDI: bot faqat MIJOZ uchun ishlaydi,
   xodimlar (restoran/kuryer/admin) o'z sayt panelida ishlaydi. */
import { Router } from 'express';
import { requireRole } from '../auth.js';
import {
  listBlocks, unblockPhone, blockPhone, forgetPhone,
  PAUSE_MIN, BLOCK_AT, WARN_AT, SPAM_MAX, SPAM_WINDOW_MIN,
} from '../blocks.js';

const router = Router();

/* ================= BLOKLANGAN RAQAMLAR (ADMIN) ================= */

/* GET /api/blocked — ro'yxat (bloklangan + ogohlantirilgan raqamlar).
   `rules` — saytning O'ZI avtomatik qo'llaydigan qoidalar (panelда ko'rsatiladi). */
router.get('/blocked', requireRole('admin'), (_req, res) => {
  res.json({
    rules: {
      pauseMin: PAUSE_MIN, warnAt: WARN_AT, blockAt: BLOCK_AT,
      spamMax: SPAM_MAX, spamWindowMin: SPAM_WINDOW_MIN,
    },
    list: listBlocks(),
  });
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
