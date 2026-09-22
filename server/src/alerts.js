/* ===== Yetkazish muddati ogohlantirishlari =====
   Buyurtma yaratilganда unga `eta` (daqiqa) beriladi — mijozga va'da qilingan
   yetkazish muddati. Muddati tugay deb qolganda kuryerga UCH marta ogohlantirish
   yuboriladi, muddat o'tib ketsa — to'rtinchi (kechikish) xabari:

     1-ogohlantirish — muddatning 50% i o'tganda (yarmi qoldi)
     2-ogohlantirish — 5 daqiqa qolganda
     3-ogohlantirish — 2 daqiqa qolganda
     4 (kechikish)   — muddat tugadi, buyurtma hali yetkazilmagan

   Har bir daraja bitta buyurtma uchun BIR MARTA yuboriladi (order_alerts jadvali).
   Xabar Telegram orqali kuryerga (ulangan bo'lsa) va adminlarga boradi; kuryer
   paneli esa AYNAN shu chegaralarni o'zi hisoblab ekranda ko'rsatadi. */
import { db } from './db.js';
import { notifyOpsOverdue } from './bot.js';
import { clampEta } from './orders-core.js';

/* Hali yetkazilmagan bosqichlar — shular kuzatiladi */
const ACTIVE = "('new','accepted','ready','ontheway')";

/* created_at UTC ('YYYY-MM-DD HH:MM:SS') → ms */
function stamp(s) {
  if (!s) return 0;
  const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : 0;
}

/* Qolgan daqiqaga qarab qaysi daraja tegishli (eng yuqorisi) */
export function alertLevel(minutesLeft, eta) {
  if (minutesLeft <= 0) return 4;
  if (minutesLeft <= 2) return 3;
  if (minutesLeft <= 5) return 2;
  if (minutesLeft <= Math.max(6, Math.round(eta / 2))) return 1;
  return 0;
}

function alreadySent(orderId, level) {
  try { return !!db.prepare('SELECT 1 FROM order_alerts WHERE order_id = ? AND level = ?').get(orderId, level); }
  catch (e) { return true; }   // baza xatosi — spam qilmaymiz
}
function markSent(orderId, level) {
  try { db.prepare('INSERT OR IGNORE INTO order_alerts (order_id, level) VALUES (?,?)').run(orderId, level); }
  catch (e) { /* jim */ }
}

export function checkDeadlines() {
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM orders WHERE status IN ${ACTIVE} ORDER BY id`).all();
  } catch (e) { return; }

  const now = Date.now();
  for (const o of rows) {
    const created = stamp(o.created_at);
    if (!created) continue;
    const eta = clampEta(o.eta);
    const deadline = created + eta * 60000;
    /* ceil: 40 soniya qolganда "0 daqiqa" (= vaqt tugadi) deb hisoblamaslik uchun.
       Muddat haqiqatan o'tgandagina manfiy/0 bo'ladi. */
    const minutesLeft = Math.ceil((deadline - now) / 60000);

    /* Juda eski buyurtmalar (2 soatdan ortiq kechikkan) — qayta-qayta bezovta qilmaymiz */
    if (now - deadline > 2 * 60 * 60 * 1000) continue;

    const level = alertLevel(minutesLeft, eta);
    if (!level) continue;

    /* Pastroq darajalar o'tkazib yuborilgan bo'lsa ham (server uxlab qolgan),
       faqat AYNAN shu darajani yuboramiz — eskilarini "yuborilgan" deb belgilaymiz. */
    for (let l = 1; l < level; l++) markSent(o.id, l);
    if (alreadySent(o.id, level)) continue;

    markSent(o.id, level);
    /* KURYERGA ogohlantirish O'Z PANELIDA chiqadi (assets/js/kuryer.js) —
       aynan shu chegaralar bo'yicha, 3 ta ogohlantirish + "vaqt tugadi".
       Bot kuryerga yozmaydi: u faqat mijoz uchun.
       Vaqt tugagan bo'lsa — operatorlar guruhiga (bo'lsa) xabar boradi. */
    if (level >= 4) notifyOpsOverdue(o, Math.abs(Math.min(0, minutesLeft)));
    console.log(`[ALERT] #${o.id} — ${level}-daraja (${minutesLeft} daq.), kuryer: ${o.courier || '—'}`);
  }
}

/* Har daqiqada tekshiramiz (app.js ishga tushirganда chaqiradi) */
export function startDeadlineAlerts() {
  checkDeadlines();
  const t = setInterval(checkDeadlines, 60 * 1000);
  if (t.unref) t.unref();
  return t;
}
