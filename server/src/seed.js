/* ===== Yetkaz.uz backend — boshlang'ich ma'lumotlar =====
   Eski frontend (store.js, data.js, kuryer.js) dagi seed bilan bir xil.
   Parollar bcrypt bilan xeshlanadi. */
import { db, initSchema } from './db.js';
import { hashPassword } from './auth.js';

/* ---- Akkauntlar (eski store.js dagi ro'yxat) ---- */
const ADMINS = [{ login: 'admin', pass: 'admin123', name: 'Administrator' }];

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
  for (const a of ADMINS)    insAcc.run(a.login, hashPassword(a.pass), 'admin',    a.name, '',            'admin.html');
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

/* CLI: `npm run seed` ("--force" bilan to'liq qayta yaratish) */
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.js')) {
  const force = process.argv.includes('--force');
  const did = seed({ force });
  console.log(did ? (force ? '✓ Baza qayta yaratildi (force)' : '✓ Baza seed qilindi') : '• Baza allaqachon mavjud, o`tkazib yuborildi');
  process.exit(0);
}
