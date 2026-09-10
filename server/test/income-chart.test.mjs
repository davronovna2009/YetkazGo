/* ===== YZ_TIME.incomeChart — DAROMAD GRAFIGI davr/ustun mantiqi =====
   Kafolat (admin, restoran, kuryer panellari SHU helperни ishlatadi):
     • grafik ustunlari REAL — har buyurtma to'g'ri ustунга tushadi (Toshkent
       kalendari bo'yicha; oy/hafta chegarasida ham adashmaydi)
     • "shu davr" kartasi = grafikning OXIRGI (joriy) ustuni — 1 so'm ham farq yo'q
     • kunlik→7 kun, haftalik→8 hafta, oylik→6 oy, yillik→5 yil
   `node test/income-chart.test.mjs` — server kerak emas. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const hoursSrc = readFileSync(resolve(HERE, '..', '..', 'assets', 'js', 'hours.js'), 'utf8');

/* hours.js — IIFE, `global.YZ_TIME` ni o'rnatadi. Fake global bilan yuklaymiz. */
const ctx = { window: {}, Intl, Date, Math, Number, String, Object };
vm.createContext(ctx);
vm.runInContext(hoursSrc, ctx);
const YZ_TIME = ctx.window.YZ_TIME;

let PASS = 0, FAIL = 0;
const eq = (a, b, m) => { if (a === b) PASS++; else { FAIL++; console.error(`  ✗ ${m}: kutildi ${JSON.stringify(b)}, keldi ${JSON.stringify(a)}`); } };
const ok = (c, m) => { if (c) PASS++; else { FAIL++; console.error(`  ✗ ${m}`); } };

ok(typeof YZ_TIME.incomeChart === 'function', 'YZ_TIME.incomeChart mavjud');

/* Toshkent "hozir" — test barqaror bo'lishi uchun helperдан olamiz */
const P = YZ_TIME.parts(new Date());

/* SQLite `datetime('now')` formatida UTC satr yasaydi (Toshkent kunidan 5 soat ayirib) */
function utcRaw(y, mo, d, h = 6) {
  // h=6 UTC -> 11:00 Toshkent: kun chegarasidan uzoq, kun aниq
  const p2 = (n) => String(n).padStart(2, '0');
  return `${y}-${p2(mo)}-${p2(d)} ${p2(h)}:00:00`;
}

/* ---------- 1) OYLIK: 6 ustun, oxirgisi = shu oy ---------- */
{
  const IC = YZ_TIME.incomeChart('oylik');
  eq(IC.buckets.length, 6, 'oylik: 6 ustun');
  eq(IC.curIndex, 5, 'oylik: joriy ustun = oxirgisi');
  const cur = IC.buckets[5];
  eq(cur.y, P.y, 'oylik: oxirgi ustun yili = shu yil');
  eq(cur.mo, P.mo, 'oylik: oxirgi ustun oyi = shu oy');

  // Buyurtmalar: 2 tasi shu oyda (100+250), 1 tasi o'tgan oyда (70), 1 tasi 5 oy oldin (40), 1 tasi 10 oy oldin (ko'rinmaydi)
  let pm = P.mo - 1, py = P.y; if (pm < 1) { pm = 12; py--; }
  let fm = P.mo - 5, fy = P.y; while (fm < 1) { fm += 12; fy--; }
  let om = P.mo - 10, oy2 = P.y; while (om < 1) { om += 12; oy2--; }
  const orders = [
    { created_at: utcRaw(P.y, P.mo, Math.min(P.d, 5)), amt: 100 },
    { created_at: utcRaw(P.y, P.mo, Math.min(P.d, 6)), amt: 250 },
    { created_at: utcRaw(py, pm, 15), amt: 70 },
    { created_at: utcRaw(fy, fm, 15), amt: 40 },
    { created_at: utcRaw(oy2, om, 15), amt: 9999 },
  ];
  const sums = IC.series(orders, (o) => o.amt);
  eq(sums.length, 6, 'oylik: series 6 ta qiymat');
  eq(sums[5], 350, 'oylik: oxirgi ustun = shu oy summasi (100+250)');
  eq(sums[4], 70, 'oylik: oldingi ustun = o\'tgan oy (70)');
  eq(sums[0], 40, 'oylik: 5 oy oldingi ustun (40)');
  eq(sums.reduce((a, b) => a + b, 0), 460, 'oylik: 10 oy oldingi buyurtma grafikка kirmaydi (9999 tashqarida)');

  // KARTA == OXIRGI USTUN: "shu davr" summasi
  const cardSum = orders.filter((o) => IC.isCurrent(o.created_at)).reduce((s, o) => s + o.amt, 0);
  eq(cardSum, sums[5], 'oylik: "shu davr" kartasi = grafik oxirgi ustuni (1 so\'m farq yo\'q)');
  eq(IC.periodLabel, 'shu oy', 'oylik: periodLabel');
  eq(IC.spanLabel, "so'nggi 6 oy", 'oylik: spanLabel');
}

/* ---------- 2) KUNLIK: 7 ustun, oxirgisi = bugun ---------- */
{
  const IC = YZ_TIME.incomeChart('kunlik');
  eq(IC.buckets.length, 7, 'kunlik: 7 ustun');
  eq(IC.curIndex, 6, 'kunlik: joriy = oxirgi');
  const today = IC.buckets[6];
  eq(today.y === P.y && today.mo === P.mo && today.d === P.d, true, 'kunlik: oxirgi ustun = bugun (Toshkent)');

  // bugun 2 ta (11+22), kecha 1 ta (5), 6 kun oldin 1 ta (3), 20 kun oldin 1 ta (tashqarida)
  const dUTC = (off) => { const t = new Date(Date.UTC(P.y, P.mo - 1, P.d - off)); return utcRaw(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  const orders = [
    { created_at: dUTC(0), amt: 11 }, { created_at: dUTC(0), amt: 22 },
    { created_at: dUTC(1), amt: 5 },
    { created_at: dUTC(6), amt: 3 },
    { created_at: dUTC(20), amt: 777 },
  ];
  const sums = IC.series(orders, (o) => o.amt);
  eq(sums[6], 33, 'kunlik: bugungi ustun (11+22)');
  eq(sums[5], 5, 'kunlik: kechagi ustun (5)');
  eq(sums[0], 3, 'kunlik: 6 kun oldingi ustun (3)');
  eq(sums.reduce((a, b) => a + b, 0), 41, 'kunlik: 20 kun oldingi buyurtma tashqarida');
  const cardSum = orders.filter((o) => IC.isCurrent(o.created_at)).reduce((s, o) => s + o.amt, 0);
  eq(cardSum, sums[6], 'kunlik: "bugun" kartasi = grafik oxirgi ustuni');
}

/* ---------- 3) HAFTALIK: 8 ustun; hafta chegarasi (Dush-Yak) ---------- */
{
  const IC = YZ_TIME.incomeChart('haftalik');
  eq(IC.buckets.length, 8, 'haftalik: 8 ustun');
  eq(IC.curIndex, 7, 'haftalik: joriy = oxirgi');

  const dUTC = (off) => { const t = new Date(Date.UTC(P.y, P.mo - 1, P.d - off)); return utcRaw(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  // bugun + 8 kun oldin (o'tgan hafta yoki undan oldin) + 60 kun oldin (tashqarida ehtimoli)
  const orders = [
    { created_at: dUTC(0), amt: 100 },
    { created_at: dUTC(8), amt: 40 },
    { created_at: dUTC(70), amt: 555 },
  ];
  const sums = IC.series(orders, (o) => o.amt);
  ok(sums[7] >= 100, 'haftalik: shu hafta ustunida bugungi buyurtma bor');
  const cardSum = orders.filter((o) => IC.isCurrent(o.created_at)).reduce((s, o) => s + o.amt, 0);
  eq(cardSum, sums[7], 'haftalik: "shu hafta" kartasi = grafik oxirgi ustuni');
  // bugungi buyurtma joriy haftada
  eq(IC.isCurrent(dUTC(0)), true, 'haftalik: bugungi buyurtma joriy haftada');
}

/* ---------- 4) YILLIK: 5 ustun, oxirgisi = shu yil ---------- */
{
  const IC = YZ_TIME.incomeChart('yillik');
  eq(IC.buckets.length, 5, 'yillik: 5 ustun');
  eq(IC.buckets[4].y, P.y, 'yillik: oxirgi ustun = shu yil');
  const orders = [
    { created_at: utcRaw(P.y, P.mo, Math.min(P.d, 10)), amt: 500 },
    { created_at: utcRaw(P.y - 1, 6, 10), amt: 200 },
    { created_at: utcRaw(P.y - 4, 6, 10), amt: 60 },
    { created_at: utcRaw(P.y - 9, 6, 10), amt: 333 },
  ];
  const sums = IC.series(orders, (o) => o.amt);
  eq(sums[4], 500, 'yillik: shu yil ustuni (500)');
  eq(sums[3], 200, 'yillik: o\'tgan yil (200)');
  eq(sums[0], 60, 'yillik: 4 yil oldin (60)');
  eq(sums.reduce((a, b) => a + b, 0), 760, 'yillik: 9 yil oldingi buyurtma tashqarida');
  const cardSum = orders.filter((o) => IC.isCurrent(o.created_at)).reduce((s, o) => s + o.amt, 0);
  eq(cardSum, sums[4], 'yillik: "shu yil" kartasi = grafik oxirgi ustuni');
}

/* ---------- 5) bucketOf: noto'g'ri/bo'sh sana -> -1 (grafikni buzmaydi) ---------- */
{
  const IC = YZ_TIME.incomeChart('oylik');
  eq(IC.bucketOf(''), -1, 'bo\'sh sana -> -1');
  eq(IC.bucketOf('salom'), -1, 'buzuq sana -> -1');
  eq(IC.bucketOf(null), -1, 'null -> -1');
  const sums = IC.series([{ created_at: '', amt: 999 }, { created_at: null, amt: 999 }], (o) => o.amt);
  eq(sums.reduce((a, b) => a + b, 0), 0, 'sanasi yo\'q buyurtma grafikка pul qo\'shmaydi');
}

console.log(`\nincome-chart: ${PASS} o'tdi, ${FAIL} yiqildi`);
process.exit(FAIL ? 1 : 0);
