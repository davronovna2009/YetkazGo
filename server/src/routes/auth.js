/* ===== /api/auth — kirish, ro'yxatdan o'tish ===== */
import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, signToken, authRequired } from '../auth.js';

const router = Router();

/* Migratsiya (accounts.email) db.js initSchema() da — jadval yaratilgandan keyin. */

function publicAccount(a) {
  return {
    id: a.id, role: a.role, login: a.login, name: a.name, phone: a.phone || '', email: a.email || '', target: a.target,
    /* Tuzilgan manzil (faqat 'user' rolда to'ldiriladi, lekin boshqa rolда ham
       bo'sh qiymat bilan xavfsiz qaytadi — panel UI'lari e'tiborsiz qoldiradi). */
    addrRegion: a.addr_region || '', addrMahalla: a.addr_mahalla || '', addrStreet: a.addr_street || '',
    addrLat: a.addr_lat != null ? a.addr_lat : null, addrLng: a.addr_lng != null ? a.addr_lng : null,
  };
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
const UZ_OPERATORS = ['20', '33', '50', '55', '77', '87', '88', '90', '91', '93', '94', '95', '97', '98', '99'];
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

  /* Referral: ?ref=<taklif qilganning login'i> — "Do'stni taklif qil" bonusi
     shuni sanaydi (routes/bonuses.js). O'zini-o'zi va mavjud bo'lmagan login'ni
     e'tiborsiz qoldiramiz (soxta hisoblanmasin). */
  const refLogin = String(req.body?.ref || '').trim();
  let refBy = '';
  if (refLogin && refLogin !== login) {
    const refAcc = db.prepare('SELECT login FROM accounts WHERE login = ?').get(refLogin);
    if (refAcc) refBy = refAcc.login;
  }

  const info = db.prepare(
    'INSERT INTO accounts (login, pass_hash, role, name, phone, target, ref_by) VALUES (?,?,?,?,?,?,?)'
  ).run(login, hashPassword(pass), 'user', name, phone, 'kabinet.html', refBy);

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  const account = publicAccount(acc);
  res.status(201).json({ token: signToken(acc), account });
});

/* PATCH /api/auth/me — joriy foydalanuvchi o'z profilini tahrirlaydi (ism/telefon/email).
   MUHIM: LOGIN va PAROL bu yerда O'ZGARMAYDI. Ularni FAQAT ADMIN o'zgartiradi
   (POST /api/accounts/update). Restoran/kuryer/mijoz panellaridan bu imkoniyat
   olib tashlangan — `login`/`pass` maydonlari e'tiborsiz qoldiriladi. */
router.patch('/me', authRequired, (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });
  const b = req.body || {};

  /* ISM:
     - user (mijoz): o'zgartirsa bo'ladi — LEKIN buyurtmalardagi `user` ham
       birga yangilanadi (aks holda mijoz o'z buyurtmalar tarixini yo'qotardi:
       GET /api/orders `user = ?` bo'yicha filtrlaydi).
     - restoran / kuryer: nom ENTITY va buyurtmalarга bog'langan (orders.rest /
       orders.courier). Uni FAQAT admin o'zgartiradi (u ikkala jadvalни sinxron
       qiladi). Shu sabab bu yerда e'tiborsiz qoldiriladi. */
  if (b.name != null && String(b.name).trim().length >= 2 && acc.role === 'user') {
    const nn = String(b.name).trim();
    if (nn !== acc.name) {
      db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(nn, acc.id);
      db.prepare('UPDATE orders SET user = ? WHERE user = ?').run(nn, acc.name);
    }
  }
  if (b.phone != null) db.prepare('UPDATE accounts SET phone = ? WHERE id = ?').run(String(b.phone), acc.id);
  if (b.email != null) db.prepare('UPDATE accounts SET email = ? WHERE id = ?').run(String(b.email), acc.id);
  /* Manzil — faqat 'user' (mijoz) roli uchun mantiqli, lekin cheklab qo'yishning
     hojati yo'q (restoran/kuryer bu maydonlarni yubormaydi). */
  if (b.addrRegion != null) db.prepare('UPDATE accounts SET addr_region = ? WHERE id = ?').run(String(b.addrRegion).trim(), acc.id);
  if (b.addrMahalla != null) db.prepare('UPDATE accounts SET addr_mahalla = ? WHERE id = ?').run(String(b.addrMahalla).trim(), acc.id);
  if (b.addrStreet != null) db.prepare('UPDATE accounts SET addr_street = ? WHERE id = ?').run(String(b.addrStreet).trim(), acc.id);
  if (b.addrLat != null && b.addrLng != null) {
    const lat = Number(b.addrLat), lng = Number(b.addrLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      db.prepare('UPDATE accounts SET addr_lat = ?, addr_lng = ? WHERE id = ?').run(lat, lng, acc.id);
    }
  }
  /* b.login / b.pass — ATAYLAB e'tiborsiz qoldiriladi (faqat admin o'zgartiradi) */
  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
  res.json({ token: signToken(updated), account: sessionAccount(updated), loginLocked: true });
});

/* GET /api/auth/me — joriy token egasini qaytaradi.
   Panellar SHU orqali tokenni tekshiradi: localStorage'dagi sessiyaga ishonilmaydi. */
router.get('/me', authRequired, (req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.user.id);
  if (!acc) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ account: sessionAccount(acc) });
});

export default router;
