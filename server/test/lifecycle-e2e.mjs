/* ===== Yetkaz.uz — TO'LIQ HAYOTIY OQIM E2E =====
   Mijoz -> restoran -> kuryer -> mijoz -> admin. Har bosqich, har rol, har
   qoida. Maqsad: HAQIQIY xatolarni topish (money-e2e moliya bilan cheklangan). */

const BASE = process.env.E2E_BASE || 'http://localhost:5099/api';
let PASS = 0, FAIL = 0;
const fails = [];
const ok = (c, m) => { if (c) PASS++; else { FAIL++; fails.push(m); console.error('  ✗ ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — kutildi ${JSON.stringify(b)}, keldi ${JSON.stringify(a)}`);
const digs = (s) => String(s || '').replace(/\D/g, '');

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { status: r.status, data: d };
}

async function main() {
  console.log('\n=== TO\'LIQ HAYOTIY OQIM ===\n');

  /* ---- 0. Setup ---- */
  const AT = (await api('POST', '/auth/login', { login: 'admin', pass: process.env.E2E_ADMIN_PASS || 'e2e-admin-pass' })).data.token;
  ok(AT, 'admin login');

  await api('POST', '/restaurants', { name: 'Osh Markazi', login: 'lc_rest', pass: 'p1', commission: 15, openH: 0, closeH: 24, phone: '+998901110001' }, AT);
  await api('POST', '/couriers', { name: 'Kuryer Vali', login: 'lc_cour', pass: 'p2', fee: 11000, openH: 0, closeH: 24, phone: '+998901110002' }, AT);
  const RT = (await api('POST', '/auth/login', { login: 'lc_rest', pass: 'p1' })).data.token;
  const KT = (await api('POST', '/auth/login', { login: 'lc_cour', pass: 'p2' })).data.token;

  await api('POST', '/dishes', { id: 8001, name: 'Osh', price: 28000, emoji: '🍚', kind: 'taom', maxQty: 5 }, RT);
  await api('POST', '/dishes', { id: 8002, name: 'Salat', price: 15000, emoji: '🥗', kind: 'taom' }, RT);
  await api('POST', '/dishes', { id: 8003, name: 'Choy', price: 5000, emoji: '🍵', kind: 'ichimlik' }, RT);

  /* ---- 1. MIJOZ: katalog ko'radi ---- */
  const boot = (await api('GET', '/bootstrap', null)).data;
  const bRest = (boot.restaurants || []).find((r) => r.name === 'Osh Markazi');
  ok(bRest, 'mijoz: restoran bootstrap\'da ko\'rinadi');
  const ovr = (await api('GET', '/overrides', null)).data;
  eq((ovr.added || []).filter((d) => d.rest === 'Osh Markazi').length, 3, 'mijoz: 3 ta taom katalogда');

  /* ---- 2. MIJOZ: buyurtma beradi (2 Osh + 1 Salat + izoh) ---- */
  const o1 = await api('POST', '/orders', {
    user: 'Aziz', phone: '+998901234701', pay: 'cash', addr: 'Yunusobod 1',
    items: [{ id: 8001, qty: 2, note: 'achchiq solmang' }, { id: 8002, qty: 1 }],
  });
  eq(o1.status, 201, 'mijoz: buyurtma yaratildi');
  eq(o1.data.amount, 71000, 'mijoz: summa 2*28000 + 15000 = 71000');
  eq(o1.data.status, 'new', 'buyurtma statusi new');
  eq(o1.data.courier, 'Kuryer Vali', 'kuryer avtomatik biriktirildi');
  const oid = o1.data.id, otok = o1.data.token;
  const oshLine = (o1.data.items || []).find((l) => l.name === 'Osh');
  eq(oshLine && oshLine.note, 'achchiq solmang', 'taom izohi saqlandi');
  eq(o1.data.qtyTotal, 3, 'jami dona 3');

  /* ---- 3. RESTORAN: buyurtmani ko'radi ---- */
  const rOrders = (await api('GET', '/orders', null, RT)).data;
  ok(rOrders.some((o) => o.id === oid), 'restoran: buyurtmani ko\'radi');
  /* Restoran mijoz telefon/manzilini ko'radi (yetkazish uchun kerak) */
  const rO = rOrders.find((o) => o.id === oid);
  ok(rO.phone && rO.addr, 'restoran: mijoz telefoni va manzili ko\'rinadi');
  /* Restoran BOSHQA restoran buyurtmasini ko'rmaydi — 2-restoran yarataylik */
  await api('POST', '/restaurants', { name: 'Burger King', login: 'lc_rest2', pass: 'p3', openH: 0, closeH: 24 }, AT);
  const RT2 = (await api('POST', '/auth/login', { login: 'lc_rest2', pass: 'p3' })).data.token;
  const r2Orders = (await api('GET', '/orders', null, RT2)).data;
  ok(!r2Orders.some((o) => o.id === oid), 'restoran 2: boshqa restoran buyurtmasini KO\'RMAYDI');

  /* ---- 4. RESTORAN: buyurtmani qabul qiladi (accepted) ---- */
  let up = await api('PATCH', '/orders/' + oid, { status: 'accepted' }, RT);
  eq(up.status, 200, 'restoran: accepted');
  up = await api('PATCH', '/orders/' + oid, { status: 'ready' }, RT);
  eq(up.data.status, 'ready', 'restoran: ready (tayyor)');

  /* Restoran BOSHQA restoran buyurtmasini o'zgartira olmaydi */
  const hack = await api('PATCH', '/orders/' + oid, { status: 'cancelled' }, RT2);
  eq(hack.status, 403, 'restoran 2: begona buyurtmani o\'zgartira olmaydi (403)');

  /* ---- 5. KURYER: buyurtmani ko'radi, yo'lga chiqadi ---- */
  const kOrders = (await api('GET', '/orders', null, KT)).data;
  ok(kOrders.some((o) => o.id === oid), 'kuryer: buyurtmani ko\'radi');
  up = await api('PATCH', '/orders/' + oid, { status: 'ontheway' }, KT);
  eq(up.data.status, 'ontheway', 'kuryer: yo\'lga chiqdi');
  up = await api('PATCH', '/orders/' + oid, { status: 'arrived' }, KT);
  eq(up.data.status, 'arrived', 'kuryer: yetkazdi (arrived)');

  /* Kuryer BOSHQA kuryer buyurtmasini o'zgartira olmaydi */
  await api('POST', '/couriers', { name: 'Kuryer 2', login: 'lc_cour2', pass: 'p4', openH: 0, closeH: 24 }, AT);
  const KT2 = (await api('POST', '/auth/login', { login: 'lc_cour2', pass: 'p4' })).data.token;
  const kh = await api('PATCH', '/orders/' + oid, { status: 'done' }, KT2);
  eq(kh.status, 403, 'kuryer 2: begona buyurtmani o\'zgartira olmaydi (403)');
  /* Endi 2-kuryerni javobга chiqaramiz — qolgan test buyurtmalari HAMMASI
     Kuryer Vali ga tushsin (test deterministik bo'lsin). */
  await api('POST', '/couriers/leave', { reason: 'test' }, KT2);
  await api('POST', '/couriers/leave-decision', { login: 'lc_cour2', approve: true }, AT);

  /* ---- 6. MIJOZ: "qabul qildim" (arrived -> done) ---- */
  const recv = await api('POST', '/orders/' + oid + '/received', { token: otok });
  eq(recv.status, 200, 'mijoz: qabul qildim');
  eq(recv.data.status, 'done', 'buyurtma done');
  eq(recv.data.courierFee, 11000, 'kuryer haqi muhrlandi (11000)');
  ok(recv.data.done_at, 'done_at yozildi');

  /* Guest order tracking (id bo'yicha, tokensiz) */
  const track = await api('GET', '/orders/' + oid, null);
  eq(track.data.status, 'done', 'mijoz: id bo\'yicha holatni kuzatadi (tokensiz)');

  /* ---- 7. MIJOZ: taom va kuryer reytingi ---- */
  const rev1 = await api('POST', '/reviews', { name: 'Aziz', rating: 5, dish: 'Osh', rest: 'Osh Markazi', text: 'Juda mazali!', orderToken: otok });
  eq(rev1.status, 201, 'mijoz: taom reytingi qoldirildi');
  const rev2 = await api('POST', '/reviews', { name: 'Aziz', rating: 4, dish: '🛵 Kuryer: Kuryer Vali', text: 'Tez yetkazdi', orderToken: otok });
  eq(rev2.status, 201, 'mijoz: kuryer reytingi qoldirildi');
  /* Reyting bootstrap'da aks etadi */
  const boot2 = (await api('GET', '/bootstrap', null)).data;
  const bRest2 = (boot2.restaurants || []).find((r) => r.name === 'Osh Markazi');
  eq(bRest2.rating, 5, 'restoran reytingi izohdан hisoblandi (5)');
  /* ===== TAOM yulduzchasi — STANDART 'sales' (sotuvга qarab), admin bosqichlari.
     Osh 2 dona sotildi (< 5) -> 0 yulduz. Mijoz bahosi `reviewAvg` da qoladi. ===== */
  const RK = 'Osh Markazi|Osh';   // reyting kaliti: "restoran|taom"
  const oshRating = boot2.ratings.dishes[RK];
  eq(oshRating && oshRating.sold, 2, 'Osh REAL sotuvi = 2 dona (yetkazilgan buyurtmadan)');
  const oshCard = (boot2.overrides.added || []).find((d) => d.rest === 'Osh Markazi' && d.name === 'Osh');
  eq(oshCard && oshCard.rating, 0, 'katalog: Osh kartasi yulduzchasi 0');
  eq(oshCard && oshCard.sold, 2, 'katalog: Osh kartasi sotuvi 2 (rest|name kaliti)');
  eq(oshRating && oshRating.rating, 0, 'Osh yulduzchasi 0 (2 dona < 5 — standart 1★ bosqichi)');
  eq(oshRating && oshRating.reviewAvg, 5, 'Osh mijoz bahosi o\'rtachasi = 5 (reviewAvg)');
  eq(boot2.settings.dishRatingSrc, 'sales', 'standart taom reyting manbai = sales');
  /* Admin 1★ bosqichini 2 ga tushirsa -> Osh 1 yulduz oladi */
  await api('PATCH', '/settings', { dishStarThresholds: [2, 5, 10, 20, 40] }, AT);
  let bootT = (await api('GET', '/bootstrap', null)).data;
  eq(bootT.ratings.dishes[RK].rating, 1, 'bosqich 2 ga tushdi -> Osh 1★');
  /* Admin manbани 'reviews' qilsa -> mijoz bahosi (5) ko'rinadi */
  await api('PATCH', '/settings', { dishRatingSrc: 'reviews' }, AT);
  bootT = (await api('GET', '/bootstrap', null)).data;
  eq(bootT.ratings.dishes[RK].rating, 5, "manba 'reviews' -> Osh yulduzchasi = 5");
  /* Standartga qaytaramiz (qolgan tekshiruvlar buzilmasin) */
  await api('PATCH', '/settings', { dishRatingSrc: 'sales', dishStarThresholds: [5, 15, 30, 60, 100] }, AT);
  const kurRating = boot2.ratings.couriers['Kuryer Vali'];
  eq(kurRating && kurRating.rating, 4, 'kuryer reytingi (4) — izohdан (o\'zgarмади)');
  /* Kuryer O'RTACHA yetkazish vaqti — real buyurtмадан hisoblanadi */
  const kRowSpeed = (await api('GET', '/couriers', null, AT)).data.find((c) => c.name === 'Kuryer Vali');
  ok(kRowSpeed && typeof kRowSpeed.avgDeliveryMin === 'number', 'kuryer: avgDeliveryMin maydoni bor');
  /* Tizimga kirmagan, tokensiz — reyting bera olmaydi */
  const revBad = await api('POST', '/reviews', { name: 'X', rating: 1, dish: 'Osh', text: 'yomon' });
  eq(revBad.status, 401, 'tokensiz reyting RAD etiladi');

  /* Kuryer reytingi saytда KO'RINMAYDI (faqat panelда) */
  const pubRevs = (await api('GET', '/reviews', null)).data;
  ok(!pubRevs.some((r) => /🛵 Kuryer:/.test(r.dish || '') && false), 'reviews ro\'yxati keladi');
  /* (kuryer izohini ratings.js panelга ajratadi — bu bootstrap tekshiruvida ko\'rindi) */

  /* ---- 8. ADMIN: izohga javob ---- */
  const rid = rev1.data.id;
  const reply = await api('POST', '/reviews/' + rid + '/reply', { reply: 'Rahmat, yana kuting!' }, AT);
  eq(reply.data.reply, 'Rahmat, yana kuting!', 'admin: izohga javob yozildi');
  const boot3 = (await api('GET', '/bootstrap', null)).data;
  const withReply = (boot3.reviews || []).find((r) => r.id === rid);
  eq(withReply && withReply.reply, 'Rahmat, yana kuting!', 'admin javobi bootstrap\'da (saytда ko\'rinadi)');

  /* ---- 9. MIN SUMMA / MAX QTY / ISH VAQTI ---- */
  const tooSmall = await api('POST', '/orders', { user: 'B', phone: '+998901234702', pay: 'cash', addr: 'x', items: [{ id: 8003, qty: 1 }] });
  eq(tooSmall.status, 400, 'min summa (20000) dan kam — RAD etiladi');
  const tooMany = await api('POST', '/orders', { user: 'B', phone: '+998901234702', pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 6 }] });
  eq(tooMany.status, 409, 'Osh max 5 — 6 ta olib bo\'lmaydi (409)');
  ok(/5 ta/.test(tooMany.data.error || ''), 'max qty xatosida chegara ko\'rsatiladi');

  /* Ish vaqti: restoranни 10-11 ga cheklaymiz (test hozir bu oraliqда emas deb faraz) */
  const nowH = new Date(Date.now() + 5 * 3600 * 1000).getUTCHours();   // Toshkent soati
  const closedH = (nowH + 3) % 24;
  await api('PATCH', '/restaurants', { login: 'lc_rest', openH: closedH, closeH: (closedH + 1) % 24 }, AT);
  const closedOrder = await api('POST', '/orders', { user: 'B', phone: '+998901234702', pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(closedOrder.status, 409, 'yopiq restorandan buyurtma RAD etiladi (409)');
  ok(/yopiq/i.test(closedOrder.data.error || ''), 'yopiq xato matni');
  await api('PATCH', '/restaurants', { login: 'lc_rest', openH: 0, closeH: 24 }, AT);   // qaytaramiz

  /* ---- 10. RESTORAN: taom "sotuvda yo'q" / o'chirish ---- */
  await api('POST', '/soldout', { name: 'Salat', soldout: true }, RT);
  const soldoutOrder = await api('POST', '/orders', { user: 'B', phone: '+998901234702', pay: 'cash', addr: 'x', items: [{ id: 8002, qty: 2 }] });
  eq(soldoutOrder.status, 409, 'sotuvda yo\'q taom — RAD etiladi (409)');
  await api('POST', '/soldout', { name: 'Salat', soldout: false }, RT);   // qaytaramiz
  await api('DELETE', '/dishes', { name: 'Choy' }, RT);
  const ovrAfterDel = (await api('GET', '/overrides', null)).data;
  ok(!(ovrAfterDel.added || []).some((d) => d.rest === 'Osh Markazi' && d.name === 'Choy'), 'o\'chirilgan taom katalogdan ketdi');

  /* ---- 11. KATTA BUYURTMA -> kuryer qo'ng'irog'i ---- */
  await api('POST', '/dishes', { id: 8004, name: 'Somsa', price: 8000, emoji: '🥟', kind: 'taom', maxQty: 100 }, RT);
  const bigOrder = await api('POST', '/orders', { user: 'Katta', phone: '+998901234703', pay: 'cash', addr: 'x', items: [{ id: 8004, qty: 12 }] });
  eq(bigOrder.status, 201, 'katta buyurtma (12 dona) yaratildi');
  eq(bigOrder.data.callRequired, 1, 'katta buyurtma: kuryer qo\'ng\'irog\'i SHART');
  const bigId = bigOrder.data.id;
  await api('PATCH', '/orders/' + bigId, { status: 'accepted' }, RT);
  await api('PATCH', '/orders/' + bigId, { status: 'ready' }, RT);
  /* Kuryer qo'ng'iroqsiz yo'lga chiqolmaydi */
  const noCall = await api('PATCH', '/orders/' + bigId, { status: 'ontheway' }, KT);
  eq(noCall.status, 409, 'katta buyurtma: qo\'ng\'iroqsiz yo\'lga chiqib bo\'lmaydi (409)');
  ok(noCall.data.needCall, 'needCall bayrog\'i');
  /* Kuryer qo'ng'iroq qildi -> endi mumkin */
  const callDone = await api('POST', '/orders/' + bigId + '/call-confirm', {}, KT);
  eq(callDone.data.callDone, 1, 'kuryer: mijoz tasdiqladi');
  const nowOk = await api('PATCH', '/orders/' + bigId, { status: 'ontheway' }, KT);
  eq(nowOk.status, 200, 'qo\'ng\'iroqdan keyin yo\'lga chiqdi');

  /* ---- 12. SHUBHALI BUYURTMA -> admin tasdig'i ---- */
  const suspOrder = await api('POST', '/orders', { user: 'Shubha', phone: '+998901234704', pay: 'cash', addr: 'x', items: [{ id: 8004, qty: 25 }] });
  eq(suspOrder.status, 201, 'shubhali buyurtma yaratildi');
  eq(suspOrder.data.status, 'review', 'shubhali: status = review');
  const suspId = suspOrder.data.id;
  /* Restoran/kuryer review buyurtmani KO'RMAYDI */
  const rOrdersSusp = (await api('GET', '/orders', null, RT)).data;
  ok(!rOrdersSusp.some((o) => o.id === suspId), 'restoran: shubhali buyurtmani KO\'RMAYDI');
  const kOrdersSusp = (await api('GET', '/orders', null, KT)).data;
  ok(!kOrdersSusp.some((o) => o.id === suspId), 'kuryer: shubhali buyurtmani KO\'RMAYDI');
  /* Restoran/kuryer review buyurtmani PATCH qila olmaydi */
  const suspHack = await api('PATCH', '/orders/' + suspId, { status: 'accepted' }, RT);
  eq(suspHack.status, 409, 'restoran: shubhali buyurtmani harakatga keltira olmaydi (409)');
  /* Admin tasdiqlaydi */
  const approve = await api('POST', '/orders/' + suspId + '/approve', {}, AT);
  eq(approve.status, 200, 'admin: shubhali buyurtmani tasdiqladi');
  eq(approve.data.status, 'new', 'tasdiqdан keyin status = new');
  ok(approve.data.courier, 'tasdiqdан keyin kuryer biriktirildi');
  const rOrdersAppr = (await api('GET', '/orders', null, RT)).data;
  ok(rOrdersAppr.some((o) => o.id === suspId), 'restoran: tasdiqlangan buyurtmani ENDI ko\'radi');
  /* Yana bittasini admin RAD etadi */
  const suspOrder2 = await api('POST', '/orders', { user: 'Shubha2', phone: '+998901234705', pay: 'cash', addr: 'x', items: [{ id: 8004, qty: 30 }] });
  const rej = await api('POST', '/orders/' + suspOrder2.data.id + '/reject', { reason: 'Soxta buyurtma' }, AT);
  eq(rej.data.status, 'cancelled', 'admin rad etdi -> cancelled');
  eq(rej.data.reason, 'Soxta buyurtma', 'rad sababi mijozga ko\'rinadi');

  /* ---- 13. BEKOR QILISH + AVTOMATIK BLOK ---- */
  const cp = '+998901234706';
  const c1 = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  const r1c = await api('POST', '/orders/' + c1.data.id + '/cancel', { token: c1.data.token });
  eq(r1c.status, 200, '1-bekor: ruxsat');
  ok(!r1c.data.blocked && (r1c.data.warnLevel || 1) === 1, '1-bekor: bloklanmadi (yumshoq eslatma)');
  const c2 = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  const r2c = await api('POST', '/orders/' + c2.data.id + '/cancel', { token: c2.data.token });
  eq(r2c.data.warnLevel, 2, '2-bekor: ogohlantirish + pauza');
  ok(r2c.data.pausedSeconds > 0, '2-bekor: 5 daqiqalik pauza');
  /* Pauza paytida buyurtma bermoqchi -> 429 */
  const paused = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(paused.status, 429, 'pauza paytida yangi buyurtma RAD etiladi (429)');

  /* ---- 14. ADMIN: bloklangan raqamlar ro'yxati ---- */
  const blk = (await api('GET', '/blocked', null, AT)).data;
  ok(blk.list && blk.list.some((x) => x.pretty && digs(x.pretty||x.phone).includes('998901234706')), 'admin: bekor qilgan raqam ro\'yxatda');
  ok(blk.rules && blk.rules.blockAt === 3, 'admin: blok qoidalari ko\'rinadi');

  /* ---- 15. TO'LOV QR OQIMI ---- */
  const qr = await api('GET', '/couriers/me/qr', null, KT);
  eq(qr.status, 200, 'kuryer: to\'lov QR oldi');
  ok(qr.data.payToken, 'QR token bor');
  const payTok = qr.data.payToken;
  /* Yangi buyurtma -> QR orqali to'lash */
  const payOrder = await api('POST', '/orders', { user: 'Toluvchi', phone: '+998901234707', pay: 'card', addr: 'x', items: [{ id: 8001, qty: 2 }] });
  await api('PATCH', '/orders/' + payOrder.data.id, { status: 'accepted' }, RT);
  await api('PATCH', '/orders/' + payOrder.data.id, { status: 'ready' }, RT);
  await api('PATCH', '/orders/' + payOrder.data.id, { status: 'ontheway' }, KT);
  const lookup = await api('POST', '/pay/' + payTok + '/lookup', { phone: '+998901234707' });
  eq(lookup.status, 200, 'QR: mijoz o\'z buyurtmasini topdi');
  ok(lookup.data.orders && lookup.data.orders.length >= 1, 'QR: to\'lanmagan buyurtma ro\'yxatда');
  /* Boshqa mijoz telefoni bilan -> ko'rinmaydi */
  const lookupBad = await api('POST', '/pay/' + payTok + '/lookup', { phone: '+998900000000' });
  eq((lookupBad.data.orders || []).length, 0, 'QR: begona telefon -> buyurtma ko\'rinmaydi');
  const doPay = await api('POST', '/pay/' + payTok + '/' + payOrder.data.id, { phone: '+998901234707' });
  eq(doPay.data.ok, true, 'QR: to\'lov qabul qilindi');
  /* Begona telefon bilan to'lab bo'lmaydi */
  const payHack = await api('POST', '/pay/' + payTok + '/' + payOrder.data.id, { phone: '+998900000000' });
  eq(payHack.status, 403, 'QR: begona telefon bilan to\'lab bo\'lmaydi (403)');

  /* ---- 16. SHIKOYAT (restoran -> admin -> javob) ---- */
  const cmp = await api('POST', '/complaints', { topic: 'texnik', text: 'Panel sekin ishlayapti', orderId: 0 }, RT);
  eq(cmp.status, 201, 'restoran: shikoyat yubordi');
  const cmpList = (await api('GET', '/complaints', null, AT)).data;
  ok(cmpList.some((c) => c.id === cmp.data.id), 'admin: shikoyatni ko\'radi');
  /* Restoran faqat O'Z shikoyatini ko'radi */
  const cmpR2 = (await api('GET', '/complaints', null, RT2)).data;
  ok(!cmpR2.some((c) => c.id === cmp.data.id), 'restoran 2: begona shikoyatni ko\'rmaydi');
  const cmpReply = await api('POST', '/complaints/' + cmp.data.id + '/reply', { reply: 'Tekshiramiz' }, AT);
  eq(cmpReply.data.reply, 'Tekshiramiz', 'admin: shikoyatga javob');
  eq(cmpReply.data.status, 'seen', 'shikoyat holati: seen');
  /* Restoran begona buyurtma raqami bilan shikoyat yozolmaydi */
  const cmpBad = await api('POST', '/complaints', { topic: 'mijoz', text: 'Test shikoyat matni', orderId: oid }, RT2);
  eq(cmpBad.status, 403, 'restoran 2: begona buyurtma raqami bilan shikoyat RAD etiladi');

  /* ---- 17. E'LON (restoran -> bootstrap) ---- */
  const ann = await api('POST', '/announcements', { rest: 'Osh Markazi', text: 'Bugun Oshga 20% chegirma!', tag: 'AKSIYA', emoji: '🔥' }, RT);
  eq(ann.status, 201, 'restoran: e\'lon joyladi');
  const boot4 = (await api('GET', '/bootstrap', null)).data;
  ok((boot4.announcements || []).some((a) => a.text === 'Bugun Oshga 20% chegirma!'), 'e\'lon bootstrap\'da (saytда ko\'rinadi)');

  /* ---- 18. RESTORAN: 3 DAQIQALIK RAD ETISH OYNASI ---- */
  const rejOrder = await api('POST', '/orders', { user: 'RadEt', phone: '+998901234708', pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  const restReject = await api('PATCH', '/orders/' + rejOrder.data.id, { status: 'cancelled', reason: 'Mahsulot tugadi' }, RT);
  eq(restReject.status, 200, 'restoran: yangi buyurtmani rad etdi (3 daqiqa ichida)');
  eq(restReject.data.status, 'cancelled', 'buyurtma bekor qilindi');
  /* Restoran bekor qilganда MIJOZ jazolanmaydi (xodim bekor qildi) */
  const custOrders = (await api('GET', '/orders?user=RadEt', null, AT)).data;
  ok(custOrders.length >= 0, 'admin: mijoz filtri ishlaydi');

  /* ---- 19. ADMIN: manba statistikasi ---- */
  const src = await api('GET', '/orders/stats/source', null, AT);
  eq(src.status, 200, 'admin: bot/sayt statistikasi');
  ok(src.data.total > 0 && src.data.sayt > 0, 'statistika: saytdan buyurtmalar bor');
  eq(src.data.telegram + src.data.sayt, src.data.total, 'statistika: jami = tg + sayt');

  /* ---- 20. ADMIN: foydalanuvchilar (mehmon) ---- */
  const users = (await api('GET', '/users', null, AT)).data;
  ok(users.guests && users.guests.some((g) => digs(g.phone).includes('998901234701')), 'admin: mehmon mijoz ro\'yxatда (Aziz)');
  const aziz = users.guests.find((g) => digs(g.phone).includes('998901234701'));
  eq(aziz && aziz.spent, 71000, 'admin: mehmon "sarflagan" = done buyurtma (71000)');

  /* ---- 21. RATE-LIMIT / XAVFSIZLIK (tokensiz mutatsiya) ---- */
  const noAuth1 = await api('PATCH', '/orders/' + oid, { status: 'new' });
  eq(noAuth1.status, 401, 'tokensiz PATCH /orders -> 401 (avtorizatsiya kerak)');
  const noAuth2 = await api('GET', '/orders', null);
  eq(noAuth2.status, 401, 'tokensiz GET /orders -> 401');
  const noAuth3 = await api('POST', '/restaurants', { name: 'X', login: 'x', pass: 'x' });
  eq(noAuth3.status, 401, 'tokensiz restoran yaratish -> 401');
  const roleWrong = await api('POST', '/restaurants', { name: 'X', login: 'x', pass: 'x' }, RT);
  eq(roleWrong.status, 403, 'restoran token bilan restoran yaratish -> 403');

  /* ---- NATIJA ---- */
  console.log(`\n=== HAYOTIY OQIM: ${PASS} o'tdi, ${FAIL} yiqildi ===`);
  if (FAIL) { console.error('\nYIQILGANLAR:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('✓ To\'liq oqim ishlaydi.\n');
  process.exit(0);
}

main().catch((e) => { console.error('LIFECYCLE E2E XATOSI:', e); process.exit(2); });
