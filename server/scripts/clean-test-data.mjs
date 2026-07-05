/* ===== Yetkaz.uz — test/soxta ma'lumotlarni tozalash =====
   Productionga topshirishдан oldin sinov davomida yaratilgan buyurtma va
   yozuvlarni xavfsiz o'chiradi. FAQAT aniq "test" belgisiga ega yozuvlar
   o'chiriladi — haqiqiy restoran/kuryer/taomlarga TEGMAYDI.

   Ko'rish (o'chirmasдан):  node scripts/clean-test-data.mjs
   O'chirish:               node scripts/clean-test-data.mjs --yes  */
import { db, initSchema } from '../src/db.js';

initSchema();
const APPLY = process.argv.includes('--yes');

/* Test deb hisoblanadigan buyurtma egalari (nomi bo'yicha) */
const TEST_USER_RE = /(^|\b)(test|telegram mijoz|mehmon test|zz )/i;
/* Test login prefikslari (restoran/kuryer akkauntlari) */
const TEST_LOGIN_RE = /^(zz|kur[ab]$|test)/i;

function pick(rows, pred) { return rows.filter(pred); }

const orders = db.prepare('SELECT id, user, item, status, amount FROM orders').all();
const badOrders = pick(orders, (o) => TEST_USER_RE.test(o.user || ''));

const rests = db.prepare('SELECT id, name, login FROM restaurants').all();
const badRests = pick(rests, (r) => TEST_LOGIN_RE.test(r.login || '') || /^zz /i.test(r.name || ''));

const cours = db.prepare('SELECT id, name, login FROM couriers').all();
const badCours = pick(cours, (c) => TEST_LOGIN_RE.test(c.login || ''));

console.log('=== Topilган test yozuvlari ===');
console.log(`Buyurtmalar: ${badOrders.length}`);
badOrders.forEach((o) => console.log(`  #${o.id} · ${o.user} · ${o.item} · ${o.status}`));
console.log(`Restoranlar: ${badRests.length}`);
badRests.forEach((r) => console.log(`  ${r.name} (${r.login})`));
console.log(`Kuryerlar: ${badCours.length}`);
badCours.forEach((c) => console.log(`  ${c.name} (${c.login})`));

if (!APPLY) {
  console.log('\n(Ko\'rish rejimi — hech narsa o\'chirilmadi.)');
  console.log('O\'chirish uchun:  node scripts/clean-test-data.mjs --yes');
  process.exit(0);
}

const tx = db.prepare('DELETE FROM orders WHERE id = ?');
badOrders.forEach((o) => tx.run(o.id));
for (const r of badRests) {
  db.prepare('DELETE FROM restaurants WHERE login = ?').run(r.login);
  db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'restoran'").run(r.login);
}
for (const c of badCours) {
  db.prepare('DELETE FROM couriers WHERE login = ?').run(c.login);
  db.prepare("DELETE FROM accounts WHERE login = ? AND role = 'kuryer'").run(c.login);
}
console.log(`\n✓ O'chirildi — buyurtma: ${badOrders.length}, restoran: ${badRests.length}, kuryer: ${badCours.length}`);
