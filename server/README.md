# Yetkaz.uz — Backend

Node.js + Express + SQLite (`node:sqlite`, native bog'liqliksiz) backend.
Bitta server ham frontend (statik fayllar), ham `/api/*` REST API ni beradi.

## Ishga tushirish

```bash
cd server
npm install
npm start
```

So'ng brauzerda: **http://localhost:5050/**

- Frontend: `http://localhost:5050/`
- API tekshiruvi: `http://localhost:5050/api/health`

Ishlab chiqish (avto-qayta yuklash bilan):

```bash
npm run dev
```

Bazani boshidan to'liq qayta yaratish (seed):

```bash
npm run seed
```

## Texnologiyalar

| Qatlam        | Texnologiya                       |
| ------------- | --------------------------------- |
| HTTP server   | Express 4                         |
| Ma'lumot bazasi | SQLite (`node:sqlite`, ichki)   |
| Autentifikatsiya | JWT (`jsonwebtoken`)           |
| Parol         | bcrypt (`bcryptjs`)               |

## API yo'llari

| Metod  | Yo'l                     | Ruxsat        | Tavsif |
| ------ | ------------------------ | ------------- | ------ |
| POST   | `/api/auth/login`        | hammaga       | Kirish (token qaytaradi) |
| POST   | `/api/auth/register`     | hammaga       | Foydalanuvchi ro'yxati |
| GET    | `/api/auth/me`           | token         | Joriy akkaunt |
| GET    | `/api/bootstrap`         | hammaga       | Bosh sahifa snapshot (izoh, e'lon, override, restoran) |
| GET    | `/api/orders`            | token         | Buyurtmalar (`?rest= &courier= &user=`) |
| POST   | `/api/orders`            | ochiq (mehmon)| Yangi buyurtma (bosh sahifadan ham) |
| PATCH  | `/api/orders/:id`        | token         | Statusni yangilash |
| GET    | `/api/reviews`           | hammaga       | Izohlar |
| POST   | `/api/reviews`           | token         | Izoh qoldirish |
| GET    | `/api/overrides`         | hammaga       | Qo'shilgan/o'chirilgan/chegirmali taomlar |
| POST   | `/api/dishes`            | restoran/admin| Taom qo'shish |
| DELETE | `/api/dishes`            | restoran/admin| Taom o'chirish |
| POST   | `/api/discounts`         | restoran/admin| Chegirma o'rnatish |
| GET    | `/api/announcements`     | hammaga       | E'lonlar |
| POST   | `/api/announcements`     | restoran/admin| E'lon joylash |
| GET    | `/api/restaurants`       | hammaga       | Restoranlar |
| POST   | `/api/restaurants`       | admin         | Restoran + akkaunt qo'shish |
| DELETE | `/api/restaurants`       | admin         | Restoran + akkauntni o'chirish (`{login}`) |
| GET    | `/api/couriers`          | admin         | Kuryerlar |
| POST   | `/api/couriers`          | admin         | Kuryer + akkaunt qo'shish |
| DELETE | `/api/couriers`          | admin         | Kuryer + akkauntni o'chirish (`{login}`) |
| POST   | `/api/upload`            | restoran/admin| Rasm yuklash (base64 → `/uploads/...` URL) |

> Restoran qo'shishda `commission` (foiz) ham yuboriladi — har restoran shartnomasi
> bo'yicha daromad avtomatik bo'linadi (default 18%). Yuklangan rasmlar `server/uploads/` da.

## Sinov akkauntlari (seed)

| Rol      | Login         | Parol      |
| -------- | ------------- | ---------- |
| Admin    | `admin`       | `admin123` |
| Restoran | `burgerhouse` | `bh#2026`  |
| Kuryer   | `bekzod_k`    | `bk#2026`  |
| Mijoz    | `dilnoza`     | `1234`     |

> Barcha restoran/kuryer loginlari `assets/js/seed` mantig'ida — qolganlari ham xuddi shu sxemada.

## Frontend integratsiyasi

Frontend `assets/js/store.js` orqali ulanadi:
- O'qishlar **keshdan** (sinxron) — UX/UI o'zgarmagan.
- Yozishlar **optimistik** — darhol keshga, so'ng API ga.
- Har 5 soniyada `/api/bootstrap` + `/api/orders` bilan **realtime sinxron**.
- Backend ishlamasa — `localStorage` keshida **offline** ishlayveradi.

## Xavfsizlik (o'rnatilgan)

- Parollar **bcrypt** bilan xeshlanadi (klient JS da ochiq parol yo'q).
- **JWT** token + rol-asosli ruxsat (admin / restoran / kuryer / user).
- **helmet** — xavfsizlik HTTP sarlavhalari.
- **express-rate-limit** — `/api/auth` ga brute-force himoyasi (10 daq / 30 urinish).
- **compression** — javoblar gzip qilinadi.

## Production'ga chiqarish

1. **Muhit o'zgaruvchilari:** `.env.example` ni `.env` ga nusxalang va `JWT_SECRET` ni
   uzun tasodifiy qiymatga o'zgartiring:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   `npm start` `.env` ni avtomatik o'qiydi (`--env-file-if-exists`).

2. **Reverse proxy (Nginx) + HTTPS:** Express ni `localhost:5050` da qoldirib,
   oldidan Nginx (yoki Caddy) bilan TLS sertifikat (Let's Encrypt) o'rnating.
   Proxy ortida `app.set('trust proxy', 1)` qo'shing (rate-limit IP to'g'ri ishlashi uchun).

3. **Doimiy ishlash:** `pm2 start src/app.js --name yetkaz` yoki systemd xizmati.

4. **CSP:** hozir `helmet` da CSP o'chirilgan (frontend inline skript ishlatadi).
   Productionda inline skriptlarni tashqi fayllarga ko'chirib, qat'iy CSP yoqing.

5. **Ma'lumotlar bazasi:** SQLite fayli `server/data/` da. Muntazam zaxira (backup) oling.
   Yuqori yuklamada PostgreSQL ga ko'chish oson — faqat `db.js` va so'rovlar qatlamini almashtiring.

## Hali qo'shilmagan (kelajak ishi)

- Real to'lov shlyuzi (hozir to'lov tanlovi — simulyatsiya).
- Bosh sahifadagi buyurtma taymeri — mijoz uchun lokal simulyatsiya (buyurtmaning o'zi backendga boradi).
- Admin panelidagi daromad/statistika ko'rsatkichlari — demo ma'lumot (hisob-kitob keyin real bo'ladi).
