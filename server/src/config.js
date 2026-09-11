/* ===== Yetkaz.uz backend — sozlamalar ===== */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Loyiha ildizi (server/ ning bir yuqorisi) — statik frontend shu yerdan beriladi */
export const ROOT_DIR = resolve(__dirname, '..', '..');
export const SERVER_DIR = resolve(__dirname, '..');

export const PORT = Number(process.env.PORT) || 5050;

/* JWT — productionda muhit o'zgaruvchisi orqali bering */
export const JWT_SECRET = process.env.JWT_SECRET || 'yetkaz-dev-secret-CHANGE-IN-PRODUCTION';
export const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/* Ma'lumotlar bazasi fayli (Turso ulanганда — lokal embedded replica fayli) */
export const DB_PATH = process.env.DB_PATH || resolve(SERVER_DIR, 'data', 'yetkaz.db');

/* Turso (libSQL) — doimiy bulutli baza. Ikkalasi berilса embedded replica ishlaydi;
   berilmasa — oddiy lokal fayl (dev/test). */
export const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
export const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

/* Yuklangan rasmlar papkasi */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || resolve(SERVER_DIR, 'uploads');

export const BCRYPT_ROUNDS = 10;

/* ===== Admin akkaunti =====
   ADMIN_PASS — admin BIRINCHI marta yaratilganda ishlatiladi va bazada eski
   standart parol qolgan bo'lsa, uni almashtirishда ishlatiladi.
   Berilmasa — tasodifiy kuchli parol yaratilib, logga BIR MARTA chiqariladi.
   Keyinchalik parolni admin panelida yoki `node scripts/set-admin-pass.mjs`
   orqali o'zgartiring (ADMIN_PASS ni keyin o'zgartirish ta'sir qilmaydi —
   panelда qo'yilgan parol bekor qilinmasligi uchun). */
export const ADMIN_LOGIN = (process.env.ADMIN_LOGIN || 'admin').trim();
export const ADMIN_PASS = process.env.ADMIN_PASS || '';

/* Loyihaning eski standart paroli. Bazada AYNAN shu qolgan bo'lsa — har ishga
   tushganda majburan almashtiriladi (seed eski bazada qayta ishlamaydi, shuning
   uchun standart parol o'z-o'zidan yo'qolmaydi). */
export const LEGACY_ADMIN_PASS = 'admin123';

/* Minimal buyurtma summasi (so'm) — BOSHLANG'ICH qiymat (.env orqali).
   Admin panel "Moliyaviy sozlamalar"da o'zgartirsa, bazadagi `min_order`
   sozlamasi (settings.js: minOrderAmount()) BU qiymatdan USTUN turadi —
   pricing.js AYNAN o'shani ishlatadi. */
export const MIN_ORDER = Number(process.env.MIN_ORDER) || 20000;

/* ===== Telegram xabarnoma sozlamalari =====
   Yangi buyurtma kelganda operator/kuryer guruhiga push yuborish uchun.
   .env faylida bering:
     TG_TOKEN     — @BotFather bergan bot tokeni
     TG_CHAT_OPS  — guruh yoki kanal chat_id (masalan: -1001234567890)
   Ikkalasi ham bo'sh bo'lsa — xabarnoma jim o'chadi (server xato bermaydi). */
export const TG_TOKEN = process.env.TG_TOKEN || '';
export const TG_CHAT_OPS = process.env.TG_CHAT_OPS || '';

/* ===== Telegram BOT sozlamalari =====
   PUBLIC_URL        — saytning tashqi HTTPS manzili (Mini App va webhook uchun).
                       Masalan: https://yetkaz-uhzv.onrender.com
                       Render'да RENDER_EXTERNAL_URL o'zi beriladi.
   TG_WEBHOOK_SECRET — webhook'ni soxta so'rovlardan himoya qiladi. Berilmasa
                       JWT_SECRET dan hosil qilinadi.
   TG_TOKEN bo'lmasa — bot butunlay o'chadi va sayt normal ishlayveradi. */
export const PUBLIC_URL = String(
  process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''
).replace(/\/+$/, '');
export const TG_WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET || '';
