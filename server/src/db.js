/* ===== Yetkaz.uz backend — ma'lumotlar bazasi (libSQL + Turso embedded replica) =====
   Turso ulanганда (TURSO_URL bor): lokal fayl = tez o'qish uchun replica, yozuvlar
   remote (bulut) primary'ga yoziladi va DOIMIY saqlanadi. Ulanmagan bo'lsa — oddiy
   lokal fayl (dev). API node:sqlite bilan bir xil (sinxron: prepare/get/all/run/exec). */
import Database from 'libsql';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH, TURSO_URL, TURSO_TOKEN } from './config.js';

mkdirSync(dirname(DB_PATH), { recursive: true });

const opts = {};
if (TURSO_URL) { opts.syncUrl = TURSO_URL; opts.authToken = TURSO_TOKEN; }
export const db = new Database(DB_PATH, opts);

/* Boot: remote'dan lokal replica'ga mavjud ma'lumotlarni tortib olamiz */
if (TURSO_URL) {
  try { db.sync(); console.log('[Turso] embedded replica sinxronlandi'); }
  catch (e) { console.warn('[Turso] boshlang\'ich sync xato:', e.message); }
  /* Boshqa nusxalar o'zgartirsa — davriy tortib olamiz (bir server uchun ham zararsiz) */
  setInterval(() => { try { db.sync(); } catch (e) { /* jim */ } }, 60000);
}
try { db.exec('PRAGMA foreign_keys = ON;'); } catch (e) { /* ba'zi rejimlarda qo'llanmaydi */ }

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      login      TEXT NOT NULL UNIQUE,
      pass_hash  TEXT NOT NULL,
      role       TEXT NOT NULL,              -- admin | restoran | kuryer | user
      name       TEXT NOT NULL,
      phone      TEXT DEFAULT '',
      target     TEXT NOT NULL,              -- qaysi panelga yo'naltirish
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      name_cyr   TEXT DEFAULT '',
      emoji      TEXT DEFAULT '',
      kw         TEXT DEFAULT '',
      rating     REAL DEFAULT 0,            -- ESKI ustun — ENDI ISHLATILMAYDI (ratings.js jonli hisoblaydi)
      eta        INTEGER DEFAULT 20,
      dist       TEXT DEFAULT '',
      photo      TEXT DEFAULT '',
      login      TEXT DEFAULT '',
      commission INTEGER DEFAULT 18,
      open_h     INTEGER DEFAULT 9,
      close_h    INTEGER DEFAULT 23,
      active     INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS couriers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      emoji      TEXT DEFAULT '🛵',
      rest       TEXT DEFAULT '',
      login      TEXT DEFAULT '',
      phone      TEXT DEFAULT '',
      deliveries INTEGER DEFAULT 0,
      rating     REAL DEFAULT 0,            -- ESKI ustun — ENDI ISHLATILMAYDI (ratings.js jonli hisoblaydi)
      fee        INTEGER DEFAULT 0,
      active     INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user       TEXT DEFAULT '',
      phone      TEXT DEFAULT '',
      rest       TEXT DEFAULT '',
      item       TEXT DEFAULT '',
      emoji      TEXT DEFAULT '',
      amount     INTEGER DEFAULT 0,
      addr       TEXT DEFAULT '',
      pay        TEXT DEFAULT 'card',
      courier    TEXT DEFAULT '',
      status     TEXT DEFAULT 'new',         -- new | ontheway | done
      eta        INTEGER DEFAULT 15,
      time       TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT DEFAULT '',
      ava        TEXT DEFAULT '👤',
      rating     INTEGER DEFAULT 5,
      dish       TEXT DEFAULT '',
      text       TEXT DEFAULT '',
      text_cyr   TEXT DEFAULT '',
      flagged    INTEGER DEFAULT 0,
      date       TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Restoran qo'shgan yangi taomlar (base katalog data.js da qoladi)
    CREATE TABLE IF NOT EXISTS added_dishes (
      id         INTEGER PRIMARY KEY,        -- frontend bergan id (Date.now())
      name       TEXT NOT NULL,
      name_cyr   TEXT DEFAULT '',
      emoji      TEXT DEFAULT '🍽️',
      price      INTEGER DEFAULT 0,
      rest       TEXT NOT NULL,
      cat        TEXT DEFAULT 'Fastfood',
      kw         TEXT DEFAULT '',
      photo      TEXT DEFAULT '',
      rating     REAL DEFAULT 0,            -- ESKI ustun — ENDI ISHLATILMAYDI (ratings.js: sotuv/baho)
      sold       INTEGER DEFAULT 0,         -- ESKI ustun — REAL sotuv ratings.js dishSales() dan
      badge      TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- O'chirilgan taomlar (rest|name kaliti)
    CREATE TABLE IF NOT EXISTS removed_dishes (
      rest TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (rest, name)
    );

    -- Chegirmalar (rest|name -> foiz)
    CREATE TABLE IF NOT EXISTS discounts (
      rest TEXT NOT NULL,
      name TEXT NOT NULL,
      pct  INTEGER NOT NULL,
      PRIMARY KEY (rest, name)
    );

    -- Sotuvda yo'q taomlar (stock tugagan)
    CREATE TABLE IF NOT EXISTS soldout_dishes (
      rest TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (rest, name)
    );

    -- Mijozning "yoqtirgan" (like bosgan) taomlari — FAQAT ro'yxatdan o'tgan
    -- akkauntga bog'liq (accounts.id). Kabinet: taom kartida yurakcha tugmasi.
    CREATE TABLE IF NOT EXISTS likes (
      account_id INTEGER NOT NULL,
      rest       TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, rest, name)
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      rest       TEXT DEFAULT '',
      text       TEXT NOT NULL,
      emoji      TEXT DEFAULT '📢',
      tag        TEXT DEFAULT '',
      dish       TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Yuklangan rasmlar BAZADA saqlanadi (diskda emas).
    -- Sabab: Render bepul planida doimiy disk yo'q — konteyner har deploy'da
    -- va uxlab-uyg'onganda tozalanadi, natijada uploads/ dagi barcha rasm
    -- yo'qolardi (baza esa yo'lni eslab, sayt buzuq rasm ko'rsatardi).
    -- Baza Turso'da doimiy saqlangani uchun rasm ham endi yo'qolmaydi.
    CREATE TABLE IF NOT EXISTS images (
      name       TEXT PRIMARY KEY,          -- masalan dish_1737..._412.jpg
      mime       TEXT NOT NULL,
      data       BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Telefon raqami cheklovlari (buyurtmani ketma-ket bekor qilish) =====
    -- Qoida: 1-bekor — ogohlantirishsiz yoziladi; 2-bekor — ogohlantirish va
    -- 5 daqiqaga cheklov; 3-bekor — raqam BLOKLANADI (adminda "Bloklangan
    -- raqamlar" bo'limida chiqadi va faqat admin ochadi).
    CREATE TABLE IF NOT EXISTS phone_blocks (
      phone       TEXT PRIMARY KEY,          -- faqat raqamlar: 998XXXXXXXXX
      pretty      TEXT DEFAULT '',           -- ko'rinish uchun: +998 XX XXX XX XX
      cancels     INTEGER DEFAULT 0,         -- ketma-ket bekor qilishlar soni
      blocked     INTEGER DEFAULT 0,         -- 1 = butunlay bloklangan
      until       TEXT DEFAULT '',           -- vaqtinchalik cheklov tugash payti (UTC)
      last_name   TEXT DEFAULT '',           -- oxirgi buyurtmadagi ism
      reason      TEXT DEFAULT '',
      source      TEXT DEFAULT 'auto',      -- 'auto' = sayt o'zi, 'admin' = qo'lда
      unblocked_at TEXT DEFAULT '',         -- admin blokni ochgan payt ("toza varaq")
      last_cancel TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Telegram ulanishlari =====
    -- Panel (restoran/kuryer/admin) bir martalik kod hosil qiladi, egasi botga
    -- yuboradi va shu chat buyurtmalarni Telegramда oladi.
    CREATE TABLE IF NOT EXISTS tg_links (
      code       TEXT PRIMARY KEY,
      role       TEXT NOT NULL,              -- restoran | kuryer | admin
      login      TEXT NOT NULL,
      name       TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Admin(lar) Telegram chatlari — yangi buyurtma va bloklash xabarlari uchun
    CREATE TABLE IF NOT EXISTS tg_admins (
      chat_id    TEXT PRIMARY KEY,
      login      TEXT DEFAULT '',
      name       TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Kuryerga yuborilgan "vaqt kam qoldi" ogohlantirishlari — takrorlanmasin
    CREATE TABLE IF NOT EXISTS order_alerts (
      order_id   INTEGER NOT NULL,
      level      INTEGER NOT NULL,           -- 1,2,3 = ogohlantirish; 4 = vaqt tugadi
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (order_id, level)
    );

    -- ===== Sayt sozlamalari (kalit -> qiymat) =====
    -- Admin panelida to'ldiriladi, sayt/bot/mini ilova SHU YERDAN o'qiydi.
    -- Masalan owner_phone — katta buyurtma uchun "shu raqamga qo'ng'iroq qiling".
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Shikoyatlar (restoran va kuryerdan adminga) =====
    CREATE TABLE IF NOT EXISTS complaints (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT NOT NULL,              -- restoran | kuryer
      login      TEXT NOT NULL,              -- kim yuborgan (akkaunt login)
      name       TEXT DEFAULT '',            -- ko'rinadigan ism
      topic      TEXT DEFAULT '',            -- mavzu (kechikish, to'lov, mijoz, boshqa)
      text       TEXT NOT NULL,
      order_id   INTEGER DEFAULT 0,          -- tegishli buyurtma (0 = umumiy)
      status     TEXT DEFAULT 'new',         -- new | seen | closed
      reply      TEXT DEFAULT '',            -- admin javobi
      reply_at   TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Bonuslar (admin/restoran belgilaydi, mijoz kabinetда ko'radi) =====
    -- type: 'order_count' (masalan "7 kunда 3 marta buyurtma ber") | 'referral'
    -- (do'st taklif qil) | 'custom' (faqat ma'lumot uchun, avtomatik kuzatuv yo'q).
    CREATE TABLE IF NOT EXISTS bonuses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL DEFAULT 'admin',   -- admin | restoran
      rest       TEXT DEFAULT '',                 -- scope='restoran' bo'lsa restoran nomi
      title      TEXT NOT NULL,
      descr      TEXT DEFAULT '',
      image      TEXT DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'custom',
      target     INTEGER DEFAULT 0,
      reward_text TEXT DEFAULT '',
      active     INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Tadbirlar (mijoz kelajakdagi tadbiri uchun oldindan xabar beradi) =====
    -- Admin — HAMMASINI ko'radi; restoran — FAQAT o'ziga tegishlisini (to'liq).
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      user          TEXT DEFAULT '',
      phone         TEXT DEFAULT '',
      rest          TEXT NOT NULL DEFAULT '',
      addr          TEXT DEFAULT '',
      event_date    TEXT NOT NULL,        -- YYYY-MM-DD
      name          TEXT NOT NULL,        -- tadbir nomi
      headcount     INTEGER DEFAULT 0,    -- necha kishilik
      advance_days  INTEGER DEFAULT 1,    -- necha kun oldin buyurtma berilishi kerak
      discount_pct  INTEGER DEFAULT 0,    -- admin/restoran belgilagan chegirma
      status        TEXT NOT NULL DEFAULT 'pending',   -- pending | discounted
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ===== Guruh buyurtmasi: bir nechta mijoz BITTA yetkazishga, lekin HAR
    -- KIM O'Z ulushini alohida to'laydi. Guruh "open" holatda a'zolar taom
    -- qo'shadi (group_items), birov "tasdiqlash"ni bossa BITTA orders yozuviga
    -- birlashtiriladi (orders.group_id/group_breakdown — pastroqda).
    CREATE TABLE IF NOT EXISTS groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      rest       TEXT DEFAULT '',
      addr       TEXT DEFAULT '',
      status     TEXT NOT NULL DEFAULT 'open',   -- open | confirmed | cancelled
      order_id   INTEGER DEFAULT NULL,           -- confirmed bo'lgach — yaratilgan orders.id
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id    INTEGER NOT NULL,
      account_id  INTEGER NOT NULL,
      name        TEXT NOT NULL,
      pay         TEXT NOT NULL DEFAULT 'cash',   -- shu a'zoning O'Z to'lov turi
      joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(group_id, account_id)
    );

    CREATE TABLE IF NOT EXISTS group_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id    INTEGER NOT NULL,
      account_id  INTEGER NOT NULL,
      member_name TEXT NOT NULL,
      dish_id     INTEGER NOT NULL,
      dish_rest   TEXT NOT NULL,
      dish_name   TEXT NOT NULL,
      emoji       TEXT DEFAULT '🍽️',
      qty         INTEGER NOT NULL DEFAULT 1,
      note        TEXT DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_group_items_group ON group_items(group_id);

    CREATE INDEX IF NOT EXISTS idx_orders_rest    ON orders(rest);
    CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier);
    CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user);
    -- status bo'yicha qidirish (masalan "done" buyurtmalar — ratings.js dishSales,
    -- daromad hisoblari) buyurtma soni ko'paysa ham TEZ ishlashi uchun.
    CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
  `);

  /* Migratsiyalar: eski bazalarda yangi ustunlar bo'lmasligi mumkin.
     MUHIM: barcha ustun migratsiyalari SHU YERDA (initSchema ichida) bo'lishi kerak —
     bu jadvallar CREATE QILINGANDAN keyin ishga tushadi. Route fayllarida (import
     paytida) ALTER TABLE yozilsa, yangi bazada jadval hali yo'q bo'lib, jim yiqiladi
     va ustun umuman qo'shilmaydi (masalan orders.token → buyurtma 500 beradi). */
  try { db.exec('ALTER TABLE restaurants ADD COLUMN commission INTEGER DEFAULT 18'); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN phone TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN token TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN reason TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  try { db.exec('ALTER TABLE orders ADD COLUMN delivery INTEGER DEFAULT 0'); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN done_at TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  /* Kuryer "Yetkazdim" bosgan payt — 30 daqiqadan keyin avtomatik tasdiqlash uchun */
  try { db.exec("ALTER TABLE orders ADD COLUMN arrived_at TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  /* Telegram botdan kelgan buyurtmада mijozning chat_id'si — holat xabarlari uchun */
  try { db.exec("ALTER TABLE orders ADD COLUMN tg_chat_id TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  // Buyurtma tarkibi (server narxlagan qatorlar JSON): [{id,name,emoji,qty,price,pct,eff,sum}]
  // Nizo/tekshiruv uchun — summa shu qatorlardan kelib chiqqan (pricing.js).
  try { db.exec("ALTER TABLE orders ADD COLUMN items_json TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  // Izoh qaysi RESTORANга tegishli — restoran o'z izohlarini aniq ko'rishi uchun
  // (avval faqat dish nomi bor edi, "Osh +2 ta" kabi buyurtma nomi mos kelmasdi).
  try { db.exec("ALTER TABLE reviews ADD COLUMN rest TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  // Yetkazishда to'lov (QR orqali tasdiqlanadi): paid + vaqti
  try { db.exec('ALTER TABLE orders ADD COLUMN paid INTEGER DEFAULT 0'); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE orders ADD COLUMN paid_at TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  // Kuryerning doimiy to'lov QR tokeni (mijoz skanerlaydi)
  try { db.exec("ALTER TABLE couriers ADD COLUMN pay_token TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  try { db.exec("ALTER TABLE accounts ADD COLUMN email TEXT DEFAULT ''"); } catch (e) { /* bor */ }
  try { db.exec('ALTER TABLE couriers ADD COLUMN fee INTEGER DEFAULT 0'); } catch (e) { /* bor */ }
  try { db.exec('ALTER TABLE restaurants ADD COLUMN open_h INTEGER DEFAULT 9'); } catch (e) { /* bor */ }
  try { db.exec('ALTER TABLE restaurants ADD COLUMN close_h INTEGER DEFAULT 23'); } catch (e) { /* bor */ }
  // ===== Qo'shimcha ma'lumot ustunlari (restoran/kuryer profili) =====
  for (const col of [
    "ALTER TABLE restaurants ADD COLUMN addr TEXT DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN owner TEXT DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN email TEXT DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN descr TEXT DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN hours TEXT DEFAULT ''",
    "ALTER TABLE restaurants ADD COLUMN area TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN transport TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN plate TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN address TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN email TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN birthdate TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN passport TEXT DEFAULT ''",
    // Kuryer ish vaqti (o'zi boshqaradi) + ishdan javob (leave) holati
    "ALTER TABLE couriers ADD COLUMN open_h INTEGER DEFAULT 8",
    "ALTER TABLE couriers ADD COLUMN close_h INTEGER DEFAULT 22",
    "ALTER TABLE couriers ADD COLUMN on_leave INTEGER DEFAULT 0",
    "ALTER TABLE couriers ADD COLUMN leave_reason TEXT DEFAULT ''",
    // Ishdan javob so'rovi holati: none | pending | approved | denied (admin qaror qiladi)
    "ALTER TABLE couriers ADD COLUMN leave_status TEXT DEFAULT 'none'",
    // Reklama/e'longa biriktirilgan rasm (restoran o'zi yuklaydi)
    "ALTER TABLE announcements ADD COLUMN img TEXT DEFAULT ''",
    // Taom qo'shimcha ma'lumotlari (restoran kiritadi, saytda ko'rinadi)
    "ALTER TABLE added_dishes ADD COLUMN weight TEXT DEFAULT ''",        // vazn/miqdor (masalan "500 g" / "3 dona")
    "ALTER TABLE added_dishes ADD COLUMN ingredients TEXT DEFAULT ''",   // tarkibi (ichidagi mahsulotlar)
    "ALTER TABLE added_dishes ADD COLUMN descr TEXT DEFAULT ''",         // tavsif / ta'mi
    // Restoran/kuryer Telegram chat_id — buyurtma xabarlari botда keladi
    "ALTER TABLE restaurants ADD COLUMN tg_chat_id TEXT DEFAULT ''",
    "ALTER TABLE couriers ADD COLUMN tg_chat_id TEXT DEFAULT ''",
    // Blok kim tomonidan: 'auto' — sayt o'zi qoida bo'yicha, 'admin' — qo'lда
    "ALTER TABLE phone_blocks ADD COLUMN source TEXT DEFAULT 'auto'",
    // Admin blokni ochgan payt — spam qoidasi shundan oldingi buyurtmalarni sanamaydi
    "ALTER TABLE phone_blocks ADD COLUMN unblocked_at TEXT DEFAULT ''",
    // Buyurtma QAYERDAN kelgan: 'sayt' yoki 'telegram' (panellarda ko'rsatiladi)
    "ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'sayt'",
    // ===== Katta/shubhali buyurtmalar (order-rules.js) =====
    // Jami dona soni — "10 tadan ko'p" qoidasi shundan hisoblanadi
    'ALTER TABLE orders ADD COLUMN qty_total INTEGER DEFAULT 0',
    // Kuryer yo'lga chiqishdan OLDIN mijozga qo'ng'iroq qilishi shartmi
    'ALTER TABLE orders ADD COLUMN call_required INTEGER DEFAULT 0',
    'ALTER TABLE orders ADD COLUMN call_done INTEGER DEFAULT 0',
    "ALTER TABLE orders ADD COLUMN call_by TEXT DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN call_at TEXT DEFAULT ''",
    // Shubhali buyurtma (status='review') — admin tasdig'isiz restoran/kuryerga bormaydi
    'ALTER TABLE orders ADD COLUMN suspicious INTEGER DEFAULT 0',
    "ALTER TABLE orders ADD COLUMN suspicious_reason TEXT DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN approved_by TEXT DEFAULT ''",
    "ALTER TABLE orders ADD COLUMN approved_at TEXT DEFAULT ''",
    // ===== Izohlarni admin nazorat qiladi =====
    // Adminning izohga rasmiy javobi (saytda izoh ostida ko'rinadi)
    "ALTER TABLE reviews ADD COLUMN reply TEXT DEFAULT ''",
    "ALTER TABLE reviews ADD COLUMN reply_at TEXT DEFAULT ''",
    // ===== Taom turi va miqdor cheklovi =====
    // kind: 'taom' | 'ichimlik' | 'shirinlik' — restoran paneli 3 xil forma ko'rsatadi
    "ALTER TABLE added_dishes ADD COLUMN kind TEXT DEFAULT 'taom'",
    // Bir buyurtmada shu taomdan maksimal necha dona olish mumkin (0 = cheksiz).
    // Undan oshsa mijozga "sayt egasiga qo'ng'iroq qiling" xabari chiqadi.
    'ALTER TABLE added_dishes ADD COLUMN max_qty INTEGER DEFAULT 0',
    // Ichimlik uchun: hajmi (0,5 L) va turi (gazli/gazsiz/issiq)
    "ALTER TABLE added_dishes ADD COLUMN volume TEXT DEFAULT ''",
    "ALTER TABLE added_dishes ADD COLUMN dtype TEXT DEFAULT ''",
    // Shirinlik uchun: allergenlar (yong'oq, sut, gluten...)
    "ALTER TABLE added_dishes ADD COLUMN allergens TEXT DEFAULT ''",
    // ===== MOLIYA: buyurtma HAR DOIM o'z shartlarini o'zida saqlaydi =====
    // Ilgari daromad hisobi restoranning HOZIRGI komissiyasi va kuryerning
    // HOZIRGI haqi bo'yicha qayta hisoblanardi. Admin foizni o'zgartirsa,
    // O'TGAN OYNING daromadi ham o'zgarib ketardi — hisobot yolg'on bo'lardi.
    // Endi foiz buyurtma yaratilganda, kuryer haqi esa yetkazilganda YOZILADI
    // va keyin o'zgarmaydi. Barcha panel (restoran/kuryer/admin) shundan hisoblaydi.
    'ALTER TABLE orders ADD COLUMN commission_pct INTEGER DEFAULT -1',   // -1 = eski buyurtma (restoran joriy foizi ishlatiladi)
    'ALTER TABLE orders ADD COLUMN courier_fee INTEGER DEFAULT -1',      // -1 = hali yetkazilmagan / eski buyurtma
    // ===== Mijoz profili: tuzilgan manzil (tuman/mahalla/ko'cha) + saqlangan joylashuv =====
    // Kabinet "Sozlamalar"да bitta erkin matn o'rniga 3 ta aniq maydon; checkout
    // shu yerdan yig'ib olingan manzilni oldindan to'ldiradi (har safar so'raladi,
    // faqat maydon bo'sh qolmaydi).
    "ALTER TABLE accounts ADD COLUMN addr_region TEXT DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN addr_mahalla TEXT DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN addr_street TEXT DEFAULT ''",
    'ALTER TABLE accounts ADD COLUMN addr_lat REAL DEFAULT NULL',
    'ALTER TABLE accounts ADD COLUMN addr_lng REAL DEFAULT NULL',
    // Referral: kim taklif qilgan (referal qilganning login'i). "Do'stni taklif
    // qil" bonusi shu ustunga qarab hisoblanadi (bonuses.js: qualifiers).
    "ALTER TABLE accounts ADD COLUMN ref_by TEXT DEFAULT ''",
    // Guruh buyurtmasi: tasdiqlanganda BITTA orders yozuviga birlashtiriladi —
    // shu ikki ustun "bu buyurtma qaysi guruhdan kelgani" va har a'zoning
    // ulushi/to'lovi (JSON: [{name,amount,pay,paid}]) ni saqlaydi.
    'ALTER TABLE orders ADD COLUMN group_id INTEGER DEFAULT NULL',
    "ALTER TABLE orders ADD COLUMN group_breakdown TEXT DEFAULT ''",
    // Profil rasmi (Telegram kabi) — HAR ROL uchun bitta umumiy ustun.
    // Kabinet/restoran/kuryer/admin "Sozlamalar"да o'rnatiladi, barcha
    // panellarda va o'sha kishi yozgan izohlarda ko'rinadi (routes/auth.js,
    // routes/reviews.js).
    "ALTER TABLE accounts ADD COLUMN avatar TEXT DEFAULT ''",
  ]) { try { db.exec(col); } catch (e) { /* bor */ } }

  reconcileLogins();
}

/* ===== LOGIN NUSXALARINI YARASHTIRISH (eski/buzilgan bazalar uchun) =====
   `accounts.login` — kirish uchun HAQIQIY login. `restaurants.login` va
   `couriers.login` — nusxa. Ilgari restoran/kuryer o'z loginini o'zgartirsa
   faqat accounts yangilanardi, nusxa eski qolardi. Natijada:
     • admin «Restoranlar» bo'limi ESKI loginni ko'rsatar (nusxadan),
       «Loginlar» bo'limi YANGISINI (accounts'dan) — "ikki joyda ikki xil";
     • restoran kirsa ham, o'z ma'lumotini (nom/rasm/ish vaqti) topolmasdi,
       chunki so'rovlar nusxa login bo'yicha kalitlanadi.
   Ism jadvallar orasida sinxron saqlanadi (misc.js rename), shuning uchun
   NOM bo'yicha to'g'ri loginni topib nusxani tuzatamiz. Sog'lom bazada bu
   hech narsani o'zgartirmaydi (login allaqachon mos). */
export function reconcileLogins() {
  try {
    db.prepare(`
      UPDATE restaurants
         SET login = (SELECT a.login FROM accounts a
                       WHERE a.role = 'restoran' AND a.name = restaurants.name)
       WHERE EXISTS (SELECT 1 FROM accounts a
                      WHERE a.role = 'restoran' AND a.name = restaurants.name
                        AND a.login <> restaurants.login)
    `).run();
    db.prepare(`
      UPDATE couriers
         SET login = (SELECT a.login FROM accounts a
                       WHERE a.role = 'kuryer' AND a.name = couriers.name)
       WHERE EXISTS (SELECT 1 FROM accounts a
                      WHERE a.role = 'kuryer' AND a.name = couriers.name
                        AND a.login <> couriers.login)
    `).run();
  } catch (e) { console.warn('[reconcileLogins] o\'tkazib yuborildi:', e.message); }
}
