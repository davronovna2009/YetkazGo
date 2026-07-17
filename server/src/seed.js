/* ===== Yetkaz.uz backend — boshlang'ich ma'lumotlar =====
   Eski frontend (store.js, data.js, kuryer.js) dagi seed bilan bir xil.
   Parollar bcrypt bilan xeshlanadi. */
import { randomBytes } from 'node:crypto';
import { db, initSchema } from './db.js';
import { hashPassword, verifyPassword } from './auth.js';
import { ADMIN_LOGIN, ADMIN_PASS, LEGACY_ADMIN_PASS } from './config.js';

/* Tasodifiy, o'qish oson parol (ADMIN_PASS berilmaganda) */
function randomPass() {
  return 'yz-' + randomBytes(9).toString('base64url');
}

/* Diqqatni tortadigan banner — bu xabar o'tkazib yuborilmasligi kerak */
function passBanner(login, pass, sabab) {
  const line = '='.repeat(64);
  console.warn(
    `\n${line}\n` +
    `  🔑 ADMIN PAROLI ${sabab}\n` +
    `     login:  ${login}\n` +
    `     parol:  ${pass}\n` +
    `  Bu parol FAQAT SHU YERDA ko'rsatiladi — hoziroq saqlab qo'ying!\n` +
    `  O'zgartirish uchun:  node scripts/set-admin-pass.mjs <yangi-parol>\n` +
    `  Yoki .env da ADMIN_PASS ni bering.\n` +
    `${line}\n`
  );
}

/* ---- Akkauntlar ---- */
/* MUHIM: bu yerda parol QATTIQ YOZILMAYDI. ADMIN_PASS berilsa — o'sha, aks holda
   tasodifiy kuchli parol yaratiladi va logga bir marta chiqariladi. */
const ADMINS = [{ login: ADMIN_LOGIN, name: 'Administrator' }];

const RESTS_ACC = [];

const COUR_ACC = [];

const USERS_SEED = [];

/* ---- Restoranlar (data.js RESTAURANTS) ---- */
const UN = (id, w = 800) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;
const RESTAURANTS = [];

/* ---- Buyurtmalar (store.js SEED_ORDERS) ---- */
const SEED_ORDERS = [];

/* ---- Izohlar (store.js SEED_REVIEWS) ---- */
const SEED_REVIEWS = [];

function isSeeded() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
  return row.n > 0;
}

export function seed({ force = false } = {}) {
  initSchema();
  if (isSeeded() && !force) return false;

  if (force) {
    for (const t of ['accounts', 'restaurants', 'couriers', 'orders', 'reviews', 'added_dishes', 'removed_dishes', 'discounts', 'announcements']) {
      db.exec(`DELETE FROM ${t};`);
    }
  }

  const insAcc = db.prepare('INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)');
  for (const a of ADMINS) {
    const pass = ADMIN_PASS || randomPass();
    insAcc.run(a.login, hashPassword(pass), 'admin', a.name, '', 'admin.html');
    if (!ADMIN_PASS) passBanner(a.login, pass, 'YARATILDI (ADMIN_PASS berilmagan)');
    else console.log(`✓ Admin «${a.login}» yaratildi (parol .env dagi ADMIN_PASS dan).`);
  }
  for (const a of RESTS_ACC) insAcc.run(a.login, hashPassword(a.pass), 'restoran', a.name, '',            'restoran.html');
  for (const a of COUR_ACC)  insAcc.run(a.login, hashPassword(a.pass), 'kuryer',   a.name, a.phone || '', 'kuryer.html');
  for (const a of USERS_SEED) insAcc.run(a.login, hashPassword(a.pass), 'user',    a.name, a.phone || '', 'kabinet.html');

  const insRest = db.prepare('INSERT INTO restaurants (name, name_cyr, emoji, kw, rating, eta, dist, photo, login) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const r of RESTAURANTS) insRest.run(r.name, r.name_cyr, r.emoji, r.kw, r.rating, r.eta, r.dist, r.photo, r.login);

  const insCour = db.prepare('INSERT INTO couriers (name, emoji, rest, login, phone, deliveries, rating) VALUES (?,?,?,?,?,?,?)');
  const courMeta = { bekzod_k: 420, sherzod_k: 310, aziz_k: 540, ulugbek_k: 480 };
  for (const c of COUR_ACC) insCour.run(c.name, '🛵', c.rest, c.login, c.phone, courMeta[c.login] || 0, 4.8);

  const insOrd = db.prepare('INSERT INTO orders (user, rest, item, emoji, amount, addr, pay, courier, status, eta, time) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const o of SEED_ORDERS) insOrd.run(o.user, o.rest, o.item, o.emoji, o.amount, o.addr, o.pay, o.courier, o.status, o.eta, o.time);

  const insRev = db.prepare('INSERT INTO reviews (name, ava, rating, dish, text, flagged, date) VALUES (?,?,?,?,?,?,?)');
  for (const r of SEED_REVIEWS) insRev.run(r.name, r.ava, r.rating, r.dish, r.text, r.flagged, r.date);

  return true;
}

/* ===== Standart parolni YO'Q QILISH =====
   Har ishga tushganda tekshiramiz: admin paroli hali eski standart ('admin123')
   bo'lsa — majburan almashtiramiz. Bu eski bazalar uchun zarur: seed() faqat
   bo'sh bazada ishlaydi, shuning uchun allaqachon yaratilgan admin'da standart
   parol abadiy qolib ketardi.

   Parol standart BO'LMASA — hech narsa qilmaymiz (admin panelда yoki skript
   orqali qo'ygan parolini bekor qilmaslik uchun). */
export function ensureAdminSecure() {
  let acc;
  try {
    acc = db.prepare("SELECT * FROM accounts WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  } catch (e) { return false; }
  if (!acc) return false;

  /* Parol allaqachon o'zgartirilgan — tegmaymiz */
  if (!verifyPassword(LEGACY_ADMIN_PASS, acc.pass_hash)) return false;

  const next = ADMIN_PASS || randomPass();
  db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(next), acc.id);

  if (ADMIN_PASS) {
    console.warn(`\n⚠️  Admin «${acc.login}» da standart parol topildi — .env dagi ADMIN_PASS ga almashtirildi.\n`);
  } else {
    passBanner(acc.login, next, 'ALMASHTIRILDI (standart parol xavfli edi)');
  }
  return true;
}

/* CLI: `npm run seed` ("--force" bilan to'liq qayta yaratish) */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  const force = process.argv.includes('--force');
  const did = seed({ force });
  console.log(did ? (force ? '✓ Baza qayta yaratildi (force)' : '✓ Baza seed qilindi') : '• Baza allaqachon mavjud, o`tkazib yuborildi');
  process.exit(0);
}
