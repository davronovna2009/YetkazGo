/* ===== "AI maslahat" (habit.js: detectHabit) — pure-function unit testlari =====
   Server/HTTP kerak emas — to'g'ridan-to'g'ri bazaga (toza, alohida fayl)
   buyurtma qatorlarini aniq sana/vaqt bilan yozib, detectHabit() ni
   sinaymiz. `at` argumenti — sinov uchun "hozir"ni qo'lda beramiz (haqiqiy
   ishlab chiqarish kodi buni hech qachon bermaydi). */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = resolve(HERE, '.tmp-habit-test.db');
for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* */ } }
process.env.DB_PATH = DB;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';

const { seed } = await import('../src/seed.js');
const { db } = await import('../src/db.js');
const { detectHabit } = await import('../src/habit.js');
seed();

let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, msg) { if (cond) PASS++; else { FAIL++; fails.push(msg); console.error('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — kutildi ${JSON.stringify(b)}, keldi ${JSON.stringify(a)}`); }

/* `hoursAgoDays` kunlar oldingi, Toshkent soatida `tashHour:tashMin` — SQLite
   created_at (UTC, 'YYYY-MM-DD HH:MM:SS') qatorini qo'lda yozib beradi. */
function insertOrder({ phone, rest, items, daysAgo, tashHour, tashMin = 0, status = 'done' }) {
  const utcMs = Date.now() - daysAgo * 86400000;
  const d = new Date(utcMs);
  /* Toshkent = UTC+5, DST yo'q */
  d.setUTCHours(tashHour - 5, tashMin, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const created = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
  db.prepare(
    `INSERT INTO orders (user, phone, rest, item, emoji, amount, addr, pay, status, items_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run('Test', phone, rest, items[0].name, items[0].emoji, 10000, 'X', 'cash', status, JSON.stringify(items), created);
}
/* `atDate` — bugungi kun, Toshkent soatida `tashHour:tashMin` (habit tekshirilayotgan payt) */
function atTash(tashHour, tashMin = 0) {
  const d = new Date();
  d.setUTCHours(tashHour - 5, tashMin, 0, 0);
  return d;
}

const OSH = [{ id: 1, name: 'Osh', emoji: '🍚' }];

/* ===== 1) Kamida 3 kun ketma-ket bir xil taom, bir xil payt -> aniqlanadi ===== */
{
  const phone = '+998 90 123 45 01';
  for (let i = 5; i >= 1; i--) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i, tashHour: 13 });
  const h = detectHabit(phone, atTash(13, 10));
  ok(!!h, '5 kun ketma-ket 13:00 da Osh — odat aniqlandi');
  if (h) {
    eq(h.name, 'Osh', 'aniqlangan taom nomi — Osh');
    eq(h.rest, 'Osh Markazi', 'aniqlangan restoran — Osh Markazi');
    eq(h.days, 5, 'necha kun takrorlangani — 5');
  }
}

/* ===== 2) Faqat 2 marta — hali "odat" emas ===== */
{
  const phone = '+998 90 123 45 02';
  for (let i = 2; i >= 1; i--) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i, tashHour: 13 });
  const h = detectHabit(phone, atTash(13, 10));
  ok(!h, 'faqat 2 marta — odat deb topilmadi');
}

/* ===== 3) 5 marta, lekin HOZIR ertalab (vaqt oralig'idan tashqari) — taklif yo'q ===== */
{
  const phone = '+998 90 123 45 03';
  for (let i = 5; i >= 1; i--) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i, tashHour: 13 });
  const h = detectHabit(phone, atTash(8, 0));
  ok(!h, 'hozir ertalab (13:00dan uzoq) — taklif qilinmadi');
}

/* ===== 4) 5 marta, lekin BUGUN allaqachon shu taomni olgan — qayta so'ralmaydi ===== */
{
  const phone = '+998 90 123 45 04';
  for (let i = 5; i >= 1; i--) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i, tashHour: 13 });
  insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: 0, tashHour: 13 });
  const h = detectHabit(phone, atTash(13, 10));
  ok(!h, 'bugun allaqachon olgan — qayta taklif qilinmadi');
}

/* ===== 5) Vaqt tartibsiz (juda tarqoq soatlar) — barqaror odat emas ===== */
{
  const phone = '+998 90 123 45 05';
  const hours = [9, 14, 20, 11, 22];
  for (let i = 0; i < hours.length; i++) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i + 1, tashHour: hours[i] });
  const h = detectHabit(phone, atTash(14, 0));
  ok(!h, 'soatlar juda tarqoq — barqaror odat topilmadi');
}

/* ===== 6) Bekor qilingan buyurtmalar hisobga OLINMAYDI ===== */
{
  const phone = '+998 90 123 45 06';
  for (let i = 5; i >= 1; i--) insertOrder({ phone, rest: 'Osh Markazi', items: OSH, daysAgo: i, tashHour: 13, status: 'cancelled' });
  const h = detectHabit(phone, atTash(13, 10));
  ok(!h, 'faqat bekor qilingan buyurtmalar — odat sifatida hisoblanmadi');
}

/* ===== 7) Noto'g'ri/bo'sh raqam — xatosiz null qaytaradi ===== */
{
  ok(detectHabit('') === null, 'bo`sh raqam -> null');
  ok(detectHabit('+998 90 000 00 00') === null, 'buyurtmasi yo`q raqam -> null');
}

console.log(`\n=== HABIT: ${PASS} o'tdi, ${FAIL} yiqildi ===`);
if (FAIL) { console.error('\nYIQILGANLAR:\n - ' + fails.join('\n - ')); }
for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* */ } }
process.exit(FAIL ? 1 : 0);
