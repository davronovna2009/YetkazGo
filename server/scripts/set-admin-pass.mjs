/* ===== Yetkaz.uz — admin parolini o'zgartirish =====
   Parolni unutsangiz yoki almashtirmoqchi bo'lsangiz:

     cd server
     node scripts/set-admin-pass.mjs "YangiKuchliParol#2026"

   Parol bermasangiz — tasodifiy kuchli parol yaratib beradi:
     node scripts/set-admin-pass.mjs

   Boshqa adminni ko'rsatish (agar bir nechta bo'lsa):
     node scripts/set-admin-pass.mjs "parol" --login admin2   */
import { randomBytes } from 'node:crypto';
import { db, initSchema } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

initSchema();

/* Argumentlarni ajratamiz: [parol] [--login <nom>] */
const args = process.argv.slice(2);
let login = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--login') { login = args[++i] || null; continue; }
  if (args[i].startsWith('--')) continue;      // noma'lum bayroqlar e'tiborsiz
  rest.push(args[i]);
}
const given = rest[0] || '';
const pass = given || ('yz-' + randomBytes(9).toString('base64url'));

if (pass.length < 8) {
  console.error('✗ Parol kamida 8 belgi bo`lsin.');
  process.exit(1);
}

const acc = login
  ? db.prepare("SELECT * FROM accounts WHERE login = ? AND role = 'admin'").get(login)
  : db.prepare("SELECT * FROM accounts WHERE role = 'admin' ORDER BY id LIMIT 1").get();

if (!acc) {
  console.error(login ? `✗ «${login}» nomli admin topilmadi.` : '✗ Bazada admin akkaunti yo`q. Avval serverni bir marta ishga tushiring.');
  process.exit(1);
}

db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(pass), acc.id);

const line = '='.repeat(56);
console.log(`\n${line}\n  ✓ Admin paroli o'zgartirildi\n     login:  ${acc.login}\n     parol:  ${pass}\n${line}\n`);
process.exit(0);
