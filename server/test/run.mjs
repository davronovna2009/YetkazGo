/* ===== Yetkaz.uz — TEST RUNNER (cross-platform, faqat Node) =====
   1) panel-units.mjs — frontend moliya funksiyalari (server kerak emas)
   2) money-e2e.mjs   — toza bazada server ishga tushirib, to'liq oqim +
                        panellararo moslik (admin/restoran/kuryer/kabinet)

   Ishlatish:  npm test        (server/ ichidan)
   Talab:      Node >= 22 (o'rnatilgan `fetch`, `--env-file` shart emas) */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRV = resolve(HERE, '..', 'src', 'app.js');
const DB = resolve(HERE, '.tmp-test.db');
const PORT = process.env.TEST_PORT || '5099';
const ADMIN_PASS = 'test-admin-pass-' + Math.random().toString(36).slice(2, 8);

function run(cmd, args, env) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => res(code || 0));
  });
}

async function waitHealth(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function cleanDb() {
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* yo'q */ } }
}

let fail = 0;

/* ---- 1) Panel birlik testlari ---- */
console.log('\n══ 1/2  panel-units (frontend moliya funksiyalari) ══\n');
fail += await run(process.execPath, [resolve(HERE, 'panel-units.mjs')]);

/* ---- 2) Server E2E ---- */
console.log('\n══ 2/2  money-e2e (server + panellararo moslik) ══\n');
cleanDb();
const srv = spawn(process.execPath, [SRV], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT, DB_PATH: DB, ADMIN_PASS,
    JWT_SECRET: 'test-secret', NODE_ENV: 'test', TG_TOKEN: '', TG_CHAT_OPS: '',
  },
});
let srvlog = '';
srv.stdout.on('data', (d) => { srvlog += d; });
srv.stderr.on('data', (d) => { srvlog += d; });

const ok = await waitHealth(`http://localhost:${PORT}/api/health`);
if (!ok) {
  console.error('✗ Server ishga tushmadi. Log:\n' + srvlog);
  srv.kill(); cleanDb(); process.exit(1);
}

fail += await run(process.execPath, [resolve(HERE, 'money-e2e.mjs')], {
  E2E_BASE: `http://localhost:${PORT}/api`,
  E2E_ADMIN_PASS: ADMIN_PASS,
});

srv.kill();
await new Promise((r) => setTimeout(r, 300));
cleanDb();

console.log(fail ? '\n✗ TESTLAR YIQILDI\n' : '\n✓ HAMMA TEST O‘TDI\n');
process.exit(fail ? 1 : 0);
