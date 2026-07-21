/* ===== Yetkaz.uz — Telegram bot =====
   Vazifasi:
     1) /start  → xush kelibsiz + "🍽 Buyurtma berish" (Mini App) tugmasi
     2) Mini App'dan kelgan buyurtmani (web_app_data) qabul qilib, saytdagi
        BIR XIL logika bilan (orders-core.js) buyurtma yaratadi
     3) Buyurtma holati o'zgarganда mijozga xabar yuboradi
     4) "Yetkazildi" bo'lganда mijoz tugma bosib TASDIQLAYDI (arrived -> done)

   MUHIM: TG_TOKEN berilmasa bot butunlay o'chadi va sayt normal ishlayveradi.
   Bot bilan bog'liq HAR QANDAY xato ushlanadi — hech qachon saytni yiqitmaydi. */
import { Router } from 'express';
import { db } from './db.js';
import { createOrder, OrderError } from './orders-core.js';
import { TG_TOKEN, PUBLIC_URL, TG_WEBHOOK_SECRET, JWT_SECRET } from './config.js';
import { restIsOpen, restHoursText } from './hours.js';
import { createHash } from 'node:crypto';

const API = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : '';
export const BOT_ENABLED = Boolean(TG_TOKEN);

/* Webhook manzilini taxmin qilib bo'lmasligi uchun — tokendan hosil qilingan yo'l */
const WEBHOOK_PATH = TG_TOKEN
  ? '/api/tg/' + createHash('sha256').update(TG_TOKEN).digest('hex').slice(0, 24)
  : '/api/tg/disabled';
/* Telegram har so'rovda shu sirni sarlavhaда qaytaradi — soxta so'rov o'tmaydi */
const SECRET = TG_WEBHOOK_SECRET
  || createHash('sha256').update('yz-tg-' + (JWT_SECRET || '') + TG_TOKEN).digest('hex').slice(0, 32);

/* ---------- Telegram API yordamchilari (hech qachon throw qilmaydi) ---------- */
async function tg(method, body) {
  if (!API) return null;
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    if (!data || !data.ok) console.warn('[BOT]', method, 'xato:', data && data.description);
    return data;
  } catch (e) {
    console.warn('[BOT]', method, 'yuborilmadi:', e.message);
    return null;
  }
}

/* HTML rejimi uchun ekranlash (Telegram faqat shu 3 belgini talab qiladi) */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const money = (n) => Number(n || 0).toLocaleString('ru-RU');

function send(chatId, text, extra) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    disable_web_page_preview: true, ...(extra || {}),
  });
}

/* ---------- Mini App tugmasi ----------
   Mini ilova (tg-app.html) HAR DOIM bitta restoran menyusini ochadi va
   `?rest=<nom>` parametrini kutadi — `rest` bo'lmasa "Restoran tanlanmagan"
   xatosini ko'rsatadi. Shuning uchun bot avval restoran ro'yxatini beradi,
   mijoz tanlagan tugma esa o'sha restoran menyusini ochadi. */
function miniAppUrl(rest) {
  if (!PUBLIC_URL) return '';
  return `${PUBLIC_URL}/tg-app.html?rest=${encodeURIComponent(rest)}`;
}

/* Faol restoranlar — saytdagi /api/bootstrap bilan bir xil filtr (active = 1) */
function activeRestaurants() {
  try {
    return db.prepare('SELECT * FROM restaurants WHERE active = 1 ORDER BY id').all();
  } catch (e) {
    console.warn('[BOT] restoranlarni o`qib bo`lmadi:', e.message);
    return [];
  }
}

/* Restoran tugmalari — har biri o'z menyusini Mini App'da ochadi.
   web_app tugmasi inline klaviaturaда faqat SHAXSIY chatда ishlaydi; bot
   aynan shaxsiy chatда ishlatiladi. Telegram bitta klaviaturaда 100 tagacha
   tugmaga ruxsat beradi — ehtiyot uchun 40 ta bilan cheklaymiz. */
const REST_LIMIT = 40;
function restaurantKeyboard(rows) {
  const buttons = rows.slice(0, REST_LIMIT).map((r) => {
    const open = restIsOpen(r);
    const label = `${r.emoji || '🍽'} ${r.name} · ${open ? '🟢' : '🔴 ' + restHoursText(r)}`;
    return [{ text: label, web_app: { url: miniAppUrl(r.name) } }];
  });
  return { inline_keyboard: buttons };
}

/* Pastdagi doimiy klaviatura. Bu yerда web_app tugmasi YO'Q — chunki restoran
   tanlanmasdan mini ilovani ochish mantiqsiz (u xato ko'rsatardi). */
function mainKeyboard() {
  return {
    keyboard: [[{ text: '🏪 Restoran tanlash' }], [{ text: '📦 Buyurtmalarim' }, { text: 'ℹ️ Yordam' }]],
    resize_keyboard: true,
  };
}

/* ---------- "🏪 Restoran tanlash" ---------- */
async function onChooseRest(chatId) {
  if (!PUBLIC_URL) {
    return send(chatId, '⚠️ Bot hali to`liq sozlanmagan (sayt manzili berilmagan). Administratorga murojaat qiling.');
  }
  const rows = activeRestaurants();
  if (!rows.length) {
    return send(chatId, '😔 Hozircha faol restoran yo`q. Birozdan keyin qayta urinib ko`ring.', { reply_markup: mainKeyboard() });
  }
  const ochiq = rows.filter(restIsOpen).length;
  const extra = rows.length > REST_LIMIT ? `\n<i>(${REST_LIMIT} tasi ko'rsatildi)</i>` : '';
  await send(chatId,
    `🏪 <b>Restoranni tanlang</b>\n\n` +
    `Jami ${rows.length} ta · hozir ochiq: <b>${ochiq}</b> ta 🟢\n` +
    `Tugmani bosing — o'sha restoran menyusi ochiladi.${extra}`,
    { reply_markup: restaurantKeyboard(rows) });
}

/* ---------- Holat matnlari (sayt paneli bilan bir xil) ---------- */
const STATUS_TEXT = {
  new: { ico: '🆕', t: 'Qabul qilindi — restoran tayyorlashni boshlaydi' },
  accepted: { ico: '👨‍🍳', t: 'Tayyorlanmoqda' },
  ready: { ico: '✅', t: 'Tayyor — kuryer olib ketmoqda' },
  ontheway: { ico: '🛵', t: "Kuryer yo'lda" },
  arrived: { ico: '📍', t: 'Kuryer yetib keldi!' },
  done: { ico: '🎉', t: 'Yetkazildi' },
  cancelled: { ico: '❌', t: 'Bekor qilindi' },
};

/* ---------- Buyurtma holati o'zgarganда mijozga xabar ----------
   orders.js shu funksiyani chaqiradi. Bot o'chiq bo'lsa — darrov qaytadi. */
export function notifyCustomerStatus(order, prevStatus) {
  try {
    if (!BOT_ENABLED || !order) return;
    const chatId = order.tg_chat_id || order.tgChatId;
    if (!chatId) return;                       // saytdan berilgan buyurtma — Telegram xabari kerak emas
    const st = STATUS_TEXT[order.status];
    if (!st) return;

    let text = `${st.ico} <b>Buyurtma #${order.id}</b>\n${esc(st.t)}`;
    if (order.status === 'cancelled' && order.reason) {
      text += `\n\nSabab: <i>${esc(order.reason)}</i>`;
    }
    if (order.status === 'ontheway' && order.courier) {
      text += `\n\nKuryer: <b>${esc(order.courier)}</b>`;
    }

    /* "Yetib keldi" — mijoz shu yerдан TASDIQLAYDI (arrived -> done).
       Saytdagi "Qabul qildim" tugmasi bilan bir xil natija. */
    if (order.status === 'arrived') {
      text += '\n\nBuyurtmangizni oldingizmi? Quyidagi tugmani bosing.'
            + '\n<i>30 daqiqadan keyin avtomatik tasdiqlanadi.</i>';
      return send(chatId, text, {
        reply_markup: { inline_keyboard: [[{ text: '✅ Qabul qildim', callback_data: `confirm:${order.id}` }]] },
      });
    }
    if (order.status === 'done' && order.auto) {
      text += '\n<i>(30 daqiqa o`tgani uchun avtomatik tasdiqlandi)</i>';
    }
    if (order.status === 'done') {
      text += '\n\nYoqimli ishtaha! 😋 Bizni tanlaganingiz uchun rahmat.';
    }
    return send(chatId, text);
  } catch (e) {
    console.warn('[BOT] holat xabari yuborilmadi:', e.message);
  }
}

/* ---------- /start ----------
   Xush kelibsizdan keyin DARROV restoran ro'yxati chiqadi — mijoz bitta
   tugma bosib o'sha restoran menyusiga tushadi. */
async function onStart(chatId, name) {
  const text =
    `Assalomu alaykum, <b>${esc(name || 'mehmon')}</b>! 👋\n\n` +
    'Men <b>Yetkaz.uz</b> botiman — Xatirchi tumani bo\'ylab taom yetkazib beramiz. 🛵\n\n' +
    (PUBLIC_URL
      ? 'Avval <b>restoranni tanlang</b> — so\'ng uning menyusi ochiladi.'
      : '⚠️ Bot hali to`liq sozlanmagan (sayt manzili berilmagan). Administratorga murojaat qiling.');
  await send(chatId, text, { reply_markup: mainKeyboard() });
  if (PUBLIC_URL) await onChooseRest(chatId);
}

/* ---------- Mini App'dan kelgan buyurtma ---------- */
async function onWebAppData(msg) {
  const chatId = msg.chat.id;
  let payload;
  try {
    payload = JSON.parse(msg.web_app_data.data);
  } catch (e) {
    return send(chatId, '❌ Buyurtma ma`lumoti tushunarsiz keldi. Qaytadan urinib ko`ring.');
  }

  const from = msg.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram mijoz';

  let created;
  try {
    created = createOrder({
      user: name,
      phone: payload.phone,
      addr: payload.addr,
      pay: payload.pay,
      items: payload.items,
      tgChatId: chatId,
    });
  } catch (e) {
    const reason = e instanceof OrderError ? e.message : 'Buyurtmani rasmiylashtirib bo`lmadi';
    console.warn('[BOT] buyurtma rad etildi:', reason);
    return send(chatId, `❌ <b>Buyurtma qabul qilinmadi</b>\n${esc(reason)}`, { reply_markup: mainKeyboard() });
  }

  const o = created.order;
  const lines = (created.lines || [])
    .map((l) => `  • ${esc(l.emoji)} ${esc(l.name)} × ${l.qty} — ${money(l.sum)} so'm`)
    .join('\n');

  const text =
    `✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n` +
    `🧾 Raqami: <b>#${o.id}</b>\n` +
    `🏪 Restoran: <b>${esc(o.rest)}</b>\n\n` +
    `🍽 <b>Tarkibi:</b>\n${lines}\n\n` +
    `💰 Jami: <b>${money(o.amount)} so'm</b>\n` +
    `📍 Manzil: ${esc(o.addr)}\n` +
    `📞 Telefon: ${esc(o.phone)}\n` +
    `💳 To'lov: ${o.pay === 'cash' ? '💵 Naqd' : '💳 Karta'}\n` +
    (o.courier ? `🛵 Kuryer: <b>${esc(o.courier)}</b>\n` : '') +
    `\nHolat o'zgarishi haqida shu yerда xabar beramiz.`;

  await send(chatId, text, { reply_markup: mainKeyboard() });
}

/* ---------- "📦 Buyurtmalarim" ---------- */
async function onMyOrders(chatId) {
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, rest, item, amount, status FROM orders
        WHERE tg_chat_id = ? ORDER BY id DESC LIMIT 10`
    ).all(String(chatId));
  } catch (e) { /* baza xatosi — bo'sh ro'yxat */ }

  if (!rows.length) {
    return send(chatId, 'Sizда hali buyurtma yo`q. 🏪 <b>Restoran tanlash</b> tugmasini bosing.', { reply_markup: mainKeyboard() });
  }
  const list = rows.map((r) => {
    const st = STATUS_TEXT[r.status] || { ico: '•', t: r.status };
    return `${st.ico} <b>#${r.id}</b> · ${esc(r.rest)}\n   ${esc(r.item)} — ${money(r.amount)} so'm\n   <i>${esc(st.t)}</i>`;
  }).join('\n\n');
  await send(chatId, `📦 <b>So'nggi buyurtmalaringiz</b>\n\n${list}`, { reply_markup: mainKeyboard() });
}

/* ---------- "✅ Qabul qildim" tugmasi (arrived -> done) ---------- */
async function onConfirmCallback(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const id = Number(String(cb.data || '').split(':')[1]);
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: false });

  if (!id) return answer('Buyurtma topilmadi');

  let o = null;
  try { o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id); } catch (e) {}
  if (!o) return answer('Buyurtma topilmadi');

  /* EGALIK: faqat SHU buyurtmani bergan chat tasdiqlay oladi */
  if (String(o.tg_chat_id) !== String(chatId)) return answer('Bu buyurtma sizniki emas');

  if (o.status === 'done') return answer('Bu buyurtma allaqachon tasdiqlangan ✓');
  if (o.status !== 'arrived') return answer('Buyurtma hali yetkazilmagan');

  try {
    db.prepare("UPDATE orders SET status = 'done', done_at = datetime('now') WHERE id = ?").run(id);
  } catch (e) {
    return answer('Xatolik — qaytadan urinib ko`ring');
  }
  await answer('Rahmat! Tasdiqlandi ✓');
  /* Tugmani olib tashlaymiz — ikkinchi marta bosilmasin */
  await tg('editMessageReplyMarkup', {
    chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
  });
  await send(chatId, `🎉 <b>Buyurtma #${id} yakunlandi</b>\nYoqimli ishtaha! 😋 Bizni tanlaganingiz uchun rahmat.`);
}

/* ---------- Kelgan yangilanishni qayta ishlash ---------- */
async function handleUpdate(u) {
  try {
    if (u.callback_query) {
      const data = String(u.callback_query.data || '');
      if (data.startsWith('confirm:')) return await onConfirmCallback(u.callback_query);
      return await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id });
    }

    const msg = u.message;
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;

    if (msg.web_app_data) return await onWebAppData(msg);

    const text = String(msg.text || '').trim();
    if (!text) return;

    if (text === '/start' || text.startsWith('/start')) return await onStart(chatId, msg.from && msg.from.first_name);
    if (text === '🏪 Restoran tanlash' || text === '/restoranlar') return await onChooseRest(chatId);
    if (text === '📦 Buyurtmalarim' || text === '/buyurtmalarim') return await onMyOrders(chatId);
    if (text === 'ℹ️ Yordam' || text === '/yordam' || text === '/help') {
      return await send(chatId,
        'ℹ️ <b>Yordam</b>\n\n' +
        '🏪 <b>Restoran tanlash</b> — restoranlar ro`yxati. Tugmani bossangiz o`sha restoran menyusi ochiladi va shu yerдан buyurtma berasiz\n' +
        '📦 <b>Buyurtmalarim</b> — so`nggi buyurtmalar va ularning holati\n\n' +
        '🟢 — restoran hozir ochiq, 🔴 — yopiq (yonida ish vaqti yozilgan)\n\n' +
        'Buyurtma yetib kelganда shu yerда <b>✅ Qabul qildim</b> tugmasi chiqadi — bosishni unutmang.\n' +
        (PUBLIC_URL ? `\n🌐 Sayt: ${PUBLIC_URL}` : ''),
        { reply_markup: mainKeyboard() });
    }
    /* Boshqa har qanday matn — restoran ro'yxatini ko'rsatamiz */
    return await onChooseRest(chatId);
  } catch (e) {
    console.warn('[BOT] update xatosi:', e.message);
  }
}

/* ---------- Webhook route ----------
   Telegram POST qiladi. Javobni DARHOL 200 qaytaramiz — aks holda Telegram
   qayta-qayta yuboradi va bitta buyurtma bir necha marta yaratilishi mumkin. */
export const botRouter = Router();
botRouter.post(WEBHOOK_PATH, (req, res) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) return res.sendStatus(401);
  res.sendStatus(200);
  handleUpdate(req.body || {});
});

/* ---------- Ishga tushirish ---------- */
export async function startBot() {
  if (!BOT_ENABLED) {
    console.log('[BOT] TG_TOKEN yo`q — Telegram bot o`chiq (sayt normal ishlaydi)');
    return;
  }
  const me = await tg('getMe');
  const username = me && me.result && me.result.username;
  if (!username) {
    console.warn('[BOT] token noto`g`ri ko`rinadi — bot ishga tushmadi');
    return;
  }

  if (!PUBLIC_URL) {
    console.warn('[BOT] PUBLIC_URL yo`q — webhook o`rnatilmadi. Render`да RENDER_EXTERNAL_URL o`zi keladi;');
    console.warn('[BOT] lokalда .env ga PUBLIC_URL=https://... (masalan ngrok) qo`shing.');
    return;
  }

  const url = `${PUBLIC_URL}${WEBHOOK_PATH}`;
  const r = await tg('setWebhook', {
    url,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,     // qayta deploy'да eski xabarlar qaytadan ishlanmasin
  });
  if (r && r.ok) console.log(`[BOT] @${username} ishga tushdi — webhook: ${WEBHOOK_PATH}`);
  else console.warn('[BOT] webhook o`rnatilmadi');

  /* Telegram menyusidagi buyruqlar ro'yxati */
  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Botni ishga tushirish' },
      { command: 'restoranlar', description: 'Restoran tanlash' },
      { command: 'buyurtmalarim', description: "So'nggi buyurtmalar" },
      { command: 'yordam', description: 'Yordam' },
    ],
  });
}
