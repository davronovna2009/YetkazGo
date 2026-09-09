/* ===== Yetkaz.uz — MOLIYA / HISOB-KITOB E2E TEST =====
   Maqsad: server moliya modeli TO'G'RI, va HAR BIR PANEL (admin / restoran /
   kuryer / kabinet) AYNAN bir xil raqamни ko'rsatadi — 1 so'm ham farq yo'q.

   Test o'zi server ishga tushirmaydi — CI/lokal `node e2e-money.mjs` dan oldin
   server 5099-portда, toza bazада turishi kerak (run-e2e.sh buni qiladi). */

const BASE = process.env.E2E_BASE || 'http://localhost:5099/api';
let PASS = 0, FAIL = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { PASS++; }
  else { FAIL++; fails.push(msg); console.error('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, `${msg} — kutildi ${b}, keldi ${a}`); }

async function api(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}

const money = (n) => Math.round(n);

/* =========================================================================
   PANEL FORMULALARI — har bir panel JS faylidan KO'CHIRILGAN (post-fix).
   Kirish: server /api/orders (rowToOrder) qaytargan buyurtmalar + entity ro'yxati.
   ========================================================================= */

/* --- ADMIN (assets/js/admin.js: commOf/feeOf/profitOf + renderIncome) --- */
const admin = {
  commOf: (o) => (o && o.commission != null) ? Number(o.commission) || 0 : 0,
  feeOf: (o) => (!o || o.status !== 'done') ? 0 : (o.courierFee != null ? Number(o.courierFee) || 0 : 0),
  profitOf: (o) => (o && o.siteProfit != null) ? Number(o.siteProfit) || 0 : 0,
  totals(orders) {
    const done = orders.filter((o) => o.status === 'done');
    const gmv = done.reduce((s, o) => s + (o.amount || 0), 0);
    const comm = done.reduce((s, o) => s + this.commOf(o), 0);
    const fee = done.reduce((s, o) => s + this.feeOf(o), 0);
    return { gmv, comm, fee, toRest: gmv - comm, profit: comm - fee, count: done.length };
  },
};

/* --- RESTORAN (assets/js/restoran.js: netOf + renderIncome) --- */
const restoran = {
  netOf: (o) => (o && o.restNet != null) ? Number(o.restNet) || 0 : 0,
  commOf: (o) => (o && o.commission != null) ? Number(o.commission) || 0 : 0,
  totalsFor(orders, restName) {
    const done = orders.filter((o) => o.rest === restName && o.status === 'done');
    const gross = done.reduce((s, o) => s + (o.amount || 0), 0);
    const net = done.reduce((s, o) => s + this.netOf(o), 0);
    const commission = done.reduce((s, o) => s + this.commOf(o), 0);
    return { gross, net, commission, count: done.length };
  },
};

/* --- KURYER (assets/js/kuryer.js: feeOf + renderIncome) --- */
const kuryer = {
  feeOf: (o, curFee) => (o && o.courierFee != null) ? Number(o.courierFee) || 0 : curFee,
  totalsFor(orders, courierName, curFee) {
    const done = orders.filter((o) => o.courier === courierName && o.status === 'done');
    const earn = done.reduce((s, o) => s + this.feeOf(o, curFee), 0);
    return { earn, count: done.length };
  },
};

/* --- KABINET (assets/js/kabinet.js: renderProfil, POST-FIX = done only) --- */
const kabinet = {
  spentFor(orders, userName) {
    return orders
      .filter((o) => o.user === userName && o.status === 'done')
      .reduce((s, o) => s + (o.amount || 0), 0);
  },
};

/* --- RESTORAN dish jadvali (assets/js/restoran.js: salesMap + allocNet + dishTable) --- */
function salesMap(orders) {
  const m = {};
  (orders || []).forEach((o) => {
    const ls = Array.isArray(o.items) ? o.items : [];
    if (ls.length) {
      ls.forEach((l) => {
        const k = String(l.name || '').trim(); if (!k) return;
        if (!m[k]) m[k] = { name: k, qty: 0, gross: 0, orders: 0 };
        const q = Number(l.qty) || 0;
        m[k].qty += q;
        m[k].gross += Number(l.sum) || ((Number(l.eff) || Number(l.price) || 0) * (q || 1));
        m[k].orders++;
      });
    }
  });
  return m;
}
function allocNet(items, totalGross, totalNet) {
  const out = {};
  if (!items.length) return out;
  if (!totalGross) { items.forEach((it) => { out[it.key] = 0; }); return out; }
  let acc = 0; const fr = [];
  items.forEach((it) => {
    const exact = it.gross * totalNet / totalGross;
    const fl = Math.floor(exact);
    out[it.key] = fl; acc += fl;
    fr.push({ key: it.key, f: exact - fl });
  });
  const left = Math.round(totalNet - acc);
  fr.sort((a, b) => b.f - a.f);
  for (let i = 0; i < fr.length && i < left; i++) out[fr[i].key] += 1;
  if (left > fr.length && fr.length) out[fr[0].key] += (left - fr.length);
  return out;
}
const restoranDish = {
  netOf: (o) => (o && o.restNet != null) ? Number(o.restNet) || 0 : 0,
  dishTable(doneOrders, dishNames) {
    const sales = salesMap(doneOrders);
    const totGross = doneOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const totNet = doneOrders.reduce((s, o) => s + this.netOf(o), 0);
    const keepRate = totGross ? (totNet / totGross) : 0;
    const shownGross = dishNames.reduce((s, n) => s + ((sales[n] && sales[n].gross) || 0), 0);
    const shownNet = Math.round(shownGross * keepRate);
    const items = dishNames.map((n) => ({ key: n, gross: (sales[n] && sales[n].gross) || 0 }));
    const alloc = allocNet(items, shownGross, shownNet);
    const out = { __totals: { gross: totGross, net: totNet, shownGross, shownNet } };
    dishNames.forEach((n) => { out[n] = { qty: sales[n] ? sales[n].qty : 0, gross: sales[n] ? sales[n].gross : 0, net: alloc[n] || 0 }; });
    return out;
  },
};

/* --- ADMIN kart helperlari (assets/js/admin.js: restFinance / courierFinance) --- */
const adminHelpers = {
  restFinance(name, comm, orders) {
    const done = orders.filter((o) => o.rest === name && o.status === 'done');
    const rev = done.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const fb = comm != null ? comm : 18;
    const siteCut = done.reduce((s, o) => s + (o.commission != null ? Number(o.commission) || 0 : Math.round((Number(o.amount) || 0) * fb / 100)), 0);
    return { rev, orders: done.length, siteCut, restGets: rev - siteCut };
  },
  courierFinance(name, fee, orders) {
    const done = orders.filter((o) => o.courier === name && o.status === 'done');
    const earn = done.reduce((s, o) => s + (o.courierFee != null ? Number(o.courierFee) || 0 : (Number(fee) || 0)), 0);
    return { deliveries: done.length, earn };
  },
};

/* ========================================================================= */

async function main() {
  console.log('\n=== Yetkaz.uz moliya E2E ===\n');

  /* 1) Admin login */
  const adminLogin = await api('POST', '/auth/login', { login: 'admin', pass: process.env.E2E_ADMIN_PASS || 'e2e-admin-pass' });
  eq(adminLogin.status, 200, 'admin login status');
  const AT = adminLogin.data.token;
  ok(!!AT, 'admin token bor');

  /* 2) Restoran yarat (komissiya 20%, 24 soat ochiq) */
  const rc = await api('POST', '/restaurants', {
    name: 'E2E Milliy Taomlar', login: 'e2e_rest', pass: 'rest-pass-123',
    commission: 20, openH: 0, closeH: 24, phone: '+998901112233',
  }, AT);
  eq(rc.status, 201, 'restoran yaratildi');
  eq(rc.data.commission, 20, 'restoran komissiyasi 20%');

  /* 3) Kuryer yarat (haq 12000, 24 soat) */
  const cc = await api('POST', '/couriers', {
    name: 'E2E Kuryer Aziz', login: 'e2e_cour', pass: 'cour-pass-123',
    fee: 12000, openH: 0, closeH: 24, phone: '+998907776655',
  }, AT);
  eq(cc.status, 201, 'kuryer yaratildi');
  eq(cc.data.fee, 12000, 'kuryer haqi 12000');

  /* 4) Restoran login + 2 ta taom */
  const rLogin = await api('POST', '/auth/login', { login: 'e2e_rest', pass: 'rest-pass-123' });
  eq(rLogin.status, 200, 'restoran login');
  const RT = rLogin.data.token;
  eq(rLogin.data.account.commission, 20, 'restoran sessiyasida komissiya 20%');

  const d1 = await api('POST', '/dishes', { id: 900001, name: 'Osh', price: 30000, emoji: '🍚', kind: 'taom' }, RT);
  const d2 = await api('POST', '/dishes', { id: 900002, name: 'Somsa', price: 12000, emoji: '🥟', kind: 'taom' }, RT);
  eq(d1.status, 201, 'taom 1 (Osh 30000)');
  eq(d2.status, 201, 'taom 2 (Somsa 12000)');

  /* 5) Kuryer login (fee sessiyada) */
  const kLogin = await api('POST', '/auth/login', { login: 'e2e_cour', pass: 'cour-pass-123' });
  const KT = kLogin.data.token;
  eq(kLogin.data.account.fee, 12000, 'kuryer sessiyasida fee 12000');

  /* 6) 3 ta buyurtma (turli mijoz, turli to'lov) — komissiya 20% davrida
        Buyurtma A: 2 Osh + 1 Somsa = 72000, karta
        Buyurtma B: 3 Somsa           = 36000, naqd
        Buyurtma C: 1 Osh + 2 Somsa   = 54000, karta                       */
  const orderSpecs = [
    { user: 'Dilnoza', phone: '+998901234501', pay: 'card', items: [{ id: 900001, qty: 2 }, { id: 900002, qty: 1 }], expect: 72000 },
    { user: 'Bekzod', phone: '+998901234502', pay: 'cash', items: [{ id: 900002, qty: 3 }], expect: 36000 },
    { user: 'Dilnoza', phone: '+998901234501', pay: 'card', items: [{ id: 900001, qty: 1 }, { id: 900002, qty: 2 }], expect: 54000 },
  ];

  const placed = [];
  for (const spec of orderSpecs) {
    const r = await api('POST', '/orders', {
      user: spec.user, phone: spec.phone, pay: spec.pay,
      items: spec.items, addr: 'Test ko\'cha 1', amount: 999, // amount ataylab noto'g'ri — server e'tibormasin
    });
    eq(r.status, 201, `buyurtma (${spec.user}) yaratildi`);
    eq(r.data.amount, spec.expect, `buyurtma summasi server hisobi (${spec.user})`);
    eq(r.data.commissionPct, 20, `buyurtma komissiya foizi muhrlandi 20% (${spec.user})`);
    eq(r.data.commission, money(spec.expect * 20 / 100), `buyurtma komissiyasi (${spec.user})`);
    eq(r.data.restNet, spec.expect - money(spec.expect * 20 / 100), `restoran ulushi (${spec.user})`);
    eq(r.data.courierFee, 0, `yo'ldagi buyurtmada kuryer haqi 0 (${spec.user})`);
    placed.push({ ...r.data, token: r.data.token, pay: spec.pay });
  }

  /* 7) Komissiyani 25% ga o'zgartiramiz — ESKI buyurtmalar 20% da qolishi shart */
  const patchComm = await api('PATCH', '/restaurants', { login: 'e2e_rest', commission: 25 }, AT);
  eq(patchComm.status, 200, 'komissiya 25% ga o\'zgartirildi');
  eq(patchComm.data.commission, 25, 'yangi komissiya 25%');

  /* 8) 4-buyurtma — endi 25% */
  const r4 = await api('POST', '/orders', {
    user: 'Sardor', phone: '+998901234503', pay: 'cash',
    items: [{ id: 900001, qty: 2 }], addr: 'Test ko\'cha 2',
  });
  eq(r4.status, 201, '4-buyurtma yaratildi (25% davri)');
  eq(r4.data.amount, 60000, '4-buyurtma summasi 60000');
  eq(r4.data.commissionPct, 25, '4-buyurtma komissiyasi 25% muhrlandi');
  eq(r4.data.commission, 15000, '4-buyurtma komissiyasi 15000');
  placed.push({ ...r4.data, token: r4.data.token, pay: 'cash' });

  /* 9) Hamma buyurtmani DONE ga olib boramiz (kuryer PATCH orqali).
        4-buyurtmani DONE qilmaymiz — u "yo'lda" qoladi (moliyaga kirmasin).   */
  const toFinish = placed.slice(0, 3);
  for (const o of toFinish) {
    for (const st of ['accepted', 'ready', 'ontheway', 'arrived', 'done']) {
      const up = await api('PATCH', '/orders/' + o.id, { status: st, token: o.token }, KT);
      eq(up.status, 200, `buyurtma ${o.id} -> ${st}`);
    }
  }
  /* 4-buyurtma faqat "ontheway" gacha */
  const o4 = placed[3];
  for (const st of ['accepted', 'ready', 'ontheway']) {
    await api('PATCH', '/orders/' + o4.id, { status: st, token: o4.token }, KT);
  }

  /* 10) Kuryer haqini o'zgartiramiz (12000 -> 15000). DONE bo'lgan buyurtmalar
         12000 da MUHRLANGAN bo'lishi kerak. */
  const patchFee = await api('PATCH', '/couriers', { login: 'e2e_cour', fee: 15000 }, AT);
  eq(patchFee.status, 200, 'kuryer haqi 15000 ga o\'zgartirildi');

  /* ============ TEKSHIRUV: server javoblari ============ */
  const adminOrders = (await api('GET', '/orders', null, AT)).data;
  ok(Array.isArray(adminOrders) && adminOrders.length === 4, `admin 4 ta buyurtma ko'radi (keldi ${adminOrders.length})`);

  const done = adminOrders.filter((o) => o.status === 'done');
  eq(done.length, 3, 'yetkazilgan buyurtmalar soni 3');

  /* Har bir done buyurtma: courierFee 12000 muhrlangan, siteProfit = comm - 12000 */
  for (const o of done) {
    eq(o.courierFee, 12000, `done #${o.id} kuryer haqi muhrlangan 12000`);
    eq(o.siteProfit, o.commission - 12000, `done #${o.id} sof foyda = komissiya - haq`);
    eq(o.restNet + o.commission, o.amount, `done #${o.id} restNet + komissiya = summa`);
  }
  /* Eski 3 done buyurtma 20% da qolgan */
  for (const o of done) eq(o.commissionPct, 20, `done #${o.id} hali ham 20% komissiya (o'zgarmadi)`);

  /* 4-buyurtma (ontheway): kuryer haqi hali 0 (yetkazilmagan) */
  const o4live = adminOrders.find((o) => o.id === o4.id);
  eq(o4live.status, 'ontheway', '4-buyurtma yo\'lda');
  eq(o4live.courierFee, 0, 'yo\'ldagi buyurtmada kuryer haqi 0 (xarajat emas)');
  eq(o4live.commissionPct, 25, '4-buyurtma 25% komissiya');

  /* ============ TEKSHIRUV: PANELLAR BIR-BIRIGA MOS ============ */
  console.log('\n--- Panellararo moslik ---');

  // Kutilgan qiymatlar (qo'lда):
  // A: 72000, comm 14400, net 57600 ; B: 36000, comm 7200, net 28800 ; C: 54000, comm 10800, net 43200
  const expComm = 14400 + 7200 + 10800;   // 32400
  const expNet = 57600 + 28800 + 43200;   // 129600
  const expGmv = 72000 + 36000 + 54000;   // 162000
  const expFee = 12000 * 3;               // 36000
  const expProfit = expComm - expFee;     // -3600  (test uchun ataylab manfiy — belgisi to'g'ri chiqsin)

  const A = admin.totals(adminOrders);
  eq(A.gmv, expGmv, 'ADMIN: aylanma (GMV)');
  eq(A.comm, expComm, 'ADMIN: komissiya daromadi');
  eq(A.fee, expFee, 'ADMIN: kuryer xarajati');
  eq(A.toRest, expNet, 'ADMIN: restoranlarga o\'tkaziladi');
  eq(A.profit, expProfit, 'ADMIN: sof foyda');

  const R = restoran.totalsFor(adminOrders, 'E2E Milliy Taomlar');
  eq(R.gross, expGmv, 'RESTORAN: aylanma');
  eq(R.net, expNet, 'RESTORAN: sof daromad');
  eq(R.commission, expComm, 'RESTORAN: sayt komissiyasi');
  eq(R.net + R.commission, R.gross, 'RESTORAN: net + komissiya = aylanma (1 so\'m farq yo\'q)');

  const K = kuryer.totalsFor(adminOrders, 'E2E Kuryer Aziz', 15000 /* joriy fee */);
  eq(K.earn, expFee, 'KURYER: daromad (muhrlangan 12000 x 3, joriy 15000 ta\'sir qilmaydi)');

  /* Restoran paneli o'z API si orqali ko'rgan buyurtmalar bilan ham bir xil */
  const restOrders = (await api('GET', '/orders', null, RT)).data;
  const R2 = restoran.totalsFor(restOrders, 'E2E Milliy Taomlar');
  eq(R2.net, expNet, 'RESTORAN (o\'z API): sof daromad admin bilan bir xil');
  eq(R2.commission, expComm, 'RESTORAN (o\'z API): komissiya admin bilan bir xil');

  /* Kuryer paneli o'z API si orqali */
  const courOrders = (await api('GET', '/orders', null, KT)).data;
  const K2 = kuryer.totalsFor(courOrders, 'E2E Kuryer Aziz', 15000);
  eq(K2.earn, expFee, 'KURYER (o\'z API): daromad admin bilan bir xil');

  /* /api/couriers.earned (server hisobi) = panel hisobi */
  const couriersList = (await api('GET', '/couriers', null, AT)).data;
  const cRow = couriersList.find((c) => c.name === 'E2E Kuryer Aziz');
  eq(cRow.earned, expFee, '/api/couriers.earned = kuryer paneli daromadi');
  eq(cRow.deliveries, 3, '/api/couriers.deliveries = 3');

  /* /api/admin/restaurants — komissiya bilan; panel hisobi bilan tekshirdik */
  const adminRests = (await api('GET', '/admin/restaurants', null, AT)).data;
  const arRow = adminRests.find((r) => r.name === 'E2E Milliy Taomlar');
  eq(arRow.commission, 25, '/api/admin/restaurants: joriy komissiya 25% (lekin eski buyurtmalar 20%)');

  /* ============ ZANJIR INVARIANTI ============ */
  eq(A.toRest + A.comm, A.gmv, 'INVARIANT: restoranga + komissiya = aylanma');
  eq(A.profit + A.fee, A.comm, 'INVARIANT: sof foyda + kuryer haqi = komissiya');
  eq(R.net, A.toRest, 'INVARIANT: restoran ko\'rgan net = admin ko\'rgan "restoranga"');
  eq(K.earn, A.fee, 'INVARIANT: kuryer ko\'rgan daromad = admin ko\'rgan xarajat');

  /* ============ KABINET: "Jami sarflagan" (POST-FIX = done only) ============ */
  console.log('\n--- Kabinet "Jami sarflagan" ---');
  /* Dilnoza: A (72000, done) + C (54000, done) = 126000. Boshqa statusdagi yo'q. */
  const dilnoza = kabinet.spentFor(adminOrders, 'Dilnoza');
  eq(dilnoza, 126000, 'KABINET: Dilnoza jami sarflagan (faqat done)');
  /* Sardor: 4-buyurtma ONTHEWAY — "sarflagan" ga KIRMASLIGI kerak */
  const sardor = kabinet.spentFor(adminOrders, 'Sardor');
  eq(sardor, 0, 'KABINET: Sardor sarflagan 0 (buyurtma yo\'lda, hali sarflamagan)');

  /* Bekzod buyurtmasini bekor qilib ko'ramiz-chi? U allaqachon done. Yangi
     mijoz + bekor qilingan buyurtma bilan tekshiramiz. */
  const rCancel = await api('POST', '/orders', {
    user: 'Kamola', phone: '+998901234504', pay: 'card',
    items: [{ id: 900001, qty: 1 }], addr: 'Test 3',
  });
  await api('POST', '/orders/' + rCancel.data.id + '/cancel', { token: rCancel.data.token });
  const afterCancel = (await api('GET', '/orders', null, AT)).data;
  const kamola = kabinet.spentFor(afterCancel, 'Kamola');
  eq(kamola, 0, 'KABINET: Kamola sarflagan 0 (buyurtma bekor qilingan)');
  /* Admin moliya bekor qilingan buyurtmadan ta'sirlanmaydi */
  const A2 = admin.totals(afterCancel);
  eq(A2.gmv, expGmv, 'ADMIN: bekor qilingan buyurtma aylanmaga qo\'shilmadi');
  eq(A2.comm, expComm, 'ADMIN: bekor qilingan buyurtma komissiyaga qo\'shilmadi');

  /* ============ PART D: RESTORAN "Taomlar" jadvali — 1 so'mgacha ============ */
  console.log('\n--- Restoran taom jadvali (allocNet) ---');
  const rDone = adminOrders.filter((o) => o.rest === 'E2E Milliy Taomlar' && o.status === 'done');
  const dishNames = ['Osh', 'Somsa'];
  const dt = restoranDish.dishTable(rDone, dishNames);
  const dishNetSum = dishNames.reduce((s, n) => s + dt[n].net, 0);
  eq(dt.__totals.net, expNet, 'RESTORAN: jadval umumiy sof daromadi = 129600');
  eq(dishNetSum, dt.__totals.shownNet, 'RESTORAN: taomlar "sizga qoladi" YIG\'INDISI = ko\'rsatilgan sof (1 so\'m farq yo\'q)');
  eq(dt.__totals.shownNet, expNet, 'RESTORAN: o\'chirilgan taom yo\'q — shownNet = umumiy net');
  eq(dishNetSum, expNet, 'RESTORAN: taom jadvali yig\'indisi = "Sizning daromadingiz" (1 so\'m farq yo\'q)');
  /* Har taom qty > 0 va gross yig'indisi = aylanma */
  const dishGrossSum = dishNames.reduce((s, n) => s + dt[n].gross, 0);
  eq(dishGrossSum, expGmv, 'RESTORAN: taomlar tushumi yig\'indisi = aylanma');
  // Osh: A(2*30000=60000) + C(1*30000=30000) = 90000 ; Somsa: A(12000)+B(36000)+C(24000)=72000
  eq(dt['Osh'].gross, 90000, 'RESTORAN: Osh tushumi 90000');
  eq(dt['Somsa'].gross, 72000, 'RESTORAN: Somsa tushumi 72000');
  eq(dt['Osh'].qty, 3, 'RESTORAN: Osh 3 dona sotildi');
  eq(dt['Somsa'].qty, 6, 'RESTORAN: Somsa 6 dona sotildi');

  /* ============ PART E: ADMIN kart helperlari = Daromad bo'limi ============ */
  console.log('\n--- Admin restoran/kuryer kartasi ---');
  const rf = adminHelpers.restFinance('E2E Milliy Taomlar', 25 /* joriy foiz */, adminOrders);
  eq(rf.rev, expGmv, 'ADMIN kart: restoran aylanmasi');
  eq(rf.siteCut, expComm, 'ADMIN kart: restoran komissiyasi (eski buyurtmalar 20% — joriy 25% EMAS)');
  eq(rf.restGets, expNet, 'ADMIN kart: restoranga o\'tdi');
  eq(rf.siteCut, R.commission, 'ADMIN kart komissiyasi = RESTORAN paneli komissiyasi');
  eq(rf.restGets, R.net, 'ADMIN kart "restoranga" = RESTORAN paneli "Sizning daromadingiz"');

  const cf = adminHelpers.courierFinance('E2E Kuryer Aziz', 15000 /* joriy haq */, adminOrders);
  eq(cf.earn, expFee, 'ADMIN kart: kuryer daromadi (muhrlangan 12000 x 3)');
  eq(cf.deliveries, 3, 'ADMIN kart: kuryer 3 yetkazma');
  eq(cf.earn, K.earn, 'ADMIN kart kuryer daromadi = KURYER paneli daromadi');
  eq(cf.earn, cRow.earned, 'ADMIN kart kuryer daromadi = /api/couriers.earned');

  /* ============ PART F: ADMIN mehmon mijoz kartasi (telefon bo'yicha, done-only) ============ */
  console.log('\n--- Admin mehmon mijoz (telefon bo\'yicha) ---');
  const digs = (s) => String(s || '').replace(/\D/g, '');
  const guestSpent = (orders, phone) => orders
    .filter((o) => digs(o.phone) === digs(phone) && o.status === 'done')
    .reduce((s, o) => s + (o.amount || 0), 0);
  // Dilnoza (+998901234501): A(72000) + C(54000) done = 126000
  eq(guestSpent(afterCancel, '+998901234501'), 126000, 'ADMIN mehmon: Dilnoza (telefon) jami sarflagan = kabinet bilan bir xil');
  eq(guestSpent(afterCancel, '+998901234501'), kabinet.spentFor(afterCancel, 'Dilnoza'), 'ADMIN mehmon (telefon) = KABINET (ism) — bir xil summa');
  // Sardor (+998901234503): 4-buyurtma ontheway -> 0
  eq(guestSpent(afterCancel, '+998901234503'), 0, 'ADMIN mehmon: Sardor sarflagan 0 (yo\'lda)');
  // Kamola (+998901234504): bekor -> 0
  eq(guestSpent(afterCancel, '+998901234504'), 0, 'ADMIN mehmon: Kamola sarflagan 0 (bekor)');
  // /api/users guests ro'yxatida chiqadi
  const usersResp = (await api('GET', '/users', null, AT)).data;
  const guests = (usersResp && usersResp.guests) || [];
  ok(guests.some((g) => digs(g.phone) === '998901234501'), '/api/users: Dilnoza mehmonlar ro\'yxatida');

  /* ============ PART G: CHEGIRMA — butun zanjir ============ */
  console.log('\n--- Chegirma (discount) ---');
  /* Restoran Somsa'ga 25% chegirma qo'yadi (narx 12000 -> eff 9000) */
  const disc = await api('POST', '/discounts', { name: 'Somsa', pct: 25 }, RT);
  eq(disc.status, 200, 'chegirma o\'rnatildi (25% Somsa)');

  /* Ommaviy /api/overrides chegirmани ko'rsatadi */
  const ovr = (await api('GET', '/overrides', null)).data;
  eq((ovr.discounts || {})['E2E Milliy Taomlar|Somsa'], 25, '/api/overrides: Somsa 25% chegirma');

  /* Yangi buyurtma: 4 Somsa. Chegirmasiz 48000, chegirма bilan 4*9000 = 36000 */
  const rd = await api('POST', '/orders', {
    user: 'Gul', phone: '+998901234511', pay: 'card',
    items: [{ id: 900002, qty: 4 }], addr: 'Chegirma ko\'cha',
  });
  eq(rd.status, 201, 'chegirmali buyurtma yaratildi');
  eq(rd.data.amount, 36000, 'CHEGIRMA: summa chegirmali narxda (4 × 9000 = 36000, 48000 EMAS)');
  const sline = (rd.data.items || []).find((l) => l.name === 'Somsa');
  ok(sline, 'chegirmali buyurtma tarkibida Somsa qatori bor');
  eq(sline.price, 12000, 'CHEGIRMA: qatorда asl narx 12000');
  eq(sline.pct, 25, 'CHEGIRMA: qatorда chegirma foizi 25%');
  eq(sline.eff, 9000, 'CHEGIRMA: qatorда chegirmali narx 9000');
  eq(sline.sum, 36000, 'CHEGIRMA: qator summasi 4 × 9000');
  eq(rd.data.commissionPct, 25, 'chegirmali buyurtma komissiya foizi (joriy 25%)');
  eq(rd.data.commission, 9000, 'CHEGIRMA: komissiya chegirmali summadan (36000 × 25%)');
  eq(rd.data.restNet, 27000, 'CHEGIRMA: restoran ulushi chegirmali summadan');

  /* done ga olib boramiz — restoran/admin statistikasi CHEGIRMALI summani ko'rsatishi kerak */
  for (const st of ['accepted', 'ready', 'ontheway', 'arrived', 'done']) {
    await api('PATCH', '/orders/' + rd.data.id, { status: st, token: rd.data.token }, KT);
  }
  const withDisc = (await api('GET', '/orders', null, AT)).data;
  const doneDisc = withDisc.filter((o) => o.status === 'done');
  const gmvD = doneDisc.reduce((s, o) => s + o.amount, 0);
  eq(gmvD, expGmv + 36000, 'CHEGIRMA: admin aylanmasiga chegirmali summa qo\'shildi (48000 EMAS)');
  const rt = restoranDish.dishTable(doneDisc.filter((o) => o.rest === 'E2E Milliy Taomlar'), ['Osh', 'Somsa'], { commission: 25 });
  // Somsa endi: oldingi 72000 + yangi 36000 = 108000
  eq(rt.Somsa.gross, 108000, 'CHEGIRMA: restoran "Somsa tushumi" chegirmali summa bilan (108000)');
  eq(rt.Somsa.qty, 10, 'CHEGIRMA: Somsa jami 10 dona (6 + 4)');

  /* Chegirmani olib tashlaymiz — keyingi buyurtма to'liq narxда */
  await api('POST', '/discounts', { name: 'Somsa', pct: 0 }, RT);
  const rd2 = await api('POST', '/orders', {
    user: 'Gul', phone: '+998901234511', pay: 'card',
    items: [{ id: 900002, qty: 2 }], addr: 'Chegirma ko\'cha',
  });
  eq(rd2.data.amount, 24000, 'CHEGIRMA olib tashlandi: 2 Somsa = 24000 (to\'liq narx)');
  await api('POST', '/orders/' + rd2.data.id + '/cancel', { token: rd2.data.token });

  /* ============ PART H: LOGIN / PAROL — FAQAT ADMIN ============ */
  console.log('\n--- Login/parol: faqat admin ---');

  /* Restoran O'ZI login/parol/NOMNI O'ZGARTIRA OLMAYDI (/auth/me e'tiborsiz qoldiradi;
     nom buyurtmalarга bog'langan — faqat admin o'zgartiradi). Telefon/email — mumkin. */
  const meTry = await api('PATCH', '/auth/me', { login: 'hacker_login', pass: 'hacked123', name: 'Soxta Nom', phone: '+998900000000' }, RT);
  eq(meTry.status, 200, '/auth/me: so\'rov qabul qilindi (telefon uchun)');
  eq(meTry.data.account.login, 'e2e_rest', '/auth/me: LOGIN o\'zgarmadi (restoran o\'zi o\'zgartira olmaydi)');
  eq(meTry.data.account.name, 'E2E Milliy Taomlar', '/auth/me: NOM o\'zgarmadi (buyurtmalarга bog\'langan — faqat admin)');
  eq(meTry.data.account.phone, '+998900000000', '/auth/me: telefon o\'zgardi (bunga ruxsat)');
  // eski parol hali ham ishlaydi (parol o'zgarmagan)
  const relog = await api('POST', '/auth/login', { login: 'e2e_rest', pass: 'rest-pass-123' });
  eq(relog.status, 200, '/auth/me dan keyin ESKI parol hali ishlaydi (parol o\'zgarmadi)');
  // "hacked123" bilan kira olmaydi
  const badlog = await api('POST', '/auth/login', { login: 'e2e_rest', pass: 'hacked123' });
  eq(badlog.status, 401, 'restoran qo\'ygan "yangi parol" ishlamaydi (e\'tiborsiz qoldirildi)');

  /* Kuryer ham xuddi shunday */
  const kMeTry = await api('PATCH', '/auth/me', { pass: 'kur-hack-123' }, KT);
  eq(kMeTry.status, 200, 'kuryer /auth/me so\'rovi');
  const kBad = await api('POST', '/auth/login', { login: 'e2e_cour', pass: 'kur-hack-123' });
  eq(kBad.status, 401, 'kuryer o\'zi qo\'ygan parol ishlamaydi');

  /* ADMIN restoran loginini VA parolini o'zgartiradi */
  const upd = await api('POST', '/accounts/update', { login: 'e2e_rest', newLogin: 'e2e_rest_new', pass: 'yangi-pass-456' }, AT);
  eq(upd.status, 200, 'admin: /accounts/update muvaffaqiyatli');
  eq(upd.data.login, 'e2e_rest_new', 'admin: login yangilandi');
  eq(upd.data.pass, 'yangi-pass-456', 'admin: yangi parol javobда bir marta qaytdi');
  // eski login endi ishlamaydi
  const oldLoginTry = await api('POST', '/auth/login', { login: 'e2e_rest', pass: 'rest-pass-123' });
  eq(oldLoginTry.status, 401, 'admin o\'zgartirgach ESKI login ishlamaydi');
  // yangi login + yangi parol ishlaydi
  const newLoginTry = await api('POST', '/auth/login', { login: 'e2e_rest_new', pass: 'yangi-pass-456' });
  eq(newLoginTry.status, 200, 'yangi login + yangi parol ishlaydi');
  eq(newLoginTry.data.account.role, 'restoran', 'yangi login bilan rol saqlanadi');
  // restaurants jadvalidagi login nusxasi ham yangilandi (admin ro'yxati orqali tekshiramiz)
  const adminRests2 = (await api('GET', '/admin/restaurants', null, AT)).data;
  ok(adminRests2.some((r) => r.login === 'e2e_rest_new'), '/admin/restaurants: login nusxasi ham yangilandi (ikki joyда bir xil)');
  // yangi login bilan restoran o'z buyurtmalarini ko'radi (name bo'yicha, buzilmadi)
  const RT2 = newLoginTry.data.token;
  const rOrders2 = (await api('GET', '/orders', null, RT2)).data;
  ok(Array.isArray(rOrders2) && rOrders2.length > 0, 'yangi login bilan restoran buyurtmalarini ko\'radi');

  /* Band login — rad etiladi */
  const dupLogin = await api('POST', '/accounts/update', { login: 'e2e_cour', newLogin: 'admin' }, AT);
  eq(dupLogin.status, 409, 'band login rad etildi (409)');

  /* Faqat parol (login o'zgarmasdan) */
  const passOnly = await api('POST', '/accounts/update', { login: 'e2e_cour', pass: 'kuryer-yangi-789' }, AT);
  eq(passOnly.status, 200, 'admin: faqat parol o\'zgartirish');
  eq(passOnly.data.login, 'e2e_cour', 'faqat parol — login o\'zgarmadi');
  const cLog = await api('POST', '/auth/login', { login: 'e2e_cour', pass: 'kuryer-yangi-789' });
  eq(cLog.status, 200, 'kuryer yangi parol (admin qo\'ygan) bilan kiradi');

  /* Non-admin /accounts/update ga kira olmaydi */
  const forbidden = await api('POST', '/accounts/update', { login: 'e2e_cour', pass: 'x' }, RT2);
  eq(forbidden.status, 403, 'restoran /accounts/update ga kira olmaydi (403)');

  /* MIJOZ o'z ismini o'zgartirsa — buyurtmalar tarixi YO'QOLMAYDI (orders.user sinxron) */
  const reg = await api('POST', '/auth/register', { name: 'Aziza Karimova', phone: '+998911112233', login: 'aziza_k', pass: 'aziza-pass' });
  eq(reg.status, 201, 'mijoz ro\'yxatdan o\'tdi');
  const UAT = reg.data.token;
  const uOrd = await api('POST', '/orders', { user: 'Aziza Karimova', phone: '+998911112233', pay: 'card', items: [{ id: 900001, qty: 1 }], addr: 'Mijoz ko\'cha' }, UAT);
  eq(uOrd.status, 201, 'mijoz buyurtma berdi');
  let uList = (await api('GET', '/orders', null, UAT)).data;
  eq(uList.length, 1, 'mijoz o\'z buyurtmasini ko\'radi');
  /* Ismni o'zgartiramiz */
  const uRename = await api('PATCH', '/auth/me', { name: 'Aziza Yusupova' }, UAT);
  eq(uRename.data.account.name, 'Aziza Yusupova', 'mijoz ismi o\'zgardi');
  /* Yangi token bilan (ism JWT da) — buyurtma HALI ko'rinadi */
  const UAT2 = (await api('POST', '/auth/login', { login: 'aziza_k', pass: 'aziza-pass' })).data.token;
  uList = (await api('GET', '/orders', null, UAT2)).data;
  eq(uList.length, 1, 'ism o\'zgargach ham mijoz buyurtmalar tarixini ko\'radi (orders.user sinxron)');
  await api('POST', '/orders/' + uOrd.data.id + '/cancel', { token: uOrd.data.token });

  /* MIJOZ login/parolni O'ZGARTIRA OLMAYDI */
  const uHack = await api('PATCH', '/auth/me', { login: 'aziza_hack', pass: 'hack1234' }, UAT2);
  eq(uHack.data.account.login, 'aziza_k', 'mijoz login o\'zgartira olmaydi');
  eq((await api('POST', '/auth/login', { login: 'aziza_k', pass: 'hack1234' })).status, 401, 'mijoz o\'zgartirgan parol ishlamaydi');

  /* ============ PART I: ADMIN restoran ma'lumotlarini TO'LIQ tahrirlaydi ============ */
  console.log('\n--- Admin: restoran barcha maydonlari ---');
  const rEdit = await api('PATCH', '/restaurants', {
    login: 'e2e_rest_new',
    emoji: '🍲', nameCyr: 'Миллий Таомлар', phone: '+998901239999',
    kw: 'milliy', eta: 35, dist: '3.2 km', hours: 'Har kuni 8:00–23:00',
    owner: 'Karimov Aziz', email: 'rest@e2e.uz', addr: 'Chilonzor 5',
    area: 'Chilonzor tumani', descr: 'Eng mazali milliy taomlar',
  }, AT);
  eq(rEdit.status, 200, 'restoran PATCH muvaffaqiyatli');
  eq(rEdit.data.emoji, '🍲', 'restoran: emoji saqlandi');
  eq(rEdit.data.nameCyr, 'Миллий Таомлар', 'restoran: kirill nomi saqlandi');
  eq(rEdit.data.phone, '+998901239999', 'restoran: telefon saqlandi (accounts.phone) va javobда qaytdi');
  eq(rEdit.data.kw, 'milliy', 'restoran: kalit so\'z saqlandi');
  eq(rEdit.data.eta, 35, 'restoran: yetkazish vaqti saqlandi');
  eq(rEdit.data.dist, '3.2 km', 'restoran: masofa saqlandi');
  eq(rEdit.data.hours, 'Har kuni 8:00–23:00', 'restoran: ish vaqti matni saqlandi');
  eq(rEdit.data.owner, 'Karimov Aziz', 'restoran: egasi saqlandi');
  eq(rEdit.data.email, 'rest@e2e.uz', 'restoran: email saqlandi');
  eq(rEdit.data.area, 'Chilonzor tumani', 'restoran: hudud saqlandi');
  eq(rEdit.data.descr, 'Eng mazali milliy taomlar', 'restoran: tavsif saqlandi');
  /* GET /admin/restaurants ham hammasini qaytaradi (telefon bilan) */
  const arList2 = (await api('GET', '/admin/restaurants', null, AT)).data;
  const arRow2 = arList2.find((x) => x.login === 'e2e_rest_new');
  eq(arRow2.phone, '+998901239999', '/admin/restaurants: telefon ko\'rinadi');
  eq(arRow2.emoji, '🍲', '/admin/restaurants: emoji ko\'rinadi');
  eq(arRow2.eta, 35, '/admin/restaurants: eta ko\'rinadi');
  /* Ommaviy /bootstrap da ham yangi emoji/eta ko'rinadi (komissiyasiz) */
  const boot = (await api('GET', '/bootstrap', null)).data;
  const bRest = (boot.restaurants || []).find((x) => x.name === 'E2E Milliy Taomlar');
  eq(bRest.emoji, '🍲', '/bootstrap: yangi emoji mijozga ko\'rinadi');
  eq(bRest.eta, 35, '/bootstrap: yangi eta mijozga ko\'rinadi');
  eq(bRest.commission, undefined, '/bootstrap: komissiya HALI sizmaydi');

  /* ============ PART J: ADMIN kuryer ma'lumotlarini TO'LIQ tahrirlaydi ============ */
  console.log('\n--- Admin: kuryer barcha maydonlari ---');
  const cEdit = await api('PATCH', '/couriers', {
    login: 'e2e_cour',
    emoji: '🏍️', phone: '+998907771122', transport: 'Mototsikl',
    plate: '01 A 777 BC', address: 'Yunusobod 12', email: 'kur@e2e.uz',
    birthdate: '1998-05-20', passport: 'AA 7654321', fee: 13000,
  }, AT);
  eq(cEdit.status, 200, 'kuryer PATCH muvaffaqiyatli');
  eq(cEdit.data.emoji, '🏍️', 'kuryer: emoji saqlandi');
  eq(cEdit.data.transport, 'Mototsikl', 'kuryer: transport saqlandi');
  eq(cEdit.data.plate, '01 A 777 BC', 'kuryer: avto raqami saqlandi');
  eq(cEdit.data.address, 'Yunusobod 12', 'kuryer: manzil saqlandi');
  eq(cEdit.data.email, 'kur@e2e.uz', 'kuryer: email saqlandi');
  eq(cEdit.data.birthdate, '1998-05-20', 'kuryer: tug\'ilgan sana saqlandi');
  eq(cEdit.data.passport, 'AA 7654321', 'kuryer: pasport saqlandi');
  eq(cEdit.data.fee, 13000, 'kuryer: haq saqlandi');
  const cList2 = (await api('GET', '/couriers', null, AT)).data;
  const cRow2 = cList2.find((x) => x.login === 'e2e_cour');
  eq(cRow2.plate, '01 A 777 BC', '/couriers: avto raqami ko\'rinadi');
  eq(cRow2.passport, 'AA 7654321', '/couriers: pasport ko\'rinadi');
  eq(cRow2.emoji, '🏍️', '/couriers: emoji ko\'rinadi');

  /* ============ PART K: ADMIN «Yordam / murojaat» kontaktlari ============ */
  console.log('\n--- Admin: yordam kontaktlari ---');
  const setResp = await api('PATCH', '/settings', {
    supportPhone: '+998712000000',
    supportUsername: '@yetkaz_yordam',
    supportLink: 'https://t.me/yetkaz_yordam',
    supportNote: 'Ish vaqti: 9:00–21:00',
  }, AT);
  eq(setResp.status, 200, '/settings PATCH muvaffaqiyatli');
  eq(setResp.data.supportPhone, '+998712000000', 'settings: yordam telefoni saqlandi');
  eq(setResp.data.supportUsername, '@yetkaz_yordam', 'settings: username saqlandi');
  eq(setResp.data.supportLink, 'https://t.me/yetkaz_yordam', 'settings: havola saqlandi');
  eq(setResp.data.supportNote, 'Ish vaqti: 9:00–21:00', 'settings: izoh saqlandi');
  /* Ochiq GET /settings — login shart emas (mijoz ham ko'radi) */
  const pubSet = (await api('GET', '/settings', null)).data;
  eq(pubSet.supportPhone, '+998712000000', 'GET /settings (ochiq): yordam telefoni ko\'rinadi');
  eq(pubSet.supportUsername, '@yetkaz_yordam', 'GET /settings (ochiq): username ko\'rinadi');
  /* /bootstrap.settings ham */
  const boot2 = (await api('GET', '/bootstrap', null)).data;
  eq(boot2.settings.supportLink, 'https://t.me/yetkaz_yordam', '/bootstrap.settings: havola ko\'rinadi');
  /* Non-admin /settings PATCH ga kira olmaydi */
  const setForbidden = await api('PATCH', '/settings', { supportPhone: '+998000000000' }, KT);
  eq(setForbidden.status, 403, 'kuryer /settings PATCH ga kira olmaydi (403)');

  /* ============ NATIJA ============ */
  console.log(`\n=== NATIJA: ${PASS} o'tdi, ${FAIL} yiqildi ===`);
  if (FAIL) { console.error('\nYiqilganlar:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('✓ Server moliya modeli va HAMMA PANEL bir-biriga 1 so\'mgacha mos.\n');
  process.exit(0);
}

main().catch((e) => { console.error('E2E xatosi:', e); process.exit(2); });
