/* ===== TAOM YULDUZCHASI — sotuvga qarab (admin bosqichlari) =====
   settings.js dan `starsForSales` ni AJRATIB (haqiqiy kod) tekshiradi.
   Kafolat: 0..5 yulduz; buzuq/teskari bosqich ham grafikni buzmaydi. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(HERE, '..', 'src', 'settings.js'), 'utf8');

/* `export function NAME(` dan balanslangan `}` gacha ajratadi */
function extract(name) {
  const m = new RegExp('export function ' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('topilmadi: ' + name);
  let depth = 0;
  for (let j = src.indexOf('{', m.index); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) {
      return src.slice(m.index, j + 1).replace(/^export\s+/, '');
    }
  }
  throw new Error('qavs buzuq: ' + name);
}

const ctx = { Math, Number };
vm.createContext(ctx);
/* dishStarThresholds ichida getSetting bor — testда kerak emas, shim beramiz */
vm.runInContext('function getSetting(){return "";}', ctx);
vm.runInContext(extract('dishStarThresholds') + ';this.dishStarThresholds=dishStarThresholds;', ctx);
vm.runInContext(extract('starsForSales') + ';this.starsForSales=starsForSales;', ctx);

let PASS = 0, FAIL = 0;
const eq = (a, b, m) => { if (a === b) PASS++; else { FAIL++; console.error(`  ✗ ${m}: kutildi ${b}, keldi ${a}`); } };

const T = [5, 15, 30, 60, 100];  // standart bosqichlar

eq(ctx.starsForSales(0, T), 0, '0 sotuv -> 0 yulduz');
eq(ctx.starsForSales(4, T), 0, '4 sotuv -> 0 yulduz (5 dan kam)');
eq(ctx.starsForSales(5, T), 1, '5 sotuv -> 1 yulduz');
eq(ctx.starsForSales(14, T), 1, '14 -> 1 yulduz');
eq(ctx.starsForSales(15, T), 2, '15 -> 2 yulduz');
eq(ctx.starsForSales(29, T), 2, '29 -> 2 yulduz');
eq(ctx.starsForSales(30, T), 3, '30 -> 3 yulduz');
eq(ctx.starsForSales(59, T), 3, '59 -> 3 yulduz');
eq(ctx.starsForSales(60, T), 4, '60 -> 4 yulduz');
eq(ctx.starsForSales(99, T), 4, '99 -> 4 yulduz');
eq(ctx.starsForSales(100, T), 5, '100 -> 5 yulduz');
eq(ctx.starsForSales(100000, T), 5, 'juda ko\'p -> 5 yulduz (cheklangan)');

/* Manfiy / buzuq kirish */
eq(ctx.starsForSales(-10, T), 0, 'manfiy -> 0');
eq(ctx.starsForSales('abc', T), 0, 'matn -> 0');
eq(ctx.starsForSales(50), 3, 'bosqichsiz -> standart bosqichlar (50 -> 3★)');

/* dishStarThresholds — har doim 5 ta, o'suvchi */
const d = ctx.dishStarThresholds();
eq(d.length, 5, 'dishStarThresholds: 5 ta');
eq(d.every((v, i) => i === 0 || v > d[i - 1]), true, 'dishStarThresholds: qat\'iy o\'suvchi');

console.log(`\nrating-stars: ${PASS} o'tdi, ${FAIL} yiqildi`);
process.exit(FAIL ? 1 : 0);
