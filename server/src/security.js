/* ===== Yetkaz.uz — CSP (Content-Security-Policy) =====
   XSS ga qarshi ENG MUHIM to'siq. Escape qilishni bitta joyda unutsak ham,
   brauzer injektsiya qilingan skriptni BAJARMAYDI.

   Nima bloklanadi:
     • <script> injektsiya (nonce'siz skript ishlamaydi)
     • inline hodisa atributlari: <img onerror="..."> — script-src da
       'unsafe-inline' YO'Q, shuning uchun ular umuman ishga tushmaydi
     • javascript: havolalar
     • boshqa domenga ma'lumot yuborish (connect-src)

   Nega nonce (hash emas): HTML fayllarда inline <script> bloklari bor
   (~46KB). Nonce har so'rovда yangi bo'ladi va HTML shu yerда belgilanadi —
   demak YANGI html fayl qo'shsangiz ham avtomat himoyalanadi, hech narsa
   sozlash shart emas.

   Service worker: javob (HTML + CSP sarlavhasi + nonce) BIRGA keshlanadi,
   shuning uchun offline'да ham nonce mos keladi. */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/* Faqat inline <script ...> ga nonce qo'shamiz (src= bo'lganlarga shart emas) */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc\s*=)/gi;

function policy(nonce) {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    /* MUHIM: 'unsafe-inline' YO'Q — inline onerror/onclick shu tufayli bloklanadi.
       telegram.org — Telegram Mini App (tg-app.html) uchun. */
    `script-src 'self' 'nonce-${nonce}' https://telegram.org`,
    /* Uslublar: sayt style="..." atributlarini ko'p ishlatadi. Uslub
       injektsiyasi skript bajarmaydi — shuning uchun bu yerда yon beramiz. */
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    /* Rasm: restoran istalgan https havola qo'yishi mumkin + /uploads + data: */
    "img-src 'self' data: blob: https:",
    /* nominatim — manzilni aniqlash (app.js) */
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');
}

/* So'ralgan yo'lni ROOT ichidagi .html fayl bilan bog'laydi.
   express.static({extensions:['html']}) bilan bir xil xatti-harakat:
     /            -> index.html
     /kabinet     -> kabinet.html
     /kabinet.html-> kabinet.html
   Boshqa kengaytmali fayllar (js/css/png) — bu middleware'ga tegishli emas. */
function htmlPathFor(rootDir, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath || '/'); } catch (e) { return null; }
  if (rel.indexOf('\0') !== -1) return null;
  if (rel === '/' || rel === '') rel = '/index.html';
  else if (!/\.html$/i.test(rel)) {
    if (/\.[a-z0-9]+$/i.test(rel)) return null;   // .js/.css/.png -> static
    rel = rel + '.html';
  }
  const root = resolve(rootDir);
  const full = resolve(root, '.' + rel);
  /* Yo'l ildizdan chiqib ketmasin (../ hujumi) */
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/* HTML ni nonce bilan beradi va CSP sarlavhasini qo'yadi.
   express.static'dan OLDIN ulanadi; html topilmasa — next(). */
export function htmlWithCsp(rootDir) {
  return async function htmlCspMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const full = htmlPathFor(rootDir, req.path);
    if (!full) return next();

    let src;
    try { src = await readFile(full, 'utf8'); }
    catch (e) { return next(); }   // fayl yo'q -> odatdagi 404 oqimi

    const nonce = randomBytes(16).toString('base64');
    const out = src.replace(INLINE_SCRIPT, `<script nonce="${nonce}"`);

    res.setHeader('Content-Security-Policy', policy(nonce));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    /* Nonce har so'rovда yangi — HTML keshlanmasligi kerak (SW o'zi keshlaydi) */
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') return res.end();
    return res.send(out);
  };
}
