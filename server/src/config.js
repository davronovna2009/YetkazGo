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

/* Ma'lumotlar bazasi fayli */
export const DB_PATH = process.env.DB_PATH || resolve(SERVER_DIR, 'data', 'yetkaz.db');

/* Yuklangan rasmlar papkasi */
export const UPLOAD_DIR = process.env.UPLOAD_DIR || resolve(SERVER_DIR, 'uploads');

export const BCRYPT_ROUNDS = 10;

/* ===== Telegram xabarnoma sozlamalari =====
   Yangi buyurtma kelganda operator/kuryer guruhiga push yuborish uchun.
   .env faylida bering:
     TG_TOKEN     — @BotFather bergan bot tokeni
     TG_CHAT_OPS  — guruh yoki kanal chat_id (masalan: -1001234567890)
   Ikkalasi ham bo'sh bo'lsa — xabarnoma jim o'chadi (server xato bermaydi). */
export const TG_TOKEN = process.env.TG_TOKEN || '';
export const TG_CHAT_OPS = process.env.TG_CHAT_OPS || '';
