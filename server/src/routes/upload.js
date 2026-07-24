/* ===== Rasm yuklash va berish — rasm BAZADA saqlanadi =====

   NEGA diskda emas: Render bepul planida doimiy disk yo'q. Konteyner har
   deploy'da va uxlab-uyg'onganda tozalanadi, shuning uchun `server/uploads/`
   ichidagi barcha rasm yo'qolardi. Baza (Turso) esa bulutda doimiy saqlanadi —
   demak rasm ham endi yo'qolmaydi.

   NEGA bazadagi ustunga to'g'ridan-to'g'ri `data:` URL sifatida emas: u holda
   har bir rasm /api/bootstrap javobiga qo'shilib, bosh sahifa bir necha
   megabaytga shishardi. Hozir bazada faqat QISQA yo'l (`/img/xxx.jpg`) turadi,
   rasmning o'zi esa alohida, brauzer keshlaydigan so'rov bilan olinadi.

   Eski `/uploads/...` yo'llari ham ishlayveradi (app.js dagi statik xizmat) —
   fayllari saqlanib qolgan lokal muhitda eskisi buzilmasin. */
import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';

const router = Router();

const MAX_BYTES = 6 * 1024 * 1024;   // 6MB — frontend rasmni 800–900px ga siqadi
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/* base64 `data:` rasmni bazaga saqlab, QISQA `/img/xxx` yo'lini qaytaradi.
   data: URL bo'lmasa — o'zini qaytaradi (allaqachon qisqa yo'l). Xato bo'lsa
   bo'sh satr (chaqiruvchi emoji zaxirasига tushadi).
   MAQSAD: hech qachon ustunда to'liq base64 saqlanmasin — u /api/bootstrap
   javobini megabaytга shishirib, panelni qotiradi. */
export function toImageUrl(photo) {
  const s = String(photo || '');
  const m = s.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!m) return s;   // data: emas — tegmaymiz
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch (e) { return ''; }
  if (!buf.length || buf.length > MAX_BYTES) return '';
  const name = `dish_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
  try {
    db.prepare('INSERT INTO images (name, mime, data) VALUES (?,?,?)').run(name, MIME[ext], buf);
    return '/img/' + name;
  } catch (e) { return ''; }
}

/* POST /api/upload  body: { dataUrl: "data:image/png;base64,..." } -> { url } */
router.post('/', requireRole('restoran', 'admin'), (req, res) => {
  const dataUrl = String(req.body?.dataUrl || '');
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Rasm formati noto`g`ri' });

  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); }
  catch (e) { return res.status(400).json({ error: 'Rasmni o`qib bo`lmadi' }); }
  if (!buf.length) return res.status(400).json({ error: 'Rasm bo`sh' });
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Rasm juda katta (max 6MB)' });

  const name = `dish_${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`;
  try {
    db.prepare('INSERT INTO images (name, mime, data) VALUES (?,?,?)').run(name, MIME[ext], buf);
  } catch (e) {
    console.error('Rasmni bazaga yozib bo`lmadi:', e);
    return res.status(500).json({ error: 'Rasmni saqlab bo`lmadi' });
  }
  res.status(201).json({ url: '/img/' + name });
});

/* GET /img/:name — rasmni bazadan beradi (ochiq, autentifikatsiyasiz).
   Nom tasodifiy va o'zgarmas, shuning uchun uzoq muddat keshlanadi. */
export const imageRouter = Router();
imageRouter.get('/img/:name', (req, res) => {
  const name = String(req.params.name || '');
  /* Faqat biz yaratgan nom shakli — boshqa hech narsa bazaga so'rov qilmasin */
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(name)) return res.sendStatus(404);

  let row;
  try { row = db.prepare('SELECT mime, data FROM images WHERE name = ?').get(name); }
  catch (e) { return res.sendStatus(500); }
  if (!row) return res.sendStatus(404);

  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  res.setHeader('Content-Type', row.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

export default router;
