# Yetkaz.uz — internetga chiqarish va APK olish

APK telefonда ishlashi uchun avval sayt internetда (HTTPS bilan) bo'lishi shart.
Quyidagi yo'l **Android Studio talab qilmaydi** — eng oson variant.

---

## 1-qadam — Kodni GitHub'ga joylash

1. github.com da yangi (bo'sh) repozitoriy oching.
2. Shu papkada (terminalда):
   ```bash
   git remote add origin https://github.com/FOYDALANUVCHI/yetkaz.git
   git push -u origin master
   ```

## 2-qadam — Render.com'ga deploy (bepul)

1. render.com'ga GitHub bilan kiring.
2. **New + → Blueprint** → yuqoridagi repozitoriyni tanlang.
3. Render `render.yaml`ni o'qiydi va avtomatik sozlaydi (`JWT_SECRET`ni o'zi yaratadi).
4. **Apply** bosing → 1-2 daqiqaдан keyin sizга manzil beradi:
   ```
   https://yetkaz.onrender.com
   ```
5. Shu manzilni telefon/kompyuter brauzerида ochib, sayt ishlashini tekshiring.

> Eslatma: bepul Render 15 daqiqa harakatsizlikдан keyin "uxlaydi" — birinchi
> ochilish 30-50 soniya sekin bo'lishi mumkin. To'lovli plan buni yo'qotadi.

## 3-qadam — APK yasash (PWABuilder, bepul)

1. **pwabuilder.com** oching.
2. Render manzilingizni (`https://yetkaz.onrender.com`) kiriting → **Start**.
3. U PWA'ni tekshiradi (bizда manifest + service worker bor) → **Package For Stores**.
4. **Android → Generate Package** → `.apk` (va Play Store uchun `.aab`) yuklab oling.
5. `.apk`ni telefonга o'tkazing → o'rnating (Sozlamalar → "Noma'lum manbalar"ga ruxsat).

Tayyor — ilova bosh ekranда, to'liq ekran, ikonка bilan ishlaydi. 📱

---

## Muqobil yo'llar

- **Railway / Fly.io** — Render o'rniga ishlatса bo'ladi (`Procfile` ham bor).
- **Android Studio** — agar lokal qurmoqchi bo'lsangiz, Capacitor sozlash kerak (aytsangiz yordam beraman).
- **O'z domeningiz** (`yetkaz.uz`) — Renderда "Custom Domain" qo'shib, DNS'ni ulang.

## Productionга chiqarishдан oldin
- To'lov tizimi (Payme/Click) — hozir to'lov simulyatsiya.
- SQLite o'rniga PostgreSQL (yuqori yuklamада).
- Doimiy disk yoki tashqi DB (Render bepul disk vaqtinchalik).
