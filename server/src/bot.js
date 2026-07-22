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
/* Bekor qilish hisobi — botdan bekor qilish ham AYNAN saytdagi qoidalarga
   bo'ysunadi (2-marta ogohlantirish + pauza, 3-marta blok). */
import { registerCancel } from './blocks.js';
import { TG_TOKEN, TG_CHAT_OPS, PUBLIC_URL, TG_WEBHOOK_SECRET, JWT_SECRET } from './config.js';
import { restIsOpen, restHoursText } from './hours.js';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const API = TG_TOKEN ? `https://api.telegram.org/bot${TG_TOKEN}` : '';
export const BOT_ENABLED = Boolean(TG_TOKEN);

/* Bot username — panellardagi "Telegramga ulash" havolasi uchun (startBot to'ldiradi) */
let BOT_USERNAME = '';
export function botUsername() { return BOT_USERNAME; }

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

/* Mijoz buyurtmani bekor qila oladigan bosqichlar — sayt bilan AYNAN bir xil
   (server/src/routes/orders.js: /:id/cancel). Kuryer yo'lga chiqqach bo'lmaydi. */
const CANCELLABLE = ['new', 'accepted', 'ready'];

/* Mijoz uchun tugmalar: bekor qilish (mumkin bo'lsa) */
function customerKeyboard(order) {
  if (!order || !CANCELLABLE.includes(order.status)) return null;
  return { inline_keyboard: [[{ text: '❌ Buyurtmani bekor qilish', callback_data: `cancel:${order.id}` }]] };
}

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
    /* Hali bekor qilsa bo'ladigan bosqich — tugmani birga yuboramiz */
    const kb = customerKeyboard(order);
    return send(chatId, text, kb ? { reply_markup: kb } : undefined);
  } catch (e) {
    console.warn('[BOT] holat xabari yuborilmadi:', e.message);
  }
}

/* ================= XODIMLAR (restoran / kuryer / admin) TELEGRAMDA =================
   Saytdagi panellarga qo'shimcha: buyurtma AYNAN shu botда ham keladi va
   holatni to'g'ridan-to'g'ri Telegramdan o'zgartirsa bo'ladi. */

const one = (sql, ...p) => { try { return db.prepare(sql).get(...p) || null; } catch (e) { return null; } };
const many = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (e) { return []; } };

function restChat(name) {
  const r = one('SELECT tg_chat_id FROM restaurants WHERE name = ?', String(name || ''));
  return (r && r.tg_chat_id) || '';
}
function courierChat(name) {
  const c = one('SELECT tg_chat_id FROM couriers WHERE name = ?', String(name || ''));
  return (c && c.tg_chat_id) || '';
}
function adminChats() {
  const rows = many('SELECT chat_id FROM tg_admins');
  const list = rows.map((r) => String(r.chat_id)).filter(Boolean);
  /* Operatorlar guruhi ham adminlar qatorida (TG_CHAT_OPS) */
  if (TG_CHAT_OPS && !list.includes(String(TG_CHAT_OPS))) list.push(String(TG_CHAT_OPS));
  return list;
}

/* Buyurtma kartochkasi — hamma xodimga bir xil ko'rinadi */
function orderCard(order, lines, title) {
  const items = (lines && lines.length)
    ? lines.map((l) => `  • ${esc(l.emoji)} ${esc(l.name)} × ${l.qty} — ${money(l.sum)} so'm`).join('\n')
    : `  • ${esc(order.item) || '—'}`;
  return (
    `${title}\n\n` +
    `🍽 <b>Tarkibi:</b>\n${items}\n\n` +
    `💰 Jami: <b>${money(order.amount)} so'm</b>\n` +
    `🏪 Restoran: <b>${esc(order.rest) || '—'}</b>\n` +
    `👤 Mijoz: ${esc(order.user) || '—'}\n` +
    `📞 Telefon: ${esc(order.phone) || '—'}\n` +
    `📍 Manzil: ${esc(order.addr) || '—'}\n` +
    `🛵 Kuryer: <b>${esc(order.courier) || 'tayinlanmagan'}</b>\n` +
    `💳 To'lov: ${order.pay === 'cash' ? '💵 Naqd' : '💳 Karta'}\n` +
    `⏱ Yetkazish muddati: <b>${Number(order.eta) || 15} daqiqa</b>\n` +
    `📲 Qayerdan: <b>${order.source === 'telegram' ? 'Telegram bot' : 'Sayt'}</b>`
  );
}

/* Rolga qarab keyingi bosqich tugmalari (saytdagi panel bilan bir xil) */
function staffKeyboard(order, role) {
  const b = (text, st) => ({ text, callback_data: `st:${order.id}:${st}` });
  if (role === 'restoran') {
    if (order.status === 'new') return { inline_keyboard: [[b('👨‍🍳 Tayyorlanmoqda', 'accepted')], [b('❌ Bekor qilish', 'cancelled')]] };
    if (order.status === 'accepted') return { inline_keyboard: [[b('✅ Tayyor', 'ready')]] };
    return null;
  }
  if (role === 'kuryer') {
    if (['new', 'accepted', 'ready'].includes(order.status)) return { inline_keyboard: [[b("🛵 Yo'lga chiqdim", 'ontheway')]] };
    if (order.status === 'ontheway') return { inline_keyboard: [[b('📍 Yetkazdim', 'arrived')]] };
    return null;
  }
  return null;
}

/* Yangi buyurtma — restoran + kuryer + admin(lar). Sayt va bot AYNAN shuni chaqiradi. */
export function notifyNewOrder(order, lines) {
  try {
    if (!BOT_ENABLED || !order) return;
    const body = orderCard(order, lines, `🆕 <b>YANGI BUYURTMA #${order.id}</b>`);

    const rc = restChat(order.rest);
    if (rc) send(rc, body, { reply_markup: staffKeyboard(order, 'restoran') || undefined });

    const cc = courierChat(order.courier);
    if (cc) send(cc, body, { reply_markup: staffKeyboard(order, 'kuryer') || undefined });

    for (const chat of adminChats()) send(chat, body);
  } catch (e) {
    console.warn('[BOT] yangi buyurtma xabari yuborilmadi:', e.message);
  }
}

/* Holat o'zgardi — mijozdan tashqari XODIMLARGA ham bildiramiz */
export function notifyStaffStatus(order, prevStatus, actor) {
  try {
    if (!BOT_ENABLED || !order) return;
    const st = STATUS_TEXT[order.status];
    if (!st) return;
    let text = `${st.ico} <b>Buyurtma #${order.id}</b> — ${esc(st.t)}\n`
             + `🏪 ${esc(order.rest) || '—'} · 🛵 ${esc(order.courier) || '—'} · ${money(order.amount)} so'm`;
    if (order.status === 'cancelled' && order.reason) text += `\n\nSabab: <i>${esc(order.reason)}</i>`;

    const rc = restChat(order.rest);
    if (rc && actor !== 'restoran') send(rc, text, { reply_markup: staffKeyboard(order, 'restoran') || undefined });

    const cc = courierChat(order.courier);
    if (cc && actor !== 'kuryer') send(cc, text, { reply_markup: staffKeyboard(order, 'kuryer') || undefined });

    /* Adminlarga faqat muhim bosqichlar — spam bo'lmasin */
    if (['cancelled', 'done'].includes(order.status)) {
      for (const chat of adminChats()) send(chat, text);
    }
  } catch (e) {
    console.warn('[BOT] xodim xabari yuborilmadi:', e.message);
  }
}

/* Kuryerga "vaqt kam qoldi" / "vaqt tugadi" ogohlantirishi (alerts.js chaqiradi) */
export function notifyCourierDeadline(order, level, minutesLeft) {
  try {
    if (!BOT_ENABLED || !order) return;
    const cc = courierChat(order.courier);
    const text = level >= 4
      ? `⛔️ <b>VAQT TUGADI — buyurtma #${order.id}</b>\n\n`
        + `Yetkazish muddati o'tib ketdi, buyurtma hali yetkazilmagan.\n`
        + `📍 ${esc(order.addr) || '—'}\n📞 ${esc(order.phone) || '—'}\n\n`
        + `Iltimos, mijoz bilan darhol bog'laning va yetkazing.`
      : `⏰ <b>${level}-ogohlantirish — buyurtma #${order.id}</b>\n\n`
        + `Yetkazishga <b>${minutesLeft} daqiqa</b> qoldi!\n`
        + `📍 ${esc(order.addr) || '—'}\n📞 ${esc(order.phone) || '—'}\n🍽 ${esc(order.item) || '—'}`;
    if (cc) send(cc, text);
    /* Vaqt tugagan bo'lsa — adminlar ham bilsin */
    if (level >= 4) {
      for (const chat of adminChats()) {
        send(chat, `⛔️ <b>Kechikish</b> — buyurtma #${order.id}\n🛵 ${esc(order.courier) || '—'} · 🏪 ${esc(order.rest) || '—'}`);
      }
    }
  } catch (e) {
    console.warn('[BOT] kechikish xabari yuborilmadi:', e.message);
  }
}

/* Raqam bloklanganда adminlarga xabar */
export function notifyPhoneBlocked(pretty, name, cancels) {
  try {
    if (!BOT_ENABLED) return;
    const text = '⛔️ <b>Raqam bloklandi</b>\n\n'
      + `📞 <b>${esc(pretty)}</b>${name ? ` (${esc(name)})` : ''}\n`
      + `Sabab: ${cancels} marta buyurtma bekor qilingan.\n\n`
      + "Admin panel → <b>Bloklangan raqamlar</b> bo'limidan ochishingiz mumkin.";
    for (const chat of adminChats()) send(chat, text);
  } catch (e) { /* jim */ }
}

/* ---------- Panelni Telegramga ulash (bir martalik kod) ---------- */
function linkByCode(code, chatId, tgName) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(c)) return null;
  const link = one('SELECT * FROM tg_links WHERE code = ?', c);
  if (!link) return null;
  /* Kod bir martalik — ishlatilgach o'chadi */
  try { db.prepare('DELETE FROM tg_links WHERE code = ?').run(c); } catch (e) {}

  const chat = String(chatId);
  try {
    if (link.role === 'restoran') {
      db.prepare('UPDATE restaurants SET tg_chat_id = ? WHERE login = ?').run(chat, link.login);
    } else if (link.role === 'kuryer') {
      db.prepare('UPDATE couriers SET tg_chat_id = ? WHERE login = ?').run(chat, link.login);
    } else if (link.role === 'admin') {
      db.prepare('INSERT OR REPLACE INTO tg_admins (chat_id, login, name) VALUES (?,?,?)')
        .run(chat, link.login, String(tgName || ''));
    } else return null;
  } catch (e) {
    console.warn('[BOT] ulash xatosi:', e.message);
    return null;
  }
  return link;
}

async function onLinkCode(chatId, code, tgName) {
  const link = linkByCode(code, chatId, tgName);
  if (!link) {
    return send(chatId, '❌ Kod noto`g`ri yoki allaqachon ishlatilgan. Panelдан yangi kod oling.', { reply_markup: mainKeyboard() });
  }
  const role = { restoran: '🏪 Restoran', kuryer: '🛵 Kuryer', admin: '🛡 Administrator' }[link.role] || link.role;
  return send(chatId,
    `✅ <b>Ulandi!</b>\n\n${role}: <b>${esc(link.name || link.login)}</b>\n\n`
    + 'Endi yangi buyurtmalar va holat o`zgarishlari shu chatga keladi. '
    + 'Buyurtma tugmalari orqali holatni to`g`ridan-to`g`ri shu yerдан o`zgartirasiz.',
    { reply_markup: mainKeyboard() });
}

/* ---------- Xodim Telegramdan holatni o'zgartirdi (st:<id>:<status>) ---------- */
const NEXT_OK = {
  restoran: { new: ['accepted', 'cancelled'], accepted: ['ready', 'cancelled'], ready: ['cancelled'] },
  kuryer: { new: ['ontheway'], accepted: ['ontheway'], ready: ['ontheway'], ontheway: ['arrived'] },
};

async function onStatusCallback(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: false });
  const parts = String(cb.data || '').split(':');
  const id = Number(parts[1]);
  const want = String(parts[2] || '');
  if (!id || !want) return answer('Buyurtma topilmadi');

  const o = one('SELECT * FROM orders WHERE id = ?', id);
  if (!o) return answer('Buyurtma topilmadi');

  /* EGALIK: bu chat shu buyurtmaning restorani yoki kuryerimi? */
  let role = '';
  if (String(restChat(o.rest)) === String(chatId)) role = 'restoran';
  else if (String(courierChat(o.courier)) === String(chatId)) role = 'kuryer';
  if (!role) return answer('Bu buyurtma sizga tegishli emas');

  const allowed = (NEXT_OK[role] || {})[o.status] || [];
  if (!allowed.includes(want)) {
    return answer(`Bu bosqichda bo'lmaydi (hozir: ${(STATUS_TEXT[o.status] || {}).t || o.status})`);
  }

  try {
    const extra = want === 'arrived' ? ", arrived_at = datetime('now')" : '';
    db.prepare(`UPDATE orders SET status = ?${extra} WHERE id = ?`).run(want, id);
  } catch (e) {
    return answer('Xatolik — qaytadan urinib ko`ring');
  }
  const updated = one('SELECT * FROM orders WHERE id = ?', id);
  await answer('Bajarildi ✓');
  /* Bosilgan tugmani olib tashlaymiz — ikki marta bosilmasin */
  try {
    await tg('editMessageReplyMarkup', {
      chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {}

  const st = STATUS_TEXT[want] || {};
  await send(chatId, `${st.ico || '✓'} <b>Buyurtma #${id}</b> — ${esc(st.t || want)}`,
    { reply_markup: staffKeyboard(updated, role) || undefined });

  /* Mijozga va ikkinchi tomonga xabar (halqa bo'lmasligi uchun `role` beriladi) */
  notifyCustomerStatus(updated, o.status);
  notifyStaffStatus(updated, o.status, role);
}

/* ---------- /start ----------
   Xush kelibsizdan keyin DARROV restoran ro'yxati chiqadi — mijoz bitta
   tugma bosib o'sha restoran menyusiga tushadi. */
async function onStart(chatId, name, payload) {
  /* Deep-link: t.me/<bot>?start=link_ABC123 — panelni shu chatga ulaydi */
  const p = String(payload || '').trim();
  if (p.startsWith('link_')) return onLinkCode(chatId, p.slice(5), name);

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

  /* Restoran + kuryer + adminlarga — saytdan berilgan buyurtma bilan BIR XIL */
  notifyNewOrder(created.order, created.lines);

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

  /* Hali bekor qilsa bo'ladigan buyurtmalar uchun tugma */
  const cancellable = rows.filter((r) => CANCELLABLE.includes(r.status));
  const extra = cancellable.length
    ? {
        reply_markup: {
          inline_keyboard: cancellable.map((r) => [
            { text: `❌ #${r.id} — bekor qilish`, callback_data: `cancel:${r.id}` },
          ]),
        },
      }
    : { reply_markup: mainKeyboard() };

  await send(chatId, `📦 <b>So'nggi buyurtmalaringiz</b>\n\n${list}`, extra);
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

/* ---------- "❌ Buyurtmani bekor qilish" (mijoz) ----------
   Saytdagi POST /api/orders/:id/cancel bilan AYNAN bir xil qoidalar:
     • faqat new/accepted/ready bosqichida (kuryer yo'lga chiqqach — yo'q)
     • faqat SHU buyurtmani bergan chat bekor qila oladi
     • bekor qilish hisobi oshadi: 2-marta ogohlantirish + 5 daqiqa pauza,
       3-marta raqam avtomatik bloklanadi (blocks.js) */
async function onCancelCallback(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const id = Number(String(cb.data || '').split(':')[1]);
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cb.id, text, show_alert: false });

  if (!id) return answer('Buyurtma topilmadi');
  const o = one('SELECT * FROM orders WHERE id = ?', id);
  if (!o) return answer('Buyurtma topilmadi');

  /* EGALIK: faqat buyurtma egasi bekor qiladi */
  if (String(o.tg_chat_id) !== String(chatId)) return answer('Bu buyurtma sizniki emas');

  if (o.status === 'cancelled') return answer('Bu buyurtma allaqachon bekor qilingan');
  if (!CANCELLABLE.includes(o.status)) {
    return answer('Bu bosqichda bekor qilib bo`lmaydi — kuryer yo`lda');
  }

  try {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(id);
  } catch (e) {
    return answer('Xatolik — qaytadan urinib ko`ring');
  }

  /* Jazо hisobi — sayt bilan bitta manba (blocks.js) */
  const penalty = registerCancel(o.phone, o.user);

  await answer('Buyurtma bekor qilindi');
  /* Tugmani olib tashlaymiz — ikkinchi marta bosilmasin */
  try {
    await tg('editMessageReplyMarkup', {
      chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {}

  let text = `❌ <b>Buyurtma #${id} bekor qilindi</b>`;
  if (penalty && penalty.message) {
    text += penalty.level >= 2
      ? `\n\n${esc(penalty.message)}`
      : `\n\n<i>${esc(penalty.message)}</i>`;
  }
  await send(chatId, text, { reply_markup: mainKeyboard() });

  /* Restoran, kuryer va adminlar ham bilsin */
  const updated = one('SELECT * FROM orders WHERE id = ?', id);
  notifyStaffStatus(updated, o.status, '');
}

/* ---------- Kelgan yangilanishni qayta ishlash ---------- */
async function handleUpdate(u) {
  try {
    if (u.callback_query) {
      const data = String(u.callback_query.data || '');
      if (data.startsWith('confirm:')) return await onConfirmCallback(u.callback_query);
      if (data.startsWith('cancel:')) return await onCancelCallback(u.callback_query);
      if (data.startsWith('st:')) return await onStatusCallback(u.callback_query);
      return await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id });
    }

    const msg = u.message;
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;

    if (msg.web_app_data) return await onWebAppData(msg);

    const text = String(msg.text || '').trim();
    if (!text) return;

    if (text === '/start' || text.startsWith('/start')) {
      return await onStart(chatId, msg.from && msg.from.first_name, text.slice(6).trim());
    }
    /* Panel bergan ulash kodi (masalan "K7Q2M9") — deep-link ishlamaganда qo'lда */
    if (/^\/?(ulash\s+)?[A-Za-z0-9]{8}$/.test(text)) {
      const code = text.replace(/^\/?(ulash\s+)?/i, '');
      const link = one('SELECT 1 FROM tg_links WHERE code = ?', code.toUpperCase());
      if (link) return await onLinkCode(chatId, code, msg.from && msg.from.first_name);
    }
    if (text === '🏪 Restoran tanlash' || text === '/restoranlar') return await onChooseRest(chatId);
    if (text === '📦 Buyurtmalarim' || text === '/buyurtmalarim') return await onMyOrders(chatId);
    if (text === 'ℹ️ Yordam' || text === '/yordam' || text === '/help') {
      return await send(chatId,
        'ℹ️ <b>Yordam</b>\n\n' +
        '🏪 <b>Restoran tanlash</b> — restoranlar ro`yxati. Tugmani bossangiz o`sha restoran menyusi ochiladi va shu yerдан buyurtma berasiz\n' +
        '📦 <b>Buyurtmalarim</b> — so`nggi buyurtmalar, holati va <b>bekor qilish</b> tugmasi\n\n' +
        '❌ <b>Bekor qilish</b> — kuryer yo`lga chiqqunicha mumkin. Diqqat: buyurtmani ' +
        'qayta-qayta bekor qilsangiz raqamingiz vaqtincha cheklanadi, keyin bloklanadi.\n\n' +
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

/* ================== MINI ILOVADAN BUYURTMA (POST /api/tg/order) ==================
   NEGA KERAK: Telegram qoidasiga ko'ra `WebApp.sendData()` FAQAT pastki
   klaviatura (reply keyboard) tugmasidan ochilgan mini ilovada ishlaydi.
   Bizda restoranlar INLINE tugmalar bilan beriladi (har biri o'z menyusini
   ochadi), shuning uchun sendData jimgina yo'qolardi — mijoz "Tasdiqlash"
   bosardi-yu, buyurtma yaratilmasdi.

   Endi mini ilova buyurtmani TO'G'RIDAN-TO'G'RI shu API'ga yuboradi. Mijozni
   Telegram bergan `initData` imzosi bo'yicha tekshiramiz — bot tokeni bilan
   HMAC hisoblanadi, ya'ni soxta so'rov o'tmaydi. */

/* initData imzosini tekshiradi. To'g'ri bo'lsa Telegram foydalanuvchisini
   qaytaradi, aks holda null. */
function verifyInitData(initData) {
  if (!TG_TOKEN || !initData) return null;
  let params;
  try { params = new URLSearchParams(String(initData)); } catch (e) { return null; }

  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');

  /* Telegram talab qiladi: kalitlar alifbo tartibida, "kalit=qiymat" satrlari \n bilan */
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(TG_TOKEN).digest();
  const calc = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  /* Vaqt bo'yicha xavfsiz solishtirish */
  try {
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash.toLowerCase(), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch (e) { return null; }

  /* Eskirgan imzo qabul qilinmaydi (24 soat) */
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > 86400) return null;

  try { return JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
}

botRouter.post('/api/tg/order', async (req, res) => {
  if (!BOT_ENABLED) return res.status(503).json({ error: 'Telegram bot sozlanmagan' });

  const b = req.body || {};
  const tgUser = verifyInitData(b.initData);
  if (!tgUser || !tgUser.id) {
    return res.status(401).json({ error: 'Telegram tasdig`i noto`g`ri. Mini ilovani bot orqali qayta oching.' });
  }

  const chatId = String(tgUser.id);
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ')
            || tgUser.username || 'Telegram mijoz';

  let created;
  try {
    created = createOrder({
      user: name,
      phone: b.phone,
      addr: b.addr,
      pay: b.pay,
      items: b.items,
      tgChatId: chatId,
    });
  } catch (e) {
    const status = e instanceof OrderError ? e.status : 500;
    const reason = e instanceof OrderError ? e.message : 'Buyurtmani rasmiylashtirib bo`lmadi';
    if (!(e instanceof OrderError)) console.error('[BOT] mini ilova buyurtmasi xatosi:', e);
    return res.status(status).json({ error: reason });
  }

  const o = created.order;

  /* 1) Restoran + kuryer + adminlar — saytdan berilgan buyurtma bilan BIR XIL */
  notifyNewOrder(o, created.lines);

  /* 2) Mijozning O'ZIGA botда tasdiq xabari (mini ilova yopilgach shu ko'rinadi) */
  const lines = (created.lines || [])
    .map((l) => `  • ${esc(l.emoji)} ${esc(l.name)} × ${l.qty} — ${money(l.sum)} so'm`)
    .join('\n');
  send(chatId,
    '✅ <b>Buyurtmangiz qabul qilindi!</b>\n\n'
    + `🧾 Raqami: <b>#${o.id}</b>\n`
    + `🏪 Restoran: <b>${esc(o.rest)}</b>\n\n`
    + `🍽 <b>Tarkibi:</b>\n${lines}\n\n`
    + `💰 Jami: <b>${money(o.amount)} so'm</b>\n`
    + `📍 Manzil: ${esc(o.addr)}\n`
    + `📞 Telefon: ${esc(o.phone)}\n`
    + `💳 To'lov: ${o.pay === 'cash' ? '💵 Naqd' : '💳 Karta'}\n`
    + (o.courier ? `🛵 Kuryer: <b>${esc(o.courier)}</b>\n` : '')
    + `⏱ Taxminiy vaqt: <b>${Number(o.eta) || 15} daqiqa</b>\n\n`
    + "Iltimos, kuting — restoran buyurtmani tayyorlay boshladi. Holat o'zgarishi haqida shu yerда xabar beramiz.\n\n"
    + '<i>Fikringiz o`zgarsa — quyidagi tugma bilan bekor qilishingiz mumkin (kuryer yo`lga chiqqunicha).</i>',
    { reply_markup: customerKeyboard(o) || mainKeyboard() });

  /* 3) Mini ilovaga javob — u "Tasdiqlandi" ekranini ko'rsatib yopiladi */
  res.status(201).json({
    ok: true,
    id: o.id,
    rest: o.rest,
    amount: o.amount,
    eta: o.eta,
    courier: o.courier || '',
  });
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
  BOT_USERNAME = username;   // panellardagi "Telegramga ulash" havolasi uchun

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
