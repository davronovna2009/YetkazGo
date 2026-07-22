# Yetkaz.uz — Render + Turso + Telegram bot sozlash

Yangi Render hisobiga deploy qilish va bazani doimiy qilish uchun **qadamma-qadam**
qo'llanma. Tartib bilan boring — har qadam oldingisiga tayanadi.

---

## 1-qadam — Turso (doimiy baza) ⚠️ ENG MUHIM

**Nega kerak:** Render bepul planida doimiy disk yo'q. Turso ulanmasa,
**har deploy'da butun baza o'chadi** — restoranlar, kuryerlar, buyurtmalar,
admin paroli. Turso bepul planida 500 ta baza va 9 GB trafik bor, bu yetarli.

1. https://turso.tech → **Sign up** (GitHub bilan kirsa bo'ladi)
2. Yangi baza yarating (nomi masalan `yetkaz`), region: **Frankfurt (fra)** yoki
   **Amsterdam (ams)** — O'zbekistonga eng yaqini
3. Ikkita qiymatni oling va saqlab qo'ying:
   - **Database URL** — `libsql://yetkaz-xxxx.turso.io` ko'rinishida
   - **Auth token** — uzun matn (bir marta ko'rsatiladi, nusxa oling!)

> Kod Turso'ni allaqachon qo'llab-quvvatlaydi (`server/src/db.js`) — embedded
> replica rejimida ishlaydi: o'qish lokal fayldan (tez), yozish Turso'ga
> (doimiy). Hech narsani o'zgartirish shart emas, faqat env-var bering.

---

## 2-qadam — Telegram bot yaratish

1. Telegramda **@BotFather** ni oching
2. `/newbot` → bot nomi (masalan `Yetkaz Xatirchi`) → username (masalan
   `yetkaz_xatirchi_bot`, `_bot` bilan tugashi shart)
3. BotFather **tokenni** beradi — `123456789:AAExxxxxxxx` ko'rinishida. Saqlang.
4. Mini App tugmasi ishlashi uchun (deploy'dan **keyin** qiling):
   `/mybots` → botni tanlang → **Bot Settings → Menu Button → Configure**
   → manzil: `https://SIZNING-SAYT.onrender.com/tg-app.html`

### Buyurtma xabarnomasi uchun guruh (ixtiyoriy)
Operatorlar yangi buyurtmani ko'rib turishi uchun:
1. Telegramda guruh oching, botni **admin** qilib qo'shing
2. Guruh `chat_id` sini oling (masalan @getidsbot orqali) — `-100...` bilan boshlanadi
3. Uni `TG_CHAT_OPS` ga yozasiz

---

## 3-qadam — Render'ga deploy

1. https://render.com → yangi hisob (GitHub bilan kiring)
2. **New + → Blueprint** → `davronovna2009/YetkazGo` repozitoriyni tanlang
3. Render `render.yaml` ni o'qiydi va o'zi sozlaydi
4. **Environment Variables** bo'limida quyidagilarni kiriting:

| Kalit | Qiymat | Majburiymi |
|---|---|---|
| `ADMIN_PASS` | Kuchli parol, masalan `Yetkaz#Admin2026!` | ✅ Ha |
| `TURSO_DATABASE_URL` | 1-qadamdagi `libsql://...` | ✅ Ha (aks holda baza o'chadi) |
| `TURSO_AUTH_TOKEN` | 1-qadamdagi token | ✅ Ha |
| `TG_TOKEN` | 2-qadamdagi bot tokeni | Bot kerak bo'lsa |
| `TG_CHAT_OPS` | Operatorlar guruhi `chat_id` | Ixtiyoriy |

> `JWT_SECRET` — Render **o'zi** yaratadi, tegmang.
> `PUBLIC_URL` — kerak emas: Render `RENDER_EXTERNAL_URL` ni o'zi beradi va bot
> Mini App manzilini shundan oladi.

5. **Apply** → 2-3 daqiqada manzil beradi: `https://xxxx.onrender.com`

---

## 4-qadam — Tekshirish

Deploy tugagach quyidagilarni **tartib bilan** tekshiring:

### Sayt
- [ ] Sayt ochiladi
- [ ] `/admin` → login `admin`, parol — `ADMIN_PASS` da bergan parolingiz
- [ ] Admin panelda restoran qo'shing → **Egasi (F.I.Sh.) majburiy** ekanini ko'ring
- [ ] Ish vaqti maydoniga harf yozib ko'ring — **kirmasligi kerak**
- [ ] Kuryer qo'shing → **davlat raqami so'ralmasligi** kerak
- [ ] Telefonni kichraytiring (F12 → mobil rejim) → headerda **burger + logo**,
      sarlavha pastki qatorda

### Doimiylik (eng muhim tekshiruv)
- [ ] Restoran/taom qo'shing
- [ ] Render → **Manual Deploy → Deploy latest commit**
- [ ] Deploy tugagach qayta kiring → **ma'lumot joyida turibdimi?**
      Turibsa — Turso ishlayapti. Yo'qolgan bo'lsa — env-var'lar noto'g'ri.

### Bot
- [ ] Botga `/start` yozing → "🍽 Buyurtma berish" tugmasi chiqadi
- [ ] Tugmani bosing → Mini App ochiladi → taom tanlab buyurtma bering
- [ ] Botga tasdiq xabari keladi (raqam, tarkib, summa, kuryer)
- [ ] Restoran panelida buyurtma ko'rinadi
- [ ] Kuryer panelida "Yo'lga chiqdim" → "Yetkazdim" bosing
- [ ] Botga **"✅ Qabul qildim"** tugmasi keladi → bosing
- [ ] Restoran va kuryer panelida **"Yetkazildi"** bo'ladi

---

## Panellarni Telegramga ulash (restoran / kuryer / admin)

Buyurtma faqat saytda emas, **botда ham** kelishi uchun har bir panel egasi
o'z Telegramini bir marta ulaydi:

1. Panelга kiring → **Sozlamalar** → **✈️ Telegram bot**
2. **«Telegramga ulash»** tugmasi → sayt 8 belgili kod va havola beradi
3. **«Telegramда ochish»** tugmasini bosing (yoki kodni botga xabar qilib yuboring)
4. Panelда **«✅ Telegram ulangan»** yozuvi chiqadi

Shundan keyin:

| Kim | Nima keladi | Telegramdagi tugmalar |
|---|---|---|
| 🏪 Restoran | Yangi buyurtma (to'liq tarkibi bilan) | Tayyorlanmoqda → Tayyor → Bekor qilish |
| 🛵 Kuryer | Yangi buyurtma + **vaqt ogohlantirishlari** | Yo'lga chiqdim → Yetkazdim |
| 🛡 Admin | Yangi buyurtma, bekor qilish, kechikish, bloklangan raqamlar | — |

`TG_CHAT_OPS` guruhi ham admin qatorida — barcha buyurtmalar unga tushaveradi.

---

## Buyurtmani bekor qilish cheklovi

Bitta **telefon raqami** bo'yicha hisob yuritiladi:

| Bekor qilish | Nima bo'ladi |
|---|---|
| 1-marta | Faqat qayd etiladi |
| 2-marta | Ogohlantirish + **5 daqiqaga** buyurtma berish cheklanadi |
| 3-marta | Raqam **bloklanadi** |

Bloklangan raqam **Admin panel → 🚫 Bloklangan raqamlar** bo'limida chiqadi;
faqat admin **«Blokni ochish»** tugmasi bilan ochadi. Buyurtma muvaffaqiyatli
yakunlansa (mijoz «Qabul qildim» bosса) — hisob **nolga qaytadi**.

---

## Yetkazish muddati ogohlantirishlari

Buyurtmaga berilgan vaqt (`eta`) tugay deb qolganda kuryer **3 marta**
ogohlantiriladi, muddat o'tsa — to'rtinchi xabar:

| Daraja | Qachon |
|---|---|
| 1 | Vaqtning yarmi qolganda |
| 2 | 5 daqiqa qolganda |
| 3 | 2 daqiqa qolganda |
| ⛔ | Vaqt tugadi, buyurtma hali yetkazilmagan |

Ogohlantirish **ikki joyда** ko'rinadi: kuryer panelining tepasida (qizil banner
+ har bir buyurtmada sanoq) va Telegram botда. Har bir daraja bitta buyurtma
uchun bir marta yuboriladi.

---

## Ishlash mantig'i (qisqacha)

```
Mijoz (bot yoki sayt)
      │  buyurtma
      ▼
orders-core.js ← narx, kuryer biriktirish, telefon tekshiruvi
      │           (sayt va bot AYNAN shu kodni ishlatadi)
      ▼
Restoran paneli ──► Kuryer paneli
                         │ "Yetkazdim"
                         ▼
                    status = arrived
                         │
        ┌────────────────┴────────────────┐
        │ mijoz tasdiqlaydi                │ 30 daqiqa o'tadi
        │ (sayt/kabinet/bot tugmasi)       │ (server o'zi)
        └────────────────┬────────────────┘
                         ▼
                    status = done
              (kuryer daromadi yoziladi)
```

## Muammo bo'lsa

| Belgi | Sabab |
|---|---|
| Har deploy'da baza bo'sh | `TURSO_*` env-var'lar berilmagan yoki xato |
| Bot javob bermaydi | `TG_TOKEN` xato — Render Logs'da `[BOT] token noto'g'ri` chiqadi |
| Mini App ochilmaydi | BotFather'da Menu Button manzili sozlanmagan (2-qadam, 4-band) |
| Bot ishlaydi-yu tugma yo'q | `PUBLIC_URL`/`RENDER_EXTERNAL_URL` yo'q — Logs'ni ko'ring |
| Birinchi ochilish sekin | Bepul Render 15 daq. harakatsizlikdan keyin uxlaydi (normal) |

Render **Logs** bo'limi — birinchi qaraydigan joyingiz. Bot ishga tushsa
`[BOT] @username ishga tushdi` deb yozadi.
