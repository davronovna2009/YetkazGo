/* ===== Bir martalik ko'chirish: `uploads/` dagi rasmlar -> bazaga =====

   Ilgari rasmlar diskka yozilardi (`/uploads/xxx.jpg`), bazada esa faqat yo'li
   turardi. Render bepul planida disk doimiy emas — shuning uchun endi rasm
   bazada saqlanadi (routes/upload.js).

   Bu funksiya server ishga tushganda bir marta ishlaydi va diskda HALI MAVJUD
   bo'lgan rasmlarni bazaga ko'chirib, tegishli yozuvlardagi `/uploads/...`
   yo'lini `/img/...` ga almashtiradi.

   Xavfsizlik: fayli yo'q yozuvlarga TEGILMAYDI (ular allaqachon buzilgan —
   restoran rasmni qayta yuklashi kerak). Har qanday xato jim yutiladi:
   ko'chirish muvaffaqiyatsiz bo'lsa ham sayt normal ishga tushaveradi. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { db } from './db.js';
import { UPLOAD_DIR } from './config.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/* Qaysi jadval/ustunlarda rasm yo'li saqlanadi */
const COLS = [
  ['restaurants', 'photo'],
  ['added_dishes', 'photo'],
  ['announcements', 'img'],
];

export function migrateUploadsToDb() {
  try {
    if (!existsSync(UPLOAD_DIR)) return;

    let files;
    try { files = readdirSync(UPLOAD_DIR); } catch (e) { return; }
    if (!files.length) return;

    const has = db.prepare('SELECT 1 AS x FROM images WHERE name = ?');
    const ins = db.prepare('INSERT INTO images (name, mime, data) VALUES (?,?,?)');

    let kochirildi = 0;
    for (const name of files) {
      const mime = MIME[extname(name).toLowerCase()];
      if (!mime) continue;                       // rasm bo'lmagan fayl
      if (has.get(name)) continue;               // allaqachon bazada
      let buf;
      try { buf = readFileSync(resolve(UPLOAD_DIR, name)); } catch (e) { continue; }
      if (!buf.length || buf.length > 6 * 1024 * 1024) continue;
      try { ins.run(name, mime, buf); kochirildi++; } catch (e) { /* nomi band — o'tkazamiz */ }
    }

    /* Yo'llarni yangilaymiz — FAQAT bazaga haqiqatan tushgan rasmlar uchun */
    let yangilandi = 0;
    for (const [table, col] of COLS) {
      try {
        const r = db.prepare(
          `UPDATE ${table} SET ${col} = '/img/' || substr(${col}, 10)
            WHERE ${col} LIKE '/uploads/%'
              AND substr(${col}, 10) IN (SELECT name FROM images)`
        ).run();
        yangilandi += r.changes || 0;
      } catch (e) { /* jadval yo'q bo'lsa — o'tkazamiz */ }
    }

    if (kochirildi || yangilandi) {
      console.log(`[RASM] ${kochirildi} ta rasm bazaga ko'chirildi, ${yangilandi} ta yo'l yangilandi`);
    }
  } catch (e) {
    console.warn('[RASM] ko`chirish o`tkazib yuborildi:', e.message);
  }
}
