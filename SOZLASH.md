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

## Bot kim uchun

Bot **faqat MIJOZ** bilan ishlaydi — boshqa hech kim uchun emas:

| Kim | Qayerda ishlaydi |
|---|---|
| 👤 Mijoz | **Telegram bot** — restoran tanlaydi, mini ilovada buyurtma beradi, holatini kuzatadi, qabul qilganini tasdiqlaydi yoki bekor qiladi |
| 🏪 Restoran | **Sayt paneli** (`/restoran.html`) — buyurtma darhol ko`rinadi |
| 🛵 Kuryer | **Sayt paneli** (`/kuryer.html`) — buyurtmalar va vaqt ogohlantirishlari shu yerда |
| 🛡 Admin | **Sayt paneli** (`/admin.html`) |

Restoran va kuryer botga **ulanmaydi** va bot ularga yozmaydi. Ilgari xodimlar ham
botga ulanardi va kuryer ma`lumoti mijoz oqimiga aralashib ketardi — shuning uchun
butunlay ajratildi.

**`TG_CHAT_OPS` (ixtiyoriy)** — operatorlar GURUHI. Bu shaxsiy chat emas, kuzatuv
kanali: yangi buyurtma, bekor qilish, kechikish va bloklangan raqamlar u yerга tushadi.
Berilmasa — hech narsa yuborilmaydi, bot normal ishlayveradi.

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

## Katta va shubhali buyurtmalar

Chegaralar **bitta joyda**: `server/src/order-rules.js` (o'zgartirsangiz, panellar
ham shu sonlarga moslashadi).

### 1) Kuryerning tasdiqlovchi qo'ng'irog'i

Buyurtma **10 donadan ko'p** yoki **300 000 so'mdan qimmat** bo'lsa, kuryer
panelida «Yo'lga chiqdim» o'rniga **📞 Mijozga qo'ng'iroq** tugmasi chiqadi.
Kuryer mijozga qo'ng'iroq qilib «rostdan shuncha buyurtma berdingizmi?» deb
so'raydi va **«Mijoz tasdiqladi»** bosgandan keyingina yo'lga chiqa oladi.

To'siq **serverда** ham bor: tasdiqsiz `status = ontheway` so'rovi `409` bilan
rad etiladi — ya'ni tugmani chetlab o'tib bo'lmaydi.

### 2) Shubhali buyurtma — avval ADMIN, keyin restoran

Quyidagilardan **birortasi** bo'lsa, buyurtma `status = review` bo'ladi va
**restoran ham, kuryer ham uni ko'rmaydi**:

| Shart | Chegara |
|---|---|
| Jami mahsulot | **60 donadan** ko'p |
| Summa | **3 000 000 so'mdan** qimmat |
| Turli taom soni | **30 xildan** ko'p |
| Bitta raqamdan ketma-ket buyurtma | **30 daqiqada 3 va undan ko'p** |

Bunday buyurtma **Admin panel → 🔎 Shubhali buyurtmalar** bo'limiga tushadi
(yon menyuda qizil hisoblagich chiqadi). Admin buyurtma tarkibini rasm bilan
ko'radi, mijozga qo'ng'iroq qila oladi va:

* **✅ Tasdiqlash** — buyurtma `new` bo'ladi, kuryer **shu paytda** biriktiriladi
  va restoran panelida paydo bo'ladi;
* **❌ Rad etish** — bekor qilinadi, sabab mijozga ko'rsatiladi.

> Oddiy katta buyurtma (20–30 ta mahsulot) adminга **tushmaydi** — u to'g'ridan
> restoranga boradi, faqat kuryerdan tasdiqlovchi qo'ng'iroq talab qilinadi.

---

## Kuryerga buyurtma taqsimlash

| Holat | Kimga beriladi |
|---|---|
| Bo'sh joyi bor kuryer bor | **Eng kam yuklangani** (bir xil bo'lsa — shu restoranning kuryeri) |
| Hamma kuryerda **2 tadan** bor | **Eng tez bo'shaydigani** (yetib borish vaqti eng kam) |

Bitta kuryerda bir vaqtda **2 tadan ko'p** faol buyurtma bo'lmaydi
(`MAX_ACTIVE_PER_COURIER`, `server/src/orders-core.js`). Ish vaqtidan tashqaridagi
va ishdan javobdagi kuryerlar hisobga olinmaydi.

---

## Izohlarni admin nazorat qiladi

**Admin panel → 💬 Izohlar** bo'limida saytga yozilgan **har bir** izoh ko'rinadi
(qidiruv + «faqat past baho» filtri bilan). Admin:

* **↩ Javob yozish** — javob saytda izoh ostida **«Yetkaz javobi»** bo'lib chiqadi;
* **🗑 O'chirish** — izoh saytdan butunlay o'chadi.

> Eslatma: bosh sahifada faqat **3 yulduz va undan yuqori** izohlar ko'rsatiladi
> (eski qoida). Past bahodagi izohlar admin panelida to'liq ko'rinadi.

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

Ogohlantirish **kuryer panelida** ko'rinadi: tepada qizil banner + har bir
buyurtmada sanoq (`⏱ 8 daqiqa qoldi`). Bot kuryerga yozmaydi — u faqat mijoz
uchun. Vaqt tugab ketsa, `TG_CHAT_OPS` guruhi bo'lsa, u yerга ham xabar boradi.

---

## Ishlash mantig'i (qisqacha)

```
Mijoz (bot yoki sayt)
      │  buyurtma
      ▼
orders-core.js ← narx, kuryer biriktirish, telefon tekshiruvi
      │           (sayt va bot AYNAN shu kodni ishlatadi)
      │
      ├── shubhali? ──► Admin paneli (🔎 Shubhali buyurtmalar)
      │                      │ admin tasdiqlaydi
      ▼                      ▼
Restoran paneli ──► Kuryer paneli
                         │ katta buyurtma bo'lsa: avval mijozga qo'ng'iroq
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
