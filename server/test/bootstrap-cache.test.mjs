/* ===== /api/bootstrap KESHI — ko'p foydalanuvchida TEZ ishlashini tekshiradi =====
   Muammo: HAR ochiq panel/sahifa /api/bootstrap ni 5 soniyada bir so'raydi
   (assets/js/store.js). Foydalanuvchi ko'paysa, shu so'rov ичidagi og'ir hisoblar
   (ratings.js: barcha done buyurtма tarkibini items_json'dan qayta parse qilish)
   HAR mijozга alohida QAYTA bajarilса — server sekinlashadi/qотиб qoladi.

   Tuzatish: qisqa (2 soniyalik) kesh — shu oynada kelgan BARCHA so'rovlar bitta
   hisobни baham ko'radi. BU TEST buni ISBOTLAYDI:
     1) kesh ичida yozilgan o'zgarish DARHOL ko'rinmaydi (server qayta hisoblamadi)
     2) kesh muddati o'tgach — YANGI natija keladi (ma'lumot abadiy eskirmaydi)
   MUHIM: bu tekshiruv server/test/run.mjs NODE_ENV=test QO'YMAGAN holда ishlaydi
   (o'zi alohida server ko'taradi) — chunki kesh aynan production rejimida yoqiq
   (ratings.js / routes/misc.js: NODE_ENV==='test' bo'lsa kesh O'CHIQ). */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRV = resolve(HERE, '..', 'src', 'app.js');
const PORT = String(Number(process.env.TEST_PORT || 5099) + 77);
const DB = resolve(HERE, '.tmp-bootstrap-cache.db');
const ADMIN_PASS = 'cache-test-pass-' + Math.random().toString(36).slice(2, 8);
const BASE = `http://localhost:${PORT}/api`;

let PASS = 0, FAIL = 0;
const eq = (a, b, m) => { if (a === b) PASS++; else { FAIL++; console.error(`  ✗ ${m}: kutildi ${JSON.stringify(b)}, keldi ${JSON.stringify(a)}`); } };

function clean() { for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* */ } } }
async function waitHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/api/health`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
async function api(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* */ }
  return { status: res.status, data };
}

clean();
console.log('\n══  bootstrap-cache (ko\'p foydalanuvchida tezlik)  ══\n');
/* MUHIM: NODE_ENV BERILMAYDI — production rejimidagi kabi kesh YOQIQ bo'lsin */
const srv = spawn(process.execPath, [SRV], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASS, JWT_SECRET: 'cache-test-secret', TG_TOKEN: '', TG_CHAT_OPS: '', NODE_ENV: '' },
});
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });

if (!(await waitHealth())) {
  console.error('✗ Server ishga tushmadi. Log:\n' + log);
  srv.kill(); clean(); process.exit(1);
}

try {
  const AT = (await api('POST', '/auth/login', { login: 'admin', pass: ADMIN_PASS })).data.token;

  /* 1) Boshlang'ich holatni keshга yozamiz */
  const b1 = await api('GET', '/bootstrap');
  eq(b1.status, 200, 'bootstrap: 200');
  const before = b1.data.settings.ownerName || '';

  /* 2) Ma'lumotni O'ZGARTIRAMIZ (bootstrap keshiga TEGMAYDI — alohida yo'l) */
  const patch = await api('PATCH', '/settings', { ownerName: 'CacheTestName1' }, AT);
  eq(patch.status, 200, 'PATCH /settings: 200');
  eq(patch.data.ownerName, 'CacheTestName1', 'PATCH javobi DARHOL yangi (bu yo\'l keshsiz)');

  /* 3) Kesh oynasi ичida (darrov) — ESKI natija kelishi kerak: server QAYTA
        hisoblamadi, demak ko'p mijoz bir vaqtда so'raса ham DB bir marta ishlaydi */
  const b2 = await api('GET', '/bootstrap');
  eq(b2.data.settings.ownerName, before, 'kesh ичida: bootstrap ESKI natijani qaytaradi (qayta hisoblamadi)');

  /* 4) Kesh muddati o'tgач — YANGI natija (ma'lumot abadiy eskirib qolmaydi) */
  await new Promise((r) => setTimeout(r, 2300));
  const b3 = await api('GET', '/bootstrap');
  eq(b3.data.settings.ownerName, 'CacheTestName1', 'kesh muddati o\'tгач: bootstrap YANGI natijani qaytaradi');

  /* 5) TEZLIK: kesh ичida 20 ta PARALLEL so'rov — barchasi TEZ va BIR XIL javob
        qaytarishi kerak (server har biriga alohida qayta hisoblamaydi) */
  const t0 = Date.now();
  const many = await Promise.all(Array.from({ length: 20 }, () => api('GET', '/bootstrap')));
  const ms = Date.now() - t0;
  const allSame = many.every((r) => r.data.settings.ownerName === many[0].data.settings.ownerName);
  eq(allSame, true, '20 parallel so\'rov — hammasi bir xil (kesh baham ko\'rildi)');
  console.log(`  ⓘ 20 parallel /api/bootstrap so'rovi ${ms}ms da tugadi`);
} finally {
  srv.kill();
  await new Promise((r) => setTimeout(r, 250));
  clean();
}

console.log(`\nbootstrap-cache: ${PASS} o'tdi, ${FAIL} yiqildi`);
process.exit(FAIL ? 1 : 0);
