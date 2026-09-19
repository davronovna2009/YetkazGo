/* ===== PANEL BIRLIK TESTLARI — frontend moliya funksiyalari =====
   assets/js/*.js fayllaridan funksiyalarni AJRATIB olib (nusxa emas — HAQIQIY
   kod) tekshiradi. Server kerak emas. `node test/panel-units.mjs`.

   Nimani kafolatlaydi:
     • restoran.js  — netOf / allocNet / dishTable / recompute:
       taomlar «sizga qoladi» yig'indisi restoran umumiy sof daromadiga
       AYNAN teng (1 so'm ham farq yo'q); komissiya har buyurtmaning
       muhrlangan foizidan.
     • admin.js     — restFinance / courierFinance: kart raqamlari sealed
       qiymatlardan (admin foizni o'zgartirsa eski buyurtmalar o'zgarmaydi).
     • kabinet.js   — orderSig / hydrateOrders: buyurtma IKKI marta
       ko'rinmaydi, summa serverga yarashadi. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const JS = (name) => readFileSync(resolve(HERE, '..', '..', 'assets', 'js', name), 'utf8');

let PASS = 0, FAIL = 0;
const eq = (a, b, m) => { if (a === b) { PASS++; } else { FAIL++; console.error(`  ✗ ${m}: kutildi ${b}, keldi ${a}`); } };

/* `[async] function NAME(` dan balanslangan `}` gacha ajratadi.
   `methodOf(src, name)` — obyekt metodi (`name() { ... }`) ni funksiyaга aylantiradi. */
function extract(src, name) {
  const m = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('funksiya topilmadi: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', m.index); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('qavs balansi buzuq: ' + name);
}
function methodOf(src, name) {
  const re = new RegExp('(^|[\\s,{])' + name + '\\s*\\(([^)]*)\\)\\s*\\{', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('metod topilmadi: ' + name);
  const bodyStart = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0, end = -1;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) { end = j; break; }
  }
  if (end < 0) throw new Error('qavs balansi buzuq: ' + name);
  return 'function ' + name + '(' + m[2] + ') ' + src.slice(bodyStart, end + 1);
}

/* Sinov buyurtmalari (A=72000/20%, B=36000/20%, C=54000/20%) — done;
   D=60000/25% — ontheway (moliyaga kirmaydi); E — cancelled. */
const ORDERS = [
  { rest: 'M', courier: 'K', user: 'D', amount: 72000, restNet: 57600, commission: 14400, courierFee: 12000, status: 'done', items: [{ name: 'Osh', qty: 2, sum: 60000 }, { name: 'Somsa', qty: 1, sum: 12000 }] },
  { rest: 'M', courier: 'K', user: 'B', amount: 36000, restNet: 28800, commission: 7200, courierFee: 12000, status: 'done', items: [{ name: 'Somsa', qty: 3, sum: 36000 }] },
  { rest: 'M', courier: 'K', user: 'D', amount: 54000, restNet: 43200, commission: 10800, courierFee: 12000, status: 'done', items: [{ name: 'Osh', qty: 1, sum: 30000 }, { name: 'Somsa', qty: 2, sum: 24000 }] },
  { rest: 'M', courier: 'K', user: 'S', amount: 60000, restNet: 45000, commission: 15000, courierFee: 0, status: 'ontheway', items: [{ name: 'Osh', qty: 2, sum: 60000 }] },
  { rest: 'M', courier: 'K', user: 'X', amount: 30000, commission: 6000, status: 'cancelled', items: [] },
];
const EXP_GMV = 162000, EXP_COMM = 32400, EXP_NET = 129600, EXP_FEE = 36000;

/* ---------- RESTORAN ---------- */
{
  const src = JS('restoran.js');
  const ctx = {
    restPct: (r) => (r && r.commission != null ? Number(r.commission) : 18),
    YZ_ITEMS: { lines: (o) => (o && Array.isArray(o.items) ? o.items : []) },
    doneOrdersOf: () => ORDERS.filter((o) => o.status === 'done'),
    priceOf: (d) => d.price || 0,
    Math, Number, String, isFinite, Object, Array,
  };
  vm.createContext(ctx);
  for (const fn of ['salesMap', 'netOf', 'allocNet', 'dishTable', 'recompute']) {
    vm.runInContext(
      ['salesMap', 'netOf', 'allocNet', 'dishTable'].map((n) => (ctx[n] ? `this.${n}=${n};` : '')).join('') +
      extract(src, fn) + `;this.${fn}=${fn};`, ctx);
  }
  eq(ctx.netOf({ restNet: 57600 }, 20), 57600, 'restoran.netOf: restNet ustuvor');
  eq(ctx.netOf({ amount: 100000 }, 20), 80000, 'restoran.netOf: pct bilan');
  eq(ctx.netOf({ amount: 100000 }), 82000, 'restoran.netOf: pct berilmasa 18%');

  /* priceOf — chegirmali taom narxi (restoran menyusida ko'rinadigan) */
  vm.runInContext(extract(src, 'priceOf') + ';this.priceOf=priceOf;', ctx);
  eq(ctx.priceOf({ price: 12000, discount: 25 }), 9000, 'restoran.priceOf: 25% chegirма -> 9000');
  eq(ctx.priceOf({ price: 30000, discount: 0 }), 30000, 'restoran.priceOf: chegirмasiz -> asl narx');
  eq(ctx.priceOf({ price: 10000, discount: 10 }), 9000, 'restoran.priceOf: 10% chegirма -> 9000');

  const al = ctx.allocNet([{ key: 'a', gross: 90000 }, { key: 'b', gross: 72000 }], 162000, 129600);
  eq(al.a + al.b, 129600, 'restoran.allocNet: yig‘indi = totalNet');

  const R = { name: 'M', commission: 25, dishes: [{ name: 'Osh', price: 30000 }, { name: 'Somsa', price: 12000 }] };
  ctx.recompute(R);
  eq(R.gross, EXP_GMV, 'restoran.recompute: r.gross');
  eq(R.net, EXP_NET, 'restoran.recompute: r.net (sealed 20%, joriy 25% EMAS)');
  eq(R.commission, EXP_COMM, 'restoran.recompute: r.commission = gross - net');
  eq(R.dishes[0].net + R.dishes[1].net, R.net, 'restoran.recompute: TAOMLAR net yig‘indisi = r.net (1 so‘m farq yo‘q)');
  eq(R.dishes[0].sold, 3, 'restoran.recompute: Osh 3 dona');
  eq(R.dishes[1].sold, 6, 'restoran.recompute: Somsa 6 dona');
  eq(R.orders, 3, 'restoran.recompute: 3 yetkazilgan');

  const dt = ctx.dishTable(ORDERS.filter((o) => o.status === 'done'), R.dishes, R);
  eq(dt.__totals.net, EXP_NET, 'restoran.dishTable: umumiy net');
  eq(dt.Osh.gross + dt.Somsa.gross, EXP_GMV, 'restoran.dishTable: taom tushumi yig‘indisi = aylanma');
}

/* ---------- ADMIN ---------- */
{
  const src = JS('admin.js');
  const ctx = { Math, Number, String, Object };
  vm.createContext(ctx);
  for (const fn of ['restFinance', 'courierFinance']) vm.runInContext(extract(src, fn) + `;this.${fn}=${fn};`, ctx);

  const rf = ctx.restFinance({ name: 'M', commission: 25 }, ORDERS);
  eq(rf.rev, EXP_GMV, 'admin.restFinance: aylanma faqat done');
  eq(rf.siteCut, EXP_COMM, 'admin.restFinance: komissiya sealed (joriy 25% EMAS)');
  eq(rf.restGets, EXP_NET, 'admin.restFinance: restoranga');
  eq(rf.siteCut + rf.restGets, rf.rev, 'admin.restFinance: siteCut + restGets = aylanma');

  const cf = ctx.courierFinance({ name: 'K', fee: 15000 }, ORDERS);
  eq(cf.earn, EXP_FEE, 'admin.courierFinance: daromad sealed 12000x3 (joriy 15000 EMAS)');
  eq(cf.deliveries, 3, 'admin.courierFinance: 3 yetkazma');
}

/* ---------- ADMIN = RESTORAN = KURYER (panellararo) ---------- */
{
  const asrc = JS('admin.js'), rsrc = JS('restoran.js');
  const a = {}; vm.createContext(a);
  for (const fn of ['restFinance', 'courierFinance']) vm.runInContext(extract(asrc, fn) + `;this.${fn}=${fn};`, Object.assign(a, { Math, Number, String, Object }));
  const r = { restPct: () => 18, YZ_ITEMS: { lines: (o) => o.items || [] }, Math, Number, String, isFinite, Object, Array };
  vm.createContext(r);
  for (const fn of ['salesMap', 'netOf', 'allocNet', 'dishTable']) vm.runInContext(['salesMap', 'netOf', 'allocNet'].map((n) => r[n] ? `this.${n}=${n};` : '').join('') + extract(rsrc, fn) + `;this.${fn}=${fn};`, r);

  const done = ORDERS.filter((o) => o.status === 'done');
  const adminComm = a.restFinance({ name: 'M', commission: 25 }, ORDERS).siteCut;
  const adminRest = a.restFinance({ name: 'M', commission: 25 }, ORDERS).restGets;
  const adminFee = a.courierFinance({ name: 'K' }, ORDERS).earn;
  const restNet = done.reduce((s, o) => s + r.netOf(o, 18), 0);
  const restComm = done.reduce((s, o) => s + (o.amount) - r.netOf(o, 18), 0);
  const courEarn = done.reduce((s, o) => s + (o.courierFee != null ? o.courierFee : 0), 0);
  eq(adminRest, restNet, 'PANELLAR: admin "restoranga" = restoran "Sizning daromadingiz"');
  eq(adminComm, restComm, 'PANELLAR: admin komissiya = restoran ko‘rgan komissiya');
  eq(adminFee, courEarn, 'PANELLAR: admin "kuryer xarajati" = kuryer "Sizning daromadingiz"');
  eq(adminRest + adminComm, EXP_GMV, 'PANELLAR: restoranga + komissiya = aylanma');
  eq(adminComm - adminFee, EXP_COMM - EXP_FEE, 'PANELLAR: sof foyda = komissiya - kuryer haqi');
}

/* ---------- KABINET ---------- */
{
  const src = JS('kabinet.js');
  const USER = { name: 'D', orders: [] };
  const STORE = { _o: [], ordersForUser: (n) => STORE._o.filter((o) => o.user === n) };
  const ctx = {
    USER, STORE, Number, String, Array, Object, Math,
    YZ_TIME: { fmtDate: (s) => String(s || '').slice(0, 10) },
    beOrderToLocal: (o) => ({ id: o.id, dish: o.item, rest: o.rest, pay: o.pay, amount: o.amount, status: o.status, date: '', reason: o.reason || '' }),
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'orderSig') + ';this.orderSig=orderSig;', ctx);
  vm.runInContext('this.orderSig=orderSig;' + extract(src, 'hydrateOrders') + ';this.hydrateOrders=hydrateOrders;', ctx);

  USER.orders.push({ id: 172500000123, _local: true, dish: 'Osh', rest: 'M', pay: 'card', amount: 72000, status: 'new' });
  STORE._o.push({ id: 9, user: 'D', rest: 'M', item: 'Osh', pay: 'card', amount: 72000, status: 'new', created_at: '2026-09-09 07:00:00' });
  ctx.hydrateOrders();
  eq(USER.orders.length, 1, 'kabinet.hydrateOrders: buyurtma IKKI marta ko‘rinmaydi');
  eq(USER.orders[0].id, 9, 'kabinet.hydrateOrders: optimistik yozuv haqiqiy id oldi');
  eq(USER.orders[0]._local, undefined, 'kabinet.hydrateOrders: _local tozalandi');
  ctx.hydrateOrders(); ctx.hydrateOrders();
  eq(USER.orders.length, 1, 'kabinet.hydrateOrders: qayta-qayta chaqirilsa ham bitta');
  STORE._o[0].amount = 45000; STORE._o[0].status = 'done';
  ctx.hydrateOrders();
  eq(USER.orders[0].amount, 45000, 'kabinet.hydrateOrders: summa server qiymatiga yarashdi');
  const spent = USER.orders.filter((o) => o.status === 'done').reduce((s, o) => s + (Number(o.amount) || 0), 0);
  eq(spent, 45000, 'kabinet: "Jami sarflagan" = faqat done buyurtma summasi');
}

/* ---------- ADMIN «Loginlar» — ishonchli yuklash (2+ marta kirilса ham) ---------- */
{
  const src = JS('admin.js');
  /* Soxta #loginsList elementi */
  let hostHTML = '';
  const host = {
    set innerHTML(v) { hostHTML = v; },
    get innerHTML() { return hostHTML; },
    querySelectorAll: () => [],
  };
  let fetchResult = [
    { login: 'admin', role: 'admin', name: 'Administrator' },
    { login: 'r1', role: 'restoran', name: 'Rest 1', phone: '+998900000001' },
    { login: 'k1', role: 'kuryer', name: 'Kur 1' },
  ];
  let fetchThrows = false;
  const ctx = {
    STORE: { fetchAccounts: async () => { if (fetchThrows) throw new Error('net'); return fetchResult; } },
    $: (sel) => (sel === '#loginsList' ? host : null),
    document: { getElementById: () => null },
    esc: (s) => String(s == null ? '' : s),
    openAccountEdit: () => {},
    console,
  };
  vm.createContext(ctx);
  /* top-level ROLE_INFO obyektini manba matnidan ajratamiz */
  const roleInfoSrc = src.slice(src.indexOf('const ROLE_INFO='), src.indexOf('};', src.indexOf('const ROLE_INFO=')) + 2);
  vm.runInContext(
    'var ACCOUNTS=[], loginQuery="", accountsLoaded=false, accountsLoading=false;' +
    roleInfoSrc + ';' +
    extract(src, 'acctCard') + ';' +
    extract(src, 'renderLogins') + ';' +
    extract(src, 'loadAccounts') + ';' +
    'this.loadAccounts=loadAccounts; this.renderLogins=renderLogins;' +
    'this.state=()=>({loaded:accountsLoaded, loading:accountsLoading, n:ACCOUNTS.length});', ctx);

  await ctx.loadAccounts();
  eq(/r1/.test(hostHTML) && /k1/.test(hostHTML), true, 'admin Loginlar: 1-kirish — kartalar chizildi');
  eq(ctx.state().n, 3, 'admin Loginlar: 1-kirish — 3 akkaunt');

  await ctx.loadAccounts();
  eq(/r1/.test(hostHTML), true, 'admin Loginlar: 2-kirish — kartalar YANA chizildi (bug tuzatildi)');
  eq(ctx.state().n, 3, 'admin Loginlar: 2-kirish — 3 akkaunt');

  await ctx.loadAccounts();
  eq(/k1/.test(hostHTML), true, 'admin Loginlar: 3-kirish — hali ham ishlaydi');

  /* Tarmoq uzildi — ro'yxat BO'SHAB QOLMAYDI */
  fetchThrows = true;
  await ctx.loadAccounts();
  eq(/r1/.test(hostHTML), true, 'admin Loginlar: fetch xato bo\'lsa oxirgi ro\'yxat saqlanadi');
  eq(ctx.state().n, 3, 'admin Loginlar: xatoдан keyin ham 3 akkaunt (bo\'shamadi)');

  /* Tarmoq tiklandi + yangi akkaunt qo'shildi */
  fetchThrows = false;
  fetchResult = [...fetchResult, { login: 'r2', role: 'restoran', name: 'Rest 2' }];
  await ctx.loadAccounts();
  eq(/r2/.test(hostHTML), true, 'admin Loginlar: tarmoq tiklangач yangi akkaunt ko\'rindi');
  eq(ctx.state().n, 4, 'admin Loginlar: 4 akkaunt');

  /* Har kartada login + parol tugmasi bor */
  eq(/lg-edit-login/.test(hostHTML) && /lg-edit-pass/.test(hostHTML), true, 'admin Loginlar: har kartada Login va Parol tugmasi');
}

/* ---------- APP «Aksiya/reklama» bo'limi — FAQAT aksiyadagi taomlar ---------- */
{
  const src = JS('app.js');
  const CAT = [
    { id: 1, rest: 'A', name: 'Osh', price: 30000, emoji: '🍚' },
    { id: 2, rest: 'A', name: 'Somsa', price: 12000, emoji: '🥟', discount: 25, eff: 9000 },
    { id: 3, rest: 'B', name: 'Desert', price: 20000, emoji: '🍰' },
    { id: 4, rest: 'B', name: 'Lagmon', price: 25000, emoji: '🍜' },
  ];
  let PROMOS = [];
  const ctx = {
    catalog: () => CAT,
    getAllPromos: () => PROMOS,
    STORE: { overrides: () => ({ discounts: {} }) },
    Set, Math, Number, String, Object, Array,
  };
  vm.createContext(ctx);
  vm.runInContext(extract(src, 'getDiscountedDishes') + ';this.getDiscountedDishes=getDiscountedDishes;', ctx);
  vm.runInContext('this.getDiscountedDishes=getDiscountedDishes;this.getAllPromos=getAllPromos;this.catalog=catalog;' +
    extract(src, 'getPromoDishCards') + ';this.getPromoDishCards=getPromoDishCards;', ctx);

  /* 1) Chegirмasi bor + e'lon yo'q — faqat chegirмали taom */
  PROMOS = [];
  let c = ctx.getPromoDishCards();
  eq(c.length, 1, 'app.promo: faqat chegирмали taom (Somsa)');
  eq(c[0].name, 'Somsa', 'app.promo: Somsa 25%');

  /* 2) E'lon "Desert" ni nomlaydi — chegирмасиз ham kartaga tushadi */
  PROMOS = [{ rest: 'B', dish: 'Desert', text: 'Desert aksiyada!', tag: 'AKSIYA' }];
  c = ctx.getPromoDishCards();
  eq(c.length, 2, 'app.promo: Somsa (chegирма) + Desert (e\'lonда nomlangan)');
  eq(c.some((x) => x.name === 'Desert'), true, 'app.promo: Desert e\'lon orqali kartaga tushdi');
  const des = c.find((x) => x.name === 'Desert');
  eq(des.eff, 20000, 'app.promo: chegирмасиз e\'lon taomi asl narxда (eff = price)');

  /* 3) E'lon dishsiz (umumiy reklама) — hech qanday yangi taom qo'shilmaydi */
  PROMOS = [{ rest: 'A', text: 'Hammaga chegirма!', tag: 'AKSIYA' }];
  c = ctx.getPromoDishCards();
  eq(c.length, 1, 'app.promo: dishsiz e\'lon — faqat chegирмали taom qoladi (reklамасиз taomlar YO\'Q)');

  /* 4) Chegирма ham, e'lon ham yo'q — bo'sh (taom kartasi umuman chizilmaydi) */
  CAT[1].discount = 0; delete CAT[1].eff;
  PROMOS = [];
  c = ctx.getPromoDishCards();
  eq(c.length, 0, 'app.promo: aksiya yo\'q -> taom kartasi chizilmaydi (bo\'sh)');
  CAT[1].discount = 25; CAT[1].eff = 9000;

  /* 5) Dublikat bo'lmaydi: taom ham chegирмали, ham e'lonда */
  PROMOS = [{ rest: 'A', dish: 'Somsa', text: 'Somsa aksiyada', tag: 'AKSIYA' }];
  c = ctx.getPromoDishCards();
  eq(c.filter((x) => x.name === 'Somsa').length, 1, 'app.promo: Somsa 1 marta (chegирма+e\'lon dublikat emas)');
}

/* ---------- support.js — YZ_SUPPORT.get() (admin o'chirgan kontakt yashiriladi) ---------- */
{
  const src = JS('support.js');
  let SETTINGS = {};
  const root = {
    YZ_SAFE: { esc: (s) => String(s == null ? '' : s) },
    STORE: { settings: () => SETTINGS },
  };
  /* IIFE ni root bilan bajaramiz */
  const ctx = { window: root, globalThis: root };
  Object.assign(root, { window: root });
  vm.createContext(root);
  vm.runInContext(src, root);
  const S = root.YZ_SUPPORT;
  eq(typeof S, 'object', 'support.js: YZ_SUPPORT global yaratildi');

  SETTINGS = {};
  eq(S.get().hasAny, false, 'YZ_SUPPORT: hech narsa yozilmaган -> hasAny=false');

  SETTINGS = { supportPhone: '+998901112233', supportPhoneOn: true };
  eq(S.get().phone, '+998901112233', 'YZ_SUPPORT: telefon yozilgan va yoqilgan');
  eq(S.get().hasAny, true, 'YZ_SUPPORT: hasAny=true');

  SETTINGS = { supportPhone: '+998901112233', supportPhoneOn: false, supportUsername: '@yordam', supportUsernameOn: true };
  eq(S.get().phone, '', 'YZ_SUPPORT: telefon O\'CHIRILGAN -> ko\'rinmaydi');
  eq(S.get().username, '@yordam', 'YZ_SUPPORT: username yoqilgan -> ko\'rinadi');
  eq(S.get().tgUrl, 'https://t.me/yordam', 'YZ_SUPPORT: username -> t.me havolasi');

  SETTINGS = { supportLink: 'https://t.me/x', supportLinkOn: false };
  eq(S.get().hasAny, false, 'YZ_SUPPORT: yagona havola ham o\'chirilgan -> hasAny=false');

  /* Eski server (Он maydonlarsiz) — yozilgan bo'lsa ko'rsatadi */
  SETTINGS = { supportPhone: '+998900000000' };
  eq(S.get().phone, '+998900000000', 'YZ_SUPPORT: eski server (On yo\'q) -> yozilgan telefon ko\'rinadi');

  const html = S.blockHtml({ title: 'X', intro: '' });
  eq(/998900000000/.test(html) && /panel/.test(html), true, 'YZ_SUPPORT.blockHtml: telefon bilan panel qaytadi');
  SETTINGS = {};
  eq(S.blockHtml({}), '', 'YZ_SUPPORT.blockHtml: bo\'sh -> ""');
}

/* ---------- store.js — payMethods() (admin karta/naqd/custom boshqaradi) ---------- */
{
  const src = JS('store.js');
  const cache = { settings: {} };
  const ctx = { cache, Array, String, Object };
  vm.createContext(ctx);
  vm.runInContext(methodOf(src, 'payMethods') + ';this.payMethods=payMethods;', ctx);
  const call = () => ctx.payMethods();

  cache.settings = {};
  let m = call();
  eq(m.length, 2, 'store.payMethods: standart -> karta + naqd');
  eq(m[0].id, 'card', 'store.payMethods: birinchi karta');

  cache.settings = { payCardOn: false, payCashOn: true };
  m = call();
  eq(m.length, 1, 'store.payMethods: karta o\'chirilgan -> faqat naqd');
  eq(m[0].id, 'cash', 'store.payMethods: naqd qoldi');

  cache.settings = { payCardOn: true, payCashOn: true, payExtra: [{ id: 'payme', label: 'Payme', note: '8600...' }] };
  m = call();
  eq(m.length, 3, 'store.payMethods: karta + naqd + custom');
  eq(m[2].label, 'Payme', 'store.payMethods: custom label');
  eq(m[2].note, '8600...', 'store.payMethods: custom note');

  cache.settings = { payCardOn: false, payCashOn: false, payExtra: [] };
  m = call();
  eq(m.length, 1, 'store.payMethods: hammasi o\'chirilса -> naqd majburan (buyurtма bo\'lsin)');
}

/* ---------- store.js — HAR PANEL O'Z tokeni (bitta brauzerда admin+kuryer) ---------- */
{
  const src = JS('store.js');
  /* Soxta localStorage + window */
  const LS = new Map();
  const localStorage = {
    getItem: (k) => (LS.has(k) ? LS.get(k) : null),
    setItem: (k, v) => LS.set(k, String(v)),
    removeItem: (k) => LS.delete(k),
  };
  const fakeEl = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: '', textContent: '' });
  const doc = {
    readyState: 'complete', addEventListener: () => {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl(), head: fakeEl(), body: fakeEl(), documentElement: fakeEl(),
  };
  const win = {
    localStorage,
    location: { protocol: 'https:', origin: 'https://x', href: 'https://x/' },
    addEventListener: () => {}, setInterval: () => 0, setTimeout: (f) => { try { f(); } catch (e) {} },
    fetch: () => Promise.reject(new Error('offline')),
    navigator: {}, document: doc,
  };
  win.window = win;
  const ctx = { ...win, globalThis: win, console, JSON, Date, Promise, Math, Object, Array, String, Number };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;this.STORE=STORE;', ctx);
  const S = ctx.STORE;
  eq(typeof S.setPanelRole, 'function', 'store: setPanelRole mavjud');

  /* Admin panel kirdi */
  S.setPanelRole('admin');
  S.setSession({ role: 'admin', name: 'AdminUser', login: 'admin' });
  /* Kuryer panel kirdi (BIR XIL brauzer/localStorage) */
  S.setPanelRole('kuryer');
  S.setSession({ role: 'kuryer', name: 'KuryerUser', login: 'kur1' });
  /* Restoran panel kirdi */
  S.setPanelRole('restoran');
  S.setSession({ role: 'restoran', name: 'RestUser', login: 'rest1' });

  /* Har panel O'Z sessiyasini ko'radi — bir-birini bosib ketmaydi */
  S.setPanelRole('admin');
  eq(S.session().name, 'AdminUser', 'store: admin panel -> admin sessiyasi (kuryer bosib ketmadi)');
  S.setPanelRole('kuryer');
  eq(S.session().name, 'KuryerUser', 'store: kuryer panel -> kuryer sessiyasi');
  S.setPanelRole('restoran');
  eq(S.session().name, 'RestUser', 'store: restoran panel -> restoran sessiyasi');

  /* localStorage'да alohida kalitlar */
  eq(LS.has('yz_session_admin') && LS.has('yz_session_kuryer') && LS.has('yz_session_restoran'), true,
    'store: yz_session_<rol> alohida saqlanadi');

  /* Kuryer chiqdi — admin/restoran sessiyasiga TEGMAYDI */
  S.setPanelRole('kuryer');
  S.clearSession();
  eq(S.session(), null, 'store: kuryer chiqdi -> kuryer sessiyasi yo\'q');
  S.setPanelRole('admin');
  eq(S.session().name, 'AdminUser', 'store: kuryer chiqqач ham admin sessiyasi joyida');

  /* Bosh saytdан (PANEL_ROLE=user) restoran kirса — token yz_token_restoran ga yoziladi */
  LS.clear();
  ctx.fetch = (url, opt) => {
    const body = opt && opt.body ? JSON.parse(opt.body) : {};
    if (String(url).includes('/auth/login')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: 'RESTOK', account: { role: 'restoran', name: 'R', login: body.login } }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  };
  S.setPanelRole('user');
  await S.login('rest1', 'p');
  eq(LS.get('yz_token_restoran'), '"RESTOK"', 'store: bosh saytdан restoran kirса -> yz_token_restoran ga yozildi');
  eq(LS.has('yz_token_user'), false, 'store: user kalitига yozilmadi (restoran token)');
  S.setPanelRole('restoran');
  eq(S.session().name, 'R', 'store: restoran panelига o\'tganда sessiya tayyor (qayta kirish shart emas)');
  ctx.fetch = () => Promise.reject(new Error('offline'));

  /* Migratsiya: eski umumiy yz_token/yz_session -> shu panelniki */
  LS.clear();
  LS.set('yz_token', '"legacyKuryerTok"');
  LS.set('yz_session', JSON.stringify({ role: 'kuryer', name: 'Old', login: 'k' }));
  S.setPanelRole('kuryer');
  eq(LS.get('yz_token_kuryer'), '"legacyKuryerTok"', 'store: eski token -> yz_token_kuryer ga ko\'chdi');
  eq(LS.has('yz_token'), false, 'store: eski umumiy token tozalandi');
  /* Rol mos kelmasa — ko'chirilmaydi */
  LS.clear();
  LS.set('yz_token', '"legacyAdminTok"');
  LS.set('yz_session', JSON.stringify({ role: 'admin', name: 'A', login: 'admin' }));
  S.setPanelRole('kuryer');
  eq(LS.has('yz_token_kuryer'), false, 'store: admin tokeni kuryer panelга ko\'chmaydi');
  eq(LS.get('yz_token'), '"legacyAdminTok"', 'store: admin uchun eski token saqlanib qoldi');
}

/* ---------- store.js — IKKI RESTORAN paneli bitta brauzerда (HAR TAB O'ZINIKI) ---------- */
{
  const src = JS('store.js');
  /* localStorage — BO'LINGAN (bir brauzer); sessionStorage — HAR TAB ALOHIDA */
  const LS = new Map();
  const mkLocal = (M) => ({ getItem: (k) => (M.has(k) ? M.get(k) : null), setItem: (k, v) => M.set(k, String(v)), removeItem: (k) => M.delete(k) });
  const fakeEl = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: '', textContent: '' });
  const doc = { readyState: 'complete', addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl(), head: fakeEl(), body: fakeEl(), documentElement: fakeEl() };
  function mkTab() {
    const SS = new Map();
    const win = {
      localStorage: mkLocal(LS), sessionStorage: mkLocal(SS),
      location: { protocol: 'https:', origin: 'https://x', href: 'https://x/restoran.html' },
      addEventListener: () => {}, setInterval: () => 0, setTimeout: (f) => {}, fetch: () => Promise.reject(new Error('offline')),
      navigator: {}, document: doc,
    };
    win.window = win;
    const ctx = { ...win, globalThis: win, console, JSON, Date, Promise, Math, Object, Array, String, Number };
    vm.createContext(ctx);
    vm.runInContext(src + '\n;this.STORE=STORE;', ctx);
    return ctx.STORE;
  }
  /* TAB A — "Shashlik" restorani kirdi */
  const A = mkTab();
  A.setPanelRole('restoran');
  A.setSession({ role: 'restoran', name: 'Shashlik', login: 'shashlik' });
  eq(A.session().name, 'Shashlik', 'TAB A: Shashlik sessiyasi');

  /* TAB B — xuddi shu brauzerда 2-restoran paneli ochildi, "ECO FISH" kirdi */
  const B = mkTab();
  B.setPanelRole('restoran');
  eq(B.session().name, 'Shashlik', 'TAB B: ochilганда oxirgi kirishни (Shashlik) qabul qildi');
  B.setSession({ role: 'restoran', name: 'ECO FISH', login: 'ecofish' });
  eq(B.session().name, 'ECO FISH', 'TAB B: ECO FISH kirdi');

  /* MUHIM: TAB A ni yangilaymiz (setPanelRole qayta chaqiriladi) — ECO FISH ga
     AYLANMASLIGI kerak (ilgari shu bug bor edi). */
  A.setPanelRole('restoran');
  eq(A.session().name, 'Shashlik', 'TAB A yangilangач ham Shashlik (ECO FISH bosib ketmadi!)');
  eq(B.session().name, 'ECO FISH', 'TAB B hamon ECO FISH');

  /* TAB A chiqdi -> TAB B ta\'sirlanmaydi */
  A.clearSession();
  eq(A.session(), null, 'TAB A chiqdi');
  B.setPanelRole('restoran');
  eq(B.session().name, 'ECO FISH', 'TAB A chiqqач ham TAB B ECO FISH bo\'lib qoladi');
}

/* ---------- store.js — BITTA TABда akkaunt almashtirish (bosh sayt -> panel) ----------
   XATO (tuzatildi): shu tabда ilgari "Shashlik" restorani kirgan bo'lsa,
   bosh saytда BOSHQA restoran (ECO FISH) login/parolini yozsangiz ham panel
   ESKI "Shashlik" ni ochib berardi. Sabab: kirish tokeni faqat localStorage'ga
   yozilar, panel esa sessionStorage'даги eski tokenni BIRLAMCHI deb olardi.
   Kuryer panelida ham AYNAN shu xato bor edi. */
{
  const src = JS('store.js');
  const LS = new Map(), SS = new Map();        // bitta brauzer + BITTA tab
  const mkStore = (M) => ({ getItem: (k) => (M.has(k) ? M.get(k) : null), setItem: (k, v) => M.set(k, String(v)), removeItem: (k) => M.delete(k) });
  const fakeEl = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: '', textContent: '' });
  const doc = { readyState: 'complete', addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl(), head: fakeEl(), body: fakeEl(), documentElement: fakeEl() };
  /* Bitta tabда ketma-ket ochilgan sahifalar: sessionStorage SAQLANADI */
  function mkPage(role) {
    const win = {
      localStorage: mkStore(LS), sessionStorage: mkStore(SS),
      location: { protocol: 'https:', origin: 'https://x', href: 'https://x/' },
      addEventListener: () => {}, setInterval: () => 0, setTimeout: () => {}, navigator: {}, document: doc,
      fetch: (url, opt) => {
        const b = opt && opt.body ? JSON.parse(opt.body) : {};
        if (String(url).includes('/auth/login')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: 'TOK_' + b.login, account: { role, name: b.login.toUpperCase(), login: b.login } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      },
    };
    win.window = win;
    const ctx = { ...win, globalThis: win, console, JSON, Date, Promise, Math, Object, Array, String, Number };
    vm.createContext(ctx);
    vm.runInContext(src + '\n;this.STORE=STORE;', ctx);
    return ctx.STORE;
  }
  /* 1) Shu tabда restoran paneli "shashlik" bilan kirgan edi */
  const p1 = mkPage('restoran');
  p1.setPanelRole('restoran');
  await p1.login('shashlik', 'p');
  eq(p1.session().login, 'shashlik', 'bitta tab: avval shashlik kirdi');
  /* 2) XUDDI SHU TAB bosh saytga o'tdi va BOSHQA restoran login/paroli yozildi */
  const site = mkPage('restoran');
  site.setPanelRole('user');
  await site.login('ecofish', 'p');
  /* 3) Tab restoran.html ga yo'naltirildi (sessionStorage o'zgarmaydi) */
  const p2 = mkPage('restoran');
  p2.setPanelRole('restoran');
  eq(p2.session().login, 'ecofish', 'bitta tab: panel YANGI kirgan restoranni ochadi (eski shashlik emas!)');
  eq(SS.get('yz_token_restoran'), '"TOK_ecofish"', 'bitta tab: tabдаги token ham yangilandi');
  eq(SS.has('yz_session_user'), false, 'bitta tab: bosh saytning eski mijoz sessiyasi shu tabда qolmadi');

  /* Kuryer paneli — AYNAN shu stsenariy */
  LS.clear(); SS.clear();
  const k1 = mkPage('kuryer');
  k1.setPanelRole('kuryer');
  await k1.login('kur1', 'p');
  eq(k1.session().login, 'kur1', 'bitta tab: avval kur1 kirdi');
  const site2 = mkPage('kuryer');
  site2.setPanelRole('user');
  await site2.login('kur2', 'p');
  const k2 = mkPage('kuryer');
  k2.setPanelRole('kuryer');
  eq(k2.session().login, 'kur2', 'bitta tab: kuryer paneli YANGI kuryerni ochadi (eskisi emas!)');
}

console.log(`\npanel-units: ${PASS} o‘tdi, ${FAIL} yiqildi`);
process.exit(FAIL ? 1 : 0);
