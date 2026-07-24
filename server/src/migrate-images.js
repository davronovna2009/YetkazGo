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
import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { UPLOAD_DIR } from './config.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

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

/* ===== base64 `data:` rasmlarni BAZAGA ko'chirish (bir martalik) =====
   MUAMMO: rasm yuklash uzilса, frontend to'liq base64 `data:image/...` URL'ni
   ustunga saqlaydi (restoran/kuryer/taom). Bunday 20–30 ta rasm /api/overrides
   va /api/bootstrap javobini bir necha MEGABAYTга shishiradi. Sayt har 5
   soniyada shuni yuklab, JSON qilib tahlil qiladi — telefon qotib qoladi.

   Yechim: har bir `data:` URL rasmni images jadvaliga (BLOB) ko'chirib, ustunni
   QISQA `/img/xxx` yo'liga almashtiramiz. Javob kichrayadi, rasm baribir
   ko'rinadi (imageRouter beradi). Bir rasm buzuq bo'lsa — o'shани o'tkazamiz,
   qolganlari ko'chadi. Hech narsa buzilmaydi. */
export function migrateDataUrlsToDb() {
  try {
    const ins = db.prepare('INSERT INTO images (name, mime, data) VALUES (?,?,?)');
    let kochirildi = 0;

    for (const [table, col] of COLS) {
      let rows = [];
      try {
        rows = db.prepare(`SELECT rowid AS _rid, ${col} AS val FROM ${table} WHERE ${col} LIKE 'data:image/%'`).all();
      } catch (e) { continue; }   // jadval yo'q — o'tkazamiz

      for (const r of rows) {
        const m = String(r.val || '').match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/);
        if (!m) continue;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        let buf;
        try { buf = Buffer.from(m[2], 'base64'); } catch (e) { continue; }
        if (!buf.length || buf.length > 8 * 1024 * 1024) continue;   // bo'sh yoki juda katta — tegmaymiz

        const name = `dish_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;
        try {
          ins.run(name, EXT_MIME[ext] || 'image/jpeg', buf);
          db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`).run('/img/' + name, r._rid);
          kochirildi++;
        } catch (e) { /* shu rasmни o'tkazamiz */ }
      }
    }

    if (kochirildi) {
      console.log(`[RASM] ${kochirildi} ta base64 rasm bazaga ko'chirildi — javoblar yengillashdi`);
    }
  } catch (e) {
    console.warn('[RASM] base64 ko`chirish o`tkazib yuborildi:', e.message);
  }
}
