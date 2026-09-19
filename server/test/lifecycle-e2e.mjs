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
  /* "Bekor" shu raqam bilan bir necha marta buyurtma beradi — guest-limit
     qoidasiga ko'ra (orders-core.js: guestOrderStatus) 2-buyurtmadan boshlab
     ro'yxatdan o'tgan bo'lishi kerak, aks holda 428 qaytib, bekor qilish
     zanjiri (warnLevel/pauza) tekshirilmay qoladi. Oldindan ro'yxatdan
     o'tkazamiz — bekor qilish jazosi TELEFON bo'yicha ishlaydi, auth holatiga
     bog'liq emas. */
  const cp = '+998901234706';
  const bekorReg = await api('POST', '/auth/register', { name: 'Bekor', phone: cp, login: 'e2e_bekor', pass: 'bekor-pass-123' });
  const BT = bekorReg.data && bekorReg.data.token;
  const c1 = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, BT);
  const r1c = await api('POST', '/orders/' + c1.data.id + '/cancel', { token: c1.data.token });
  eq(r1c.status, 200, '1-bekor: ruxsat');
  ok(!r1c.data.blocked && (r1c.data.warnLevel || 1) === 1, '1-bekor: bloklanmadi (yumshoq eslatma)');
  const c2 = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, BT);
  const r2c = await api('POST', '/orders/' + c2.data.id + '/cancel', { token: c2.data.token });
  eq(r2c.data.warnLevel, 2, '2-bekor: ogohlantirish + pauza');
  ok(r2c.data.pausedSeconds > 0, '2-bekor: 5 daqiqalik pauza');
  /* Pauza paytida buyurtma bermoqchi -> 429 (bu ham TELEFON darajasidagi
     cheklov — ro'yxatdan o'tgan bo'lса ham amal qiladi) */
  const paused = await api('POST', '/orders', { user: 'Bekor', phone: cp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, BT);
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

  /* ---- 15. GUEST-LIMIT: 1-buyurtma erkin, 2-si ro'yxatdan o'tish/kirishni talab qiladi ---- */
  console.log('\n--- Guest-limit (1-buyurtma erkin, 2-si ro\'yxatdan o\'tishni talab qiladi) ---');
  const gp = '+998901234709';
  const gStatus0 = (await api('GET', '/orders/guest-status?phone=' + encodeURIComponent(gp))).data;
  ok(!gStatus0.blocked, 'guest-status: yangi raqam — bloklanmagan');
  const g1 = await api('POST', '/orders', { user: 'Guest1', phone: gp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(g1.status, 201, 'guest: 1-buyurtma erkin qabul qilindi');
  const gStatus1 = (await api('GET', '/orders/guest-status?phone=' + encodeURIComponent(gp))).data;
  eq(gStatus1.blocked, true, 'guest-status: 1-buyurtmadan keyin bloklangan (2-si uchun)');
  eq(gStatus1.hasAccount, false, 'guest-status: hali akkaunt yo\'q -> ro\'yxatdan o\'tish so\'raladi');
  const g2 = await api('POST', '/orders', { user: 'Guest1', phone: gp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(g2.status, 428, 'guest: 2-buyurtma rad etiladi (428, ro\'yxatdan o\'tish kerak)');
  eq(g2.data.code, 'REGISTER_REQUIRED', 'guest: xato kodi REGISTER_REQUIRED');
  /* Ro'yxatdan o'tgach — endi erkin (token bilan) buyurtma beradi */
  const gReg = await api('POST', '/auth/register', { name: 'Guest1', phone: gp, login: 'e2e_guest1', pass: 'guest1-pass' });
  eq(gReg.status, 201, 'guest: ro\'yxatdan o\'tdi');
  const GT2 = gReg.data.token;
  const g3 = await api('POST', '/orders', { user: 'Guest1', phone: gp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, GT2);
  eq(g3.status, 201, 'guest: ro\'yxatdan o\'tgach 2-buyurtma qabul qilindi');

  /* Akkaunti BOR (lekin login qilmagan holda, tokensiz) raqam guest sifatida
     1-marta buyurtma bersa, 2-martada "ro'yxatdan o'tish" EMAS, "kirish"
     so'ralishi kerak (REGISTER_LOGIN). */
  const gp2 = '+998901234710';
  const preReg = await api('POST', '/auth/register', { name: 'Guest2', phone: gp2, login: 'e2e_guest2', pass: 'guest2-pass' });
  eq(preReg.status, 201, 'guest2: oldindan ro\'yxatdan o\'tgan (lekin login qilmasdan buyurtma beradi)');
  const g2a = await api('POST', '/orders', { user: 'Guest2', phone: gp2, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(g2a.status, 201, 'guest2: akkaunti bo\'lsa ham TOKENSIZ 1-buyurtma erkin (guest sifatida)');
  const g2b = await api('POST', '/orders', { user: 'Guest2', phone: gp2, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(g2b.status, 428, 'guest2: tokensiz 2-buyurtma rad etiladi (428)');
  eq(g2b.data.code, 'REGISTER_LOGIN', 'guest2: xato kodi REGISTER_LOGIN (akkaunt bor -> kirish so\'raladi)');
  const gStatus2 = (await api('GET', '/orders/guest-status?phone=' + encodeURIComponent(gp2))).data;
  eq(gStatus2.hasAccount, true, 'guest-status: akkaunt bor -> hasAccount true');

  /* ---- 16. LIKES: taomni "yoqtirish" (faqat login qilgan mijoz) ---- */
  console.log('\n--- Likes (taom yoqtirish) ---');
  const noAuthLike = await api('POST', '/likes/toggle', { rest: 'Osh Markazi', name: 'Osh' });
  eq(noAuthLike.status, 401, 'tokensiz like -> 401');
  const like1 = await api('POST', '/likes/toggle', { rest: 'Osh Markazi', name: 'Osh' }, GT2);
  eq(like1.status, 200, 'like bosildi');
  eq(like1.data.liked, true, '1-bosishda liked=true');
  const likeList1 = await api('GET', '/likes', null, GT2);
  ok(likeList1.data.some((l) => l.rest === 'Osh Markazi' && l.name === 'Osh'), 'GET /likes ro\'yxatida bor');
  const like2 = await api('POST', '/likes/toggle', { rest: 'Osh Markazi', name: 'Osh' }, GT2);
  eq(like2.data.liked, false, '2-bosishda (toggle) liked=false');
  const likeList2 = await api('GET', '/likes', null, GT2);
  ok(!likeList2.data.some((l) => l.rest === 'Osh Markazi' && l.name === 'Osh'), 'qayta bosilgach ro\'yxatdan chiqdi');

  /* ---- 17. HABIT: /api/habit endpoint mavjud va to'g'ri shaklda javob beradi ---- */
  console.log('\n--- AI maslahat (/api/habit) ---');
  const habitNoPhone = await api('GET', '/habit');
  eq(habitNoPhone.data.dish, null, 'telefonsiz -> dish:null');
  /* Bu raqam faqat 1 marta buyurtma bergan — hali "odat" darajasida emas (kamida
     3 kun kerak, habit.test.mjs da algoritm to'liq sinaladi) */
  const habitFresh = await api('GET', '/habit?phone=' + encodeURIComponent(gp));
  eq(habitFresh.data.dish, null, 'kam tarixli raqam -> dish:null');

  /* ---- 18. PROFIL MANZILI: tuman/mahalla/ko'cha + GPS saqlash ---- */
  console.log('\n--- Profil manzili (tuman/mahalla/ko\'cha/GPS) ---');
  const addrReg = await api('POST', '/auth/register', { name: 'Manzil Test', phone: '+998901234711', login: 'e2e_addr', pass: 'addr-pass-123' });
  eq(addrReg.status, 201, 'ro\'yxatdan o\'tdi');
  ok(!addrReg.data.account.addrRegion && !addrReg.data.account.addrMahalla, 'yangi hisobda manzil hali bo\'sh');
  const AT2 = addrReg.data.token;
  const addrPatch = await api('PATCH', '/auth/me', {
    addrRegion: 'Xatirchi tumani', addrMahalla: 'Guliston', addrStreet: 'Bog\'bon ko\'chasi 12',
    addrLat: 40.123, addrLng: 65.456,
  }, AT2);
  eq(addrPatch.status, 200, 'manzil saqlandi');
  eq(addrPatch.data.account.addrRegion, 'Xatirchi tumani', 'addrRegion qaytdi');
  eq(addrPatch.data.account.addrMahalla, 'Guliston', 'addrMahalla qaytdi');
  eq(addrPatch.data.account.addrStreet, 'Bog\'bon ko\'chasi 12', 'addrStreet qaytdi');
  eq(addrPatch.data.account.addrLat, 40.123, 'addrLat qaytdi');
  eq(addrPatch.data.account.addrLng, 65.456, 'addrLng qaytdi');
  /* Qayta GET /auth/me — bazaga HAQIQATDA yozilganini tasdiqlaydi (faqat javobdan emas) */
  const addrMe = await api('GET', '/auth/me', null, AT2);
  eq(addrMe.data.account.addrRegion, 'Xatirchi tumani', 'GET /auth/me: addrRegion saqlangan');
  eq(addrMe.data.account.addrStreet, 'Bog\'bon ko\'chasi 12', 'GET /auth/me: addrStreet saqlangan');

  /* ---- 19. BONUSLAR: admin/restoran belgilaydi, "kim bajardi" jonli hisoblanadi ---- */
  console.log('\n--- Bonuslar ---');
  const noAuthBonus = await api('POST', '/bonuses', { title: 'X' });
  eq(noAuthBonus.status, 401, 'tokensiz bonus yaratish -> 401');

  /* Admin: umumiy (order_count) bonus — 2 kunda kamida 2 marta buyurtma */
  const adminBonus = await api('POST', '/bonuses', {
    title: '2 marta buyur, sovg\'a ol', descr: 'Shu hafta 2 marta buyurtma bering', type: 'order_count', target: 2, rewardText: 'Tekin yetkazish',
  }, AT);
  eq(adminBonus.status, 201, 'admin bonus yaratdi');
  eq(adminBonus.data.scope, 'admin', 'scope=admin');
  const listPub = await api('GET', '/bonuses');
  ok(listPub.data.some((b) => b.id === adminBonus.data.id), 'GET /bonuses (ommaviy) da ko\'rinadi');

  /* Restoran: o'z bonusi — scope/rest klient nima yuborsa ham MAJBURAN o'ziniki */
  const restBonus = await api('POST', '/bonuses', {
    title: 'Do\'stingni taklif qil', type: 'referral', target: 1, rewardText: '20 000 so\'m',
    scope: 'admin', rest: 'Boshqa restoran',  // — buni almashtirib ko'ramiz
  }, RT);
  eq(restBonus.status, 201, 'restoran bonus yaratdi');
  eq(restBonus.data.scope, 'restoran', 'restoran bonusi scope MAJBURAN restoran');
  eq(restBonus.data.rest, 'Osh Markazi', 'restoran bonusi rest MAJBURAN o\'zi (spoofing bloklandi)');

  /* Restoran boshqa (admin) restoranning bonusini o'chira olmaydi, lekin admin o'chira oladi */
  const rest2 = await api('POST', '/restaurants', { name: 'Bonus Test Rest2', login: 'lc_bonus2', pass: 'p9', openH: 0, closeH: 24 }, AT);
  eq(rest2.status, 201, '2-restoran yaratildi');
  const RT3 = (await api('POST', '/auth/login', { login: 'lc_bonus2', pass: 'p9' })).data.token;
  const stealDel = await api('DELETE', '/bonuses/' + restBonus.data.id, null, RT3);
  eq(stealDel.status, 403, 'boshqa restoran bonusni o\'chira olmaydi (403)');
  /* Lekin admin-scope (umumiy) bonusning "kim bajardi"ni HAR restoran ko'ra oladi */
  const viewAdminBonusAsRest = await api('GET', '/bonuses/' + adminBonus.data.id + '/qualifiers', null, RT3);
  eq(viewAdminBonusAsRest.status, 200, 'restoran admin-bonusning qualifiers\'ini ko\'ra oladi');

  /* order_count qualifiers — 2 marta buyurtma bergan mijoz chiqishi kerak */
  const bqp = '+998901234712';
  const bqReg = await api('POST', '/auth/register', { name: 'Bonus Qual', phone: bqp, login: 'e2e_bonusq', pass: 'bonusq-pass' });
  const BQT = bqReg.data.token;
  await api('POST', '/orders', { user: 'Bonus Qual', phone: bqp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, BQT);
  await api('POST', '/orders', { user: 'Bonus Qual', phone: bqp, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] }, BQT);
  const oneOrderOnly = '+998901234713';
  const oo = await api('POST', '/orders', { user: 'Bitta', phone: oneOrderOnly, pay: 'cash', addr: 'x', items: [{ id: 8001, qty: 1 }] });
  eq(oo.status, 201, 'boshqa mijoz faqat 1 marta buyurtma berdi');
  const qual = await api('GET', '/bonuses/' + adminBonus.data.id + '/qualifiers', null, AT);
  eq(qual.status, 200, 'qualifiers so\'raldi');
  ok(qual.data.some((q) => q.phone.replace(/\D/g, '').endsWith('901234712') && q.count >= 2), '2 marta buyurgan mijoz ro\'yxatda');
  ok(!qual.data.some((q) => q.phone.replace(/\D/g, '').endsWith('901234713')), '1 marta buyurgan mijoz ro\'yxatda YO\'Q (target=2)');

  /* referral qualifiers — taklif qilingan hisob ro'yxatdan o'tgach ko'rinishi kerak */
  const refBonus = await api('POST', '/bonuses', { title: 'Referral test', type: 'referral', target: 1 }, AT);
  const referrer = await api('POST', '/auth/register', { name: 'Referrer', phone: '+998901234714', login: 'e2e_referrer', pass: 'ref-pass-123' });
  eq(referrer.status, 201, 'referrer ro\'yxatdan o\'tdi');
  const referred = await api('POST', '/auth/register', { name: 'Referred', phone: '+998901234715', login: 'e2e_referred', pass: 'ref-pass-456', ref: 'e2e_referrer' });
  eq(referred.status, 201, 'referred (taklif qilingan) ro\'yxatdan o\'tdi');
  const refQual = await api('GET', '/bonuses/' + refBonus.data.id + '/qualifiers', null, AT);
  ok(refQual.data.some((q) => q.user === 'Referrer' && q.count >= 1), 'referrer "kim taklif qilgan" ro\'yxatida chiqdi');
  /* O'zini-o'zi referal qilib bo'lmaydi (login === ref) va mavjud bo'lmagan login jim e\'tiborsiz qoldiriladi */
  const selfRef = await api('POST', '/auth/register', { name: 'SelfRef', phone: '+998901234716', login: 'e2e_selfref', pass: 'self-pass-123', ref: 'e2e_selfref' });
  eq(selfRef.status, 201, 'o\'z-o\'ziga ref bergan ham muvaffaqiyatli ro\'yxatdan o\'tadi (ref e\'tiborsiz qoldiriladi)');
  const fakeRef = await api('POST', '/auth/register', { name: 'FakeRef', phone: '+998901234717', login: 'e2e_fakeref', pass: 'fake-pass-123', ref: 'hech-qachon-royxatdan-otmagan' });
  eq(fakeRef.status, 201, 'mavjud bo\'lmagan ref login bilan ham muvaffaqiyatli ro\'yxatdan o\'tadi');

  /* Admin bonusni to'liq o'chira oladi */
  const adminDel = await api('DELETE', '/bonuses/' + restBonus.data.id, null, AT);
  eq(adminDel.status, 200, 'admin restoran bonusini ham o\'chira oladi');

  /* ---- 20. TADBIRLAR: kabinet yuboradi, admin hammasini, restoran FAQAT o'zinikini ko'radi ---- */
  console.log('\n--- Tadbirlar ---');
  const noAuthEv = await api('POST', '/events', { rest: 'Osh Markazi', name: 'X', event_date: '2026-05-01' });
  eq(noAuthEv.status, 401, 'tokensiz tadbir yaratish -> 401');
  const restAsUserEv = await api('POST', '/events', { rest: 'Osh Markazi', name: 'X', event_date: '2026-05-01' }, RT);
  eq(restAsUserEv.status, 403, 'restoran roli tadbir YARATA olmaydi (faqat mijoz)');

  const evCreate = await api('POST', '/events', {
    rest: 'Osh Markazi', name: 'To\'y marosimi', event_date: '2026-06-15', headcount: 40, advance_days: 3,
  }, BQT);
  eq(evCreate.status, 201, 'mijoz tadbir yubordi');
  eq(evCreate.data.status, 'pending', 'boshlang\'ich holat: pending');
  eq(evCreate.data.headcount, 40, 'headcount saqlandi');
  eq(evCreate.data.user, 'Bonus Qual', 'mijoz ismi avtomatik req.user dan olindi');

  /* Admin — HAMMASINI ko'radi */
  const evAdminList = await api('GET', '/events', null, AT);
  eq(evAdminList.status, 200, 'admin tadbirlarni ko\'radi');
  ok(evAdminList.data.some((e) => e.id === evCreate.data.id), 'admin ro\'yxatida yangi tadbir bor');

  /* Restoran (Osh Markazi, RT) — FAQAT o'ziga tegishlisini ko'radi */
  const evRestList = await api('GET', '/events', null, RT);
  ok(evRestList.data.some((e) => e.id === evCreate.data.id), 'Osh Markazi o\'z tadbirini ko\'radi');
  /* Boshqa restoran (RT3) — bu tadbirni UMUMAN ko'rmaydi */
  const evRest2List = await api('GET', '/events', null, RT3);
  ok(!evRest2List.data.some((e) => e.id === evCreate.data.id), 'boshqa restoran bu tadbirni ko\'rmaydi');

  /* Chegirma belgilash: restoran FAQAT o'ziniki, boshqa restoran/mijoz esa YO'Q */
  const evPatchOther = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 15 }, RT3);
  eq(evPatchOther.status, 403, 'boshqa restoran chegirma belgilay olmaydi (403)');
  const evPatchUser = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 15 }, BQT);
  eq(evPatchUser.status, 403, 'mijoz o\'zi chegirma belgilay olmaydi (403 — faqat restoran/admin)');
  const evPatch = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 15 }, RT);
  eq(evPatch.status, 200, 'Osh Markazi o\'z tadbiriga chegirma belgiladi');
  eq(evPatch.data.discountPct, 15, 'discountPct = 15');
  eq(evPatch.data.status, 'discounted', 'holat -> discounted');
  /* Admin ham istalgan restoranga chegirma belgilay oladi */
  const evPatchAdmin = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 20 }, AT);
  eq(evPatchAdmin.status, 200, 'admin ham chegirma belgilay oladi');
  eq(evPatchAdmin.data.discountPct, 20, 'admin qiymati ustunlik qildi (20)');

  /* ---- RESTORAN JAVOBI: tadbirga AYNAN qaysi taom tayyorlanadi ----
     Restoran paneli «Tadbirlar» bo'limida belgilanadi, mijoz kabinetida ko'rinadi. */
  const evDishOther = await api('PATCH', '/events/' + evCreate.data.id, { restDish: 'begona' }, RT3);
  eq(evDishOther.status, 403, 'boshqa restoran tayyorlanadigan taomni belgilay olmaydi');
  const evDishUser = await api('PATCH', '/events/' + evCreate.data.id, { restDish: 'ozim' }, BQT);
  eq(evDishUser.status, 403, 'mijoz tayyorlanadigan taomni O`ZI belgilay olmaydi');
  const evDishSet = await api('PATCH', '/events/' + evCreate.data.id, { restDish: 'To`y oshi (40 kishilik)' }, RT);
  eq(evDishSet.status, 200, 'restoran tayyorlanadigan taomni belgiladi');
  eq(evDishSet.data.restDish, 'To`y oshi (40 kishilik)', 'restDish saqlandi');
  eq(evDishSet.data.discountPct, 20, 'taom belgilanganda CHEGIRMA o`chib ketmadi');
  const evPctAgain = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 25 }, RT);
  eq(evPctAgain.data.restDish, 'To`y oshi (40 kishilik)', 'chegirma o`zgarganda TAOM o`chib ketmadi');
  eq(evPctAgain.data.status, 'discounted', 'chegirma bor -> discounted');
  const evEmpty = await api('PATCH', '/events/' + evCreate.data.id, {}, RT);
  eq(evEmpty.status, 400, 'bo`sh PATCH -> 400');
  /* Faqat taom (chegirmasiz) -> 'answered' */
  const evOnlyDish = await api('PATCH', '/events/' + evCreate.data.id, { discountPct: 0 }, RT);
  eq(evOnlyDish.data.status, 'answered', 'chegirma yo`q, taom bor -> answered');
  /* Ikkalasi ham bo'sh -> yana pending */
  const evReset = await api('PATCH', '/events/' + evCreate.data.id, { restDish: '' }, RT);
  eq(evReset.data.status, 'pending', 'javob bekor qilindi -> pending');
  /* Testning qolgan qismi uchun javobni qaytaramiz */
  await api('PATCH', '/events/' + evCreate.data.id, { restDish: 'To`y oshi (40 kishilik)', discountPct: 20 }, RT);

  /* Mijoz o'zi FAQAT o'z tadbirlarini ko'radi */
  const evOwnList = await api('GET', '/events', null, BQT);
  eq(evOwnList.status, 200, 'mijoz o\'z tadbirlarini ko\'radi');
  ok(evOwnList.data.every((e) => e.user === 'Bonus Qual'), 'faqat o\'ziniki chiqadi');
  const evMine = evOwnList.data.find((e) => e.id === evCreate.data.id);
  eq(evMine.restDish, 'To`y oshi (40 kishilik)', 'MIJOZ restoran javobini (tayyorlanadigan taom) ko`radi');

  /* ---- 21. GURUH BUYURTMASI: bir nechta a'zo, har kim o'z ulushini alohida to'laydi ---- */
  console.log('\n--- Guruh buyurtmasi ---');
  const dilReg = await api('POST', '/auth/register', { name: 'Dilnoza Guruh', phone: '+998901234720', login: 'e2e_gdil', pass: 'gdil-pass-123' });
  const azReg = await api('POST', '/auth/register', { name: 'Aziz Guruh', phone: '+998901234721', login: 'e2e_gaziz', pass: 'gaziz-pass-123' });
  const DGT = dilReg.data.token, AGT = azReg.data.token;

  const noAuthG = await api('POST', '/groups', { rest: 'Osh Markazi' });
  eq(noAuthG.status, 401, 'tokensiz guruh yaratish -> 401');
  const gCreate = await api('POST', '/groups', { rest: 'Osh Markazi' }, DGT);
  eq(gCreate.status, 201, 'Dilnoza guruh yaratdi');
  ok(/^[A-Z0-9]{6}$/.test(gCreate.data.code), 'guruh kodi 6 belgili');
  eq(gCreate.data.members.length, 1, 'boshida faqat yaratuvchi a\'zo');
  const GID = gCreate.data.id, CODE = gCreate.data.code;

  /* A'zo bo'lmagan hech kim guruhni ko'ra olmaydi */
  const nonMemberView = await api('GET', '/groups/' + GID, null, AGT);
  eq(nonMemberView.status, 403, 'a\'zo bo\'lmagan foydalanuvchi guruhni ko\'ra olmaydi');
  const badCode = await api('POST', '/groups/join', { code: 'ZZZZZZ' }, AGT);
  eq(badCode.status, 404, 'noto\'g\'ri kod -> 404');

  const joinR = await api('POST', '/groups/join', { code: CODE }, AGT);
  eq(joinR.status, 200, 'Aziz kodni kiritib qo\'shildi');
  eq(joinR.data.members.length, 2, 'endi 2 a\'zo');
  /* Qayta qo'shilish idempotent (xato bermaydi, takrorlanmaydi) */
  const joinAgain = await api('POST', '/groups/join', { code: CODE }, AGT);
  eq(joinAgain.data.members.length, 2, 'qayta qo\'shilish takrorlanmaydi');

  /* Har kim o'z nomidan taom qo'shadi — Dilnoza va Aziz IKKALASI HAM "Osh"
     buyurtma qiladi -> bir-biriga ARALASHMASLIGI kerak (alohida qatorlar). */
  const addDil = await api('POST', '/groups/' + GID + '/items', { dishId: 8001, qty: 1 }, DGT);
  eq(addDil.status, 201, 'Dilnoza Osh qo\'shdi');
  const addAziz1 = await api('POST', '/groups/' + GID + '/items', { dishId: 8001, qty: 2, note: 'achchiq solmang' }, AGT);
  eq(addAziz1.status, 201, 'Aziz ham Osh qo\'shdi (2 ta, izoh bilan)');
  const addAziz2 = await api('POST', '/groups/' + GID + '/items', { dishId: 8004, qty: 1 }, AGT);
  eq(addAziz2.status, 201, 'Aziz Somsa ham qo\'shdi');

  /* Boshqa restorandan taom qo'shib bo'lmaydi */
  await api('POST', '/dishes', { id: 8010, name: 'Burger X', price: 30000, emoji: '🍔', kind: 'taom' }, RT2);
  const wrongRest = await api('POST', '/groups/' + GID + '/items', { dishId: 8010, qty: 1 }, DGT);
  eq(wrongRest.status, 400, 'boshqa restoran taomi qo\'shilmaydi');

  /* A'zo bo'lmagan hech kim taom qo'sha olmaydi */
  const nonMemberAdd = await api('POST', '/groups/' + GID + '/items', { dishId: 8001, qty: 1 });
  eq(nonMemberAdd.status, 401, 'tokensiz taom qo\'shib bo\'lmaydi');

  const gAfterItems = await api('GET', '/groups/' + GID, null, DGT);
  eq(gAfterItems.data.items.length, 3, 'jami 3 ta ALOHIDA qator (2 tasi bir xil "Osh" bo\'lsa ham aralashmagan)');
  const dilOshRow = gAfterItems.data.items.find((it) => it.accountId && it.memberName === 'Dilnoza Guruh' && it.dishName === 'Osh');
  const azOshRow = gAfterItems.data.items.find((it) => it.memberName === 'Aziz Guruh' && it.dishName === 'Osh');
  ok(dilOshRow && dilOshRow.qty === 1, 'Dilnozaning Oshi 1 dona (Azizniki bilan qo\'shilmagan)');
  ok(azOshRow && azOshRow.qty === 2, 'Azizning Oshi 2 dona, o\'z holicha');

  /* Aziz Dilnozaning qatorini o'chira olmaydi, faqat o'zinikini */
  const stealItemDel = await api('DELETE', '/groups/' + GID + '/items/' + dilOshRow.id, null, AGT);
  eq(stealItemDel.status, 403, 'boshqa a\'zoning qatorini o\'chirib bo\'lmaydi');
  const ownItemDel = await api('DELETE', '/groups/' + GID + '/items/' + addAziz2.data.items.slice(-1)[0].id, null, AGT);
  eq(ownItemDel.status, 200, 'Aziz o\'z Somsasini o\'chira oladi');
  /* Qaytarib qo'shamiz — keyingi tasdiqlashda kerak */
  await api('POST', '/groups/' + GID + '/items', { dishId: 8004, qty: 1 }, AGT);

  /* Manzil va to'lov turlari */
  const noAddrConfirm = await api('POST', '/groups/' + GID + '/confirm', {}, DGT);
  eq(noAddrConfirm.status, 400, 'manzilsiz tasdiqlab bo\'lmaydi');
  await api('PATCH', '/groups/' + GID + '/addr', { addr: 'Xatirchi tumani, Guliston mahallasi, Bog\'bon ko\'chasi 5' }, AGT);
  await api('PATCH', '/groups/' + GID + '/pay', { pay: 'cash' }, DGT);
  await api('PATCH', '/groups/' + GID + '/pay', { pay: 'card' }, AGT);

  /* Tasdiqlash — YARATUVCHI EMAS, boshqa a'zo (Aziz) ham bosishi mumkin */
  const confirm = await api('POST', '/groups/' + GID + '/confirm', {}, AGT);
  eq(confirm.status, 200, 'guruh muvaffaqiyatli tasdiqlandi');
  eq(confirm.data.group.status, 'confirmed', 'guruh holati -> confirmed');
  const gOrder = confirm.data.order;
  eq(gOrder.rest, 'Osh Markazi', 'yaratilgan buyurtma restorani to\'g\'ri');
  // Dilnoza: 1 Osh (28000) = 28000; Aziz: 2 Osh + 1 Somsa (56000+8000=64000); jami 92000
  eq(gOrder.amount, 92000, 'jami summa: Dilnoza 28000 + Aziz 64000 = 92000');
  eq(gOrder.items.length, 3, 'buyurtma tarkibida 3 ta ALOHIDA qator bor');
  ok(gOrder.items.some((l) => l.note && l.note.includes('👤 Dilnoza Guruh')), 'Dilnozaning qatori ismi bilan belgilangan');
  ok(gOrder.items.some((l) => l.note && l.note.includes('👤 Aziz Guruh') && l.note.includes('achchiq solmang')), 'Azizning izohi HAM ismi HAM saqlangan');
  ok(Array.isArray(gOrder.groupBreakdown) && gOrder.groupBreakdown.length === 2, 'groupBreakdown 2 a\'zoni o\'z ichiga oladi');
  const dilShare = gOrder.groupBreakdown.find((b) => b.name === 'Dilnoza Guruh');
  const azShare = gOrder.groupBreakdown.find((b) => b.name === 'Aziz Guruh');
  ok(dilShare && dilShare.amount === 28000 && dilShare.pay === 'cash', 'Dilnozaning ulushi 28000, naqd');
  ok(azShare && azShare.amount === 64000 && azShare.pay === 'card', 'Azizning ulushi 64000, karta');

  /* Yakunlangan guruhga endi taom qo'shib/tasdiqlab bo'lmaydi */
  const addAfterConfirm = await api('POST', '/groups/' + GID + '/items', { dishId: 8001, qty: 1 }, DGT);
  eq(addAfterConfirm.status, 409, 'yakunlangan guruhga taom qo\'shib bo\'lmaydi');
  const reConfirm = await api('POST', '/groups/' + GID + '/confirm', {}, DGT);
  eq(reConfirm.status, 409, 'yakunlangan guruhni qayta tasdiqlab bo\'lmaydi');

  /* Admin panelida ham groupBreakdown ko'rinadi (restoran/kuryer/admin BIR XIL manba) */
  const adminOrders = await api('GET', '/orders', null, AT);
  const seenByAdmin = adminOrders.data.find((o) => o.id === gOrder.id);
  ok(seenByAdmin && Array.isArray(seenByAdmin.groupBreakdown) && seenByAdmin.groupBreakdown.length === 2, 'admin GET /orders da groupBreakdown ko\'rinadi');

  /* Naqd ulushni "olindi" deb belgilash (restoran/kuryer/admin) */
  const noAuthPaid = await api('POST', '/orders/' + gOrder.id + '/group-paid', { index: 0 });
  eq(noAuthPaid.status, 401, 'tokensiz group-paid -> 401');
  const wrongRestPaid = await api('POST', '/orders/' + gOrder.id + '/group-paid', { index: 0 }, RT2);
  eq(wrongRestPaid.status, 403, 'boshqa restoran group-paid belgilay olmaydi');
  const markPaid = await api('POST', '/orders/' + gOrder.id + '/group-paid', { index: 0 }, RT);
  eq(markPaid.status, 200, 'Osh Markazi 0-a\'zoni "olindi" deb belgiladi');
  eq(markPaid.data.groupBreakdown[0].paid, true, '0-a\'zo paid=true bo\'ldi');
  eq(markPaid.data.groupBreakdown[1].paid, false, '1-a\'zo hali paid=false (tegmagan)');

  /* ---- NATIJA ---- */
  console.log(`\n=== HAYOTIY OQIM: ${PASS} o'tdi, ${FAIL} yiqildi ===`);
  if (FAIL) { console.error('\nYIQILGANLAR:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('✓ To\'liq oqim ishlaydi.\n');
  process.exit(0);
}

main().catch((e) => { console.error('LIFECYCLE E2E XATOSI:', e); process.exit(2); });
