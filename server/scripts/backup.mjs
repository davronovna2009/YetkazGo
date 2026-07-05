/* ===== Yetkaz.uz — ma'lumotlar bazasi zaxirasi (backup) =====
   SQLite bazasini (WAL bilan) xavfsiz nusxalab, timestamp bilan saqlaydi.
   Oxirgi KEEP ta nusxa qoladi, eskilari o'chiriladi.

   Qo'lda:   node scripts/backup.mjs
   Rejalashtirilgan: DEPLOY.md dagi Windows "Scheduled Task" / cron ko'rsatmasi. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(__dirname, '..');

const DB_PATH = process.env.DB_PATH || resolve(SERVER_DIR, 'data', 'yetkaz.db');
const BACKUP_DIR = process.env.BACKUP_DIR || resolve(SERVER_DIR, 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;   // oxirgi nechta nusxa qolsin

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const out = resolve(BACKUP_DIR, `yetkaz-${stamp()}.db`);

  /* WAL rejimида to'g'ri, izchil nusxa olish uchun SQLite ning o'z VACUUM INTO
     buyrug'ini ishlatamiz (oddiy fayl-nusxa WAL tufayli buzuq bo'lishi mumkin). */
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  db.close();

  const size = (statSync(out).size / 1024).toFixed(0);
  console.log(`✓ Zaxira yaratildi: ${out} (${size} KB)`);

  /* Eski nusxalarni tozalash (KEEP dan ortig'i) */
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => /^yetkaz-\d{8}-\d{6}\.db$/.test(f))
    .map((f) => ({ f, t: statSync(resolve(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const old = files.slice(KEEP);
  old.forEach(({ f }) => { try { unlinkSync(resolve(BACKUP_DIR, f)); } catch (e) {} });
  console.log(`  Jami nusxa: ${files.length - old.length} (KEEP=${KEEP}), o'chirildi: ${old.length}`);
}

try { main(); }
catch (e) { console.error('✗ Backup xatosi:', e.message); process.exit(1); }
