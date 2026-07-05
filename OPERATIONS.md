# Yetkaz.uz — operatsion qo'llanma (pm2, backup, xavfsizlik)

Bu hujjat **saytni ishlatib turish** (24/7, zaxira, tozalash, topshirishga tayyorlash)
uchun. Internetga chiqarish/APK uchun — `DEPLOY.md` ga qarang.

---

## 1. 24/7 avtomat ishlash — pm2

Terminal yopilса ham ishlashi, yiqilса o'zi tiklanishi uchun (backend + bot):

```bash
npm i -g pm2
cd yetkaz-FINAL
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                  # chiqqan buyruqni admin huquqi bilan bajaring
```

Foydali: `pm2 status`, `pm2 logs`, `pm2 restart all`, `pm2 stop all`.

> Windows'da qayta-yuklanishда avtomat ishga tushish:
> admin PowerShell'да `npm i -g pm2-windows-startup && pm2-startup install`.

---

## 2. Ma'lumotlar bazasi zaxirasi (backup)

```bash
cd server
node scripts/backup.mjs      # server/backups/ ichida timestampli, izchil nusxa
```

**Har kuni avtomat — Windows Scheduled Task:**
```powershell
schtasks /create /tn "YetkazBackup" ^
  /tr "node C:\Users\davro\OneDrive\Desktop\yetkaz-FINAL\server\scripts\backup.mjs" ^
  /sc daily /st 03:00
```
**Linux (cron):** `0 3 * * * cd /path/server && node scripts/backup.mjs`

Oxirgi 14 nusxa saqlanadi (`BACKUP_KEEP`). Nusxalarни **tashqi joyga** (bulut/disk) ham ko'chiring — bitta mashina yetarli emas.

---

## 3. Test/soxta ma'lumotlarni tozalash

```bash
cd server
node scripts/clean-test-data.mjs         # KO'RISH (o'chirmaydi)
node scripts/clean-test-data.mjs --yes   # tasdiqlab O'CHIRISH
```
Faqat aniq "test" belgili yozuvlar o'chadi; haqiqiy ma'lumotga tegmaydi.

---

## 4. Xavfsizlik — allaqachon bor (backend)

- ✅ `helmet` — xavfsizlik sarlavhalari
- ✅ `rate-limit` — login/ro'yxat (30/10daq) va buyurtma (15/daq) brute-force/spam himoyasi
- ✅ Parollar `bcrypt` bilan xeshlangan
- ✅ Rasm yuklash — rol tekshiruvi + tur (png/jpg/webp/gif) + 6MB limit + xavfsiz nom
- ✅ Body limitlari (1MB / rasm 8MB), JSON xato ishlovi
- ✅ Rollarga qat'iy ruxsat (admin/restoran/kuryer/user)

**Productionда SIZ qilishingiz shart:**
- [ ] `server/.env` da **kuchli `JWT_SECRET`**:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- [ ] HTTPS (SSL) — `deploy/nginx.conf.example` + certbot, yoki hosting SSL
- [ ] Har restoran/kuryerга **kuchli, alohida parol** (admin panelida)

---

## 5. Docker (ixtiyoriy)

```bash
docker build -t yetkaz .
docker run -d --name yetkaz -p 5050:5050 \
  -v yetkaz_data:/app/server/data \
  -v yetkaz_uploads:/app/server/uploads \
  --env-file server/.env  yetkaz
```

---

## 6. Topshirishдан oldin — yakuniy ro'yxat

- [ ] Kuchli `JWT_SECRET` (.env)
- [ ] HTTPS ulandi
- [ ] pm2/Docker — 24/7 + auto-restart
- [ ] Kunlik backup + tashqi nusxa
- [ ] Test ma'lumot tozalandi
- [ ] Har restoranga alohida login/parol
- [ ] Yetarli faol kuryer
- [ ] `TG_TOKEN`/`TG_CHAT_OPS` kerakli guruhga
- [ ] Mobil/brauzerда ko'z bilan test
- [ ] (Keyin) to'lov + SMS tasdiq ulanadi
