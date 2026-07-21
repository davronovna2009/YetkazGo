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
      rating     REAL DEFAULT 4.5,
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
      rating     REAL DEFAULT 4.8,
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
      rating     REAL DEFAULT 4.5,
      sold       INTEGER DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_orders_rest    ON orders(rest);
    CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier);
    CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user);
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
  ]) { try { db.exec(col); } catch (e) { /* bor */ } }
}
