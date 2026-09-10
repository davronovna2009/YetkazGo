/* ===== Yetkaz.uz — TEST RUNNER (cross-platform, faqat Node) =====
   1) panel-units.mjs  — frontend funksiyalari (server kerak emas)
   2) money-e2e.mjs     — TOZA bazada: moliya + panellararo moslik
   3) lifecycle-e2e.mjs — TOZA bazada: to'liq hayotiy oqim (har rol, har qoida)

   Har E2E fayl O'Z toza bazasi + serveri bilan ishlaydi (test izolyatsiyasi).
   Ishlatish:  npm test        (server/ ichidan) ;  Node >= 22 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRV = resolve(HERE, '..', 'src', 'app.js');
const ADMIN_PASS = 'test-admin-pass-' + Math.random().toString(36).slice(2, 8);
let portSeq = Number(process.env.TEST_PORT || 5099);

function run(cmd, args, env) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (code) => res(code || 0));
  });
}
async function waitHealth(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/* Toza baza + serverда bitta E2E faylni bajaradi */
async function runE2E(file, label) {
  const PORT = String(portSeq++);
  const DB = resolve(HERE, `.tmp-${file.replace(/\W/g, '')}.db`);
  const clean = () => { for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* */ } } };
  clean();
  console.log(`\n══  ${label}  ══\n`);
  const srv = spawn(process.execPath, [SRV], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT, DB_PATH: DB, ADMIN_PASS, JWT_SECRET: 'test-secret', NODE_ENV: 'test', TG_TOKEN: '', TG_CHAT_OPS: '' },
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  if (!(await waitHealth(`http://localhost:${PORT}/api/health`))) {
    console.error('✗ Server ishga tushmadi. Log:\n' + log);
    srv.kill(); clean(); return 1;
  }
  const code = await run(process.execPath, [resolve(HERE, file)], {
    E2E_BASE: `http://localhost:${PORT}/api`, E2E_ADMIN_PASS: ADMIN_PASS,
  });
  srv.kill();
  await new Promise((r) => setTimeout(r, 250));
  clean();
  return code;
}

let fail = 0;

console.log('\n══  1/3  panel-units (server kerak emas)  ══\n');
fail += await run(process.execPath, [resolve(HERE, 'panel-units.mjs')]);

fail += await runE2E('money-e2e.mjs', '2/3  money-e2e (moliya + panellararo moslik)');
fail += await runE2E('lifecycle-e2e.mjs', '3/3  lifecycle-e2e (to\'liq hayotiy oqim)');

console.log(fail ? '\n✗ TESTLAR YIQILDI\n' : '\n✓ HAMMA TEST O‘TDI\n');
process.exit(fail ? 1 : 0);
