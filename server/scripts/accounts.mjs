/* ===== Yetkaz.uz — akkauntlarni boshqarish =====
   Parollar bazada XESHLANGAN (bcrypt) — ularni o'qib bo'lmaydi. Bu skript
   loginlarni ko'rsatadi va kerak bo'lsa YANGI parol o'rnatadi (o'shani ekranga
   bir marta chiqaradi — nusxa olib egasiga berasiz).

   RO'YXAT (barcha login: rol, ism):
     cd server
     node scripts/accounts.mjs

   Faqat bitta rol (admin | restoran | kuryer | user):
     node scripts/accounts.mjs --role restoran

   BITTA akkauntga yangi parol o'rnatish:
     node scripts/accounts.mjs --login <login> --set "YangiParol#2026"
   Parol bermasangiz — tasodifiy kuchli parol yaratib beradi:
     node scripts/accounts.mjs --login <login> --set

   HAMMA restoran (yoki kuryer) parolini birdan qayta o'rnatish (har biriga
   alohida tasodifiy parol — ro'yxat bilan chiqadi):
     node scripts/accounts.mjs --role restoran --reset-all
*/
import { randomBytes } from 'node:crypto';
import { db, initSchema } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

initSchema();

const args = process.argv.slice(2);
let role = null, login = null, doSet = false, setPass = null, resetAll = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--role') role = args[++i] || null;
  else if (a === '--login') login = args[++i] || null;
  else if (a === '--set') { doSet = true; if (args[i + 1] && !args[i + 1].startsWith('--')) setPass = args[++i]; }
  else if (a === '--reset-all') resetAll = true;
}

function randPass() { return 'yz-' + randomBytes(6).toString('base64url'); }
const line = '='.repeat(60);

/* --- Bitta akkauntga parol o'rnatish --- */
if (login && doSet) {
  const acc = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
  if (!acc) { console.error(`✗ «${login}» topilmadi.`); process.exit(1); }
  const pass = setPass || randPass();
  if (pass.length < 4) { console.error('✗ Parol kamida 4 belgi.'); process.exit(1); }
  db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(pass), acc.id);
  console.log(`\n${line}\n  ✓ Yangi parol o'rnatildi\n     rol:    ${acc.role}\n     login:  ${acc.login}\n     parol:  ${pass}\n${line}\n`);
  process.exit(0);
}

/* --- Rol bo'yicha hammasiga yangi parol --- */
if (resetAll) {
  if (!role) { console.error('✗ --reset-all bilan --role kerak (masalan: --role restoran).'); process.exit(1); }
  const rows = db.prepare('SELECT * FROM accounts WHERE role = ? ORDER BY login').all(role);
  if (!rows.length) { console.error(`✗ «${role}» rolida akkaunt yo'q.`); process.exit(1); }
  console.log(`\n${line}\n  ✓ «${role}» — hammasiga yangi parol\n${line}`);
  for (const acc of rows) {
    const pass = randPass();
    db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(pass), acc.id);
    console.log(`  ${acc.login.padEnd(20)}  ${pass}   (${acc.name || ''})`);
  }
  console.log(`${line}\n  Har birini nusxa olib egasiga bering.\n`);
  process.exit(0);
}

/* --- RO'YXAT (parolsiz — loginlar) --- */
const where = role ? 'WHERE role = ?' : '';
const rows = role
  ? db.prepare(`SELECT role, login, name, phone FROM accounts ${where} ORDER BY role, login`).all(role)
  : db.prepare('SELECT role, login, name, phone FROM accounts ORDER BY role, login').all();

if (!rows.length) { console.log('Akkaunt yo`q.'); process.exit(0); }

console.log(`\n${line}\n  YETKAZ — AKKAUNTLAR (${rows.length} ta)`);
console.log(`  ⚠  Parollar XESHLANGAN — o'qib bo'lmaydi. Kerak bo'lsa --set bilan yangisini qo'ying.\n${line}`);
let cur = '';
for (const r of rows) {
  if (r.role !== cur) { cur = r.role; console.log(`\n  [${cur.toUpperCase()}]`); }
  console.log(`   login: ${String(r.login).padEnd(20)} ism: ${r.name || '—'}${r.phone ? '  tel: ' + r.phone : ''}`);
}
console.log(`\n${line}`);
console.log('  Parol o`rnatish:  node scripts/accounts.mjs --login <login> --set "YangiParol"');
console.log(`${line}\n`);
process.exit(0);
