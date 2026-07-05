/* ===== /api/upload — rasm yuklash (base64 -> diskka) ===== */
import { Router } from 'express';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireRole } from '../auth.js';
import { UPLOAD_DIR } from '../config.js';

mkdirSync(UPLOAD_DIR, { recursive: true });

const router = Router();

/* POST /api/upload  body: { dataUrl: "data:image/png;base64,..." } */
router.post('/', requireRole('restoran', 'admin'), (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Rasm formati noto`g`ri' });

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'Rasm juda katta (max 6MB)' });

  const name = `dish_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
  writeFileSync(resolve(UPLOAD_DIR, name), buf);
  res.status(201).json({ url: '/uploads/' + name });
});

export default router;
