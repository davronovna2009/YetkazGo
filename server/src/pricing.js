/* ===== Yetkaz.uz backend — buyurtma narxini SERVERDA hisoblash =====
   MUHIM: mijoz (sayt yoki bot) yuborgan `amount` ga HECH QACHON ishonilmaydi.
   Mijoz faqat NIMA va NECHTA olayotganini aytadi — `items: [{id, qty}]`.
   Narx, chegirma va jami summa shu yerda, bazadagi haqiqiy ma'lumot bo'yicha
   hisoblanadi. Katalog to'liq bazada (added_dishes) — shuning uchun bu ishonchli.

   Chegirma/o'chirilgan/sotuvda yo'q taomlar `rest|name` kaliti bo'yicha
   saqlanadi (store.js:mergeDishes va bot menu.js bilan bir xil mantiq). */
import { db } from './db.js';
import { MIN_ORDER } from './config.js';

const MAX_LINES = 30;   // savatdagi turli taomlar soni
const MAX_QTY = 50;     // bitta taomdan maksimal dona

/* Narx xatosi — status kodi bilan (route uni to'g'ridan-to'g'ri qaytaradi) */
export class PriceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* Chegirma foizini xavfsiz oraliqqa keltiradi (buzuq ma'lumot manfiy narx bermasin) */
function safePct(pct) {
  const n = Number(pct) || 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/* Mijoz yuborgan items ni tekshirib, {id -> qty} ga aylantiradi (tartib saqlanadi) */
function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new PriceError(400, 'Savat bo`sh — taom tanlang');
  }
  if (rawItems.length > MAX_LINES) {
    throw new PriceError(400, 'Savatda juda ko`p turdagi taom');
  }
  const want = new Map();
  for (const it of rawItems) {
    const id = Number(it && it.id);
    const qty = Number(it && it.qty);
    if (!Number.isInteger(id) || id <= 0) {
      throw new PriceError(400, 'Taom identifikatori noto`g`ri');
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new PriceError(400, 'Taom miqdori 1 dan ' + MAX_QTY + ' gacha bo`lishi kerak');
    }
    want.set(id, Math.min(MAX_QTY, (want.get(id) || 0) + qty));
  }
  return want;
}

/* Buyurtmani narxlaydi. Muvaffaqiyatда:
     { rest, item, emoji, amount, lines: [{id,name,emoji,qty,price,pct,eff,sum}] }
   Xatoда — PriceError (status + o'zbekcha xabar). */
export function priceOrder(rawItems) {
  const want = normalizeItems(rawItems);

  const selDish = db.prepare('SELECT id, name, emoji, price, rest FROM added_dishes WHERE id = ?');
  const selRemoved = db.prepare('SELECT 1 AS x FROM removed_dishes WHERE rest = ? AND name = ?');
  const selSoldout = db.prepare('SELECT 1 AS x FROM soldout_dishes WHERE rest = ? AND name = ?');
  const selDiscount = db.prepare('SELECT pct FROM discounts WHERE rest = ? AND name = ?');
  const selRest = db.prepare('SELECT active FROM restaurants WHERE name = ?');

  const lines = [];
  let amount = 0;
  let rest = null;

  for (const [id, qty] of want) {
    const d = selDish.get(id);
    if (!d) throw new PriceError(400, 'Tanlangan taom topilmadi — sahifani yangilang');

    /* Bitta buyurtma — bitta restoran (sayt ham shunday ishlaydi) */
    if (rest === null) rest = d.rest;
    else if (rest !== d.rest) {
      throw new PriceError(400, 'Bitta buyurtmada faqat bitta restoran taomlari bo`lishi mumkin');
    }

    if (selRemoved.get(d.rest, d.name)) {
      throw new PriceError(409, '«' + d.name + '» menyudan olib tashlangan');
    }
    if (selSoldout.get(d.rest, d.name)) {
      throw new PriceError(409, '«' + d.name + '» hozir sotuvda yo`q');
    }

    const price = Math.max(0, Math.round(Number(d.price) || 0));
    const pct = safePct((selDiscount.get(d.rest, d.name) || {}).pct);
    const eff = pct ? Math.round(price * (1 - pct / 100)) : price;
    const sum = eff * qty;

    amount += sum;
    lines.push({ id: d.id, name: d.name, emoji: d.emoji || '🍽️', qty, price, pct, eff, sum });
  }

  /* Restoran o'chirilgan bo'lsa — buyurtma qabul qilinmaydi.
     (Yozuv umuman bo'lmasa — eski ma'lumotga toqat qilamiz, rad etmaymiz.) */
  const r = selRest.get(rest);
  if (r && !r.active) {
    throw new PriceError(409, 'Bu restoran hozir buyurtma qabul qilmayapti');
  }

  if (amount < MIN_ORDER) {
    throw new PriceError(400, 'Minimal buyurtma ' + MIN_ORDER.toLocaleString('ru-RU') + ' so`m');
  }

  /* Yorliq — sayt (app.js) formatida: "Lag'mon +2 ta". Sayt buyurtmani shu
     matn bo'yicha topadi, shuning uchun format AYNAN bir xil bo'lishi shart. */
  const item = lines.length > 1 ? `${lines[0].name} +${lines.length - 1} ta` : lines[0].name;

  return { rest, item, emoji: lines[0].emoji, amount, lines };
}
