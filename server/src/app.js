/* ===== Yetkaz.uz backend — Express ilovasi =====
   Bitta server: /api/* -> REST API, qolgan hammasi -> statik frontend. */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { PORT, ROOT_DIR, JWT_SECRET, UPLOAD_DIR } from './config.js';
import { seed, ensureAdminSecure } from './seed.js';
import { attachUser } from './auth.js';
import { htmlWithCsp } from './security.js';

import authRoutes from './routes/auth.js';
import ordersRoutes, { startAutoConfirm } from './routes/orders.js';
import reviewsRoutes from './routes/reviews.js';
import dishesRoutes from './routes/dishes.js';
import announcementsRoutes from './routes/announcements.js';
import miscRoutes from './routes/misc.js';
import uploadRoutes, { imageRouter } from './routes/upload.js';
import { migrateUploadsToDb } from './migrate-images.js';
import resetRoutes from './routes/reset.js';
import { botRouter, startBot } from './bot.js';

/* Birinchi ishga tushganda bazani seed qilamiz */
seed();
/* Eski bazada standart admin paroli qolgan bo'lsa — majburan almashtiramiz */
ensureAdminSecure();
/* "Yetkazildi" holatida osilib qolgan buyurtmalarni 30 daqiqadan keyin yopamiz */
startAutoConfirm();
/* Diskda qolgan eski rasmlarni bazaga ko'chiramiz (bir martalik, xavfsiz) */
migrateUploadsToDb();

const app = express();

/* Reverse-proxy (Render/Railway/Fly) ortida to'g'ri IP olish uchun —
   rate-limit IP'ni shu orqali aniqlaydi. */
app.set('trust proxy', 1);

/* Xavfsizlik sarlavhalari.
   helmet'ning O'Z CSP'si o'chirilgan — uning o'rniga security.js dagi nonce'li
   CSP ishlaydi (HTML javobiga qo'yiladi). Ikkitasi bir vaqtда bo'lsa, ular
   KESISHMA bo'yicha qo'llanib, sayt buzilardi. */
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
app.use(attachUser);  // sarlavhadan foydalanuvchini ajratadi (body kerak emas)

/* Rasmlar BAZADAN (asosiy yo'l — deploy'dan keyin ham yo'qolmaydi) */
app.use(imageRouter);
/* Eski `/uploads/...` yo'llari — fayli saqlanib qolgan muhitlarda ishlayversin */
app.use('/uploads', express.static(UPLOAD_DIR));
/* Rasm yuklash — kattaroq body (8MB), global 1mb parserdan OLDIN */
app.use('/api/upload', express.json({ limit: '8mb' }), uploadRoutes);

app.use(express.json({ limit: '1mb' }));

/* Kirish/ro'yxat uchun brute-force himoyasi */
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,        // 10 daqiqa
  max: 30,                          // har IP uchun 30 urinish
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Juda ko`p urinish. Birozdan so`ng qayta urinib ko`ring.' },
});

/* Buyurtma spamiga qarshi himoya — FAQAT yangi buyurtma yaratish (POST) cheklanadi.
   GET (har 5 soniyalik polling) va status yangilash (PATCH) ta'sirlanmaydi. */
const orderLimiter = rateLimit({
  windowMs: 60 * 1000,             // 1 daqiqa
  max: 15,                          // har IP uchun daqiqasiga 15 ta yangi buyurtma
  standardHeaders: true,
  legacyHeaders: false,
  /* FAQAT yangi buyurtma yaratish (POST /api/orders) cheklanadi.
     req.path bu yerda router ichidagi yo'l: yangi buyurtma -> '/'.
     Mijozning "bekor qilish" (/:id/cancel) va "qabul qildim" (/:id/received)
     so'rovlari ham POST — ular limitга TUSHMASLIGI kerak, aks holda bitta
     IP ortidagi (Wi-Fi/NAT) mijozlar buyurtmasini tasdiqlay olmay qolardi. */
  skip: (req) => req.method !== 'POST' || req.path !== '/',
  message: { error: 'Juda ko`p buyurtma yuborildi. Bir daqiqadan so`ng urinib ko`ring.' },
});

/* Soddagina so'rov logi */
app.use('/api', (req, _res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

/* API yo'llari */
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
/* Telegram webhook — rate-limit va boshqa cheklovlardan OLDIN turishi kerak,
   aks holda Telegram yangilanishlari 429 olib, xabarlar yo'qoladi. */
app.use(botRouter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/orders', orderLimiter, ordersRoutes);   // <-- spam himoyasi qo'shildi
app.use('/api/reviews', reviewsRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api', dishesRoutes);   // /api/overrides, /api/dishes, /api/discounts
app.use('/api', miscRoutes);     // /api/bootstrap, /api/restaurants, /api/couriers
app.use('/api', resetRoutes);    // /api/admin/reset — saytni tozalash rejasi

/* Noma'lum API yo'li */
app.use('/api', (_req, res) => res.status(404).json({ error: 'API yo`li topilmadi' }));

/* API xatolarini ushlash */
app.use('/api', (err, _req, res, _next) => {
  /* Noto'g'ri JSON body (body-parser) — bu mijoz xatosi, 400 qaytaramiz */
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON format noto`g`ri' });
  }
  /* Body juda katta */
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'So`rov hajmi juda katta' });
  }
  console.error('API xato:', err);
  res.status(500).json({ error: 'Server xatosi' });
});

/* HTML — CSP + nonce bilan (statik'dan OLDIN: inline skriptlarga nonce qo'yadi).
   Shu tufayli injektsiya qilingan <script> yoki onerror= brauzerда ISHLAMAYDI. */
app.use(htmlWithCsp(ROOT_DIR));

/* Qolgan statik fayllar (js/css/rasm) */
app.use(express.static(ROOT_DIR, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`\n🚀 Yetkaz.uz backend ishga tushdi: http://localhost:${PORT}`);
  console.log(`   API:      http://localhost:${PORT}/api/health`);
  console.log(`   Frontend: http://localhost:${PORT}/\n`);
  if (JWT_SECRET.includes('CHANGE')) {
    console.warn('⚠️  DIQQAT: JWT_SECRET standart qiymatda. Productionda .env orqali o`zgartiring!\n');
  }
  /* Bot server tinglay boshlagandan KEYIN ishga tushadi — webhook manzili
     o'rnatilgan zahoti Telegram unga so'rov yubora olsin. */
  startBot().catch((e) => console.warn('[BOT] ishga tushmadi:', e.message));
});
