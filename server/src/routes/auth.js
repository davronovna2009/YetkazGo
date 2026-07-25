/* ===== /api/auth — kirish, ro'yxatdan o'tish ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, authRequired } from '../auth.js';

const router = Router();

/* Migratsiya (accounts.email) db.js initSchema() da — jadval yaratilgandan keyin. */

function publicAccount(a) {
  return { id: a.id, role: a.role, login: a.login, name: a.name, phone: a.phone || '', email: a.email || '', target: a.target };
}

/* Sessiya uchun to'liq akkaunt. Kuryer o'z yetkazish haqini (fee) sessiyada
   olib yuradi — /login va /me BIR XIL shaklni qaytarishi shart, aks holda
   sessiya /me dan yangilanganda fee yo'qolib, daromad 0 ko'rinadi. */
function sessionAccount(acc) {
  const account = publicAccount(acc);
  if (acc.role === 'kuryer') {
    const c = db.prepare('SELECT fee FROM couriers WHERE login = ?').get(acc.login);
    account.fee = c ? (c.fee || 0) : 0;
  }
  /* Restoran O'Z komissiyasini sessiyaда olib yuradi — sayt komissiyasi
     ommaviy bootstrap'дан olib tashlangan (mijozga ko'rinmasin), lekin restoran
     o'z panelida uni ko'rishi kerak. Kirish/`/me` autentifikatsiyalangan, shu
     sabab bu yerда berish xavfsiz. */
  if (acc.role === 'restoran') {
    const r = db.prepare('SELECT commission FROM restaurants WHERE login = ?').get(acc.login);
    account.commission = r && r.commission != null ? r.commission : 18;
  }
  return account;
}

/* O'zbekiston mobil raqami validatsiyasi (ro'yxatdan o'tishda) */
const UZ_OPERATORS = ['20', '33', '50', '55', '77', '88', '90', '91', '93', '94', '95', '97', '98', '99'];
function validUzPhone(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  return /^998\d{9}$/.test(d) && UZ_OPERATORS.includes(d.slice(3, 5));
}

/* POST /api/auth/login */
router.post('/login', (req, res) => {
  const login = String(req.body?.login || '').trim();
  const pass = String(req.body?.pass || '');
  if (!login || !pass) return res.status(400).json({ error: 'Login va parolni kiriting' });

  const acc = db.prepare('SELECT * FROM accounts WHERE login = ?').get(login);
  if (!acc || !verifyPassword(pass, acc.pass_hash)) {
    return res.status(401).json({ error: 'Login yoki parol xato' });
  }
  res.json({ token: signToken(acc), account: sessionAccount(acc) });
});

/* POST /api/auth/register — faqat oddiy foydalanuvchi */
router.post('/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const login = String(req.body?.login || '').trim();
  const pass = String(req.body?.pass || '');

  if (name.length < 2) return res.status(400).json({ error: 'Ismingizni kiriting' });
  if (login.length < 3) return res.status(400).json({ error: 'Login kamida 3 belgi bo`lsin' });
  if (pass.length < 4) return res.status(400).json({ error: 'Parol kamida 4 belgi bo`lsin' });
  if (!validUzPhone(phone)) return res.status(400).json({ error: 'Telefon raqamini to`g`ri kiriting: +998 XX XXX XX XX' });

  const exists = db.prepare('SELECT 1 FROM accounts WHERE login = ?').get(login);
  if (exists) return res.status(409).json({ error: 'Bu login band, boshqasini tanlang' });

  const info = db.prepare(
    'INSERT INTO accounts (login, pass_hash, role, name, phone, target) VALUES (?,?,?,?,?,?)'
  ).run(login, hashPassword(pass), 'user', name, phone, 'kabinet.html');

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  const account = publicAccount(acc);
  res.status(201).json({ token: signToken(acc), account });
});

/* PATCH /api/auth/me — joriy foydalanuvchi o'z profilini tahrirlaydi (login/parol/ism/telefon/email) */
router.patch('/me', authRequired, (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });
  const b = req.body || {};
  if (b.name != null && String(b.name).trim().length >= 2) db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(String(b.name).trim(), acc.id);
  if (b.phone != null) db.prepare('UPDATE accounts SET phone = ? WHERE id = ?').run(String(b.phone), acc.id);
  if (b.email != null) db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(String(b.email), acc.id);
  if (b.login != null && String(b.login).trim().length >= 3) {
    const newLogin = String(b.login).trim();
    if (newLogin !== acc.login) {
      const taken = db.prepare('SELECT 1 FROM accounts WHERE login = ? AND id <> ?').get(newLogin, acc.id);
      if (taken) return res.status(409).json({ error: 'Bu login band' });
      db.prepare('UPDATE accounts SET login = ? WHERE id = ?').run(newLogin, acc.id);
      /* ===== MUHIM: login ikkita jadvalда saqlanadi =====
         `accounts.login` — haqiqiy kirish; `restaurants.login`/`couriers.login`
         — nusxa (ko'p so'rov shu nusxa bo'yicha kalitlanadi). Ilgari bu yerда
         faqat accounts yangilanardi va nusxa ESKI qolardi: admin «Restoranlar»
         bo'limi eski loginni, «Loginlar» bo'limi yangisini ko'rsatardi —
         ya'ni "ikki joyda ikki xil". Endi ikkalasi birga yangilanadi. */
      if (acc.role === 'restoran') db.prepare('UPDATE restaurants SET login = ? WHERE login = ?').run(newLogin, acc.login);
      else if (acc.role === 'kuryer') db.prepare('UPDATE couriers SET login = ? WHERE login = ?').run(newLogin, acc.login);
    }
  }
  if (b.pass && String(b.pass).length >= 4) db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?').run(hashPassword(String(b.pass)), acc.id);
  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
  res.json({ token: signToken(updated), account: sessionAccount(updated) });
});

/* GET /api/auth/me — joriy token egasini qaytaradi.
   Panellar SHU orqali tokenni tekshiradi: localStorage'dagi sessiyaga ishonilmaydi. */
router.get('/me', authRequired, (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ account: sessionAccount(acc) });
});

export default router;
