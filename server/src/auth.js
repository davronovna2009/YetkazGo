/* ===== Yetkaz.uz backend — autentifikatsiya (JWT + bcrypt) ===== */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES, BCRYPT_ROUNDS } from './config.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS);
}
export function verifyPassword(plain, hash) {
  try { return bcrypt.compareSync(String(plain), hash); } catch { return false; }
}

export function signToken(account) {
  const payload = { id: account.id, login: account.login, role: account.role, name: account.name };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function decodeToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

/* Authorization: Bearer <token> dan foydalanuvchini ajratib oladi (majburiy emas) */
export function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  req.user = m ? decodeToken(m[1]) : null;
  next();
}

/* Token majburiy bo'lgan yo'llar uchun */
export function authRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
  next();
}

/* Faqat ko'rsatilgan rollar uchun */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Ruxsat berilmagan' });
    next();
  };
}
