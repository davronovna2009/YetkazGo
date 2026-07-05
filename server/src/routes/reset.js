/* ===== /api/admin/reset — saytni to'liq tozalash (admin rejasi, 3 soatdan keyin) =====
   Admin "Saytni tozalash"ni bosса, 3 soatdan keyin: buyurtmalar (daromad),
   restoranlar, kuryerlar, izohlar, e'lonlar, taomlar tozalanadi. FAQAT ishlash
   (kod + admin akkaunti) qoladi. Reja faylда saqlanadi — server o'chib-yonса ham
   o'tib ketган vaqtда tozalaydi. Admin bekor qilishi mumkin. */
import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { SERVER_DIR } from '../config.js';

const router = Router();
const FILE = resolve(SERVER_DIR, 'data', 'reset.json');
const DELAY_MS = 3 * 60 * 60 * 1000; // 3 soat

function readReset() {
  try { if (!existsSync(FILE)) return null; const j = JSON.parse(readFileSync(FILE, 'utf8')); return (j && j.resetAt) ? j : null; }
  catch (e) { return null; }
}
function writeReset(resetAt, by) {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify({ resetAt, by, at: Date.now() })); } catch (e) {}
}
function clearReset() { try { if (existsSync(FILE)) unlinkSync(FILE); } catch (e) {} }

/* Tozalash — HAMMA operatsion ma'lumot o'chadi; admin akkaunti va sxema qoladi */
function wipe() {
  for (const t of ['orders', 'reviews', 'announcements', 'discounts', 'added_dishes', 'removed_dishes', 'soldout_dishes', 'couriers', 'restaurants']) {
    try { db.exec(`DELETE FROM ${t};`); } catch (e) {}
  }
  try { db.exec("DELETE FROM accounts WHERE role IN ('restoran','kuryer','user');"); } catch (e) {}
  clearReset();
  console.log("🧹 Sayt tozalandi (admin rejasi bo'yicha) — faqat ishlash qoldi.");
}

/* Vaqt yetdimi — har daqiqada va startда tekshiramiz */
function checkDue() { const r = readReset(); if (r && Date.now() >= r.resetAt) wipe(); }
setInterval(checkDue, 60 * 1000);
setTimeout(checkDue, 3000);

/* GET /api/admin/reset — joriy reja (resetAt yoki null) */
router.get('/admin/reset', requireRole('admin'), (_req, res) => {
  const r = readReset();
  res.json({ resetAt: r ? r.resetAt : null, delayMs: DELAY_MS });
});

/* POST /api/admin/reset — 3 soatdan keyingi tozalashni rejalashtirish */
router.post('/admin/reset', requireRole('admin'), (req, res) => {
  const resetAt = Date.now() + DELAY_MS;
  writeReset(resetAt, (req.user && req.user.login) || 'admin');
  res.json({ resetAt, delayMs: DELAY_MS });
});

/* DELETE /api/admin/reset — rejani bekor qilish */
router.delete('/admin/reset', requireRole('admin'), (_req, res) => {
  clearReset();
  res.json({ ok: true });
});

export default router;
