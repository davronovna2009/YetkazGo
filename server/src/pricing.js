/* ===== Yetkaz.uz backend — buyurtma narxini SERVERDA hisoblash =====
   MUHIM: mijoz (sayt yoki bot) yuborgan `amount` ga HECH QACHON ishonilmaydi.
   Mijoz faqat NIMA va NECHTA olayotganini aytadi — `items: [{id, qty}]`.
   Narx, chegirma va jami summa shu yerda, bazadagi haqiqiy ma'lumot bo'yicha
   hisoblanadi. Katalog to'liq bazada (added_dishes) — shuning uchun bu ishonchli.

   Chegirma/o'chirilgan/sotuvda yo'q taomlar `rest|name` kaliti bo'yicha
   saqlanadi (store.js:mergeDishes va bot menu.js bilan bir xil mantiq). */
import { db } from './db.js';
import { restIsOpen, restHoursText } from './hours.js';
import { getSetting, minOrderAmount } from './settings.js';

/* Savatdagi turli taomlar soni. Ilgari 30 edi va mijoz 30 xildan ko'p tanlasa
   buyurtma umuman o'tmasdi (xato ko'rsatib, restoran panelida hech narsa
   ko'rinmasdi). Endi katta buyurtma ham o'tadi — juda kattasi esa yo'qotilmay,
   admin tekshiruviga tushadi (order-rules.js). */
const MAX_LINES = 120;
/* Bitta taomdan absolyut yuqori chegara (buzuq so'rovga qarshi). HAQIQIY biznes
   cheklovi endi HAR TAOMGA alohida (added_dishes.max_qty) — masalan Osh 15,
   Somsa 500. Shuning uchun bu ceiling baland: restoran 500 qo'ysa ishlashi kerak. */
const MAX_QTY = 1000;

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

/* Taom izohi (mijoz tilagi): "sous bilan", "achchiq solmang", "alohida o'rang".
   Restoran tayyorlashda, kuryer esa olib chiqishda AYNAN shuni ko'radi.
   Uzun matn panellarda joylashmaydi va bazani shishiradi — shuning uchun cheklaymiz.
   Boshqaruv belgilari (\n, \t) tashlanadi: bitta qatorда ko'rsatiladi. */
export const MAX_NOTE = 200;
export function cleanNote(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_NOTE);
}

/* Mijoz yuborgan items ni tekshirib, {id -> {qty, note}} ga aylantiradi (tartib saqlanadi) */
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
    const note = cleanNote(it && it.note);
    const prev = want.get(id);
    if (prev) {
      prev.qty = Math.min(MAX_QTY, prev.qty + qty);
      /* Bir xil taom ikki marta kelsa — izohlar yo'qolmasin, birlashtiriladi */
      if (note && prev.note !== note) prev.note = cleanNote(prev.note ? prev.note + '; ' + note : note);
    } else {
      want.set(id, { qty: Math.min(MAX_QTY, qty), note });
    }
  }
  return want;
}

/* Buyurtmani narxlaydi. Muvaffaqiyatда:
     { rest, item, emoji, amount, lines: [{id,name,emoji,qty,price,pct,eff,sum,note}] }
   Xatoда — PriceError (status + o'zbekcha xabar). */
export function priceOrder(rawItems) {
  const want = normalizeItems(rawItems);

  /* `photo` ham olinadi — buyurtma tarkibi panellarда RASM bilan ko'rinsin
     (restoran/kuryer/admin modalida taomlar rasmi bilan chiqadi).
     `max_qty` — restoran qo'ygan miqdor cheklovi (0 = cheksiz). */
  const selDish = db.prepare('SELECT id, name, emoji, price, rest, photo, max_qty FROM added_dishes WHERE id = ?');
  const selRemoved = db.prepare('SELECT 1 AS x FROM removed_dishes WHERE rest = ? AND name = ?');
  const selSoldout = db.prepare('SELECT 1 AS x FROM soldout_dishes WHERE rest = ? AND name = ?');
  const selDiscount = db.prepare('SELECT pct FROM discounts WHERE rest = ? AND name = ?');
  const selRest = db.prepare('SELECT active, open_h, close_h FROM restaurants WHERE name = ?');

  const lines = [];
  let amount = 0;
  let rest = null;

  for (const [id, w] of want) {
    const qty = w.qty;
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

    /* ===== MIQDOR CHEKLOVI (restoran har taomga o'zi qo'yadi) =====
       Masalan oshga 15 ta, somsaga 500 ta. Undan oshsa buyurtma o'tmaydi —
       mijozga SAYT EGASINING raqami ko'rsatiladi: u telefonda gaplashib,
       buyurtma rostligini tasdiqlagach restoranga o'zi aytadi. */
    const lim = Math.max(0, Number(d.max_qty) || 0);
    if (lim > 0 && qty > lim) {
      const phone = getSetting('owner_phone', '');
      throw new PriceError(409,
        `«${d.name}» dan bir buyurtmada eng ko'pi ${lim} ta olish mumkin (siz ${qty} ta tanladingiz). `
        + (phone
          ? `Ko'proq kerak bo'lsa ${phone} raqamiga qo'ng'iroq qiling — tasdiqlangach restoranga o'zimiz yetkazamiz.`
          : 'Ko`proq kerak bo`lsa sayt ma`muriyatiga qo`ng`iroq qiling.'));
    }

    const price = Math.max(0, Math.round(Number(d.price) || 0));
    const pct = safePct((selDiscount.get(d.rest, d.name) || {}).pct);
    const eff = pct ? Math.round(price * (1 - pct / 100)) : price;
    const sum = eff * qty;

    amount += sum;
    /* `note` — mijozning SHU taomga yozgan tilagi ("sous bilan"). Restoran va
       kuryer panellari uni buyurtma tarkibida alohida ko'rsatadi. */
    lines.push({ id: d.id, name: d.name, emoji: d.emoji || '🍽️', photo: d.photo || '', qty, price, pct, eff, sum, note: w.note || '' });
  }

  /* Restoran o'chirilgan bo'lsa — buyurtma qabul qilinmaydi.
     (Yozuv umuman bo'lmasa — eski ma'lumotga toqat qilamiz, rad etmaymiz.) */
  const r = selRest.get(rest);
  if (r && !r.active) {
    throw new PriceError(409, 'Bu restoran hozir buyurtma qabul qilmayapti');
  }

  /* ISH VAQTI — YAKUNIY to'siq. Sayt/kabinet/mini-app tugmalarni bekitadi,
     lekin haqiqiy rad etish SHU YERDA bo'ladi: eski sahifa, to'g'ridan-to'g'ri
     API so'rovi yoki bot orqali ham yopiq restorandan buyurtma o'tmaydi.
     Vaqt Asia/Tashkent bo'yicha (hours.js) — serverning UTC soati emas. */
  if (r && !restIsOpen(r)) {
    throw new PriceError(409, `«${rest}» hozir yopiq. Ish vaqti: ${restHoursText(r)}. Shu vaqtda buyurtma bering.`);
  }

  const minOrder = minOrderAmount();
  if (amount < minOrder) {
    throw new PriceError(400, 'Minimal buyurtma ' + minOrder.toLocaleString('ru-RU') + ' so`m');
  }

  /* Yorliq — sayt (app.js) formatida: "Lag'mon +2 ta". Sayt buyurtmani shu
     matn bo'yicha topadi, shuning uchun format AYNAN bir xil bo'lishi shart. */
  const item = lines.length > 1 ? `${lines[0].name} +${lines.length - 1} ta` : lines[0].name;

  return { rest, item, emoji: lines[0].emoji, amount, lines };
}
